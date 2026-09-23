import type { GtfsFileSet } from '../core/synthetic-gtfs/types';
import { randomUUID } from 'node:crypto';
import type { MotisOsmPbfResolution, MotisProgress, MotisRequestInit, MotisRuntimeDefaults, MotisStatus } from '../shared/types';
import { assertLocalMotisRequestPath, type MotisPreparationResult, type MotisSidecar, type MotisSidecarOptions } from './motis-sidecar';
import { createMotisPreparationCache, type MotisBinaryIdentity } from './motis-preparation-cache';
import type { MotisOsmPbfMetadata } from '../shared/types';

export interface MotisPreparePayload {
  osmPbfPath: string;
  files: GtfsFileSet;
  operationId?: string;
}

interface MotisIpcDependencies {
  buildDefaults: () => Promise<MotisRuntimeDefaults>;
  prepare: (options: MotisSidecarOptions, files: GtfsFileSet, onProgress?: (phase: 'configuring' | 'importing') => void) => Promise<MotisPreparationResult>;
  sidecar: Pick<MotisSidecar, 'start' | 'request' | 'stop' | 'getStatus'>;
  inspectPbf?: (path: string) => Promise<MotisOsmPbfMetadata>;
  binaryIdentity?: () => Promise<MotisBinaryIdentity>;
  emitProgress?: (progress: MotisProgress) => void;
  resolveOsmPbf?: (forceRescan: boolean) => Promise<MotisOsmPbfResolution>;
}

export interface MotisIpcHandlers {
  prepare(payload: unknown): Promise<MotisPreparationResult>;
  start(operationId?: string): Promise<MotisStatus>;
  request(path: unknown, init?: MotisRequestInit, operationId?: string): Promise<unknown>;
  stop(): Promise<MotisStatus>;
  resolveOsmPbf(forceRescan?: boolean): Promise<MotisOsmPbfResolution>;
}

function parsePreparePayload(payload: unknown): MotisPreparePayload {
  if (!payload || typeof payload !== 'object') throw new Error('MOTIS 준비 요청이 유효하지 않습니다.');
  const value = payload as Record<string, unknown>;
  if (typeof value.osmPbfPath !== 'string' || !value.osmPbfPath.trim() || !value.files || typeof value.files !== 'object') {
    throw new Error('MOTIS 준비 요청이 유효하지 않습니다.');
  }
  return { osmPbfPath: value.osmPbfPath, files: value.files as GtfsFileSet, operationId: typeof value.operationId === 'string' && value.operationId.trim() ? value.operationId.trim() : undefined };
}

function operationId(value: string | undefined): string {
  return value?.trim() || randomUUID();
}

function phaseMessage(phase: MotisProgress['phase']): string {
  switch (phase) {
    case 'checking': return 'MOTIS 준비 상태와 지도 데이터를 확인하는 중입니다.';
    case 'configuring': return 'MOTIS 네트워크 구성을 생성하는 중입니다.';
    case 'importing': return 'MOTIS에 대중교통 네트워크를 import하는 중입니다.';
    case 'starting': return 'MOTIS 서버를 시작하는 중입니다.';
    case 'querying': return '경로를 조회하는 중입니다.';
    case 'ready': return 'MOTIS 경로탐색 준비가 완료되었습니다.';
    case 'failed': return 'MOTIS 경로탐색 준비에 실패했습니다.';
    case 'building': return '현행 노선 네트워크를 구성하는 중입니다.';
  }
}

export function buildManagedMotisOptions(defaults: MotisRuntimeDefaults, osmPbfPath: string): MotisSidecarOptions {
  return {
    ...defaults,
    osmPbfPath,
    args: ['server'],
    environment: { TBB_NUM_THREADS: '1' },
    disableTiles: true,
    healthPath: '/api/v1/health',
    startupTimeoutMs: 30000
  };
}

export function createMotisIpcHandlers(dependencies: MotisIpcDependencies): MotisIpcHandlers {
  let preparedOptions: MotisSidecarOptions | undefined;
  const preparationCache = createMotisPreparationCache({
    prepare: dependencies.prepare,
    inspectPbf: dependencies.inspectPbf,
    binaryIdentity: dependencies.binaryIdentity,
    sidecar: dependencies.sidecar
  });

  return {
    prepare: async (payload) => {
      const input = parsePreparePayload(payload);
      const options = buildManagedMotisOptions(await dependencies.buildDefaults(), input.osmPbfPath);
      const id = operationId(input.operationId);
      const emit = (phase: MotisProgress['phase'], extra: Partial<MotisProgress> = {}): void => dependencies.emitProgress?.({ operationId: id, phase, message: phaseMessage(phase), ...extra });
      emit('checking');
      preparedOptions = undefined;
      try {
        const result = await preparationCache.prepare(options, input.files, (phase) => emit(phase));
        preparedOptions = { ...options, dataDirectory: result.dataDirectory, preparationFingerprint: result.fingerprint };
        emit('ready', { fingerprint: result.fingerprint, cacheHit: result.cacheHit });
        return result;
      } catch (error) {
        emit('failed', { message: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
    start: async (requestedOperationId) => {
      if (!preparedOptions) throw new Error('먼저 Synthetic GTFS를 MOTIS에 import해야 합니다.');
      const id = operationId(requestedOperationId);
      const current = dependencies.sidecar.getStatus();
      if (current.state === 'ready' && current.preparationFingerprint === preparedOptions.preparationFingerprint) return current;
      dependencies.emitProgress?.({ operationId: id, phase: 'starting', message: phaseMessage('starting'), fingerprint: preparedOptions.preparationFingerprint });
      try {
        const status = await dependencies.sidecar.start(preparedOptions);
        if (status.state === 'failed') dependencies.emitProgress?.({ operationId: id, phase: 'failed', message: status.message ?? phaseMessage('failed'), fingerprint: preparedOptions.preparationFingerprint });
        else if (status.state === 'ready') dependencies.emitProgress?.({ operationId: id, phase: 'ready', message: phaseMessage('ready'), fingerprint: preparedOptions.preparationFingerprint });
        return status;
      } catch (error) {
        dependencies.emitProgress?.({ operationId: id, phase: 'failed', message: error instanceof Error ? error.message : String(error), fingerprint: preparedOptions.preparationFingerprint });
        throw error;
      }
    },
    request: async (path, init, requestedOperationId) => {
      assertLocalMotisRequestPath(path, dependencies.sidecar.getStatus().baseUrl);
      if (init?.method && !['GET', 'POST'].includes(init.method)) throw new Error('허용되지 않는 MOTIS HTTP 메서드입니다.');
      const id = operationId(requestedOperationId);
      dependencies.emitProgress?.({ operationId: id, phase: 'querying', message: phaseMessage('querying') });
      try {
        return await dependencies.sidecar.request(path, init);
      } catch (error) {
        dependencies.emitProgress?.({ operationId: id, phase: 'failed', message: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
    stop: async () => {
      await dependencies.sidecar.stop();
      return dependencies.sidecar.getStatus();
    },
    resolveOsmPbf: async (forceRescan = false) => {
      if (!dependencies.resolveOsmPbf) throw new Error('OSM PBF 자동 탐색을 사용할 수 없습니다.');
      return dependencies.resolveOsmPbf(forceRescan);
    }
  };
}

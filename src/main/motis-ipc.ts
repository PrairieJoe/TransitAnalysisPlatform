import type { GtfsFileSet } from '../core/synthetic-gtfs/types';
import type { MotisRequestInit, MotisRuntimeDefaults, MotisStatus } from '../shared/types';
import { assertLocalMotisRequestPath, type MotisPreparationResult, type MotisSidecar, type MotisSidecarOptions } from './motis-sidecar';

export interface MotisPreparePayload {
  osmPbfPath: string;
  files: GtfsFileSet;
}

interface MotisIpcDependencies {
  buildDefaults: () => Promise<MotisRuntimeDefaults>;
  prepare: (options: MotisSidecarOptions, files: GtfsFileSet) => Promise<MotisPreparationResult>;
  sidecar: Pick<MotisSidecar, 'start' | 'request' | 'stop' | 'getStatus'>;
}

export interface MotisIpcHandlers {
  prepare(payload: unknown): Promise<MotisPreparationResult>;
  start(): Promise<MotisStatus>;
  request(path: unknown, init?: MotisRequestInit): Promise<unknown>;
  stop(): Promise<MotisStatus>;
}

function parsePreparePayload(payload: unknown): MotisPreparePayload {
  if (!payload || typeof payload !== 'object') throw new Error('MOTIS 준비 요청이 유효하지 않습니다.');
  const value = payload as Record<string, unknown>;
  if (typeof value.osmPbfPath !== 'string' || !value.osmPbfPath.trim() || !value.files || typeof value.files !== 'object') {
    throw new Error('MOTIS 준비 요청이 유효하지 않습니다.');
  }
  return { osmPbfPath: value.osmPbfPath, files: value.files as GtfsFileSet };
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

  return {
    prepare: async (payload) => {
      const input = parsePreparePayload(payload);
      const options = buildManagedMotisOptions(await dependencies.buildDefaults(), input.osmPbfPath);
      const result = await dependencies.prepare(options, input.files);
      preparedOptions = options;
      return result;
    },
    start: async () => {
      if (!preparedOptions) throw new Error('먼저 Synthetic GTFS를 MOTIS에 import해야 합니다.');
      return dependencies.sidecar.start(preparedOptions);
    },
    request: async (path, init) => {
      assertLocalMotisRequestPath(path, dependencies.sidecar.getStatus().baseUrl);
      if (init?.method && !['GET', 'POST'].includes(init.method)) throw new Error('허용되지 않는 MOTIS HTTP 메서드입니다.');
      return dependencies.sidecar.request(path, init);
    },
    stop: async () => {
      await dependencies.sidecar.stop();
      return dependencies.sidecar.getStatus();
    }
  };
}

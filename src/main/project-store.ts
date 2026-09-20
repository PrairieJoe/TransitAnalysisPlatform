import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { assertValidScenarioDefinitions } from '../core/scenario-contract';
import type { NormalizedRecord, ProjectManifest, ProjectSummary, ScenarioExecutionManifest, ScenarioExecutionResult, ScenarioExecutionTarget } from '../shared/types';

export type ProjectMetadata = Omit<ProjectManifest, 'records'>;

export interface SaveScenarioExecutionPayload {
  projectId: string;
  manifest: ScenarioExecutionManifest;
  result: ScenarioExecutionResult;
}

export interface ReadScenarioExecutionPayload {
  projectId: string;
  executionId: string;
}

/** State-only saves never serialize records or rewrite DuckDB. */
export function createProjectStore(root: string, writeDatabase: (path: string, records: NormalizedRecord[]) => Promise<void>) {
  const pending = new Map<string, Promise<unknown>>();
  function folder(id: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('프로젝트 ID가 유효하지 않습니다.');
    return join(root, id);
  }
  function executionId(value: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error('실행 ID가 유효하지 않습니다.');
    return value;
  }
  function artifactFileName(id: string): string {
    return `scenario-executions/${executionId(id)}.json`;
  }
  function sameTarget(left: ScenarioExecutionTarget, right: ScenarioExecutionTarget): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  async function serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
    folder(id);
    const next = (pending.get(id) ?? Promise.resolve()).catch(() => {}).then(operation);
    pending.set(id, next);
    try { return await next; }
    finally { if (pending.get(id) === next) pending.delete(id); }
  }
  async function atomicJson(path: string, value: unknown): Promise<void> {
    await writeFile(`${path}.tmp`, JSON.stringify(value), 'utf8');
    await rename(`${path}.tmp`, path);
  }
  async function readExecutionManifests(id: string): Promise<ScenarioExecutionManifest[]> {
    const metadata = await readMetadataInternal(id);
    return [...(metadata.scenarioExecutionManifests ?? [])];
  }
  async function markExecutionFailed(id: string, executionIdValue: string): Promise<void> {
    try {
      const metadata = await readMetadataInternal(id);
      const manifests = (metadata.scenarioExecutionManifests ?? []).map((manifest) => manifest.executionId === executionIdValue ? { ...manifest, status: 'failed' as const, updatedAt: new Date().toISOString() } : manifest);
      await atomicJson(join(folder(id), 'project-state.json'), { ...metadata, scenarioExecutionManifests: manifests });
    } catch { /* preserve the original artifact error when metadata cannot be updated */ }
  }
  function toSummary(metadata: Pick<ProjectManifest, 'schemaVersion' | 'id' | 'name' | 'createdAt' | 'updatedAt' | 'sourceFiles' | 'analysisMode'> & { routeStopMaster?: ProjectManifest['routeStopMaster'] }, recordCount: number, hasRouteMaster = Boolean(metadata.routeStopMaster?.length)): ProjectSummary {
    return {
      schemaVersion: metadata.schemaVersion,
      id: metadata.id,
      name: metadata.name,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      sourceFiles: metadata.sourceFiles,
      ...(metadata.analysisMode ? { analysisMode: metadata.analysisMode } : {}),
      recordCount,
      hasRouteMaster
    };
  }
  async function readSummaryInternal(id: string): Promise<ProjectSummary> {
    const dir = folder(id);
    try {
      const summary = JSON.parse(await readFile(join(dir, 'project-summary.json'), 'utf8')) as ProjectMetadata & { recordCount?: number; hasRouteMaster?: boolean };
      if (summary.id !== id) throw new Error('프로젝트 요약 ID가 일치하지 않습니다.');
      return toSummary(summary, summary.recordCount ?? 0, summary.hasRouteMaster ?? Boolean(summary.routeStopMaster?.length));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const { records, ...metadata } = await readStoredProject(id);
      return toSummary(metadata, records.length);
    }
  }
  async function readMetadataInternal(id: string): Promise<ProjectMetadata> {
    const dir = folder(id);
    try {
      const state: ProjectMetadata = JSON.parse(await readFile(join(dir, 'project-state.json'), 'utf8'));
      if (state.id !== id) throw new Error('프로젝트 설정 ID가 일치하지 않습니다.');
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const base: ProjectManifest = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8'));
    const { records: _records, ...metadata } = base;
    return metadata;
  }
  async function readStoredProject(id: string): Promise<ProjectManifest> {
    const dir = folder(id);
    const base: ProjectManifest = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8'));
    try {
      const state: ProjectMetadata = JSON.parse(await readFile(join(dir, 'project-state.json'), 'utf8'));
      if (state.id !== id) throw new Error('프로젝트 설정 ID가 일치하지 않습니다.');
      return { ...state, records: base.records };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return base;
    }
  }
  return {
    save: (project: ProjectManifest) => serial(project.id, async () => {
      assertValidScenarioDefinitions(project.scenarioDefinitions);
      const dir = folder(project.id);
      await mkdir(dir, { recursive: true });
      await writeDatabase(join(dir, 'records.duckdb'), project.records);
      await atomicJson(join(dir, 'project.json'), project);
      const { records, ...metadata } = project;
      await atomicJson(join(dir, 'project-summary.json'), toSummary(metadata, records.length));
      await rm(join(dir, 'project-state.json'), { force: true });
    }),
    saveMetadata: (metadata: ProjectMetadata) => serial(metadata.id, async () => {
      assertValidScenarioDefinitions(metadata.scenarioDefinitions);
      if ('records' in metadata) throw new Error('설정 저장에 원본 거래내역을 포함할 수 없습니다.');
      const dir = folder(metadata.id);
      await access(join(dir, 'project.json'));
      const currentSummary = await readSummaryInternal(metadata.id);
      await atomicJson(join(dir, 'project-state.json'), metadata);
      await atomicJson(join(dir, 'project-summary.json'), toSummary(metadata, currentSummary.recordCount));
    }),
    read: (id: string) => serial(id, () => readStoredProject(id)),
    readMetadata: (id: string) => serial(id, () => readMetadataInternal(id)),
    readSummary: (id: string) => serial(id, () => readSummaryInternal(id)),
    saveScenarioExecution: (payload: SaveScenarioExecutionPayload) => serial(payload.projectId, async () => {
      const dir = folder(payload.projectId);
      await access(join(dir, 'project.json'));
      const manifest = payload.manifest;
      const result = payload.result;
      const expectedArtifact = artifactFileName(manifest.executionId);
      const metadata = await readMetadataInternal(payload.projectId);
      const existing = metadata.scenarioExecutionManifests ?? [];
      const matching = existing.find((item) => item.status === 'complete' && item.inputFingerprint === manifest.inputFingerprint && sameTarget(item.target, manifest.target));
      if (matching) return matching;
      if (manifest.artifactFileName !== expectedArtifact) throw new Error('실행 artifact 파일명이 실행 ID와 일치하지 않습니다.');
      if (result.executionId !== manifest.executionId || result.inputFingerprint !== manifest.inputFingerprint || !sameTarget(result.target, manifest.target)) {
        throw new Error('실행 manifest와 결과 artifact의 식별자가 일치하지 않습니다.');
      }

      const artifactPath = join(dir, expectedArtifact.replace('/', '\\'));
      await mkdir(join(dir, 'scenario-executions'), { recursive: true });
      const temporaryArtifactPath = `${artifactPath}.tmp-${randomUUID()}`;
      await writeFile(temporaryArtifactPath, JSON.stringify(result), 'utf8');
      await rename(temporaryArtifactPath, artifactPath);
      try {
        assertValidScenarioDefinitions(metadata.scenarioDefinitions);
        const withoutSameId = existing.filter((item) => item.executionId !== manifest.executionId);
        const manifests = [...withoutSameId, { ...manifest, artifactFileName: expectedArtifact }].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        const nextMetadata: ProjectMetadata = { ...metadata, scenarioExecutionManifests: manifests };
        const summary = await readSummaryInternal(payload.projectId);
        await atomicJson(join(dir, 'project-state.json'), nextMetadata);
        await atomicJson(join(dir, 'project-summary.json'), toSummary(nextMetadata, summary.recordCount));
      } catch (error) {
        const failedManifest = { ...manifest, artifactFileName: expectedArtifact, status: 'failed' as const, updatedAt: new Date().toISOString() };
        await atomicJson(join(dir, 'project-state.json'), { ...metadata, scenarioExecutionManifests: [...existing.filter((item) => item.executionId !== manifest.executionId), failedManifest] }).catch(() => {});
        throw error;
      }
      return { ...manifest, artifactFileName: expectedArtifact };
    }),
    readScenarioExecution: (payload: ReadScenarioExecutionPayload) => serial(payload.projectId, async () => {
      const dir = folder(payload.projectId);
      const id = executionId(payload.executionId);
      const manifests = await readExecutionManifests(payload.projectId);
      const manifest = manifests.find((item) => item.executionId === id);
      if (!manifest) throw new Error(`실행 결과 ${id}를 찾을 수 없습니다.`);
      if (manifest.artifactFileName !== artifactFileName(id)) throw new Error('실행 artifact 경로가 유효하지 않습니다.');
      try {
        const result = JSON.parse(await readFile(join(dir, artifactFileName(id).replace('/', '\\')), 'utf8')) as ScenarioExecutionResult;
        if (result.executionSchemaVersion !== 1 || result.executionId !== manifest.executionId || result.inputFingerprint !== manifest.inputFingerprint || !sameTarget(result.target, manifest.target)) {
          throw new Error('실행 결과 JSON 식별자가 manifest와 일치하지 않습니다.');
        }
        return result;
      } catch (error) {
        await markExecutionFailed(payload.projectId, id);
        if (error instanceof SyntaxError) throw new Error('실행 결과 JSON이 손상되었습니다.');
        throw error;
      }
    }),
    listScenarioExecutionManifests: (id: string) => serial(id, () => readExecutionManifests(id))
  };
}

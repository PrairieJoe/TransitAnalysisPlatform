import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NormalizedRecord, ProjectManifest } from '../shared/types';

export type ProjectMetadata = Omit<ProjectManifest, 'records'>;

/** State-only saves never serialize records or rewrite DuckDB. */
export function createProjectStore(root: string, writeDatabase: (path: string, records: NormalizedRecord[]) => Promise<void>) {
  const pending = new Map<string, Promise<unknown>>();
  function folder(id: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('프로젝트 ID가 유효하지 않습니다.');
    return join(root, id);
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
  return {
    save: (project: ProjectManifest) => serial(project.id, async () => {
      const dir = folder(project.id);
      await mkdir(dir, { recursive: true });
      await writeDatabase(join(dir, 'records.duckdb'), project.records);
      await atomicJson(join(dir, 'project.json'), project);
      await rm(join(dir, 'project-state.json'), { force: true });
    }),
    saveMetadata: (metadata: ProjectMetadata) => serial(metadata.id, async () => {
      if ('records' in metadata) throw new Error('설정 저장에 원본 거래내역을 포함할 수 없습니다.');
      const dir = folder(metadata.id);
      await access(join(dir, 'project.json'));
      await atomicJson(join(dir, 'project-state.json'), metadata);
    }),
    read: (id: string) => serial(id, async (): Promise<ProjectManifest> => {
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
    })
  };
}

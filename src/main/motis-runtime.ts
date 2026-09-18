import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import type { MotisRuntimeDefaults } from '../shared/types';

export interface MotisRuntimeContext {
  isPackaged: boolean;
  resourcesPath: string;
  projectRoot: string;
  userDataPath: string;
  localAppDataPath?: string;
  exists?: (path: string) => boolean;
}

export function resolveMotisExecutablePath(context: Pick<MotisRuntimeContext, 'isPackaged' | 'resourcesPath' | 'projectRoot'> & { exists?: (path: string) => boolean }): string {
  const candidates = context.isPackaged
    ? [join(context.resourcesPath, 'motis', 'motis.exe')]
    : [
        join(context.projectRoot, 'vendor', 'motis', 'patched-windows', 'motis.exe'),
        join(context.projectRoot, 'vendor', 'motis', 'windows', 'motis.exe')
      ];
  const exists = context.exists ?? existsSync;
  return candidates.find((candidate) => exists(candidate)) ?? candidates[0];
}

export function resolveMotisDataDirectory(userDataPath?: string, localAppDataPath?: string): string {
  const localAppDataRoot = localAppDataPath?.trim();
  const dataRoot = localAppDataRoot || (userDataPath ? dirname(userDataPath) : undefined);
  if (!dataRoot) throw new Error('MOTIS 데이터 디렉터리 기준 경로를 확인하지 못했습니다.');
  return join(dataRoot, 'Transit Analysis Platform', 'motis-data');
}

async function probeLoopbackPort(port: number): Promise<number> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port }, () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('사용 가능한 MOTIS 포트를 확인하지 못했습니다.');
    return address.port;
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export async function findAvailableLoopbackPort(preferredPort = 0): Promise<number> {
  try {
    return await probeLoopbackPort(preferredPort);
  } catch (error) {
    if (preferredPort === 0 || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    return probeLoopbackPort(0);
  }
}

export async function buildMotisRuntimeDefaults(context: MotisRuntimeContext): Promise<MotisRuntimeDefaults> {
  return {
    executablePath: resolveMotisExecutablePath(context),
    dataDirectory: resolveMotisDataDirectory(context.userDataPath, context.localAppDataPath),
    port: await findAvailableLoopbackPort()
  };
}

export function createCachedMotisRuntimeDefaultsLoader(loader: () => Promise<MotisRuntimeDefaults>): () => Promise<MotisRuntimeDefaults> {
  let cached: Promise<MotisRuntimeDefaults> | undefined;
  return () => {
    if (!cached) {
      cached = loader().catch((error) => {
        cached = undefined;
        throw error;
      });
    }
    return cached;
  };
}

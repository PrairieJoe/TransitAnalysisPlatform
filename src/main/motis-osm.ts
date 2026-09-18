import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { MotisOsmPbfMetadata } from '../shared/types';

export const GEOFABRIK_SOUTH_KOREA_URL = 'https://download.geofabrik.de/asia/south-korea.html';

export async function inspectOsmPbf(filePath: string): Promise<MotisOsmPbfMetadata> {
  const normalizedPath = filePath.trim();
  if (!normalizedPath) throw new Error('OSM PBF 파일을 선택하세요.');

  let fileStats;
  try {
    fileStats = await stat(normalizedPath);
  } catch {
    throw new Error(`OSM PBF 파일을 찾을 수 없습니다: ${normalizedPath}`);
  }
  if (!fileStats.isFile()) throw new Error(`OSM PBF 파일을 찾을 수 없습니다: ${normalizedPath}`);

  const hash = createHash('sha256');
  for await (const chunk of createReadStream(normalizedPath)) hash.update(chunk);
  return { path: normalizedPath, fileName: basename(normalizedPath), sizeBytes: fileStats.size, sha256: hash.digest('hex').toUpperCase() };
}

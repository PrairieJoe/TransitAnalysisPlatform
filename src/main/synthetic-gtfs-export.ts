import { BrowserWindow, dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import type { GtfsFileSet } from '../core/synthetic-gtfs/types';

const GTFS_FILE_NAMES: Array<keyof GtfsFileSet> = [
  'agency.txt',
  'stops.txt',
  'routes.txt',
  'trips.txt',
  'stop_times.txt',
  'calendar.txt',
  'tap-motis-config.json',
  'tap-provenance.json',
  'tap-validation.json'
];

function safeFileName(fileName: string): string {
  const normalized = fileName.trim().replace(/[<>:"/\\|?*]/g, '_');
  return normalized.toLowerCase().endsWith('.zip') ? normalized : `${normalized || 'synthetic-gtfs'}.zip`;
}

function assertFileSet(files: GtfsFileSet): void {
  for (const name of GTFS_FILE_NAMES) if (typeof files?.[name] !== 'string') throw new Error(`GTFS 파일이 없습니다: ${name}`);
}

export async function exportSyntheticGtfsZip(window: BrowserWindow, fileName: string, files: GtfsFileSet): Promise<boolean> {
  assertFileSet(files);
  const result = await dialog.showSaveDialog(window, {
    defaultPath: safeFileName(fileName),
    filters: [{ name: 'Synthetic GTFS ZIP', extensions: ['zip'] }]
  });
  if (result.canceled || !result.filePath) return false;
  const zip = new JSZip();
  for (const name of GTFS_FILE_NAMES) zip.file(name, files[name]);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await writeFile(result.filePath, buffer);
  return true;
}

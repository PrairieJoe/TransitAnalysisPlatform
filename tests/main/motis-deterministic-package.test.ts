import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { packageDeterministicCandidate } from '../../scripts/motis/package-deterministic-candidate.mjs';

describe('deterministic Custom MOTIS packaging', () => {
  it('produces the same archive and payload tree for the same candidate files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tap-motis-deterministic-'));
    try {
      const payload = join(root, 'payload');
      await mkdir(payload);
      await writeFile(join(payload, 'motis.exe'), 'candidate binary');
      await writeFile(join(payload, 'motis-manifest.json'), JSON.stringify({ schemaVersion: 2 }));
      await writeFile(join(payload, 'nested.txt'), 'stable payload');

      const first = await packageDeterministicCandidate(payload, join(root, 'first.zip'));
      const second = await packageDeterministicCandidate(payload, join(root, 'second.zip'));

      expect(second.archiveSha256).toBe(first.archiveSha256);
      expect(second.payloadTreeSha256).toBe(first.payloadTreeSha256);
      expect(second.files.map((entry) => entry.path)).toEqual(['motis-manifest.json', 'motis.exe', 'nested.txt']);
      expect(await readFile(join(root, 'first.zip'))).toEqual(await readFile(join(root, 'second.zip')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses to package a candidate without motis.exe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tap-motis-deterministic-missing-'));
    try {
      const payload = join(root, 'payload');
      await mkdir(payload);
      await writeFile(join(payload, 'motis-manifest.json'), '{}');
      await expect(packageDeterministicCandidate(payload, join(root, 'candidate.zip'))).rejects.toThrow(/motis\.exe/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

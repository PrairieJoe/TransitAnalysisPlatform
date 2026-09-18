import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Electron preload packaging', () => {
  it('uses a sandbox-compatible CommonJS preload entry', () => {
    const mainSource = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
    const viteConfigSource = readFileSync(new URL('../../electron.vite.config.ts', import.meta.url), 'utf8');

    expect(mainSource).toContain("'../preload/index.cjs'");
    expect(viteConfigSource).toContain("format: 'cjs'");
    expect(viteConfigSource).toContain("entryFileNames: 'index.cjs'");
  });
});

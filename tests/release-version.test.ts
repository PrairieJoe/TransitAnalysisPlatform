import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('0.8.0 release surfaces', () => {
  it('keeps package metadata and user docs aligned', () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };
    const packageLock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8')) as { packages: { '': { version: string } } };
    const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

    expect(packageJson.version).toBe('0.8.0');
    expect(packageLock.packages[''].version).toBe('0.8.0');
    expect(changelog).toContain('## 0.8.0');
    expect(readme).toContain('분석 결과');
    expect(readme).toContain('계획·시나리오');
    expect(readme).toContain('노선 개편 시나리오');
    expect(changelog).toContain('현행');
    expect(changelog).toContain('개편안');
    expect(changelog).not.toContain('## 0.8.1');
  });
});

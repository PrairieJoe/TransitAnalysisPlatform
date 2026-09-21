import { describe, expect, it } from 'vitest';

import { evaluateReadiness } from '../../scripts/release/verify-release-readiness.mjs';

describe('release readiness verifier', () => {
  it('rejects the current repository in stable mode while the builder is still a probe', async () => {
    const report = await evaluateReadiness({ mode: 'stable' });

    expect(report.releaseReady).toBe(false);
    expect(report.checks.find((entry) => entry.name === 'app-version')?.passed).toBe(false);
    expect(report.checks.find((entry) => entry.name === 'builder-lock')?.passed).toBe(false);
    expect(report.checks.find((entry) => entry.name === 'final-evidence')?.passed).toBe(false);
  });

  it('keeps RC mode non-promotable but reports the repository as internally consistent', async () => {
    const report = await evaluateReadiness({ mode: 'rc' });

    expect(report.appVersion).toBe('0.7.0-rc.1');
    expect(report.releaseReady).toBe(false);
    expect(report.internalConsistent).toBe(true);
  });
});

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBuilderLock, verifyBuilderObservation, verifyReleaseAttestation } from '../../scripts/motis/builder-lock.mjs';

const source = {
  motisVersion: 'v2.11.3',
  motisCommit: 'b228a4519d196d9dd01b5ce80be46e642abc953e',
  osrCommit: 'a7b2ec2728544304ef1d8397b3042abc8d10f7e7'
};

const patch = {
  id: 'osr-max-ways-per-node-32',
  file: 'scripts/motis/osr-max-ways-per-node-32.patch',
  sha256: '4754d17b7d9b04cf928439e91dff29a19266d8f74f7da0de09bf3b253737ec91'
};

function msvcObservation() {
  return {
    compilerFamily: 'MSVC',
    compilerVersion: '19.42.34436',
    windowsSdkVersion: '10.0.26100.0',
    cmakeVersion: '3.31.6',
    ninjaVersion: '1.12.1',
    generator: 'Ninja',
    runnerImage: 'windows-2025'
  };
}

function builderLock({ state, toolchain, release }: {
  state: 'probe' | 'locked';
  toolchain?: ReturnType<typeof msvcObservation>;
  release?: { buildRunId: string; archiveSha256: string; binarySha256: string; pbfSha256: string; scenarioReportSha256: string };
}) {
  return {
    schemaVersion: 1,
    state,
    source,
    patch,
    artifact: { format: 'zip', manifestSchemaVersion: 2 },
    ...(toolchain ? { toolchain } : {}),
    ...(release ? { release } : {})
  };
}

describe('MOTIS builder lock', () => {
  it('allows an MSVC probe but blocks publishing while the toolchain is unlocked', () => {
    const lock = builderLock({ state: 'probe' });

    expect(() => verifyBuilderObservation(lock, msvcObservation(), { requireLocked: false })).not.toThrow();
    expect(() => verifyBuilderObservation(lock, msvcObservation(), { requireLocked: true })).toThrow(/locked/i);
  });

  it('rejects compiler and SDK drift after locking', () => {
    const lock = builderLock({ state: 'locked', toolchain: msvcObservation() });

    expect(() => verifyBuilderObservation(lock, { ...msvcObservation(), windowsSdkVersion: 'different' }, { requireLocked: true })).toThrow(/Windows SDK/i);
  });

  it('requires the locked toolchain to record its compiler family and generator', () => {
    const { generator: _generator, ...incompleteToolchain } = msvcObservation();
    const lock = builderLock({ state: 'locked', toolchain: incompleteToolchain as ReturnType<typeof msvcObservation> });

    expect(() => verifyBuilderObservation(lock, msvcObservation(), { requireLocked: true })).toThrow(/generator.*required/i);
  });

  it('rejects malformed lock JSON and an unknown lock schema', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tap-builder-lock-'));
    const malformedPath = join(root, 'malformed.json');
    const unknownSchemaPath = join(root, 'unknown-schema.json');
    await writeFile(malformedPath, '{');
    await writeFile(unknownSchemaPath, JSON.stringify({ ...builderLock({ state: 'probe' }), schemaVersion: 99 }));

    try {
      await expect(readBuilderLock(malformedPath)).rejects.toThrow(/invalid builder lock JSON/i);
      await expect(readBuilderLock(unknownSchemaPath)).rejects.toThrow(/unknown builder lock schema/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects persisted locked locks that do not declare MSVC with Ninja', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tap-builder-lock-identity-'));
    const mingwPath = join(root, 'mingw.json');
    const nonNinjaPath = join(root, 'non-ninja.json');
    await writeFile(mingwPath, JSON.stringify(builderLock({ state: 'locked', toolchain: { ...msvcObservation(), compilerFamily: 'MinGW' } })));
    await writeFile(nonNinjaPath, JSON.stringify(builderLock({ state: 'locked', toolchain: { ...msvcObservation(), generator: 'Visual Studio 17 2022' } })));

    try {
      await expect(readBuilderLock(mingwPath)).rejects.toThrow(/MSVC with Ninja/i);
      await expect(readBuilderLock(nonNinjaPath)).rejects.toThrow(/MSVC with Ninja/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects MinGW and incomplete builder observations', () => {
    const lock = builderLock({ state: 'probe' });

    expect(() => verifyBuilderObservation(lock, { ...msvcObservation(), compilerFamily: 'MinGW' }, { requireLocked: false })).toThrow(/MSVC with Ninja/i);
    expect(() => verifyBuilderObservation(lock, { ...msvcObservation(), ninjaVersion: '' }, { requireLocked: false })).toThrow(/Ninja.*required/i);
  });

  it('rejects an attestation whose binary hash differs from the locked release', () => {
    const lock = builderLock({
      state: 'locked',
      toolchain: msvcObservation(),
      release: { buildRunId: '12345', archiveSha256: 'a'.repeat(64), binarySha256: 'b'.repeat(64), pbfSha256: 'c'.repeat(64), scenarioReportSha256: 'd'.repeat(64) }
    });
    const attestation = { schemaVersion: 1, buildRunId: '12345', archiveSha256: 'a'.repeat(64), binarySha256: 'c'.repeat(64), pbfSha256: 'c'.repeat(64), scenarioReportSha256: 'd'.repeat(64) };

    expect(() => verifyReleaseAttestation(lock, attestation)).toThrow(/binary SHA-256 differs/i);
  });

  it('accepts an attestation whose build run and hashes match the locked release', () => {
    const lock = builderLock({
      state: 'locked',
      toolchain: msvcObservation(),
      release: { buildRunId: '12345', archiveSha256: 'a'.repeat(64), binarySha256: 'b'.repeat(64), pbfSha256: 'c'.repeat(64), scenarioReportSha256: 'd'.repeat(64) }
    });
    const attestation = { schemaVersion: 1, buildRunId: '12345', archiveSha256: 'a'.repeat(64), binarySha256: 'b'.repeat(64), pbfSha256: 'c'.repeat(64), scenarioReportSha256: 'd'.repeat(64) };

    expect(verifyReleaseAttestation(lock, attestation)).toEqual(attestation);
  });

  it('rejects an attestation whose archive hash differs from the locked release', () => {
    const lock = builderLock({
      state: 'locked',
      toolchain: msvcObservation(),
      release: { buildRunId: '12345', archiveSha256: 'a'.repeat(64), binarySha256: 'b'.repeat(64), pbfSha256: 'c'.repeat(64), scenarioReportSha256: 'd'.repeat(64) }
    });
    const attestation = { schemaVersion: 1, buildRunId: '12345', archiveSha256: 'c'.repeat(64), binarySha256: 'b'.repeat(64), pbfSha256: 'c'.repeat(64), scenarioReportSha256: 'd'.repeat(64) };

    expect(() => verifyReleaseAttestation(lock, attestation)).toThrow(/archive SHA-256 differs/i);
  });
});

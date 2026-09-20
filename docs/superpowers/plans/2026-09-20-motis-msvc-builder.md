# MOTIS MSVC Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, validate, lock, and publish the TAP-specific MOTIS `v2.11.3` Windows distribution with only the OSR `16 -> 32` functional change, using the upstream MSVC/Ninja build path instead of MinGW.

**Architecture:** A build-only workflow produces an immutable candidate artifact and a complete builder observation. Local nationwide validation tests that exact artifact and creates a hash-bound attestation. A separate manual publish workflow downloads the original run artifact, verifies the committed lock and attestation, and then creates the GitHub Release asset used by TAP packaging.

**Tech Stack:** PowerShell 7, MSVC `cl.exe`, Ninja, CMake, GitHub Actions, Node.js 24 ESM, Vitest, MOTIS `pkg` v0.23, existing Electron packaging bootstrap.

**Spec:** `docs/superpowers/specs/2026-09-20-motis-msvc-walking-integration-design.md`

## Global Constraints

- Base MOTIS is tag `v2.11.3`, commit `b228a4519d196d9dd01b5ce80be46e642abc953e`.
- Base OSR is commit `a7b2ec2728544304ef1d8397b3042abc8d10f7e7`.
- The only functional source change is `kMaxWaysPerNode` from `16` to `32`.
- The active builder must use MSVC `cl.exe` and Ninja; MinGW compatibility patches are not active inputs.
- No MOTIS executable, PBF, or compiler toolchain is committed to Git.
- A build candidate cannot be published until its exact archive and binary hashes match a nationwide validation attestation.
- A missing or invalid Custom MOTIS asset fails packaging; there is no silent fallback to the official 16-way binary.
- GitHub Release mutation remains a distinct manual action after validation.

## Review Focus

- Runner image drift: Task 1 tests that a locked compiler/SDK/CMake/Ninja mismatch blocks release verification.
- Patch contamination: Task 2 tests that only the OSR capacity patch changes tracked source and that MinGW patches are absent from the active command.
- Candidate substitution: Tasks 5 and 7 test that validation and publishing refer to the same archive and binary hashes from one build run.
- Partial distributions: Task 3 tests missing CRT DLL, UI, profiles, licenses, and invalid manifest paths.
- Unsupported OSM topology: Task 5 records an explicit failure with node ID when an input exceeds the supported 32-way bound.

---

## File Structure

- `scripts/motis/motis-builder-lock.json`: source, patch, toolchain, artifact, and validation lock state.
- `scripts/motis/builder-lock.mjs`: parse and verify builder observations, release attestations, and locked candidates.
- `scripts/motis/observe-msvc-toolchain.ps1`: emit machine-readable compiler, SDK, CMake, Ninja, and runner metadata.
- `scripts/motis/resolve-pinned-source.ps1`: obtain MOTIS `v2.11.3`, hydrate `.pkg.lock`, pin OSR, and apply only the capacity patch.
- `scripts/motis/build-patched-windows-msvc.ps1`: configure, build, test, and stage MOTIS with MSVC/Ninja.
- `scripts/motis/create-release-candidate.mjs`: generate manifest v2 and deterministic archive inventory.
- `scripts/motis/validate-release-candidate.mts`: run nationwide import, health, BUS, and walking checks against the exact archive.
- `scripts/motis/lock-release-candidate.mjs`: bind a validated candidate and build run to the release config.
- `.github/workflows/motis-build.yml`: build-only candidate workflow.
- `.github/workflows/motis-publish.yml`: separately authorized publish workflow that reuses a prior build artifact.
- Existing bootstrap/verifier files remain the consumer boundary and are upgraded to manifest v2.

### Task 1: Add the builder lock and environment verifier

**Files:**
- Create: `scripts/motis/motis-builder-lock.json`
- Create: `scripts/motis/builder-lock.mjs`
- Create: `tests/main/motis-builder-lock.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `readBuilderLock(path)`, `verifyBuilderObservation(lock, observation, options)`, and `verifyReleaseAttestation(lock, attestation)`.
- Consumes: JSON observations emitted by Task 2 and validation attestations emitted by Task 5.

- [ ] **Step 1: Write failing lock-state tests**

```ts
it('allows an MSVC probe but blocks publishing while the toolchain is unlocked', () => {
  const lock = builderLock({ state: 'probe' });
  expect(() => verifyBuilderObservation(lock, msvcObservation(), { requireLocked: false })).not.toThrow();
  expect(() => verifyBuilderObservation(lock, msvcObservation(), { requireLocked: true })).toThrow(/locked/i);
});

it('rejects compiler and SDK drift after locking', () => {
  const lock = builderLock({ state: 'locked', toolchain: msvcObservation() });
  expect(() => verifyBuilderObservation(lock, { ...msvcObservation(), windowsSdkVersion: 'different' }, { requireLocked: true })).toThrow(/Windows SDK/i);
});
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npx vitest run tests/main/motis-builder-lock.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because `builder-lock.mjs` does not exist.

- [ ] **Step 3: Implement the discriminated lock model**

```js
export function verifyBuilderObservation(lock, observation, { requireLocked = true } = {}) {
  if (observation.compilerFamily !== 'MSVC' || observation.generator !== 'Ninja') {
    throw new Error('Custom MOTIS requires MSVC with Ninja.');
  }
  if (requireLocked && lock.state !== 'locked') throw new Error('Builder toolchain is not locked.');
  if (lock.state === 'locked') {
    for (const key of ['compilerVersion', 'windowsSdkVersion', 'cmakeVersion', 'ninjaVersion']) {
      if (lock.toolchain[key] !== observation[key]) throw new Error(`Builder ${key} differs from lock.`);
    }
  }
  return observation;
}
```

The initial JSON uses `state: "probe"`, fixes the source commits and patch SHA, and contains no fabricated tool versions. `state: "locked"` requires all exact toolchain fields.

- [ ] **Step 4: Add malformed JSON, unknown schema, MinGW, missing field, and attestation hash tests**

Run: `npx vitest run tests/main/motis-builder-lock.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: PASS.

- [ ] **Step 5: Add `motis:verify-builder-lock` and commit**

```powershell
git add package.json scripts/motis/motis-builder-lock.json scripts/motis/builder-lock.mjs tests/main/motis-builder-lock.test.ts
git commit -m "build(motis): define MSVC builder lock"
```

### Task 2: Resolve pinned source and build with the upstream MSVC path

**Files:**
- Create: `scripts/motis/observe-msvc-toolchain.ps1`
- Create: `scripts/motis/resolve-pinned-source.ps1`
- Create: `scripts/motis/build-patched-windows-msvc.ps1`
- Create: `tests/main/motis-msvc-build-script.test.ts`
- Read-only reference: `deps/motis-v2.11.3/.github/workflows/ci.yml`
- Read-only reference: `scripts/motis/build-patched-windows.ps1`

**Interfaces:**
- Produces: staged distribution directory and `builder-observation.json`.
- Consumes: source and patch identities from `motis-builder-lock.json`.

- [ ] **Step 1: Write static contract tests for the new scripts**

```ts
it('mirrors the upstream MSVC Ninja targets without MinGW compatibility patches', () => {
  expect(source).toContain('-GNinja');
  expect(source).toContain('-DMOTIS_MIMALLOC=ON');
  expect(source).toMatch(/motis motis-test motis-web-ui/);
  expect(source).toContain('VCToolsRedistDir');
  expect(source).not.toMatch(/mingw|windows-mingw|msys2/i);
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx vitest run tests/main/motis-msvc-build-script.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because the MSVC scripts do not exist.

- [ ] **Step 3: Implement toolchain observation**

The script invokes `cl.exe`, `cmake --version`, and `ninja --version`, reads the selected Windows SDK and `VCToolsVersion`, and writes the observation from captured values:

```powershell
$observation = [ordered]@{
    compilerFamily = 'MSVC'
    compilerVersion = $compilerVersion
    windowsSdkVersion = $windowsSdkVersion
    cmakeVersion = $cmakeVersion
    ninjaVersion = $ninjaVersion
    generator = 'Ninja'
    runnerImage = [string]$env:ImageOS
}
$observation | ConvertTo-Json | Set-Content -Encoding utf8 $OutputPath
```

The script throws before writing when any captured value is empty.

- [ ] **Step 4: Implement pinned source resolution**

Reuse only the existing download, commit verification, `pkg` hydration, line-ending normalization, and nested-repository verification logic. Apply `osr-max-ways-per-node-32.patch` inside the OSR repository, then run:

```powershell
$changedFiles = @(git -C $OsrSource diff --name-only)
if ($changedFiles.Count -ne 1 -or $changedFiles[0] -ne 'include/osr/types.h') {
    throw "OSR source diff must contain only include/osr/types.h: $($changedFiles -join ', ')"
}
git -C $OsrSource diff --check
$patchDiff = git -C $OsrSource diff --unified=0 -- include/osr/types.h
if (@($patchDiff | Select-String -SimpleMatch 'way_pos_t{16U}').Count -ne 1 -or
    @($patchDiff | Select-String -SimpleMatch 'way_pos_t{32U}').Count -ne 1) {
    throw 'OSR capacity diff is not the approved 16U to 32U change.'
}
```

Every other hydrated nested repository must have an empty `git status --porcelain` result before configuration starts.

- [ ] **Step 5: Implement the MSVC/Ninja build and stage**

```powershell
cmake -G Ninja -S $MotisSource -B $BuildDirectory -DCMAKE_BUILD_TYPE=Release -DMOTIS_MIMALLOC=ON
cmake --build $BuildDirectory --target motis motis-test motis-web-ui --parallel 4
& (Join-Path $BuildDirectory 'motis-test.exe')
```

Copy `motis.exe`, `${env:VCToolsRedistDir}x64\Microsoft.VC143.CRT\*.dll`, `deps/tiles/profile`, `ui/build`, and tracked MIT license texts into the staging directory.

- [ ] **Step 6: Run parse/static tests and commit**

Run: `npx vitest run tests/main/motis-msvc-build-script.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: PASS.

```powershell
git add scripts/motis/observe-msvc-toolchain.ps1 scripts/motis/resolve-pinned-source.ps1 scripts/motis/build-patched-windows-msvc.ps1 tests/main/motis-msvc-build-script.test.ts
git commit -m "build(motis): add upstream-aligned MSVC builder"
```

### Task 3: Upgrade the distribution manifest and verifier

**Files:**
- Create: `scripts/motis/create-release-candidate.mjs`
- Modify: `scripts/motis/verify-patched-build.mjs`
- Modify: `scripts/motis/build-patched-windows-msvc.ps1`
- Create: `tests/main/motis-patched-build.test.ts`
- Modify: `tests/main/motis-release-bootstrap.test.ts`

**Interfaces:**
- Produces: manifest schema v2 with `builder`, `sourceDiff`, `binary`, `files`, and `validation` sections.
- Consumes: staged files and `builder-observation.json` from Task 2.

- [ ] **Step 1: Write failing manifest v2 tests**

```ts
expect(result.manifest.schemaVersion).toBe(2);
expect(result.manifest.builder.compilerFamily).toBe('MSVC');
expect(result.manifest.builder.generator).toBe('Ninja');
expect(result.manifest.sourceDiff.changedFiles).toEqual(['include/osr/types.h']);
expect(result.manifest.runtimeDlls).toContain('vcruntime140.dll');
```

Also test path traversal, duplicate file entries, missing license, missing CRT, and a manifest claiming MinGW.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npx vitest run tests/main/motis-patched-build.test.ts tests/main/motis-release-bootstrap.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL on the new v2 requirements.

- [ ] **Step 3: Implement manifest creation and strict verification**

```js
const manifest = {
  schemaVersion: 2,
  motisVersion: lock.source.motisVersion,
  motisCommit: lock.source.motisCommit,
  osrCommit: lock.source.osrCommit,
  patchId: lock.patch.id,
  patchSha256: lock.patch.sha256,
  baseMaxWaysPerNode: 16,
  maxWaysPerNode: 32,
  builder: observation,
  sourceDiff: { changedFiles: ['include/osr/types.h'] },
  binary,
  runtimeDlls,
  files
};
```

The verifier recalculates every listed file hash and rejects unlisted executable/DLL payloads.

- [ ] **Step 4: Make the bootstrap require manifest v2 and the locked candidate hash**

Run: `npx vitest run tests/main/motis-patched-build.test.ts tests/main/motis-release-bootstrap.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/motis/create-release-candidate.mjs scripts/motis/verify-patched-build.mjs scripts/motis/build-patched-windows-msvc.ps1 tests/main/motis-patched-build.test.ts tests/main/motis-release-bootstrap.test.ts
git commit -m "build(motis): verify MSVC distribution manifest"
```

### Task 4: Replace the MinGW workflow with a build-only candidate workflow

**Files:**
- Create: `.github/workflows/motis-build.yml`
- Delete: `.github/workflows/motis-release.yml`
- Create: `tests/main/motis-workflow-contract.test.ts`

**Interfaces:**
- Produces: workflow artifact `motis-windows-x64-v2.11.3-osr32-<run-id>` containing ZIP, SHA file, manifest, and builder observation.
- Consumes: Tasks 1–3 scripts.

- [ ] **Step 1: Write a workflow contract test**

Assert `windows-2025`, `ilammy/msvc-dev-cmd@v1`, Ninja, the MSVC build script, artifact upload, and `contents: read`; reject `msys2`, `mingw`, `gh release`, and `contents: write`.

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx vitest run tests/main/motis-workflow-contract.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because the build-only workflow does not exist.

- [ ] **Step 3: Implement the build-only workflow**

```yaml
jobs:
  build:
    runs-on: windows-2025
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: ilammy/msvc-dev-cmd@v1
      - run: powershell -ExecutionPolicy Bypass -File .\scripts\motis\build-patched-windows-msvc.ps1
      - run: node .\scripts\motis\verify-patched-build.mjs .\vendor\motis\patched-windows\motis-manifest.json
      - uses: actions/upload-artifact@v4
```

The workflow never publishes a Release and always retains the candidate long enough for local nationwide validation.

- [ ] **Step 4: Run the workflow contract and full JS tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add .github/workflows/motis-build.yml .github/workflows/motis-release.yml tests/main/motis-workflow-contract.test.ts
git commit -m "ci(motis): build MSVC candidate without publishing"
```

### Task 5: Validate the exact candidate with nationwide OSM and walking

**Files:**
- Create: `fixtures/motis-release-validation.json`
- Create: `scripts/motis/validate-release-candidate.mts`
- Create: `tests/main/motis-release-validation.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `motis-validation-attestation.json` bound to archive SHA, binary SHA, PBF SHA, manifest, and scenario result hashes.
- Consumes: downloaded candidate archive, official 16-way control binary, South Korea PBF, and existing Yeosu fixture data.

- [ ] **Step 1: Write failing argument and attestation tests**

Cover missing archive, wrong archive hash, wrong PBF, official-control result without `maximum is 16`, custom import failure, zero access walk, zero egress walk, problem-node walking failure, and a 32-way overflow diagnostic.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npx vitest run tests/main/motis-release-validation.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because the validator does not exist.

- [ ] **Step 3: Implement candidate extraction and identity checks**

```ts
const candidate = await prepareMotis({
  archivePath: args.archive,
  outputDirectory: work.candidate,
  expectedBinarySha256: undefined,
  expectedBinarySizeBytes: undefined
});
assert.equal(candidate.manifest.builder.compilerFamily, 'MSVC');
```

Never mutate `vendor/motis` during validation; use a new temporary directory.

- [ ] **Step 4: Implement the control and custom scenarios**

Run the official binary and require the recorded `node ... has 18 ways, maximum is 16` control result. Run the candidate with tiles disabled and the same PBF, then verify import, health, a BUS route, an Incheon-campus FOOT route centered on node `10729381152`, and a Yeosu coordinate-to-coordinate transit plan whose access and egress walk seconds are both positive.

- [ ] **Step 5: Write a hash-bound attestation**

```ts
const attestation = {
  schemaVersion: 1,
  buildRunId: args.buildRunId,
  archiveSha256,
  binarySha256: candidate.actualSha256,
  pbfSha256,
  officialControl: { maxWays: 16, failedNodeOsmId: '10729381152', observedWays: 18 },
  candidate: { import: 'passed', health: 'passed', bus: 'passed', footAtProblemNode: 'passed', coordinateTransit: 'passed' },
  scenarioReportSha256
};
```

- [ ] **Step 6: Run unit tests and a dry validation against invalid fixtures**

Run: `npx vitest run tests/main/motis-release-validation.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add package.json fixtures/motis-release-validation.json scripts/motis/validate-release-candidate.mts tests/main/motis-release-validation.test.ts
git commit -m "test(motis): attest nationwide walking candidate"
```

### Task 6: Lock a candidate only after two matching MSVC proof runs

**Files:**
- Create: `scripts/motis/lock-release-candidate.mjs`
- Create: `tests/main/motis-release-lock.test.ts`
- Modify after real validation: `scripts/motis/motis-builder-lock.json`
- Modify after real validation: `scripts/motis/motis-release-config.mjs`
- Create after real validation: `docs/test-reports/2026-09-20-motis-msvc-validation.json`

**Interfaces:**
- Produces: locked toolchain metadata, release archive/binary hashes, and committed validation attestation.
- Consumes: two builder observations with identical tool metadata plus the exact candidate attestation.

- [ ] **Step 1: Write failing lock-transition tests**

Test differing toolchains, differing source commits, unvalidated archive, wrong build run, and successful probe-to-locked transition.

- [ ] **Step 2: Implement the lock command**

```powershell
node scripts/motis/lock-release-candidate.mjs `
  --first-observation proof-1/builder-observation.json `
  --second-observation proof-2/builder-observation.json `
  --attestation validation/motis-validation-attestation.json
```

The command writes lock/config/report files through temporary files and rename, and refuses to overwrite a different locked candidate without `--replace-approved-candidate`.

- [ ] **Step 3: Run tests and commit the mechanism**

Run: `npx vitest run tests/main/motis-release-lock.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: PASS.

```powershell
git add scripts/motis/lock-release-candidate.mjs tests/main/motis-release-lock.test.ts
git commit -m "build(motis): lock validated release candidates"
```

- [ ] **Step 4: Dispatch two build-only runs and compare observations**

Run: `gh workflow run motis-build.yml --ref codex/0.6.2-main-integration`

Expected: both runs complete successfully and produce identical source, patch, and toolchain observations. If not, keep lock state `probe` and fix the builder before continuing.

- [ ] **Step 5: Download one exact candidate and run nationwide validation**

Run the `motis:validate-release` command with the candidate archive, known South Korea PBF, official control binary, and build run ID.

Expected: official control fails at the recorded 18-way node; candidate import, health, BUS, problem-node FOOT, and coordinate-transit checks pass.

- [ ] **Step 6: Lock and commit the observed values**

```powershell
git add scripts/motis/motis-builder-lock.json scripts/motis/motis-release-config.mjs docs/test-reports/2026-09-20-motis-msvc-validation.json
git commit -m "build(motis): approve validated MSVC candidate"
```

### Task 7: Add a separate hash-bound publish workflow

**Files:**
- Create: `.github/workflows/motis-publish.yml`
- Modify: `tests/main/motis-workflow-contract.test.ts`

**Interfaces:**
- Consumes: `build_run_id`, `release_tag`, locked release config, and committed validation attestation.
- Produces: GitHub Release ZIP, SHA file, manifest, and attestation without rebuilding.

- [ ] **Step 1: Extend workflow tests**

Require `workflow_dispatch`, `actions: read`, `contents: write` only in the publish job, cross-run artifact download, lock verification, and no compiler/build command.

- [ ] **Step 2: Implement the publish workflow**

```yaml
on:
  workflow_dispatch:
    inputs:
      build_run_id: { required: true, type: string }
      release_tag: { required: true, default: v0.6.2, type: string }
permissions:
  actions: read
  contents: write
```

Use `actions/download-artifact@v4` with `run-id` and `github-token`, then verify archive, manifest, binary, run ID, and attestation before any `gh release` command.

- [ ] **Step 3: Run tests and commit**

Run: `npx vitest run tests/main/motis-workflow-contract.test.ts tests/main/motis-builder-lock.test.ts tests/main/motis-release-lock.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: PASS.

```powershell
git add .github/workflows/motis-publish.yml tests/main/motis-workflow-contract.test.ts
git commit -m "ci(motis): publish only validated build artifacts"
```

### Task 8: Verify packaging, documentation, and release readiness

**Files:**
- Modify: `docs/motis-custom-build.md`
- Modify: `docs/release-process.md`
- Modify: `docs/patch-notes-0.6.2-draft.md`
- Modify: `docs/test-reports/2026-09-20-motis-32-way-memory-validation.md`
- Modify: `scripts/package-win.mjs` only if manifest v2 requires packaging changes
- Test: `tests/main/motis-release-bootstrap.test.ts`

**Interfaces:**
- Consumes: locked Release asset from Task 7 after explicit publication approval.
- Produces: repeatable fresh-clone package and developer/release checklists.

- [ ] **Step 1: Update docs to make MSVC the only active procedure**

Document build-only run, candidate download, nationwide validation, lock commit, separate publish action, bootstrap, and fresh-clone package checks. Mark MinGW scripts and patches as historical failure evidence rather than active instructions.

- [ ] **Step 2: Run complete local verification before publishing**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

Run: `npm run motis:prepare -- --offline`

Expected: all pass using the validated local MSVC distribution.

- [ ] **Step 3: Verify the exact published asset from a clean directory**

Run bootstrap without local vendor files, package Windows, execute packaged `motis.exe --help` with a system-only PATH, and run the coordinate A–B smoke test.

Expected: archive hash, binary hash, manifest v2, packaged runtime, and A–B walking checks match the committed lock and attestation.

- [ ] **Step 4: Record final evidence and commit documentation**

```powershell
git add docs/motis-custom-build.md docs/release-process.md docs/patch-notes-0.6.2-draft.md docs/test-reports/2026-09-20-motis-32-way-memory-validation.md scripts/package-win.mjs tests/main/motis-release-bootstrap.test.ts
git commit -m "docs: record verified MSVC MOTIS release process"
```

- [ ] **Step 5: Stop for explicit Release publication confirmation**

Report the candidate build run ID, archive SHA-256, binary SHA-256, nationwide validation result, fresh-clone result, and exact `motis-publish.yml` inputs. Do not dispatch the publish workflow until the user confirms the validated candidate.

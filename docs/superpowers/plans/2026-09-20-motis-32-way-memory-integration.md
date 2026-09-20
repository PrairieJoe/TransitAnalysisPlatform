# MOTIS 32-Way Custom Build and Memory Boundary Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and package a reproducible TAP-custom MOTIS based on official `v2.11.3` with only the OSR per-node way limit changed from 16 to 32, while preserving and documenting the 0.6.2 memory boundary improvements.

**Architecture:** Keep MOTIS as a separately launched Electron sidecar. Store the source patch, pinned source metadata, license notices, and build verification in tracked files; keep the generated Windows distribution under the existing ignored `vendor/motis/patched-windows` directory. Make packaging reject the unpatched official fallback unless an explicitly named distribution directory is supplied.

**Tech Stack:** TypeScript, Electron 36, electron-builder, Vitest, PowerShell, CMake/pkg, MOTIS `v2.11.3`, OSR commit `a7b2ec2728544304ef1d8397b3042abc8d10f7e7`, Windows x64.

**Spec:** `docs/superpowers/specs/2026-09-20-motis-32-way-memory-integration-design.md`

## Global Constraints

- Base MOTIS version: official `v2.11.3`.
- Pinned OSR commit: `a7b2ec2728544304ef1d8397b3042abc8d10f7e7`.
- Only `kMaxWaysPerNode` changes from `16` to `32`; values above 32 remain unsupported.
- The Electron app launches MOTIS as a local child process and uses `resources/motis/motis.exe` in packaged builds.
- The Korea PBF remains user-provided and is not bundled into the installer.
- Existing main-process jobs, DuckDB offload, bounded project summaries, revision checks, and 250-row route-table paging remain in scope and must not regress.
- MOTIS tiles remain disabled for the patched MinGW validation path and `TBB_NUM_THREADS=1` remains explicit for that path.

## Review Focus

- A build started from the wrong MOTIS tag or OSR commit must fail before patching; Task 1 verifies the pinned source identity.
- A patch that changes another OSR limit or silently accepts more than 32 ways must fail verification; Task 1 verifies the exact diff and constant.
- A Windows package must not silently include the official unpatched binary; Task 2 verifies patched-only default selection.
- A packaged app must retain MOTIS/OSR and dependency notices; Task 2 verifies the resources in the unpacked package.
- The memory-boundary changes must still preserve analysis results and responsiveness; Task 3 runs the full test suite plus the existing 7-day benchmark and records the result.

---

### Task 1: Add pinned MOTIS/OSR patch and reproducible Windows build workflow

**Files:**
- Create: `scripts/motis/osr-max-ways-per-node-32.patch`
- Create: `scripts/motis/build-patched-windows.ps1`
- Create: `scripts/motis/verify-patched-build.mjs`
- Create: `docs/motis-custom-build.md`
- Create: `docs/licenses/MOTIS-MIT.txt`
- Create: `docs/licenses/OSR-MIT.txt`
- Test: `scripts/motis/verify-patched-build.mjs` invoked against a generated manifest and binary

**Interfaces:**
- `build-patched-windows.ps1 -SourceRoot <directory> -OutputDirectory <directory>` downloads or reuses the pinned MOTIS and OSR sources, applies the one-line patch, builds the Windows distribution, writes a manifest, and copies the resulting distribution to `vendor/motis/patched-windows`.
- `verify-patched-build.mjs <manifest-path>` exits 0 only when the manifest identifies MOTIS `v2.11.3`, OSR commit `a7b2ec2728544304ef1d8397b3042abc8d10f7e7`, patch id `osr-max-ways-per-node-32`, `maxWaysPerNode` `32`, and existing `motis.exe`/`tiles-profiles` files whose SHA-256 matches the manifest.

- [ ] **Step 1: Write the failing verification test**

Create a temporary manifest fixture with `maxWaysPerNode: 16` and run:

```powershell
node scripts/motis/verify-patched-build.mjs .\scripts\motis\fixtures\official-manifest.json
```

Expected: FAIL with a message that the custom patch metadata must declare `maxWaysPerNode: 32`.

- [ ] **Step 2: Run the verification test to confirm the failure is caused by missing custom-build validation**

Run:

```powershell
node scripts/motis/verify-patched-build.mjs .\scripts\motis\fixtures\official-manifest.json
```

Expected: non-zero exit; no source or binary change is made.

- [ ] **Step 3: Add the exact one-line source patch**

Create `scripts/motis/osr-max-ways-per-node-32.patch` changing only:

```diff
-constexpr auto const kMaxWaysPerNode = way_pos_t{16U};
+constexpr auto const kMaxWaysPerNode = way_pos_t{32U};
```

The patch must target `include/osr/types.h` from the pinned OSR commit and must not change the verification in `src/ways.cc` or any unrelated data structure.

- [ ] **Step 4: Implement the manifest verifier**

Implement `verify-patched-build.mjs` to read JSON, assert the exact version/commit/patch fields, require `maxWaysPerNode === 32`, require the binary and tiles profile paths, calculate the binary SHA-256, and compare it with the manifest. Return a non-zero exit code with a specific error for each mismatch.

- [ ] **Step 5: Run the verifier and confirm it passes for a valid fixture**

Create a valid fixture using a small executable placeholder and matching SHA-256, then run:

```powershell
node scripts/motis/verify-patched-build.mjs .\scripts\motis\fixtures\patched-manifest.json
```

Expected: exit 0 and a concise verification summary containing `v2.11.3`, the pinned OSR commit, and `16 -> 32`.

- [ ] **Step 6: Implement the Windows build script**

The PowerShell script must:

1. Require Git, CMake, and the MOTIS/pkg build prerequisites before changing files.
2. Clone or reuse official MOTIS `v2.11.3` and verify `git rev-parse HEAD`/tag state.
3. Resolve the OSR source at commit `a7b2ec2728544304ef1d8397b3042abc8d10f7e7`.
4. Apply `osr-max-ways-per-node-32.patch` with `git apply --check` before `git apply`.
5. Build the Windows x64 MOTIS distribution using the repository’s documented CMake/pkg workflow.
6. Copy `motis.exe`, `tiles-profiles`, license notices, and a JSON manifest to `vendor/motis/patched-windows`.
7. Invoke `verify-patched-build.mjs` on the generated manifest before reporting success.

The script must stop on errors and must never overwrite the source checkout’s uncommitted changes.

- [ ] **Step 7: Add custom-build documentation and licenses**

Document the exact base version, OSR commit, one-line patch, build command, output directory, binary hash field, known tiles/thread constraint, and the fact that this is not an official MOTIS release. Add the MIT license text and copyright notices for MOTIS and OSR under `docs/licenses/`.

- [ ] **Step 8: Run the build workflow and record the generated manifest**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\motis\build-patched-windows.ps1
node scripts/motis/verify-patched-build.mjs .\vendor\motis\patched-windows\motis-manifest.json
```

Expected: `vendor/motis/patched-windows/motis.exe` exists, the manifest identifies the exact pinned source and `maxWaysPerNode: 32`, and the verifier exits 0.

- [ ] **Step 9: Commit the source patch, build workflow, documentation, and license notices**

```powershell
git add scripts/motis docs/motis-custom-build.md docs/licenses
git commit -m "feat: add reproducible MOTIS 32-way custom build"
```

### Task 2: Enforce custom MOTIS selection and package license notices

**Files:**
- Modify: `scripts/package-win.mjs:56-95`
- Modify: `src/main/motis-runtime.ts:12-24`
- Modify: `tests/core/motis-runtime.test.ts`
- Create: `tests/main/package-win-config.test.ts`
- Modify: `docs/patch-notes-0.6.2-draft.md`

**Interfaces:**
- Development runtime continues to resolve `vendor/motis/patched-windows/motis.exe` first; the official fallback is retained only for explicit timetable-only development scenarios and is never the default package source.
- `package-win.mjs` accepts `TRANSIT_MOTIS_DIST_DIR` as an explicit override, otherwise requires `vendor/motis/patched-windows` and verifies its manifest before building.
- Packaged output contains `resources/motis/motis.exe`, `motis-manifest.json`, and the MOTIS/OSR/third-party license notices.

- [ ] **Step 1: Write the failing package-selection tests**

Add tests that assert the package configuration rejects an available official-only distribution when `TRANSIT_MOTIS_DIST_DIR` is not set, accepts the patched distribution with a valid manifest, and copies the notice files into the generated temporary electron-builder config.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run:

```powershell
npm test -- tests/main/package-win-config.test.ts tests/core/motis-runtime.test.ts
```

Expected: FAIL because package selection currently falls back to `vendor/motis/windows` and does not validate the manifest/notices.

- [ ] **Step 3: Implement patched-only package selection**

Change `scripts/package-win.mjs` so the default path is `vendor/motis/patched-windows`. If that directory is absent, fail with an actionable message. Allow a user-supplied `TRANSIT_MOTIS_DIST_DIR` only when that directory passes the same executable, tiles-profile, manifest, and license checks.

- [ ] **Step 4: Include notices and manifest in `extraResources`**

Add the generated MOTIS distribution plus tracked license notices to the temporary builder configuration. Keep the resource destination stable at `motis`, so the existing `resolveMotisExecutablePath` continues to resolve `resources/motis/motis.exe`.

- [ ] **Step 5: Run focused tests and confirm they pass**

Run:

```powershell
npm test -- tests/main/package-win-config.test.ts tests/core/motis-runtime.test.ts
```

Expected: PASS with official-only fallback rejected and patched distribution accepted.

- [ ] **Step 6: Build and smoke-test the Windows package**

Run:

```powershell
npm run package:win
node scripts/smoke-packaged.mjs
```

Expected: `release/win-unpacked/resources/motis/motis.exe`, the manifest, and notices exist; the smoke script reports the packaged MOTIS path and the app starts without an embedded-binary error.

- [ ] **Step 7: Update the draft patch notes**

Add the custom MOTIS build as a 0.6.2 change with exact wording: official `v2.11.3` baseline, OSR per-node limit changed from 16 to 32, no other MOTIS algorithm change, and nationwide PBF validation status. Keep the note marked draft until the full PBF run in Task 3 completes.

- [ ] **Step 8: Commit packaging and runtime changes**

```powershell
git add scripts/package-win.mjs src/main/motis-runtime.ts tests/core/motis-runtime.test.ts tests/main/package-win-config.test.ts docs/patch-notes-0.6.2-draft.md
git commit -m "feat: package patched MOTIS with license notices"
```

### Task 3: Validate nationwide PBF and preserve memory-boundary results

**Files:**
- Create: `docs/test-reports/2026-09-20-motis-32-way-memory-validation.md`
- Modify: `docs/patch-notes-0.6.2-draft.md`
- Test: `npm test`, `npm run typecheck`, `npm run build`, `npm run test:motis-scenario -- --full-osm`, and `npm run benchmark:analysis`

**Interfaces:**
- `run-motis-scenario.mts --full-osm` uses the generated patched binary and the current local Korea PBF.
- The validation report records the PBF SHA-256, MOTIS manifest/binary SHA-256, import outcome, health outcome, representative plan outcome, and memory/benchmark values.

- [ ] **Step 1: Reproduce the official failure as a control**

Run the official binary explicitly:

```powershell
$env:MOTIS_EXECUTABLE_PATH = (Resolve-Path .\vendor\motis\windows\motis.exe).Path
npm run test:motis-scenario -- --full-osm
```

Expected: failure at OSR graph import with `has 18 ways, maximum is 16`, recorded as the control result rather than treated as an application regression.

- [ ] **Step 2: Run the patched nationwide PBF scenario**

Run:

```powershell
$env:MOTIS_EXECUTABLE_PATH = (Resolve-Path .\vendor\motis\patched-windows\motis.exe).Path
npm run test:motis-scenario -- --full-osm
```

Expected: import completes, health readiness succeeds, a representative `WALK + BUS` plan succeeds, and the scenario report contains the PBF and binary hashes.

- [ ] **Step 3: Run application regression and memory-boundary verification**

Run:

```powershell
npm test
npm run typecheck
npm run build
npm run benchmark:analysis
```

Expected: the full Vitest suite passes; TypeScript and Electron builds pass; the benchmark confirms JS/DuckDB totals agree and records client peak RSS without introducing a renderer-wide raw-record transfer.

- [ ] **Step 4: Record validation evidence**

Create the validation report with a table comparing official control versus patched run, exact hashes, elapsed times, peak process working set where available, and the existing 1-day/7-day baseline values from the integrated 0.6.2 reports. State explicitly that the 32-way change is a targeted compatibility expansion, not proof of support for nodes above 32 ways.

- [ ] **Step 5: Update the patch notes from draft evidence**

Replace tentative MOTIS wording with the actual build hash, PBF hash, import result, and memory benchmark values. Retain known limitations: tiles disabled for the patched MinGW path, single TBB worker, user-provided PBF, and no support claim above 32 connected ways.

- [ ] **Step 6: Commit validation evidence and final draft updates**

```powershell
git add docs/test-reports/2026-09-20-motis-32-way-memory-validation.md docs/patch-notes-0.6.2-draft.md
git commit -m "test: validate nationwide PBF and memory boundaries"
```

### Task 4: Final verification before integration handoff

**Files:**
- Modify: `CHANGELOG.md` only if the repository’s existing release format requires a 0.6.2 entry
- Modify: `docs/patch-notes-0.6.2-draft.md` only for evidence corrections found during final verification

- [ ] **Step 1: Check the complete diff and repository status**

```powershell
git diff v0.6.1..HEAD --stat
git diff --check
git status --short --branch
```

Expected: only planned files are changed; generated `vendor/`, `release/`, `out/`, `data/`, and `test-artifacts/` remain ignored.

- [ ] **Step 2: Run the complete verification set once more**

```powershell
npm test
npm run typecheck
npm run build
npm run package:win
node scripts/smoke-packaged.mjs
```

Expected: all commands exit 0 and the package contains the patched MOTIS manifest and license notices.

- [ ] **Step 3: Prepare the user test handoff**

Report the exact worktree path, branch, generated installer path, PBF path/hash, packaged MOTIS binary hash, commands run, expected user-visible checks, and the fact that no remote push or main-branch update occurs until explicit approval.

# MOTIS Release Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Custom MOTIS out of the Git source tree while making development and Windows packaging automatically acquire and verify a pinned GitHub Release asset.

**Architecture:** The repository remains the source of truth for the exact MOTIS commit, functional `16 -> 32` patch, Windows compatibility patches, and verifier. A small Node bootstrap script first reuses a local distribution, otherwise downloads a version-pinned ZIP from a configured GitHub Release URL, verifies its SHA-256, extracts it safely, and runs the existing manifest verifier. `package:win` calls this bootstrap before electron-builder; a GitHub Actions workflow builds the custom distribution and publishes it as a release asset when explicitly dispatched or tagged.

**Tech Stack:** Node.js 24, ESM, built-in `fetch`/`crypto`/`fs`, `extract-zip`, PowerShell, GitHub Actions, electron-builder, existing MOTIS PowerShell build and manifest verifier.

**Spec:** `docs/superpowers/specs/2026-09-20-motis-32-way-memory-integration-design.md`

## Global Constraints

- Pin MOTIS `v2.11.3` commit `b228a4519d196d9dd01b5ce80be46e642abc953e`.
- Pin OSR commit `a7b2ec2728544304ef1d8397b3042abc8d10f7e7`.
- The only functional OSR change is `kMaxWaysPerNode: 16 -> 32`.
- Never silently fall back to the official unpatched Windows MOTIS binary.
- Require manifest verification before packaging or runtime distribution use.
- Preserve MOTIS/OSR license notices and describe the build as a TAP custom build.
- Do not download or bundle the nationwide OSM PBF in the application.
- Do not require end users to compile C++ code during normal application startup.

## Review Focus

- A missing or malformed Release asset must produce an actionable error instead of packaging an incomplete MOTIS directory; owned by the bootstrap tests.
- A corrupted or unexpected binary must be rejected by SHA-256 and manifest validation; owned by the bootstrap tests.
- A ZIP path traversal entry must not write outside the extraction directory; owned by the bootstrap tests.
- A local valid distribution must work without network access; owned by the bootstrap tests.
- CI must not publish an artifact from an unverified build or from an ordinary push; owned by the workflow structure and script checks.

---

### Task 1: Define the release manifest and bootstrap contract

**Files:**
- Create: `scripts/motis/motis-release-config.mjs`
- Create: `scripts/motis/prepare-patched-windows.mjs`
- Create: `tests/main/motis-release-bootstrap.test.ts`
- Modify: `package.json`

**Interfaces:**
- `motis-release-config.mjs` exports `MOTIS_RELEASE_CONFIG` with the pinned asset URL, archive SHA-256, and extraction directory name. Environment variables may override the URL and cache root for tests, but not the expected patch metadata.
- `prepare-patched-windows.mjs` accepts `--output <directory>`, `--archive <path>`, and `--offline`; it reuses a valid local distribution, otherwise downloads the configured archive, extracts it, and verifies `motis-manifest.json`.
- The script exits non-zero with a Korean/English actionable error when a required file, checksum, or manifest field is invalid.

- [x] **Step 1: Write the failing test**

Add tests for the exported pure helpers/CLI contract: valid local distribution returns without fetching, bad archive hash is rejected, and an archive containing `../outside.txt` is rejected.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/main/motis-release-bootstrap.test.ts`
Expected: FAIL because the bootstrap module/configuration does not exist.

- [x] **Step 3: Implement the minimal bootstrap**

Use built-in `fetch`, `createHash('sha256')`, `extract-zip`, and a temporary download file. Check the archive hash before extraction, use a fresh temporary extraction directory, require `motis.exe`, `tiles-profiles`, `ui`, `licenses`, and `motis-manifest.json`, and invoke `verify-patched-build.mjs` before replacing the output directory.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- tests/main/motis-release-bootstrap.test.ts`
Expected: all bootstrap tests pass.

- [x] **Step 5: Add package scripts**

Add `motis:prepare` and make `package:win` run `npm run motis:prepare` before the existing build/package steps. Preserve `TRANSIT_MOTIS_DIST_DIR` for explicit local testing.

- [x] **Step 6: Commit**

```powershell
git add scripts/motis/motis-release-config.mjs scripts/motis/prepare-patched-windows.mjs tests/main/motis-release-bootstrap.test.ts package.json
git commit -m "feat: bootstrap verified MOTIS release asset"
```

### Task 2: Refactor packaging to consume the prepared distribution

**Files:**
- Modify: `scripts/package-win.mjs`
- Modify: `scripts/motis/prepare-patched-windows.mjs`
- Test: `tests/main/motis-release-bootstrap.test.ts`

**Interfaces:**
- `package-win.mjs` receives a prepared distribution through `TRANSIT_MOTIS_DIST_DIR` or the default `vendor/motis/patched-windows` and never selects `vendor/motis/windows` unless the explicit official override is used for non-national control tests.

- [x] **Step 1: Extend failing tests**

Pin that packaging uses the prepared custom directory and that an official-only directory without a custom manifest is rejected by default.

- [x] **Step 2: Run focused tests and verify the new assertions fail**

Run: `npm test -- tests/main/motis-release-bootstrap.test.ts`
Expected: the new packaging contract assertions fail before the refactor.

- [x] **Step 3: Implement the minimal packaging integration**

Have `package-win.mjs` call the bootstrap unless an explicit distribution directory is supplied, pass the resolved directory to electron-builder, and retain the current custom manifest verifier and package smoke assertions.

- [x] **Step 4: Run focused and package smoke tests**

Run: `npm test -- tests/main/motis-release-bootstrap.test.ts` and `node scripts/package-win.mjs` with the existing local distribution.
Expected: tests pass and the unpacked/NSIS outputs contain the verified MOTIS sidecar.

- [x] **Step 5: Commit**

```powershell
git add scripts/package-win.mjs scripts/motis/prepare-patched-windows.mjs tests/main/motis-release-bootstrap.test.ts
git commit -m "build: package verified MOTIS distribution"
```

### Task 3: Add reproducible CI release workflow and documentation

**Files:**
- Create: `.github/workflows/motis-release.yml`
- Modify: `docs/motis-custom-build.md`
- Modify: `docs/patch-notes-0.6.2-draft.md`

**Interfaces:**
- Workflow runs only on manual dispatch or a `v*` tag, checks out the repository, installs the Windows build prerequisites, runs `build-patched-windows.ps1`, archives the verified distribution, and uploads it as a release asset with a SHA-256 file.
- Documentation explains that the source repository contains no binary, development uses `npm run motis:prepare`, and offline builds use `TRANSIT_MOTIS_DIST_DIR` or a local archive.

- [x] **Step 1: Write workflow/configuration checks**

Add a Node-readable workflow test or static assertions in the existing bootstrap test that require manual/tag triggers, the exact build script, verifier invocation, and release asset upload steps.

- [x] **Step 2: Run the check and verify it fails**

Run: `npm test -- tests/main/motis-release-bootstrap.test.ts`
Expected: workflow assertions fail because the workflow does not exist.

- [x] **Step 3: Implement the workflow and documentation**

Use least-privilege `contents: write` only for the release job, avoid release creation on ordinary pushes, upload `motis-windows-x64-v2.11.3-osr32.zip`, `motis-windows-x64-v2.11.3-osr32.sha256`, and the manifest, and preserve all license files.

- [x] **Step 4: Run static checks**

Run: `npm test -- tests/main/motis-release-bootstrap.test.ts`, `node --check scripts/motis/prepare-patched-windows.mjs`, `node --check scripts/motis/motis-release-config.mjs`, and PowerShell parse validation.
Expected: all checks pass.

- [x] **Step 5: Commit**

```powershell
git add .github/workflows/motis-release.yml docs/motis-custom-build.md docs/patch-notes-0.6.2-draft.md
git commit -m "ci: publish verified MOTIS release asset"
```

### Task 4: Full verification and local fallback validation

**Files:**
- Modify: `docs/test-reports/2026-09-20-motis-32-way-memory-validation.md`

- [x] **Step 1: Run the full test suite and typecheck**

Run: `npm test` and `npm run typecheck`.
Expected: 54 test files and 264 tests pass, with typecheck exit code 0.

- [x] **Step 2: Validate local offline preparation**

Run `npm run motis:prepare -- --offline` with the existing verified `vendor/motis/patched-windows` directory.
Expected: no network request and successful manifest verification.

- [x] **Step 3: Build and package**

Run: `npm run build` and `npm run package:win`.
Expected: Windows unpacked output and NSIS installer contain the custom MOTIS sidecar.

- [x] **Step 4: Run scenario and benchmark regression checks**

Run: `npm run test:motis-scenario -- --full-osm` and the established 7-day analysis benchmark.
Expected: nationwide PBF import and 37/37 batch routing remain successful; JS/DuckDB totals remain equal.

- [x] **Step 5: Record artifact URL/configuration and commit the final report**

Update the report with the release asset naming convention, local fallback behavior, and exact verification commands. Commit only source/scripts/docs; keep downloaded binaries and test artifacts ignored.

---

## Self-Review

- Source repository contains no Custom MOTIS binary; only patches, build code, manifest contract, and workflow are tracked.
- The runtime/package path cannot silently downgrade to official MOTIS.
- Offline development remains possible through the existing local distribution or an explicit local archive.
- The nationwide PBF claim remains scoped to the pinned TAP custom build and the existing tiles/thread constraints.

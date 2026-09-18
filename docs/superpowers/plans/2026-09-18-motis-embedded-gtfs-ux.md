# MOTIS Embedded and Synthetic GTFS UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Make MOTIS truly app-managed, provide a direct data-matching-to-GTFS flow, and reduce Synthetic GTFS setup to route, fleet, operating hours, and headway inputs with clear Before/After explanations.

**Architecture:** Keep MOTIS as a main-process sidecar, but make its executable a packaged resource, its mutable import data an app-owned LocalAppData directory, and its localhost port automatically allocated by the main process. Keep Synthetic GTFS compilation in the existing core modules, adding a small input-normalization boundary that converts headway and operating hours into the existing departure-count schedule model. Add direct navigation from the final import step and keep technical controls behind an advanced settings disclosure.

**Tech Stack:** Electron 36, React 19, TypeScript, Vite, Vitest, Electron Builder, existing MOTIS sidecar and Synthetic GTFS compiler.

**Spec:** `docs/superpowers/specs/2026-09-18-motis-embedded-gtfs-ux-design.md`

## Global Constraints

- The packaged executable is `process.resourcesPath/motis/motis.exe`; users never select an external MOTIS executable.
- Mutable MOTIS data is stored under `%LOCALAPPDATA%\\Transit Analysis Platform\\motis-data` and never under `Program Files` or `C:\\motis`.
- MOTIS binds only to `127.0.0.1` and receives an automatically selected available port.
- Map tiles remain disabled; PBF remains a user-selected external input.
- Synthetic GTFS remains explicitly estimated and must record assumptions and provenance.
- Every behavior change starts with a failing Vitest test and ends with focused plus full verification.

### Task 1: Add LocalAppData MOTIS runtime and automatic port allocation

**Files:**
- Modify: `src/main/motis-runtime.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/main/index.ts`
- Test: `tests/core/motis-runtime.test.ts`

**Interfaces:**
- Produce `resolveMotisDataDirectory(userDataPath?: string, localAppDataPath?: string): string`.
- Produce `findAvailableLoopbackPort(preferredPort?: number): Promise<number>`.
- Extend `MotisRuntimeDefaults` with `port: number`.
- The main-process `motis:defaults` handler returns executable path, data directory, and an available port.

- [ ] **Step 1: Write failing tests for the runtime contract.**

Add tests that assert:

```ts
expect(resolveMotisDataDirectory(undefined, 'C:\\Users\\User\\AppData\\Local'))
  .toBe(join('C:\\Users\\User\\AppData\\Local', 'Transit Analysis Platform', 'motis-data'));
await expect(findAvailableLoopbackPort(0)).resolves.toBeGreaterThanOrEqual(1024);
```

Also add a test that a preferred occupied port is not returned by creating a temporary `net.Server` listener and calling `findAvailableLoopbackPort(occupiedPort)`.

- [ ] **Step 2: Run the focused test and verify it fails because the interfaces are missing.**

Run: `npx vitest run tests/core/motis-runtime.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL with missing exports or missing `port` expectation.

- [ ] **Step 3: Implement the runtime helpers.**

Use `process.env.LOCALAPPDATA` when available, fall back to the parent of `app.getPath('userData')`, and append `Transit Analysis Platform/motis-data`. Implement port probing with `node:net`:

```ts
export async function findAvailableLoopbackPort(preferredPort = 0): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: preferredPort }, () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === 'string') throw new Error('사용 가능한 MOTIS 포트를 확인하지 못했습니다.');
  return address.port;
}
```

Keep the packaged executable candidate first and the development patched/release candidates only for unpackaged mode.

- [ ] **Step 4: Update the IPC default provider.**

Make `motis:defaults` asynchronous, pass `process.env.LOCALAPPDATA`, and return the selected port. Do not add a renderer-facing executable override.

- [ ] **Step 5: Run the focused tests and verify they pass.**

Run: `npx vitest run tests/core/motis-runtime.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: all runtime tests pass, including the occupied-port case.

### Task 2: Remove user MOTIS path/port controls and bind the sidecar to managed defaults

**Files:**
- Modify: `src/renderer/SyntheticGtfsBuilder.tsx`
- Modify: `src/renderer/env.d.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/main/motis-sidecar.ts`
- Modify: `src/renderer/styles.css`
- Test: `tests/main/motis-sidecar.test.ts`

**Interfaces:**
- Renderer state receives `MotisRuntimeDefaults` once on builder mount.
- `toMotisOptions` uses managed executable path, managed data directory, and managed port.
- Sidecar diagnostics never require a user-entered path for normal operation.

- [ ] **Step 1: Write failing sidecar tests for managed runtime diagnostics.**

Add a test that starts the sidecar with the runtime defaults and asserts the spawned process receives `cwd` equal to the managed data directory and that its URL uses the selected loopback port. Add a test that an empty executable path is reported as an internal component error rather than a user instruction to type a path.

- [ ] **Step 2: Run the focused sidecar test and verify the new expectations fail.**

Run: `npx vitest run tests/main/motis-sidecar.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL on the current path-oriented validation/message.

- [ ] **Step 3: Implement managed renderer state and UI.**

Remove editable fields for executable path, data directory, and port from the normal Builder panel. Add a compact status line such as `앱 내장 MOTIS · 로컬 데이터 자동 관리 · 타일 지도 제외`. Keep a collapsed `고급 진단` details section containing read-only paths and port only when troubleshooting is needed. Replace the `C:\\motis\\...` placeholder.

- [ ] **Step 4: Implement internal option validation and sidecar messages.**

Treat missing executable as `앱 내장 MOTIS 구성요소를 찾을 수 없습니다. 앱을 다시 설치하세요.`. Keep the PBF path as the only user-selected MOTIS input. Continue to force `TBB_NUM_THREADS=1` and `disableTiles: true`.

- [ ] **Step 5: Run focused tests and typecheck.**

Run: `npx vitest run tests/main/motis-sidecar.test.ts --pool=threads --maxWorkers=1 --minWorkers=1` and `npm run typecheck`.

Expected: focused sidecar tests and TypeScript compilation pass.

### Task 3: Convert minimum GTFS inputs to headway-based schedule generation and record fleet assumptions

**Files:**
- Modify: `src/core/synthetic-gtfs/draft-builder.ts`
- Modify: `src/core/synthetic-gtfs/types.ts`
- Modify: `src/core/synthetic-gtfs/source-adapter.ts`
- Modify: `src/core/synthetic-gtfs/schedule-synthesizer.ts`
- Modify: `src/renderer/SyntheticGtfsBuilder.tsx`
- Test: `tests/core/synthetic-gtfs-draft.test.ts`
- Test: `tests/core/synthetic-gtfs-schedule.test.ts`

**Interfaces:**
- Extend `SyntheticGtfsDraftOptions` with `vehicleCount: number` and `headwayMinutes: number`.
- Keep the compiler's existing `departureCount` output contract so downstream GTFS files remain compatible.
- Add a deterministic helper `deriveDepartureCount(firstDeparture: string, lastDeparture: string, headwayMinutes: number): number`.
- Add fleet-count assumptions to provenance and validation warnings without assigning vehicle IDs to trips.

- [ ] **Step 1: Write failing tests for headway conversion and fleet provenance.**

Add tests such as:

```ts
expect(deriveDepartureCount('06:00', '23:00', 20)).toBe(52);
const result = buildSyntheticGtfsDraft(routeStops, [], { ...options, vehicleCount: 8, headwayMinutes: 20 });
expect(result.files['tap-provenance.json']).toContain('운행대수');
expect(result.files['tap-provenance.json']).toContain('8');
```

Add invalid-input tests for zero/non-integer vehicle count and non-positive headway.

- [ ] **Step 2: Run the focused tests and verify they fail.**

Run: `npx vitest run tests/core/synthetic-gtfs-draft.test.ts tests/core/synthetic-gtfs-schedule.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because the new options and helper do not exist and the provenance does not contain the fleet assumption.

- [ ] **Step 3: Implement deterministic headway conversion.**

Use minute-based clock parsing. Count departures at `firstDeparture + n * headwayMinutes` while the departure is less than or equal to `lastDeparture`; reject invalid times and non-positive headways with Korean field-specific errors.

- [ ] **Step 4: Pass fleet assumptions through the synthetic provenance.**

Do not change `trips.txt` to invent vehicle assignments. Add an assumption such as `운행대수 8대는 사용자 입력 가정이며 실제 차량별 배차·회차는 검증하지 않았습니다.` to the route/service provenance and include a non-blocking validation warning.

- [ ] **Step 5: Refactor the Builder default form.**

Make visible inputs `route`, `vehicleCount`, `firstDeparture`, `lastDeparture`, `headwayMinutes`, and the After stop sequence. Move agency, service days, dates, dwell seconds, reverse derivation, and advanced technical settings into a closed `고급 설정` details block with existing defaults preserved.

- [ ] **Step 6: Run focused tests and verify they pass.**

Run the two focused test files again. Expected: all headway, invalid-input, provenance, and legacy schedule tests pass.

### Task 4: Add direct GTFS entry from the final import step and a report return path

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/SyntheticGtfsBuilder.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/core/report.test.ts` or a new pure navigation helper test if one is extracted

**Interfaces:**
- `importData(nextView: 'report' | 'synthetic' = 'report')` saves the same project and selects the requested view.
- Final route-import actions expose both `분석 실행` and `GTFS 구축`.
- Report view exposes `GTFS 구축` when route master data is available.

- [ ] **Step 1: Write a failing test for the import destination helper.**

Extract a pure helper such as:

```ts
export function nextViewAfterImport(action: 'analysis' | 'gtfs'): 'report' | 'synthetic' {
  return action === 'gtfs' ? 'synthetic' : 'report';
}
```

Test both branches before changing the JSX event handlers.

- [ ] **Step 2: Run the focused navigation test and verify it fails.**

Run: `npx vitest run tests/core/import-navigation.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because the helper is absent.

- [ ] **Step 3: Implement the direct route-import actions.**

Parameterize the existing `importData` function, keep all project persistence and analysis calculation identical, and call `setView(nextView)` after `save(next)`. On the final route step, label the buttons with the consequence: `분석 실행` and `GTFS 구축으로 이동`.

- [ ] **Step 4: Add the report-to-builder shortcut.**

Add a report header action that invokes `openProject(project, 'synthetic')` when `routeStopMasterRecords.length > 0`; otherwise show a disabled explanation that route-stop data is required.

- [ ] **Step 5: Update back navigation.**

Keep Builder back navigation directed to the report view and retain the report's project-list return. The new direct path therefore becomes `import -> synthetic -> report` without requiring the user to discover the report first.

- [ ] **Step 6: Run the navigation test, typecheck, and build.**

Run: `npx vitest run tests/core/import-navigation.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`, `npm run typecheck`, and `npm run build`.

Expected: all three commands pass.

### Task 5: Explain Before/After results and collapse technical details

**Files:**
- Modify: `src/renderer/SyntheticGtfsBuilder.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/core/transit-comparison.test.ts` if copy/summary logic is extracted; otherwise verify through build and manual UI smoke test

**Interfaces:**
- Add pure display helpers for route delta labels and minimum-input summaries so copy can be unit tested without rendering Electron.

- [ ] **Step 1: Write failing tests for the user-facing explanation helpers.**

Test that the summary identifies the Before route as the current route, the After route as the user scenario, and that a fleet assumption warning is included when `vehicleCount` is present.

- [ ] **Step 2: Implement the explanation and result hierarchy.**

Place an always-visible explanation card above the generation button, then render input summary, Scenario Delta, “결과 읽는 법”, and caution text after generation. Put file names, provenance preview, and raw technical details inside closed `<details>` sections.

- [ ] **Step 3: Run focused tests and production build.**

Run the relevant test file, `npm run typecheck`, and `npm run build`. Expected: pass with no new TypeScript errors.

### Task 6: Update packaging, user documentation, and run full verification

**Files:**
- Modify: `scripts/package-win.mjs`
- Modify: `docs/superpowers/scenarios/2026-09-18-synthetic-gtfs-motis-validation.md`
- Modify: `docs/test-reports/2026-09-18-synthetic-gtfs-motis-scenario-report.md`
- Test: package smoke checks against `release/win-unpacked`

**Interfaces:**
- Package script always includes the patched MOTIS distribution by default when present and places it at `resources/motis`.
- Documentation describes the new direct entry flow, hidden managed MOTIS runtime, LocalAppData work directory, and minimum GTFS inputs.

- [ ] **Step 1: Add a package smoke assertion.**

After packaging, assert that these files exist:

```text
release/win-unpacked/resources/motis/motis.exe
release/win-unpacked/resources/motis/tiles-profiles
release/TransitAnalysisPlatform-0.5.3-setup.exe
```

- [ ] **Step 2: Update the user scenario documentation.**

Replace instructions that ask users to type an executable path, data directory, or port with the managed-runtime flow. Document the visible fields and the expected derived trip count from headway.

- [ ] **Step 3: Run the complete verification set.**

Run:

```powershell
npm run typecheck
npm test
npm run build
npm run package:win
npm run test:motis-scenario
```

For the package smoke check, inspect the generated `release/win-unpacked/resources/motis` directory and confirm no `C:\\motis` path appears in the packaged renderer/main bundles except in development-only tests or diagnostics.

- [ ] **Step 4: Perform the manual user-flow smoke test.**

Use the fixture files, choose `GTFS 구축으로 이동` directly from the final import step, confirm only minimum inputs are visible, generate Before/After, select the separately downloaded PBF, and run the MOTIS comparison. Record any UI issue before declaring the implementation complete.

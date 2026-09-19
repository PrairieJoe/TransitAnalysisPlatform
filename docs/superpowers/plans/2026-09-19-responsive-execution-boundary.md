# Responsive Execution Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move long-running desktop analysis, alighting inference, import preparation, and project persistence behind a cancellable main-process job boundary while keeping renderer state responsive and preserving existing results.

**Architecture:** A typed cooperative job manager in Electron main owns lifecycle, cancellation, and progress events. Existing DuckDB operations remain the source of aggregate analysis, project list responses become bounded summaries, and import uses main-side parsing plus an in-memory staging token before an atomic project commit. Browser fallback keeps its current renderer/IndexedDB behavior.

**Tech Stack:** TypeScript 5.8, Electron 36 IPC/contextBridge/webUtils, React 19, DuckDB Node API, Vitest 3, XLSX.

**Spec:** `docs/superpowers/specs/2026-09-19-responsive-execution-boundary-design.md`

## Global Constraints

- No new npm dependency.
- Keep current `ProjectManifest` schema version and backward readability.
- Preserve browser fallback behavior when `window.transitDesktop` is absent.
- Never let cancelled, failed, or stale jobs replace a committed project.
- Do not rewrite `App.tsx` beyond state/orchestration needed for the execution boundary.
- Long loops must yield cooperatively and test cancellation at bounded intervals.
- IPC exposes named, allow-listed operations only; renderer cannot choose arbitrary channels or file paths.

## Review Focus

- Cancellation arriving after computation but before commit must leave the previous project unchanged; Task 5 tests the pre-commit gate.
- Reusing an existing job id must be rejected without replacing the first job; Task 1 tests duplicate ids.
- Progress listeners mounted more than once must not leak or receive duplicate events; Task 3 tests unsubscribe behavior.
- A stale project revision must reject inference persistence instead of silently overwriting newer metadata; Task 5 tests revision mismatch.
- Import staging tokens must be single-use and must not expose normalized records over IPC; Task 6 tests token consumption and bounded prepare results.

---

### Task 1: Add the cancellable job contract and manager

**Files:**
- Create: `src/shared/job-types.ts`
- Create: `src/main/job-manager.ts`
- Create: `tests/main/job-manager.test.ts`

**Interfaces:**
- Produces: `JobRequest`, `JobProgress`, `JobOperation`, `JobStatus`, `JobCancellationResult`.
- Produces: `createJobManager({ emit })`, `JobExecutionContext`, `JobCancelledError`.

- [ ] **Step 1: Write failing lifecycle tests**

Create tests that import `createJobManager` and assert successful state events, duplicate-id rejection, cooperative cancellation, completed-job cancel rejection, and failure state emission. Use a manually controlled promise so cancellation is observed by the real context rather than by a mock function.

- [ ] **Step 2: Run the test and confirm RED**

Run: `npm test -- tests/main/job-manager.test.ts`

Expected: FAIL because `src/main/job-manager.ts` and shared job types do not exist.

- [ ] **Step 3: Implement the minimal manager**

Define exact states and a `Map<string, ActiveJob>`. `start()` emits queued and running, executes once, calls `context.throwIfCancelled()` at entry and before returning, emits terminal state, and deletes the active entry in `finally`. `cancel()` changes running/queued to cancelling and returns `{ jobId, accepted: true }`; unknown or terminal jobs return false.

- [ ] **Step 4: Verify focused tests and typecheck**

Run: `npm test -- tests/main/job-manager.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 5: Commit**

```text
git add src/shared/job-types.ts src/main/job-manager.ts tests/main/job-manager.test.ts
git commit -m "feat(runtime): add cancellable job manager"
```

### Task 2: Bound project list responses and add explicit open

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/project-store.ts`
- Modify: `tests/main/project-store.test.ts`

**Interfaces:**
- Consumes: existing `ProjectManifest` and serialized project files.
- Produces: `ProjectSummary`, `ProjectStore.readSummary(id)`, existing `read(id)` unchanged.

- [ ] **Step 1: Extend the existing store test with RED assertions**

Assert `readSummary('sample')` returns metadata plus `recordCount: 1`, omits `records`, preserves saved state overrides, and rejects invalid ids.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- tests/main/project-store.test.ts`

Expected: FAIL because `readSummary` is missing.

- [ ] **Step 3: Implement summary projection**

Add `ProjectSummary = Omit<ProjectManifest, 'records'> & { recordCount: number }`. Implement `readSummary` by calling the same serialized read path and destructuring records once in main; do not alter on-disk schema.

- [ ] **Step 4: Verify tests and typecheck**

Run: `npm test -- tests/main/project-store.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 5: Commit**

```text
git add src/shared/types.ts src/main/project-store.ts tests/main/project-store.test.ts
git commit -m "feat(projects): return bounded project summaries"
```

### Task 3: Expose progress, cancellation, file paths, and project open through preload

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/env.d.ts`
- Create: `tests/preload/job-boundary.test.ts`

**Interfaces:**
- Consumes: job shared types and `ProjectSummary`.
- Produces: `onJobProgress(listener): () => void`, `cancelJob(jobId)`, `getFilePath(file)`, `openProject(id)`.

- [ ] **Step 1: Write preload boundary tests**

Mock `contextBridge`, `ipcRenderer.on/removeListener/invoke`, and `webUtils.getPathForFile`. Assert allow-listed channels, listener cleanup, exact job id forwarding, file path forwarding, and project open invocation.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- tests/preload/job-boundary.test.ts`

Expected: FAIL because the APIs do not exist.

- [ ] **Step 3: Implement the bridge and renderer declarations**

Register an internal wrapper for `job:progress`, remove that same wrapper on cleanup, expose `webUtils.getPathForFile(file)`, and add typed signatures without exposing raw `ipcRenderer`.

- [ ] **Step 4: Verify preload tests and typecheck**

Run: `npm test -- tests/preload/job-boundary.test.ts tests/preload/motis-boundary.test.ts tests/main/preload-build.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 5: Commit**

```text
git add src/preload/index.ts src/renderer/env.d.ts tests/preload/job-boundary.test.ts
git commit -m "feat(ipc): expose cancellable job bridge"
```

### Task 4: Run DuckDB analyses through the job boundary

**Files:**
- Create: `src/main/analysis-jobs.ts`
- Create: `tests/main/analysis-jobs.test.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `JobManager`, project root resolver, existing DuckDB analysis functions.
- Produces: `createAnalysisJobHandlers(dependencies)` with weekday/hourly/station/OD/route functions accepting `{ jobId, projectId, projectRevision, config }`.

- [ ] **Step 1: Write integration tests against a real temporary DuckDB project**

Save a fixture project, run weekday/hourly/OD through the handler, and compare results to direct DuckDB functions. Assert progress includes `open-database` and `analyze`, cancellation before analyze throws `JobCancelledError`, and a missing database is reconstructed from project records.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- tests/main/analysis-jobs.test.ts`

Expected: FAIL because `analysis-jobs.ts` does not exist.

- [ ] **Step 3: Implement analysis job handlers**

Extract repeated database existence logic from `src/main/index.ts`. Report coarse phases around asynchronous DuckDB work and call `throwIfCancelled()` before result return. Register IPC handlers with backward-compatible positional arguments plus a generated job id until renderer migration in Task 7.

- [ ] **Step 4: Verify integration tests and typecheck**

Run: `npm test -- tests/main/analysis-jobs.test.ts tests/core/duckdb.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 5: Commit**

```text
git add src/main/analysis-jobs.ts src/main/index.ts tests/main/analysis-jobs.test.ts
git commit -m "feat(analysis): execute database work as jobs"
```

### Task 5: Move alighting inference behind a revision-safe job

**Files:**
- Create: `src/main/alighting-job.ts`
- Create: `tests/main/alighting-job.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/env.d.ts`

**Interfaces:**
- Consumes: `ProjectStore.read/save`, `inferAlighting`, job context, expected `updatedAt` revision.
- Produces: `runAlightingInferenceJob(request)` returning the committed `ProjectManifest`.

- [ ] **Step 1: Write failing persistence tests**

Cover successful inference and reopen, cancellation immediately before save, invalid config, and stale `updatedAt`. For cancellation and stale cases, reopen the project and assert byte-equivalent prior records and metadata.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- tests/main/alighting-job.test.ts`

Expected: FAIL because `alighting-job.ts` does not exist.

- [ ] **Step 3: Implement revision-safe inference**

Read the project in main, validate route/station inputs and config, yield before and after `inferAlighting`, re-read current revision before `store.save`, then commit only if revision still matches and cancellation is clear. Return the saved manifest.

- [ ] **Step 4: Verify integration tests and typecheck**

Run: `npm test -- tests/main/alighting-job.test.ts tests/core/alighting-inference.test.ts tests/main/project-store.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 5: Commit**

```text
git add src/main/alighting-job.ts src/main/index.ts src/preload/index.ts src/renderer/env.d.ts tests/main/alighting-job.test.ts
git commit -m "feat(alighting): persist inference through cancellable jobs"
```

### Task 6: Add main-side import prepare and single-use staging

**Files:**
- Modify: `src/core/parser.ts`
- Modify: `tests/core/parser.test.ts`
- Create: `src/main/import-job.ts`
- Create: `tests/main/import-job.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/env.d.ts`

**Interfaces:**
- Produces: `parseFileBytes(bytes, fileName, options)` with parity to `parseFileRows`.
- Produces: `prepareImport(request)` returning `{ stagingToken, sourceFiles, recordCount, duplicateCount, excludedRows, warnings, from, to }` and no records.
- Produces: `commitImport({ stagingToken, keepDuplicates, manifestMetadata })` returning a committed `ProjectManifest`.

- [ ] **Step 1: Add parser parity test and confirm RED**

Add a test that parses the same CSV and XLSX content through browser `File` and `parseFileBytes`, asserting equal headers, rows, and options.

Run: `npm test -- tests/core/parser.test.ts`

Expected: FAIL because `parseFileBytes` is missing.

- [ ] **Step 2: Implement shared byte parsing and verify GREEN**

Move format-specific logic into `parseFileBytes`; keep `parseFileRows` as `file.arrayBuffer()` plus delegation.

Run: `npm test -- tests/core/parser.test.ts`

Expected: PASS.

- [ ] **Step 3: Write failing import staging tests**

Use temporary files and real mappings. Assert bounded prepare result, duplicate count, cancellation during multi-file processing, single-use token, keep/remove duplicate choice, and committed project reopen.

Run: `npm test -- tests/main/import-job.test.ts`

Expected: FAIL because `import-job.ts` does not exist.

- [ ] **Step 4: Implement prepare/commit staging**

Read only preload-resolved paths, parse and normalize each file in main, classify quality, create initial analysis result, store normalized records in a main-owned staging map keyed by opaque UUID, and consume/delete the token on commit. Check cancellation between files, normalization batches, classification, analysis, and commit. Never return records from prepare.

- [ ] **Step 5: Verify import tests and typecheck**

Run: `npm test -- tests/main/import-job.test.ts tests/core/parser.test.ts tests/core/data-quality.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 6: Commit**

```text
git add src/core/parser.ts src/main/import-job.ts src/main/index.ts src/preload/index.ts src/renderer/env.d.ts tests/core/parser.test.ts tests/main/import-job.test.ts
git commit -m "feat(import): prepare large imports in main"
```

### Task 7: Integrate job progress and cancellation in the renderer

**Files:**
- Create: `src/renderer/job-state.ts`
- Create: `tests/renderer/job-state.test.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`

**Interfaces:**
- Consumes: preload job, project summary/open, analysis, alighting, and import APIs.
- Produces: reducer/helpers that accept only the latest job id; user-visible progress and cancel controls.

- [ ] **Step 1: Write failing reducer/state tests**

Assert latest-job progress applies, stale events are ignored, cancelling disables repeat cancellation, terminal states clear the active operation, and progress percentage handles unknown totals.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- tests/renderer/job-state.test.ts`

Expected: FAIL because `job-state.ts` does not exist.

- [ ] **Step 3: Implement state helper and minimal UI**

Subscribe once in `useEffect`, create job ids in renderer, pass them to desktop calls, render an accessible progress region and cancel button, ignore stale job ids, and keep browser fallback direct paths unchanged. Change project cards to use `ProjectSummary.recordCount` and call `openProject(id)` before existing open logic. Replace desktop `importData` and `runAlightingEstimation` computation with job calls while retaining existing confirmation and state application.

- [ ] **Step 4: Verify renderer state, integration, and typecheck**

Run: `npm test -- tests/renderer/job-state.test.ts tests/preload/job-boundary.test.ts tests/main/import-job.test.ts tests/main/alighting-job.test.ts tests/main/analysis-jobs.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 5: Commit**

```text
git add src/renderer/job-state.ts src/renderer/App.tsx src/renderer/styles.css tests/renderer/job-state.test.ts
git commit -m "feat(ui): show and cancel background jobs"
```

### Task 8: Run full regression, build, and large-data validation

**Files:**
- Modify if measurements change: `docs/test-reports/2026-09-18-week-ui.md`
- Modify if script needs metrics: `scripts/validate-week-ui.mjs`

**Interfaces:**
- Consumes: completed job boundary.
- Produces: verification evidence for existing behavior and responsiveness.

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`

Expected: 47+ files and 239+ tests pass, including all new tests.

- [ ] **Step 2: Run typecheck and production build**

Run: `npm run typecheck`

Expected: exit 0.

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 3: Run the seven-day workflow**

Run: `npm run test:week-ui`

Expected: import, inference, analysis, save/reload totals match the previous validation; progress is visible; cancel acknowledgement and renderer timer delays are captured. If the fixture or packaged runtime is unavailable, record the exact missing prerequisite and run the largest available fixture benchmark instead.

- [ ] **Step 4: Audit scope and diff**

Run: `git diff --check`

Expected: exit 0.

Confirm no unrelated edits, no renderer-side Electron-only regressions, and no project records in `project:list` responses.

- [ ] **Step 5: Commit verification artifacts only when changed**

```text
git add scripts/validate-week-ui.mjs docs/test-reports/2026-09-18-week-ui.md
git commit -m "test(runtime): validate responsive execution boundary"
```

Skip this commit when no verification artifact changed.

## Definition of Done

- Tasks 1–7 behavior is implemented with observed RED→GREEN evidence.
- Full suite, typecheck, and production build pass.
- Project list IPC is bounded and explicit open restores full projects.
- Analysis, inference, and import emit progress and accept cancellation.
- Stale or cancelled jobs cannot commit project state.
- Browser fallback remains type-correct and covered by existing direct paths.
- Seven-day validation runs, or an exact external prerequisite blocker plus the strongest available replacement evidence is recorded.

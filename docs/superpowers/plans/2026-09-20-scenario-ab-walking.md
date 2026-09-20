# Scenario A–B Walking Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compare Current/Before and Scenario/After journeys between identical real-world A–B coordinates, including access, transfer, and egress walking calculated by the validated OSR 32 MOTIS build.

**Architecture:** Scenario schema v2 stores coordinate or explicit-stop endpoints and migrates v1 stop queries without pretending they are coordinates. The main process prepares hash-keyed Before and After MOTIS datasets, runs the same query set against both, normalizes detailed legs, saves a bounded manifest plus a versioned result artifact, and exposes progress/cancellation through the existing job boundary.

**Tech Stack:** TypeScript 5.8, React 19, Electron IPC, Vitest, existing `MotisSidecar`, Synthetic GTFS builders, project store, and main-process job manager.

**Spec:** `docs/superpowers/specs/2026-09-20-motis-msvc-walking-integration-design.md`

## Global Constraints

- Before and After use identical origin, destination, departure time, PBF SHA-256, MOTIS manifest, pedestrian profile, transfer limit, and street-routing limits.
- New user-entered A–B queries default to coordinate endpoints; stop endpoints remain explicit and identifiable.
- Scenario schema version is `2`; v1 stop IDs migrate to stop endpoints only when saved.
- The full OSM walking network remains enabled; BUS-only PBF filtering and straight-line substitution cannot produce a `complete` result.
- Access, transfer, egress, and direct-only walking are separately represented in normalized results.
- If either comparison side has no valid journey, numeric deltas are `null`.
- Large result artifacts remain in the project directory; renderer IPC receives summaries and selected details, not an unbounded network payload.
- This plan executes on an integration branch containing `codex/0.6.2-scenario-path-generation` and the approved MSVC builder work.

## Review Focus

- Legacy scenario input: Task 1 tests v1 migration, unknown higher versions, and read-without-write behavior.
- Coordinate safety: Tasks 1 and 3 test NaN, infinity, latitude/longitude bounds, identical A/B, and exact MOTIS `latitude,longitude` serialization.
- Walking classification: Task 4 tests access-only, egress-only, transfer walking, direct walking, and malformed leg timestamps.
- Comparison identity: Task 5 rejects different PBF, MOTIS, routing options, query endpoints, or departure windows between sides.
- Cancellation/restart: Tasks 5 and 6 test cancellation between imports/queries, no partially valid artifact, and safe retry with a new execution ID.

---

## File Structure

- `src/shared/types.ts`: scenario v2 endpoint, routing options, execution manifest, and result types.
- `src/core/scenario-contract.ts`: v1-to-v2 migration and validation.
- `src/core/motis.ts`: endpoint serialization and `/api/v6/plan` request construction.
- `src/core/transit-comparison.ts`: detailed walking classification and Before/After deltas.
- `src/core/scenario-journey.ts`: pure fingerprint, pair validation, and summary assembly.
- `src/main/scenario-journey-job.ts`: cancellable Before/After preparation and query orchestration.
- `src/main/project-store.ts`: atomic journey artifact/manifest persistence.
- `src/renderer/ScenarioDefinitionEditor.tsx`: coordinate-first query editor.
- `src/renderer/ScenarioJourneyComparison.tsx`: progress, quality state, and comparison results.

### Task 1: Upgrade the scenario contract to v2 endpoints

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/core/scenario-contract.ts`
- Modify: `tests/core/scenario-contract.test.ts`
- Modify: `tests/main/project-store.test.ts`

**Interfaces:**
- Produces: `ScenarioJourneyEndpoint`, v2 `ScenarioJourneyQuery`, `upgradeScenarioDefinition(value)`, and `validateScenarioDefinition(value)`.
- Consumes: existing v1 definitions with `originStopId`, `destinationStopId`, and `departureDateTime`.

- [ ] **Step 1: Write failing v2 type/validation tests**

```ts
const coordinateQuery = {
  origin: { kind: 'coordinate', latitude: 34.7604, longitude: 127.6622, label: 'A' },
  destination: { kind: 'coordinate', latitude: 34.7463, longitude: 127.7441, label: 'B' },
  departureDateTime: '2026-09-20T08:00'
} as const;

expect(validateScenarioDefinition(definition({ scenarioSchemaVersion: 2, journeyQueries: [coordinateQuery] }))).toEqual([]);
expect(validateScenarioDefinition(definition({ scenarioSchemaVersion: 2, journeyQueries: [{ ...coordinateQuery, origin: { kind: 'coordinate', latitude: 91, longitude: 127 } }] }))).toContainEqual(expect.stringMatching(/위도/));
```

Add cases for non-finite numbers, longitude outside `-180..180`, identical coordinate endpoints, empty stop IDs, empty date/time, duplicate query values, and unknown schema version `3`.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx vitest run tests/core/scenario-contract.test.ts tests/main/project-store.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because version 2 and endpoint objects are unsupported.

- [ ] **Step 3: Add the v2 types**

```ts
export const CURRENT_SCENARIO_SCHEMA_VERSION = 2 as const;

export type ScenarioJourneyEndpoint =
  | { kind: 'coordinate'; latitude: number; longitude: number; label?: string }
  | { kind: 'stop'; stopId: string };

export interface ScenarioJourneyQuery {
  origin: ScenarioJourneyEndpoint;
  destination: ScenarioJourneyEndpoint;
  departureDateTime: string;
}
```

- [ ] **Step 4: Implement explicit v1 migration**

```ts
export function upgradeScenarioDefinition(value: unknown): ScenarioDefinition {
  const source = parseObject(value);
  if (source.scenarioSchemaVersion === 2) return validateAndCloneV2(source);
  if (source.scenarioSchemaVersion !== 1) throw new Error('지원하지 않는 시나리오 스키마 버전입니다.');
  return {
    ...cloneV1WithoutJourneyQueries(source),
    scenarioSchemaVersion: 2,
    journeyQueries: readV1Queries(source).map((query) => ({
      origin: { kind: 'stop', stopId: query.originStopId.trim() },
      destination: { kind: 'stop', stopId: query.destinationStopId.trim() },
      departureDateTime: query.departureDateTime
    }))
  };
}
```

Project loading validates but does not persist this return value until the user saves the scenario.

- [ ] **Step 5: Run focused tests and commit**

Run: `npx vitest run tests/core/scenario-contract.test.ts tests/main/project-store.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: PASS.

```powershell
git add src/shared/types.ts src/core/scenario-contract.ts tests/core/scenario-contract.test.ts tests/main/project-store.test.ts
git commit -m "feat(scenario): add coordinate journey schema v2"
```

### Task 2: Make the scenario editor coordinate-first

**Files:**
- Modify: `src/core/scenario-editor.ts`
- Modify: `src/renderer/ScenarioDefinitionEditor.tsx`
- Modify: `tests/core/scenario-editor.test.ts`
- Modify: `tests/renderer/ScenarioDefinitionEditor.test.tsx`

**Interfaces:**
- Produces: draft transformations for coordinate/stop endpoints and a saved v2 definition.
- Consumes: v2 endpoint types and migrated v1 definitions from Task 1.

- [ ] **Step 1: Write failing draft and rendered-input tests**

Assert a new query starts as two coordinate endpoints, preserves decimal coordinates, can explicitly switch one endpoint to a stop, renders `출발지 위도/경도` and `도착지 위도/경도`, and displays migrated stop endpoints without converting them to coordinates.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx vitest run tests/core/scenario-editor.test.ts tests/renderer/ScenarioDefinitionEditor.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL on the old stop-ID-only draft.

- [ ] **Step 3: Implement endpoint draft conversion**

```ts
type JourneyEndpointDraft =
  | { kind: 'coordinate'; latitudeText: string; longitudeText: string; label: string }
  | { kind: 'stop'; stopId: string };

export function endpointDraftToValue(draft: JourneyEndpointDraft): ScenarioJourneyEndpoint {
  return draft.kind === 'stop'
    ? { kind: 'stop', stopId: draft.stopId.trim() }
    : { kind: 'coordinate', latitude: Number(draft.latitudeText), longitude: Number(draft.longitudeText), ...(draft.label.trim() ? { label: draft.label.trim() } : {}) };
}
```

- [ ] **Step 4: Render coordinate fields by default and an explicit endpoint-kind selector**

The selector labels are `지도 좌표` and `정류장 ID`. Changing kind clears incompatible fields instead of carrying a hidden stop ID or coordinate.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/core/scenario-editor.test.ts tests/renderer/ScenarioDefinitionEditor.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: PASS.

```powershell
git add src/core/scenario-editor.ts src/renderer/ScenarioDefinitionEditor.tsx tests/core/scenario-editor.test.ts tests/renderer/ScenarioDefinitionEditor.test.tsx
git commit -m "feat(scenario): edit real A-B journey endpoints"
```

### Task 3: Build MOTIS coordinate and stop plan requests

**Files:**
- Modify: `src/core/motis.ts`
- Modify: `tests/core/motis.test.ts`
- Modify: call sites in `src/renderer/SyntheticGtfsBuilder.tsx` and `scripts/run-motis-scenario.mts`

**Interfaces:**
- Produces: `toMotisPlace(endpoint)` and `buildMotisPlanPath(origin, destination, dateTime, options)`.
- Consumes: `ScenarioJourneyEndpoint` from Task 1.

- [ ] **Step 1: Write failing serialization tests**

```ts
expect(toMotisPlace({ kind: 'coordinate', latitude: 37.374635, longitude: 126.6330278 })).toBe('37.374635,126.6330278');
expect(toMotisPlace({ kind: 'stop', stopId: '3250842' })).toBe('tap-synthetic-gtfs_3250842');
```

Test negative coordinates, non-finite input rejection, stable decimal serialization, and `pedestrianProfile=FOOT`, `maxPreTransitTime=900`, `maxPostTransitTime=900`, `maxMatchingDistance=250`, `detailedLegs=true` query parameters.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx vitest run tests/core/motis.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because `buildMotisPlanPath` accepts only stop IDs.

- [ ] **Step 3: Implement endpoint serialization and explicit routing options**

```ts
export interface MotisPlanOptions {
  maxTransfers: number;
  pedestrianProfile: 'FOOT';
  maxPreTransitTimeSeconds: number;
  maxPostTransitTimeSeconds: number;
  maxMatchingDistanceMeters: number;
}
```

Use the official `/api/v6/plan` coordinate format `latitude,longitude`; do not set the experimental `radius` fallback because it estimates crow-fly access without the loaded OSM graph.

- [ ] **Step 4: Update stop-based call sites using explicit stop endpoints**

```ts
buildMotisPlanPath(
  { kind: 'stop', stopId: originStopId },
  { kind: 'stop', stopId: destinationStopId },
  departureDateTime,
  DEFAULT_MOTIS_PLAN_OPTIONS
);
```

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/core/motis.test.ts tests/core/transit-batch.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: PASS.

```powershell
git add src/core/motis.ts tests/core/motis.test.ts src/renderer/SyntheticGtfsBuilder.tsx scripts/run-motis-scenario.mts
git commit -m "feat(motis): query coordinate A-B journeys"
```

### Task 4: Normalize walking legs without misclassification

**Files:**
- Modify: `src/core/transit-comparison.ts`
- Modify: `tests/core/transit-comparison.test.ts`
- Modify: `src/shared/types.ts`

**Interfaces:**
- Produces: normalized access, transfer, egress, and direct-walk seconds/meters plus null-safe deltas.
- Consumes: detailed MOTIS itinerary legs and requested departure time.

- [ ] **Step 1: Write failing leg-position tests**

```ts
expect(normalizeMotisJourney(accessBusEgress()).accessWalkSeconds).toBe(180);
expect(normalizeMotisJourney(accessBusEgress()).egressWalkSeconds).toBe(240);
expect(normalizeMotisJourney(twoBusesWithWalkTransfer()).transferWalkSeconds).toBe(120);
expect(normalizeMotisJourney(directWalkOnly()).directWalkSeconds).toBe(600);
```

Add malformed timestamps, no itinerary, one-side missing comparison, WALK legs with zero distance, and legs before/after transit in unusual arrays.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx vitest run tests/core/transit-comparison.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because current code treats the first/last walk globally and has no direct-walk fields.

- [ ] **Step 3: Classify walks relative to first and last transit leg**

```ts
const transitIndexes = timedLegs.flatMap((entry, index) => entry.isTransit ? [index] : []);
const firstTransit = transitIndexes[0] ?? -1;
const lastTransit = transitIndexes[transitIndexes.length - 1] ?? -1;
const category = firstTransit < 0 ? 'direct'
  : index < firstTransit ? 'access'
  : index > lastTransit ? 'egress'
  : 'transfer';
```

Add `accessWalkMeters`, `transferWalkMeters`, `egressWalkMeters`, `directWalkSeconds`, and `directWalkMeters` to normalized results and deltas. A direct-walk-only itinerary is valid but receives a warning that it contains no transit leg.

- [ ] **Step 4: Run tests and commit**

Run: `npx vitest run tests/core/transit-comparison.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: PASS.

```powershell
git add src/core/transit-comparison.ts src/shared/types.ts tests/core/transit-comparison.test.ts
git commit -m "fix(motis): classify A-B walking legs by position"
```

### Task 5: Add pure comparison identity and fingerprint rules

**Files:**
- Create: `src/core/scenario-journey.ts`
- Create: `tests/core/scenario-journey.test.ts`
- Modify: `src/shared/types.ts`

**Interfaces:**
- Produces: `buildScenarioJourneyFingerprint(input)`, `assertComparableJourneySides(before, after)`, and `summarizeScenarioJourneyResult(result)`.
- Consumes: v2 queries, MOTIS/PBF environment, plan options, and normalized journeys.

- [ ] **Step 1: Write failing identity tests**

Test stable property ordering, coordinate precision changes, different PBF hash, MOTIS binary hash, pedestrian profile, transfer limit, departure time, query order, and Before/After endpoint mismatch.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx vitest run tests/core/scenario-journey.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement canonical fingerprinting**

```ts
export interface ScenarioJourneyEnvironment {
  osmPbfSha256: string;
  motisBinarySha256: string;
  motisManifestSchemaVersion: 2;
  pedestrianProfile: 'FOOT';
  maxTransfers: number;
  maxPreTransitTimeSeconds: number;
  maxPostTransitTimeSeconds: number;
  maxMatchingDistanceMeters: number;
}
```

Canonicalize queries without rounding coordinates, preserve query array order, and hash the UTF-8 JSON with SHA-256.

- [ ] **Step 4: Implement summary bounds**

The summary includes execution ID, status, query count, found counts, aggregate mean/median/p90 deltas, warning count, and artifact filename. It does not include leg geometry or raw MOTIS responses.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/core/scenario-journey.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: PASS.

```powershell
git add src/core/scenario-journey.ts src/shared/types.ts tests/core/scenario-journey.test.ts
git commit -m "feat(scenario): fingerprint comparable A-B journeys"
```

### Task 6: Execute Before and After through the main-process job boundary

**Files:**
- Create: `src/main/scenario-journey-job.ts`
- Create: `tests/main/scenario-journey-job.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/env.d.ts`
- Modify: `src/main/project-store.ts`
- Modify: `tests/main/project-store.test.ts`

**Interfaces:**
- Produces: `createScenarioJourneyJobHandlers({ jobs, store, motisFactory, prepareSnapshot })` with `run`, `summary`, and `result` methods.
- Consumes: materialized Before/After networks from `scenario-execution.ts`, Synthetic GTFS files, validated MOTIS defaults, PBF metadata, and Task 5 fingerprint rules.

- [ ] **Step 1: Write failing job lifecycle tests**

Test progress phases `validate`, `prepare-before`, `query-before`, `prepare-after`, `query-after`, `persist`; cancellation after each sidecar stop; mismatched environment rejection; partial query results; atomic artifact persistence; and retry after failure.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx vitest run tests/main/scenario-journey-job.test.ts tests/main/project-store.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because the job module and store methods do not exist.

- [ ] **Step 3: Implement sequential side execution**

```ts
for (const side of ['before', 'after'] as const) {
  context.throwIfCancelled();
  const prepared = await dependencies.prepareSnapshot({ side, network: networks[side], environment });
  const sidecar = dependencies.motisFactory();
  try {
    await sidecar.start(prepared.options);
    for (const query of definition.journeyQueries ?? []) {
      context.throwIfCancelled();
      results[side].push(normalizeMotisJourney(await sidecar.request(buildMotisPlanPath(query.origin, query.destination, query.departureDateTime, options)), query.departureDateTime));
    }
  } finally {
    await sidecar.stop();
  }
}
```

Use separate hash-keyed data directories for Before and After. Reuse a complete directory only when GTFS, PBF, MOTIS binary, and routing configuration hashes all match.

- [ ] **Step 4: Persist artifact before manifest publication**

Write `scenario-journeys/<executionId>.json.tmp`, fsync/close through the existing store pattern, rename to `.json`, then atomically update the project manifest. Failed/cancelled work never appears as `complete`.

- [ ] **Step 5: Add bounded IPC and preload APIs**

```ts
runScenarioJourney(request): Promise<{ jobId: string }>;
getScenarioJourneySummary(projectId: string, executionId: string): Promise<ScenarioJourneyExecutionManifest>;
getScenarioJourneyResult(projectId: string, executionId: string): Promise<ScenarioJourneyResult>;
```

The full result is fetched only when the user opens one execution.

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run tests/main/scenario-journey-job.test.ts tests/main/project-store.test.ts tests/preload/job-boundary.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: PASS.

```powershell
git add src/main/scenario-journey-job.ts tests/main/scenario-journey-job.test.ts src/main/index.ts src/preload/index.ts src/renderer/env.d.ts src/main/project-store.ts tests/main/project-store.test.ts
git commit -m "feat(scenario): run cancellable A-B comparisons"
```

### Task 7: Present walking-aware comparison results

**Files:**
- Create: `src/renderer/ScenarioJourneyComparison.tsx`
- Create: `tests/renderer/ScenarioJourneyComparison.test.tsx`
- Modify: `src/renderer/ScenarioDefinitionEditor.tsx`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Produces: scenario execution controls, progress/cancel UI, bounded summaries, and per-query walking/time deltas.
- Consumes: Task 6 preload APIs and existing job progress events.

- [ ] **Step 1: Write failing renderer tests**

Require identical A/B and time labels for both sides; access, transfer, egress, direct walking, ride, wait, total, and transfer deltas; `partial` warnings; one-side missing null delta; progress region; cancel action; and no claim of completion when fallback exists.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx vitest run tests/renderer/ScenarioJourneyComparison.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the bounded result panel**

Render one card per query with a compact Before → After table. Use `—` for null deltas, explicit `경로 없음` states, and a quality badge of `완료`, `부분 결과`, or `실패`. Raw geometry and raw MOTIS JSON stay out of the initial renderer payload.

- [ ] **Step 4: Wire execution, progress, cancellation, and saved-result reopen**

Use the existing job subscription pattern, ignore stale job IDs, and disable duplicate execution while an identical fingerprint is running. A complete existing fingerprint opens its saved result instead of starting another import.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/renderer/ScenarioJourneyComparison.test.tsx tests/renderer/ScenarioDefinitionEditor.test.tsx tests/renderer/job-state.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: PASS.

```powershell
git add src/renderer/ScenarioJourneyComparison.tsx tests/renderer/ScenarioJourneyComparison.test.tsx src/renderer/ScenarioDefinitionEditor.tsx src/renderer/App.tsx
git commit -m "feat(scenario): show walking-aware A-B deltas"
```

### Task 8: Run real nationwide and packaged regression validation

**Files:**
- Modify: `scripts/run-motis-scenario.mts`
- Create: `docs/test-reports/2026-09-20-scenario-ab-walking-validation.md`
- Modify: `docs/patch-notes-0.6.2-draft.md`
- Modify: `docs/release-process.md`

**Interfaces:**
- Consumes: validated MSVC MOTIS candidate, South Korea PBF, scenario v2 definition, and packaged Electron app.
- Produces: evidence for coordinate access/egress walking and Before/After comparison using identical fingerprints.

- [ ] **Step 1: Extend the scenario script to accept coordinate endpoints**

Add CLI flags `--origin-lat`, `--origin-lng`, `--destination-lat`, and `--destination-lng`; preserve stop flags for control runs. Write the exact endpoint and routing options into `scenario-input.json`.

- [ ] **Step 2: Run unit, type, and build verification**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

Expected: all pass.

- [ ] **Step 3: Run the nationwide coordinate scenario**

Run `npm run test:motis-scenario -- --full-osm` with endpoints offset from the Yeosu fixture route's first and last stops.

Expected: Before and After both find a transit journey; access and egress walking are positive; both sides share PBF, binary, endpoint, and routing-option fingerprints; batch comparison completes without HTTP errors.

- [ ] **Step 4: Run the problem-node FOOT validation**

Query a short walking path across the Incheon University node `10729381152` using the validated candidate.

Expected: path found, geometry uses OSM ways, no 16-way import failure, and no beeline fallback.

- [ ] **Step 5: Run packaged-app smoke and memory checks**

Package Windows from the validated local distribution, run the A–B flow in `win-unpacked`, verify progress/cancel/reopen behavior, and rerun the existing seven-day analysis benchmark.

- [ ] **Step 6: Record evidence and commit**

The report records scenario schema version, endpoints, departure window, PBF/archive/binary hashes, build run ID, access/transfer/egress values, route-found counts, fallback counts, and memory measurements.

```powershell
git add scripts/run-motis-scenario.mts docs/test-reports/2026-09-20-scenario-ab-walking-validation.md docs/patch-notes-0.6.2-draft.md docs/release-process.md
git commit -m "docs: validate scenario A-B walking comparison"
```

### Task 9: Integrate branches and perform whole-branch review

**Files:**
- Resolve only files changed by the builder and scenario plans.
- Verify: all files in both plans and their committed reports.

**Interfaces:**
- Consumes: completed builder plan branch and completed scenario plan branch.
- Produces: one `codex/0.6.2-main-integration` candidate ready for final user testing and Release approval.

- [ ] **Step 1: Merge the latest base and both completed feature branches without rewriting history**

Preserve scenario contract/path-generation commits and builder commits. Resolve `src/shared/types.ts`, `package.json`, release docs, and patch notes by retaining both sets of requirements.

- [ ] **Step 2: Run full verification from a clean dependency install**

Run: `npm ci`

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

Run: `git diff --check`

Expected: all pass.

- [ ] **Step 3: Run a fresh whole-branch code review**

Review trust boundaries for coordinates and file paths, comparison fingerprint equality, cancellation cleanup, manifest/attestation hash binding, and accidental reactivation of MinGW.

- [ ] **Step 4: Hand off a user test checklist**

Provide the packaged executable, exact A–B coordinate fixture, expected non-zero walking fields, problem-node test, and instructions for checking Before/After totals. Stop before final Release publication until the validated integrated candidate is approved.

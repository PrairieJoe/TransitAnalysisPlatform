# Scenario Execution Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 저장된 `ScenarioExecutionResult` 두 개를 현행·시나리오·시나리오 간에 비교하고, 동일한 X→Y 질의의 MOTIS 여정 지표를 안전하게 비교한다.

**Architecture:** 순수 core 비교 엔진이 두 execution의 `after` snapshot에서 노선·정류장·연장·운행정보 delta를 계산한다. Renderer client는 프로젝트 route master와 scenario definition으로 두 target network를 다시 materialize하고, 동일한 OSM PBF·MOTIS 환경에서 X→Y 질의를 양쪽에 실행한 뒤 기존 `NormalizedJourney`/`compareJourneys()`를 연결한다. UI는 비교 결과와 품질 경고만 표시하며 결과를 기존 execution artifact에 덮어쓰지 않는다.

**Tech Stack:** TypeScript, React, Electron IPC/contextBridge, existing Synthetic GTFS builder, existing MOTIS `/api/v6/plan` client, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-20-scenario-comparison-design.md`

## Global Constraints

- 비교 대상은 current↔scenario 및 scenario↔scenario를 모두 지원한다.
- 모든 비교 대상 네트워크는 각 execution result의 `after` snapshot을 사용한다.
- 다수 노선의 정류장 구성·순서·연장·예상 runtime·운행정보를 비교한다.
- Before 또는 After에 여정이 없으면 numeric delta를 `null`로 보존하고 0으로 대체하지 않는다.
- OSM PBF SHA-256·routing profile·travel-time model이 다르면 route 비교만 허용하고 MOTIS 여정 비교는 실행하지 않는다.
- fallback·model-estimated·partial·failed 상태와 warning을 complete 결과로 승격하지 않는다.
- 요금은 `unavailable`과 `amount: null`로 반환하며 금액을 추정하지 않는다.
- 비교 결과는 기존 `ScenarioExecutionResult`나 project metadata에 덮어쓰지 않는다.
- 수요 재배분·승객별 최적 경로·환승요금 계산은 이번 계획에 포함하지 않는다.
- 기존 단일 노선 `transit-comparison` API와 Synthetic GTFS/MOTIS 흐름을 깨뜨리지 않는다.
- 작업은 `codex/0.6.2-scenario-comparison`에서 진행하며 현재 main과 `codex/0.6.2-scenario-path-generation`에는 통합하지 않는다.

## Review Focus

- 서로 다른 PBF/model fingerprint: route delta는 반환하되 MOTIS journey 비교는 시작하지 않아야 한다. → Task 2의 environment mismatch test.
- 한쪽에만 존재하는 노선 또는 한쪽 no-route 여정: `missing`/`found: false`와 `null` delta를 보존해야 한다. → Task 1의 missing-route/no-route tests.
- scenario A↔scenario B: 두 definition의 Before가 아니라 각 execution의 `after` snapshot을 비교해야 한다. → Task 1의 after-snapshot test.
- 정류장 집합은 같지만 순서만 바뀐 노선: added/removed는 비어 있고 `reordered`만 true여야 한다. → Task 1의 reorder test.
- MOTIS 응답의 이용수단·환승횟수 및 요금: normalized journey 값은 표시하되 fare는 0이 아니어야 한다. → Task 1 and Task 2 journey tests.

---

## 파일 구조와 책임

| 파일 | 책임 |
| --- | --- |
| `src/core/scenario-comparison.ts` | execution after snapshot의 route/operation/environment 비교와 journey comparison 결과 조립 |
| `tests/core/scenario-comparison.test.ts` | 순수 비교 계약, missing/no-route, environment, warning, fare 정책 테스트 |
| `src/renderer/scenario-comparison-client.ts` | execution artifact 로드, target network materialization, PBF 검증, MOTIS Before/After query orchestration |
| `tests/renderer/scenario-comparison-client.test.ts` | artifact 선택, 환경 차단, MOTIS lifecycle, 동일 query 전달 테스트 |
| `src/renderer/ScenarioComparisonPanel.tsx` | 비교 target 선택, query 입력, route/journey 결과·경고 표시 |
| `tests/renderer/ScenarioComparisonPanel.test.tsx` | target 선택 가능성, execution 부족 상태, route/fare/warning 표시 테스트 |
| `src/renderer/ScenarioDefinitionEditor.tsx` | 저장된 execution manifest와 route master/service config를 comparison panel에 전달 |
| `tests/renderer/ScenarioDefinitionEditor.test.tsx` | 기존 editor와 비교 panel 공존 회귀 테스트가 필요한 경우 보강 |

`src/shared/types.ts`, `src/main/project-store.ts`, `src/preload/index.ts`, `src/renderer/env.d.ts`는 기존 execution read/list API가 이미 있으므로 수정하지 않는다. 새로운 비교 결과를 별도 저장하지 않기 때문에 새로운 IPC channel도 추가하지 않는다.

## 공통 계약

Task 1에서 다음 타입과 함수를 `src/core/scenario-comparison.ts`에 만든다. `ScenarioComparisonTarget`, `ScenarioEnvironmentComparison`, `ScenarioOperationComparison`, `ScenarioRouteComparison`, `ScenarioJourneyComparison`, `ScenarioComparisonResult`의 필드는 승인된 spec의 계약과 일치해야 한다.

```ts
export type ScenarioComparisonTarget =
  | { kind: 'current'; executionId: string; label: string }
  | { kind: 'scenario'; scenarioId: string; executionId: string; label: string };

export interface ScenarioExecutionComparisonInput {
  before: { target: ScenarioComparisonTarget; result: ScenarioExecutionResult };
  after: { target: ScenarioComparisonTarget; result: ScenarioExecutionResult };
  journeys?: Array<{
    query: ScenarioJourneyQuery;
    before: NormalizedJourney;
    after: NormalizedJourney;
  }>;
}

export function compareScenarioExecutions(input: ScenarioExecutionComparisonInput): ScenarioComparisonResult;
export function compareScenarioEnvironments(
  before: ScenarioExecutionEnvironment,
  after: ScenarioExecutionEnvironment
): ScenarioEnvironmentComparison;
```

`compareScenarioExecutions()`는 route comparison을 항상 계산한다. environment가 비교 불가하면 input에 전달된 journey 배열을 무시하고 `journeys: []`와 warning을 반환한다. 동일 환경이면 전달된 normalized journey 각각에 대해 기존 `compareJourneys()`를 호출하고 fare unavailable 객체를 붙인다.

## Task 1: Pure Scenario Comparison Engine

**Files:**
- Create: `src/core/scenario-comparison.ts`
- Create: `tests/core/scenario-comparison.test.ts`
- Read only: `src/core/transit-comparison.ts`, `src/shared/types.ts`, `src/core/scenario-execution.ts`

**Interfaces:**
- Consumes: `ScenarioExecutionResult`, `ScenarioExecutionEnvironment`, `ScenarioRouteExecution`, `ScenarioJourneyQuery`, `NormalizedJourney`, `compareJourneys()`.
- Produces: `compareScenarioExecutions(input): ScenarioComparisonResult` and `compareScenarioEnvironments(before, after): ScenarioEnvironmentComparison` for Task 2 and Task 3.

- [ ] **Step 1: Write failing tests for route and operation comparison**

Create fixtures for two execution results with routes `A` and `B`. Use route `A` in both snapshots with the same stop set in a different order and changed `totalDistanceMeters`, `totalRuntimeSeconds`, `headwayMinutes`, and `vehicleCount`. Put route `B` only in the after snapshot. Assert:

```ts
const result = compareScenarioExecutions({ before: beforeInput, after: afterInput });
const routeA = result.routes.find((route) => route.routeId === 'A')!;
const routeB = result.routes.find((route) => route.routeId === 'B')!;

expect(routeA.addedStopIds).toEqual([]);
expect(routeA.removedStopIds).toEqual([]);
expect(routeA.reordered).toBe(true);
expect(routeA.distanceMeters.delta).toBe(1200);
expect(routeA.runtimeSeconds.delta).toBe(180);
expect(routeA.operation.headwayMinutes).toMatchObject({ before: 20, after: 15, delta: -5, changed: true });
expect(routeB.status).toBe('missing');
expect(routeB.distanceMeters.delta).toBeNull();
```

- [ ] **Step 2: Run the focused tests and verify the contract fails**

Run: `npm test -- --run tests/core/scenario-comparison.test.ts`

Expected: FAIL because `src/core/scenario-comparison.ts` and `compareScenarioExecutions()` do not exist.

- [ ] **Step 3: Write failing tests for after-snapshot selection, environment, no-route, and fare**

Add these cases:

```ts
it('compares each target after snapshot rather than scenario Before', () => {
  const result = compareScenarioExecutions({ before: scenarioAInput, after: scenarioBInput });
  expect(result.before.kind).toBe('scenario');
  expect(result.after.kind).toBe('scenario');
  expect(result.routes.find((route) => route.routeId === 'A')?.afterStopIds).toEqual(['B-1', 'B-2']);
});

it('blocks journey results when PBF or travel model differs but keeps route comparison', () => {
  const beforeWithDifferentPbf = {
    ...beforeInput,
    result: { ...beforeInput.result, environment: { ...beforeInput.result.environment, osmPbfSha256: 'sha-before' } }
  };
  const afterWithDifferentPbf = {
    ...afterInput,
    result: { ...afterInput.result, environment: { ...afterInput.result.environment, osmPbfSha256: 'sha-after' } }
  };
  const result = compareScenarioExecutions({
    before: beforeWithDifferentPbf,
    after: afterWithDifferentPbf,
    journeys: [{ query, before: foundJourney, after: foundJourney }]
  });

  expect(result.environment.comparable).toBe(false);
  expect(result.journeys).toEqual([]);
  expect(result.routes.length).toBeGreaterThan(0);
  expect(result.warnings.join(' ')).toMatch(/PBF|환경|비교/);
});

it('does not convert a missing journey into a zero-minute improvement', () => {
  const result = compareScenarioExecutions({
    before: beforeInput,
    after: afterInput,
    journeys: [{ query, before: notFoundJourney, after: foundJourney }]
  });

  expect(result.journeys[0].journey.delta.totalSeconds).toBeNull();
  expect(result.journeys[0].fare).toEqual({ status: 'unavailable', amount: null, reason: expect.any(String) });
});
```

- [ ] **Step 4: Run the new tests and confirm the missing implementation failures**

Run: `npm test -- --run tests/core/scenario-comparison.test.ts`

Expected: FAIL with missing module/function errors or unimplemented result errors.

- [ ] **Step 5: Implement environment and route comparison helpers**

Implement deterministic helpers in `src/core/scenario-comparison.ts`:

1. Compare `osmPbfSha256`, `routingProfile`, and `travelTimeModelVersion`; set `comparable: false` and add field-specific Korean warnings when any differs.
2. Compare route ID union in lexical order.
3. Use `after.routes` from both `ScenarioExecutionResult` values. Do not read `result.before.routes` for route comparison.
4. For a missing route, return empty stop arrays, null distance/runtime/operation values, status `missing`, and a warning naming the target.
5. For a common route, calculate ordered additions/removals, `reordered`, forward route distance/runtime deltas, and operation field deltas.
6. Preserve warnings from both snapshots, routes, and segment provenance without marking a partial route complete.

Use small local helpers for nullable string/number/boolean fields so absent routes do not become zero or empty official values.

- [ ] **Step 6: Implement normalized journey and fare result assembly**

For each supplied journey input, call the existing `compareJourneys(before, after)`. Add:

```ts
fare: {
  status: 'unavailable',
  amount: null,
  reason: '운임 규칙과 교통카드 환승 정책이 연결되지 않았습니다.'
}
```

If environments are not comparable, return no journey entries and a single comparison-level warning. Deduplicate warnings while preserving first-seen order.

- [ ] **Step 7: Run the focused tests and typecheck**

Run: `npm test -- --run tests/core/scenario-comparison.test.ts; npm run typecheck`

Expected: all new comparison tests PASS and TypeScript reports no errors.

- [ ] **Step 8: Commit the pure engine**

```bash
git add src/core/scenario-comparison.ts tests/core/scenario-comparison.test.ts
git commit -m "feat: add scenario comparison engine"
```

## Task 2: Renderer Journey Comparison Orchestration

**Files:**
- Create: `src/renderer/scenario-comparison-client.ts`
- Create: `tests/renderer/scenario-comparison-client.test.ts`
- Read only: `src/renderer/scenario-execution-client.ts`, `src/core/scenario-execution.ts`, `src/core/scenario-route-execution.ts`, `src/core/synthetic-gtfs/network-builder.ts`, `src/core/motis.ts`, `src/shared/types.ts`

**Interfaces:**
- Consumes: `ScenarioExecutionManifest[]`, `readScenarioExecution`, `selectMotisOsmPbf`, `prepareMotis`, `startMotis`, `requestMotis`, `stopMotis`, `materializeScenarioNetworks()`, `buildSyntheticGtfsNetwork()`, `buildMotisPlanPath()`, `normalizeMotisJourney()`, and Task 1 `compareScenarioExecutions()`.
- Produces:

```ts
export interface ScenarioComparisonSelection {
  target: ScenarioExecutionTarget;
  executionId: string;
  label: string;
}

export interface ScenarioComparisonClientInput {
  projectId: string;
  before: ScenarioComparisonSelection;
  after: ScenarioComparisonSelection;
  routeStops: RouteStopMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
  scenarioDefinitions: ScenarioDefinition[];
  queries: ScenarioJourneyQuery[];
}

export interface ScenarioComparisonProgress {
  phase: 'loading' | 'validating' | 'routing-before' | 'routing-after' | 'complete';
  completed: number;
  total: number;
  message: string;
}

export async function runScenarioComparison(
  input: ScenarioComparisonClientInput,
  onProgress?: (progress: ScenarioComparisonProgress) => void
): Promise<ScenarioComparisonResult>;
```

- [ ] **Step 1: Write failing tests for artifact loading and target validation**

Mock `window.transitDesktop` with two manifests and results. Assert that the client:

```ts
const result = await runScenarioComparison(input);

expect(api.listScenarioExecutionManifests).toHaveBeenCalledWith('project-1');
expect(api.readScenarioExecution).toHaveBeenCalledTimes(2);
expect(result.before.kind).toBe('current');
expect(result.after.kind).toBe('scenario');
```

Add rejection tests for a missing execution ID, a manifest/result target mismatch, and a missing scenario definition. The client must fail before calling `prepareMotis`.

- [ ] **Step 2: Run client tests and verify the orchestration module is absent**

Run: `npm test -- --run tests/renderer/scenario-comparison-client.test.ts`

Expected: FAIL because the client module and `runScenarioComparison()` do not exist.

- [ ] **Step 3: Implement artifact loading and core route comparison**

Require `window.transitDesktop`; load manifests with `listScenarioExecutionManifests(projectId)` and resolve each selected `executionId`. Read exactly one artifact per side. Verify:

1. manifest target equals selection target;
2. result target and execution ID match the manifest;
3. result input fingerprint matches the manifest;
4. scenario target has a matching `ScenarioDefinition`.

Call `compareScenarioExecutions()` with no journeys first. Emit `loading` and `validating` progress. Never call MOTIS for a route-only comparison when `queries` is empty.

- [ ] **Step 4: Write failing lifecycle tests for valid X→Y queries**

Add a two-stop current/scenario fixture and one query. Assert the exact lifecycle:

```ts
expect(api.selectMotisOsmPbf).toHaveBeenCalledTimes(1);
expect(api.prepareMotis).toHaveBeenCalledTimes(2);
expect(api.startMotis).toHaveBeenCalledTimes(2);
expect(api.requestMotis).toHaveBeenCalledTimes(2);
expect(api.stopMotis).toHaveBeenCalledTimes(2);
expect(progress.map((item) => item.phase)).toEqual([
  'loading', 'validating', 'routing-before', 'routing-after', 'complete'
]);
```

Use the same mock PBF SHA as both execution environments. Make the mock MOTIS responses expose one BUS leg and a transfer count so the normalized result can be asserted.

- [ ] **Step 5: Implement target network materialization and MOTIS routing**

For each selection, materialize the `after` network:

```ts
const network = materializeScenarioNetworks({
  target: selection.target,
  routeStops: input.routeStops,
  serviceConfigs: input.serviceConfigs,
  ...(definition ? { scenarioDefinition: definition } : {})
}).after;
```

Select the OSM PBF once and require its SHA to match both result environments before starting MOTIS. Also require both environments to have the same routing profile and travel-time model. If they differ, return the route-only comparison with `journeys: []` and warnings from Task 1.

For each side, build a multi-route Synthetic GTFS using `buildSyntheticGtfsNetwork()`, call `prepareMotis()`, `startMotis()`, run every query through `buildMotisPlanPath()` and `requestMotis()`, normalize with `normalizeMotisJourney(raw, query.departureDateTime)`, and always call `stopMotis()` after a successful start in `finally`. Reuse the current execution client's lifecycle behavior; do not call the save API.

Run all queries for one target before stopping it, then prepare the second target. Preserve per-query no-route results instead of failing the whole comparison.

- [ ] **Step 6: Implement progress, warnings, and partial query behavior**

Emit `routing-before` and `routing-after` progress with `completed` counting queries and `total` equal to `queries.length`. Add query-level MOTIS errors as `NormalizedJourney` warnings and continue to remaining queries when a single query fails. If preparation/start fails for an entire side, throw a clear error after attempting to stop a started sidecar.

- [ ] **Step 7: Run client tests and typecheck**

Run: `npm test -- --run tests/renderer/scenario-comparison-client.test.ts; npm run typecheck`

Expected: all client tests PASS and TypeScript reports no errors.

- [ ] **Step 8: Commit the orchestration client**

```bash
git add src/renderer/scenario-comparison-client.ts tests/renderer/scenario-comparison-client.test.ts
git commit -m "feat: run scenario journey comparisons"
```

## Task 3: Scenario Comparison Panel and Integration

Implementation note (2026-09-21): implemented in `9137ffd`, `dde8b99`, and `bc99e98`. The panel defaults to the newest current-vs-scenario pair when available, supports scenario-to-scenario labels, shows execution timestamps, starts with one editable query, validates query fields locally, displays in-vehicle/wait/walk metrics, renders all operation changes, and explicitly labels fare as unavailable. Empty artifact and route-master states are also rendered.

**Files:**
- Create: `src/renderer/ScenarioComparisonPanel.tsx`
- Create: `tests/renderer/ScenarioComparisonPanel.test.tsx`
- Modify: `src/renderer/ScenarioDefinitionEditor.tsx`
- Modify: `tests/renderer/ScenarioDefinitionEditor.test.tsx` only if the existing render assertion needs a comparison panel regression check

**Interfaces:**
- Consumes: `ScenarioExecutionManifest[]`, `ScenarioDefinition[]`, route master/service configs, `runScenarioComparison()`, `ScenarioComparisonResult`, and existing project editor props.
- Produces: a renderer-only comparison panel; no new persistence or IPC contract.

- [ ] **Step 1: Write failing markup tests for target and unavailable states**

Render the panel with no manifests, one current manifest, and two scenario manifests. Assert:

```ts
expect(emptyMarkup).toContain('비교할 실행 결과가 없습니다');
expect(readyMarkup).toContain('현행 네트워크');
expect(readyMarkup).toContain('시나리오');
expect(readyMarkup).toContain('비교 실행');
expect(readyMarkup).toContain('요금 계산 불가');
```

Also assert that the panel disables comparison when route master or either selected execution artifact is missing, and does not render demand redistribution or fare amounts.

- [ ] **Step 2: Run panel tests to verify the component is absent**

Run: `npm test -- --run tests/renderer/ScenarioComparisonPanel.test.tsx`

Expected: FAIL because the panel module does not exist.

- [ ] **Step 3: Implement target selection and query inputs**

Build target options from `project.scenarioExecutionManifests`:

- `current` manifests become current options;
- scenario manifests resolve their label from `project.scenarioDefinitions`;
- only `complete` and `partial` manifests can be selected; failed artifacts display as unavailable;
- prevent selecting the same execution ID on both sides;
- default to current versus the newest available scenario execution;
- provide origin stop ID, destination stop ID, and departure datetime inputs;
- initialize queries from the selected scenario definition's `journeyQueries` when present, otherwise use one empty query.

Keep query validation local to the panel: origin, destination, and departure time must be non-empty before execution.

- [ ] **Step 4: Implement result rendering and quality copy**

Render:

1. selected target labels and execution timestamps;
2. environment compatibility and warnings;
3. route table with added/removed/reordered stops, distance delta, runtime delta, headway/vehicle changes, and route status;
4. journey cards with total time, in-vehicle time, wait time, walk time, modes, and transfer count;
5. no-route warning without displaying a zero-minute improvement;
6. fare as `계산 불가` with the explicit reason;
7. fallback/model-estimated/partial warnings.

Do not display demand changes, ridership redistribution, or a numeric fare.

- [ ] **Step 5: Integrate below the existing ScenarioExecutionPanel**

Render `ScenarioComparisonPanel` in `ScenarioDefinitionEditor.tsx` using the existing `project`, `routeStops`, and `serviceConfigs` props. Pass `project.scenarioExecutionManifests ?? []` and `project.scenarioDefinitions ?? []`. Do not modify the existing scenario save handler or execution artifact panel.

- [ ] **Step 6: Run UI tests and regression tests**

Run: `npm test -- --run tests/renderer/ScenarioComparisonPanel.test.tsx tests/renderer/ScenarioDefinitionEditor.test.tsx tests/renderer/ScenarioExecutionPanel.test.tsx`

Expected: all comparison UI tests and existing editor/execution panel tests PASS.

- [ ] **Step 7: Commit the comparison panel**

```bash
git add src/renderer/ScenarioComparisonPanel.tsx tests/renderer/ScenarioComparisonPanel.test.tsx src/renderer/ScenarioDefinitionEditor.tsx tests/renderer/ScenarioDefinitionEditor.test.tsx
git commit -m "feat: add scenario comparison panel"
```

## Task 4: Full Verification and Branch Handoff

Verification note (2026-09-21): `npm run typecheck` passed; `npm test` passed with 66 test files / 324 tests; `npm run build` passed after allowing the isolated worktree to write TypeScript build cache files; `git diff --check` passed. Main was not merged or modified.

Review note (2026-09-21): a read-only review found no critical issues. Its important UI findings were addressed in `dde8b99` and `bc99e98`; final verification is rerun after those commits below.

**Files:**
- Modify: `docs/superpowers/plans/2026-09-20-scenario-comparison.md` only for factual execution notes after verification.
- No product-code changes are allowed in this task unless a verification command exposes a concrete regression covered by a new failing test.

- [ ] **Step 1: Run the complete test suite**

Run: `npm test -- --run`

Expected: all existing tests and new comparison tests PASS, including route-shape, scenario execution storage, legacy transit comparison, Synthetic GTFS, and renderer tests.

- [ ] **Step 2: Run typecheck and production build**

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run build`

Expected: Electron main, preload, and renderer bundles build successfully without tracked generated files.

- [ ] **Step 3: Perform the required manual fixture review**

Use the existing mocked MOTIS responses and inspect the rendered comparison output for:

1. current↔scenario with one added stop and changed headway;
2. scenario A↔scenario B with a route removed from B;
3. one no-route X→Y query;
4. environment SHA mismatch;
5. fare unavailable copy.

The review must confirm no route comparison reads `before.routes` and no missing journey is shown as zero minutes.

- [ ] **Step 4: Inspect the branch boundary**

Run: `git status --short --branch; git log --oneline --decorate -8`

Expected: branch is `codex/0.6.2-scenario-comparison`, the working tree is clean, and `codex/0.6.2-scenario-path-generation` and main remain unmodified.

- [ ] **Step 5: Record handoff**

Report the comparison branch, commits, test/typecheck/build results, the explicit fare-unavailable policy, and that demand redistribution remains the next separate feature. Do not merge, rebase, push, or delete the branch as part of this plan.

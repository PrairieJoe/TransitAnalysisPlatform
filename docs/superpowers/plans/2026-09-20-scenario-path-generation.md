# Scenario Path Generation and Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 저장된 다중 노선 `ScenarioDefinition`을 Before/After 전체 네트워크의 도로 경로·연장·추정 운행시간·운행정보로 실행하고, 재현 가능한 execution artifact로 저장한다.

**Architecture:** 순수 core 계층이 target을 전체 네트워크 snapshot으로 materialize하고 입력 fingerprint를 만든다. 기존 MOTIS BUS geometry 요청과 Synthetic GTFS 조립을 확장해 각 snapshot의 모든 노선을 실행하며, main process가 manifest와 큰 결과 JSON의 저장 경계를 담당한다. renderer는 저장된 시나리오와 실행환경을 선택하고 진행상태·품질·재사용 결과만 표시한다.

**Tech Stack:** TypeScript, React, Electron IPC/contextBridge, Vitest, 기존 MOTIS `/api/route` BUS API, 기존 Synthetic GTFS compiler/schedule/travel-time estimator.

**Spec:** `docs/superpowers/specs/2026-09-20-scenario-path-generation-design.md`

## Global Constraints

- 설계·구현은 `codex/0.6.2-scenario-path-generation`에서 진행한다.
- 현재 개발 중인 메인 브랜치에는 통합하지 않는다.
- 기존 `scenarioDefinitions` metadata와 기존 `scenarioDeltas`는 유지한다.
- 기존 `ScenarioDefinition`의 `scenarioSchemaVersion`은 변경하지 않는다.
- 새 manifest/artifact가 없는 프로젝트도 current 화면과 기존 GTFS 흐름을 사용할 수 있어야 한다.
- 기존 단일 노선 Synthetic GTFS/MOTIS 실행 흐름을 제거하지 않는다.
- MOTIS geometry 실패·잘못된 geometry·beeline fallback은 실제 도로 경로 `complete`로 표시하지 않고 `partial` 또는 `failed`로 보존한다.
- 변경되지 않은 노선도 current 정보로 Before/After 전체 네트워크에 포함한다.
- `current` target은 Before와 After에 같은 현행 네트워크 snapshot을 사용하고, `scenario:{scenarioId}` target은 ScenarioDefinition의 Before/After snapshot을 사용한다.
- 같은 target과 input fingerprint가 이미 `complete`이면 새 artifact를 만들지 않고 기존 execution을 재사용한다.
- 모든 route가 실패하면 유효한 결과 artifact로 저장하지 않고 `failed` manifest만 남긴다.
- 이번 단계에는 수요 재배분, 현행↔시나리오·시나리오↔시나리오 비교 화면, 요금 계산, 승객별 최적 경로를 넣지 않는다.

## Review Focus

- 현행 노선에 상세 운행계획이 없는 입력은 임의의 공식 운행정보로 표시하지 않고 `MODEL_ESTIMATED` provenance와 `partial` 경고를 남겨야 한다. → Task 1의 current-operation materialization test.
- 여러 노선 중 한 노선 또는 한 방향의 geometry만 실패해도 성공한 결과를 버리지 않고 route·network를 `partial`로 저장해야 한다. → Task 2의 mixed route outcome test.
- beeline fallback geometry는 거리 계산에 사용할 수 있지만 `OSM_ROUTED`/`complete`로 승격되면 안 된다. → Task 2의 fallback provenance test.
- 잘못된 `projectId`·`executionId`·artifact 경로와 손상된 JSON은 파일 경계를 벗어나지 않게 거부하고 재생성 가능한 `failed` 상태로 남겨야 한다. → Task 3의 storage validation/round-trip tests.
- MOTIS/PBF/model fingerprint가 같으면 재사용하고 하나라도 달라지면 기존 결과를 삭제하지 않은 채 독립 execution을 생성해야 한다. → Task 3와 Task 4의 reuse/new-execution tests.

---

## 파일 구조와 책임

| 파일 | 책임 |
| --- | --- |
| `src/shared/types.ts` | execution target, environment, manifest, result artifact의 공유 계약과 `ProjectManifest` optional metadata |
| `src/core/scenario-execution.ts` | target 검증, current/scenario Before·After materialization, stable input fingerprint, execution 결과 상태 계산 |
| `src/core/route-shape.ts` | 기존 map용 route-shape API를 보존하면서 stop-pair 요청, geometry 검증, polyline 거리 계산을 공통화 |
| `src/core/synthetic-gtfs/network-builder.ts` | 여러 materialized route를 기존 adapter/compiler에 연결하는 Synthetic GTFS 생성 |
| `src/core/scenario-route-execution.ts` | snapshot route별 stop-pair 실행 결과를 방향·구간·연장·runtime으로 집계 |
| `src/main/project-store.ts` | manifest metadata와 `scenario-executions/<executionId>.json` artifact의 검증·원자 저장·조회 |
| `src/main/index.ts` | scenario execution 저장·조회 IPC handler |
| `src/preload/index.ts` | renderer에 안전한 scenario execution IPC만 노출 |
| `src/renderer/env.d.ts` | preload API의 타입 계약 |
| `src/renderer/scenario-execution-client.ts` | renderer의 MOTIS 준비/route 요청/결과 저장 orchestration |
| `src/renderer/ScenarioExecutionPanel.tsx` | 시나리오 선택, 환경확인, 실행, 진행상태, 품질 및 재사용 결과 UI |
| `src/renderer/ScenarioDefinitionEditor.tsx` | 기존 저장 editor 아래에 execution panel을 연결하되 정의 저장 흐름은 유지 |
| `src/renderer/SyntheticGtfsBuilder.tsx` | 기존 단일 노선 화면과 새 multi-route execution panel의 공존 경계 |
| `src/renderer/App.tsx` | 현재 project와 route master/service config를 execution panel에 전달 |
| `tests/core/scenario-execution.test.ts` | materialization, operation assumptions, fingerprint 순수 함수 테스트 |
| `tests/core/route-shape.test.ts` | 기존 route-shape 회귀 및 공통 stop-pair 거리/geometry 테스트 |
| `tests/core/scenario-route-execution.test.ts` | route/direction/segment aggregation과 partial 상태 테스트 |
| `tests/core/synthetic-gtfs-network.test.ts` | multi-route GTFS 생성 및 single-route 회귀 테스트 |
| `tests/main/project-store.test.ts` | manifest/artifact 저장·조회·검증·재사용 테스트 |
| `tests/renderer/scenario-execution-client.test.ts` | runtime API 호출 순서와 fingerprint reuse 테스트 |
| `tests/renderer/ScenarioExecutionPanel.test.tsx` | UI 상태·경고·재사용 표시 테스트 |

---

### Task 1: Shared Execution Contract and Full-Network Materialization

**Files:**
- Modify: `src/shared/types.ts` — execution 계약 추가, `ProjectManifest.scenarioExecutionManifests?: ScenarioExecutionManifest[]` 추가
- Create: `src/core/scenario-execution.ts`
- Create: `tests/core/scenario-execution.test.ts`

**Interfaces:**
- Consumes: `RouteStopMasterRecord[]`, `RouteServiceConfig[]`, `ScenarioDefinition`, `ScenarioOperationPlan`, `buildRoutePathIndex()`의 static/dated path 선택 규칙
- Produces: 다음 task가 사용하는 정확한 타입과 함수

```ts
export type ScenarioExecutionTarget =
  | { kind: 'current' }
  | { kind: 'scenario'; scenarioId: string };

export interface ScenarioExecutionEnvironment {
  motisVersion?: string;
  osmPbfFileName: string;
  osmPbfSha256: string;
  routingProfile: 'bus';
  travelTimeModelVersion: string;
}

export interface ScenarioPathProvenance {
  sourceType: 'OSM_ROUTED' | 'BEELINE_FALLBACK' | 'MODEL_ESTIMATED';
  confidence: 'high' | 'medium' | 'low';
  modelVersion?: string;
  assumptions: string[];
}

export interface ScenarioExecutionManifest {
  executionSchemaVersion: 1;
  executionId: string;
  target: ScenarioExecutionTarget;
  scenarioDefinitionUpdatedAt?: string;
  inputFingerprint: string;
  environment: ScenarioExecutionEnvironment;
  status: 'complete' | 'partial' | 'failed';
  routeCount: number;
  completeRouteCount: number;
  warningCount: number;
  artifactFileName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioExecutionResult {
  executionSchemaVersion: 1;
  executionId: string;
  target: ScenarioExecutionTarget;
  inputFingerprint: string;
  environment: ScenarioExecutionEnvironment;
  before: ScenarioNetworkSnapshot;
  after: ScenarioNetworkSnapshot;
  warnings: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioNetworkSnapshot {
  routes: ScenarioRouteExecution[];
  status: 'complete' | 'partial' | 'failed';
  warnings: string[];
}

export interface ScenarioRouteExecution {
  routeId: string;
  routeName: string;
  transportMode: string;
  source: 'current' | 'scenario-before' | 'scenario-after';
  stopIds: string[];
  operation: ScenarioOperationPlan;
  directions: ScenarioDirectionExecution[];
  totalDistanceMeters: number | null;
  totalRuntimeSeconds: number | null;
  status: 'complete' | 'partial' | 'failed';
  warnings: string[];
}

export interface ScenarioDirectionExecution {
  direction: 'forward' | 'reverse';
  segments: ScenarioSegmentExecution[];
  routeDistanceMeters: number | null;
  runtimeSeconds: number | null;
  status: 'complete' | 'partial' | 'failed';
}

export interface ScenarioSegmentExecution {
  fromStopId: string;
  toStopId: string;
  points: Array<{ latitude: number; longitude: number }>;
  distanceMeters: number | null;
  travelSeconds: number | null;
  source: 'osm' | 'beeline';
  provenance: ScenarioPathProvenance;
  warning?: string;
}

export interface MaterializedScenarioRoute {
  routeId: string;
  routeName: string;
  transportMode: string;
  stopRecords: RouteStopMasterRecord[];
  operation: ScenarioOperationPlan;
  source: 'current' | 'scenario-before' | 'scenario-after';
  warnings: string[];
}

export interface MaterializedScenarioNetwork {
  routes: MaterializedScenarioRoute[];
  warnings: string[];
}

export interface ScenarioMaterializationInput {
  target: ScenarioExecutionTarget;
  routeStops: RouteStopMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
  scenarioDefinition?: ScenarioDefinition;
}

export function materializeScenarioNetworks(input: ScenarioMaterializationInput): {
  before: MaterializedScenarioNetwork;
  after: MaterializedScenarioNetwork;
};

export function buildScenarioInputFingerprint(input: ScenarioMaterializationInput & {
  environment: ScenarioExecutionEnvironment;
}): string;

export function buildCurrentOperationPlan(routeId: string, serviceConfig?: RouteServiceConfig): {
  operation: ScenarioOperationPlan;
  warnings: string[];
};

export function createScenarioExecutionManifest(input: {
  executionId: string;
  target: ScenarioExecutionTarget;
  scenarioDefinitionUpdatedAt?: string;
  inputFingerprint: string;
  environment: ScenarioExecutionEnvironment;
  status: ScenarioExecutionManifest['status'];
  routeCount: number;
  completeRouteCount: number;
  warningCount: number;
  artifactFileName: string;
  now: string;
}): ScenarioExecutionManifest;
```

- [ ] **Step 1: Write the failing materialization tests**

Add small factories in `tests/core/scenario-execution.test.ts` for route master rows, service config, operation plan, and a two-route project. Pin these behaviors:

```ts
it('materializes all routes and applies a multi-route scenario to Before and After', () => {
  const result = materializeScenarioNetworks({
    target: { kind: 'scenario', scenarioId: 's-1' },
    routeStops: [routeA1, routeA2, routeA3, routeB1, routeB2, unchangedC1, unchangedC2],
    serviceConfigs: [configA, configB, configC],
    scenarioDefinition: definitionChangingAAndB
  });

  expect(result.before.routes.map((route) => route.routeId)).toEqual(['A', 'B', 'C']);
  expect(result.before.routes.find((route) => route.routeId === 'A')?.stopRecords.map((stop) => stop.stationId))
    .toEqual(['a-1', 'a-2', 'a-3']);
  expect(result.after.routes.find((route) => route.routeId === 'A')?.stopRecords.map((stop) => stop.stationId))
    .toEqual(['a-1', 'a-3', 'a-4']);
  expect(result.after.routes.find((route) => route.routeId === 'B')?.operation)
    .toEqual(definitionChangingAAndB.routeChanges[1].afterOperation);
  expect(result.after.routes.find((route) => route.routeId === 'C')?.source).toBe('current');
});

it('uses a static representative path before a dated path', () => {
  const result = materializeScenarioNetworks({
    target: { kind: 'current' },
    routeStops: [staticA1, staticA2, datedA1, datedA2],
    serviceConfigs: [configA]
  });

  expect(result.before.routes[0].stopRecords.map((stop) => stop.stationId)).toEqual(['static-1', 'static-2']);
});

it('marks missing current operations as model-estimated instead of official', () => {
  const result = materializeScenarioNetworks({
    target: { kind: 'current' },
    routeStops: [routeA1, routeA2],
    serviceConfigs: []
  });

  expect(result.before.routes[0].warnings).toContain('MODEL_ESTIMATED');
  expect(result.before.warnings.length).toBeGreaterThan(0);
});

it('rejects a scenario route or stop that is not present in the route master', () => {
  expect(() => materializeScenarioNetworks({
    target: { kind: 'scenario', scenarioId: 's-1' },
    routeStops: [routeA1, routeA2],
    serviceConfigs: [],
    scenarioDefinition: definitionWithUnknownStop
  })).toThrow(/정류장|노선/);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail for the missing contract**

Run: `npm test -- --run tests/core/scenario-execution.test.ts`

Expected: FAIL because the execution types and materialization functions do not exist yet; the existing project tests remain untouched.

- [ ] **Step 3: Add the shared execution types**

Append the contract types near the existing scenario types in `src/shared/types.ts`. Add only the optional field below to `ProjectManifest`; do not change `CURRENT_PROJECT_SCHEMA_VERSION` or existing scenario versions.

```ts
scenarioExecutionManifests?: ScenarioExecutionManifest[];
```

Use `import type` only where required; shared types must remain serializable and must not import Node-only modules.

- [ ] **Step 4: Implement deterministic materialization**

In `src/core/scenario-execution.ts`:

1. Validate `target.kind`, require a matching `scenarioDefinition` for a scenario target, reject duplicate route changes, reject empty route IDs and stop IDs, and reject scenario stop IDs that are not present in the route master for the named route.
2. Call `buildRoutePathIndex(routeStops)` and select the static path first; if no static path exists, select the dated path with the greatest `serviceDate`, matching `buildSyntheticGtfsDraft` behavior.
3. Create the full route ID union from selected current paths and scenario changes. Sort route IDs lexicographically for stable output.
4. For `current`, put the selected current route and its current operation into both `before` and `after`, with source `current`.
5. For a scenario target, use `baseStopIds`/`beforeOperation` for changed routes in `before`, `scenarioStopIds`/`afterOperation` for changed routes in `after`, and current route data in both snapshots for unchanged routes.
6. Resolve stop records by route ID and ordered station IDs. Preserve `routeName`/`transportMode` from the scenario change when present, otherwise use the selected master path.
7. Because the existing manifest does not contain a complete current first/last/headway/dwell plan, use an explicit baseline operation matching the existing Synthetic GTFS editor defaults (`serviceDays: [1,2,3,4,5]`, `firstDeparture: '06:00'`, `lastDeparture: '23:00'`, `headwayMinutes: 20`, `vehicleCount: 8`, `dwellSeconds: 20`, `deriveReverseDirection: true`, start/end dates from the selected master context or `'1970-01-01'`/`'2099-12-31'`) and add `MODEL_ESTIMATED`/missing-operation warnings. Never claim these values are measured current operations.
8. Build the fingerprint from a canonical object with sorted route IDs, ordered stop IDs, operation values, scenario `updatedAt`/route changes, target, environment, route master coordinates, service configs, and all environment fields. Use `JSON.stringify` over the canonical object; do not add a crypto dependency or expose filesystem paths.

The canonicalization must make these two inputs equal: equivalent records in different input array order and equivalent `serviceConfigs` in different order. It must make these inputs different: a changed scenario ID/updatedAt, changed stop coordinate, changed PBF SHA, changed MOTIS version/profile, or changed travel-time model version.

- [ ] **Step 5: Run the focused tests and typecheck**

Run: `npm test -- --run tests/core/scenario-execution.test.ts`

Expected: all materialization and fingerprint tests PASS.

Run: `npm run typecheck`

Expected: PASS with no changes to unrelated modules.

- [ ] **Step 6: Commit the independently testable materialization unit**

```bash
git add src/shared/types.ts src/core/scenario-execution.ts tests/core/scenario-execution.test.ts
git commit -m "feat: add scenario execution materialization contract"
```

### Task 2: Multi-Route GTFS, Geometry, and Route Execution Aggregation

**Files:**
- Modify: `src/core/route-shape.ts` — add generic stop-pair request path while preserving `fetchRouteShapes(metrics, request)` behavior
- Create: `src/core/synthetic-gtfs/network-builder.ts`
- Create: `src/core/scenario-route-execution.ts`
- Test: `tests/core/route-shape.test.ts`
- Test: `tests/core/synthetic-gtfs-network.test.ts`
- Test: `tests/core/scenario-route-execution.test.ts`

**Interfaces:**
- Consumes: `MaterializedScenarioNetwork`, `ScenarioOperationPlan`, `ScenarioPathProvenance`, existing `RouteShapeResult`, `estimateSegmentTravelTimes()`, `adaptRouteMasterToSynthetic()`, `synthesizeSchedule()`, `compileSyntheticGtfs()`
- Produces:

```ts
export interface ScenarioRouteShapeRequest {
  key: string;
  fromStopId: string;
  toStopId: string;
  from: { latitude: number; longitude: number };
  to: { latitude: number; longitude: number };
}

export interface ScenarioRouteShapeFetchRequest {
  requests: readonly ScenarioRouteShapeRequest[];
  request: <T = unknown>(path: string, init?: MotisRequestInit) => Promise<T>;
}

export function fetchRouteShapesForStops(
  input: ScenarioRouteShapeFetchRequest
): Promise<Map<string, RouteShapeResult>>;

export function calculatePolylineDistanceMeters(
  points: ReadonlyArray<{ latitude: number; longitude: number }>
): number;

export interface ScenarioSyntheticNetworkInput {
  routes: MaterializedScenarioRoute[];
  agencyId: string;
  agencyName: string;
  sourceName: string;
}

export function buildSyntheticGtfsNetwork(
  input: ScenarioSyntheticNetworkInput
): SyntheticGtfsBuildResult;

export interface ExecuteScenarioNetworkInput {
  network: MaterializedScenarioNetwork;
  request: <T = unknown>(path: string, init?: MotisRequestInit) => Promise<T>;
}

export async function executeScenarioNetwork(
  input: ExecuteScenarioNetworkInput
): Promise<ScenarioNetworkSnapshot>;
```

- [ ] **Step 1: Write failing tests for multi-route GTFS and route-shape behavior**

Pin the route and direction behavior with fixtures containing two changed routes and one unchanged route:

```ts
it('builds one Synthetic GTFS result containing every materialized route', () => {
  const result = buildSyntheticGtfsNetwork({
    routes: [routeAAfter, routeBAfter, routeCCurrent],
    agencyId: 'agency',
    agencyName: 'Test Agency',
    sourceName: 'scenario:s-1'
  });

  expect(result.summary.routeCount).toBe(3);
  expect(result.files['routes.txt']).toContain('A');
  expect(result.files['routes.txt']).toContain('B');
  expect(result.files['routes.txt']).toContain('C');
});

it('returns OSM geometry and polyline distance for a valid MOTIS response', async () => {
  const shapes = await fetchRouteShapesForStops({
    requests: [requestFor('a-1', 'a-2')],
    request: async () => validMotisFeatureCollection
  });

  expect(shapes.get('a-1:a-2')?.source).toBe('osm');
  expect(shapes.get('a-1:a-2')?.warning).toBeUndefined();
  expect(calculatePolylineDistanceMeters(shapes.get('a-1:a-2')!.points)).toBeGreaterThan(0);
});

it('marks a failed segment as beeline partial instead of complete', async () => {
  const snapshot = await executeScenarioNetwork({
    network: { routes: [routeWithTwoSegments], warnings: [] },
    request: async () => { throw new Error('MOTIS unavailable'); }
  });

  expect(snapshot.status).toBe('partial');
  expect(snapshot.routes[0].status).toBe('partial');
  expect(snapshot.routes[0].directions[0].segments[0].source).toBe('beeline');
  expect(snapshot.routes[0].directions[0].segments[0].provenance.sourceType).toBe('BEELINE_FALLBACK');
});

it('keeps successful routes when another route fails', async () => {
  const snapshot = await executeScenarioNetwork({
    network: { routes: [routeThatSucceeds, routeThatFails], warnings: [] },
    request: requestByRoutePair
  });

  expect(snapshot.status).toBe('partial');
  expect(snapshot.routes.find((route) => route.routeId === 'OK')?.status).toBe('complete');
  expect(snapshot.routes.find((route) => route.routeId === 'FAIL')?.status).toBe('partial');
});
```

Also retain the existing `fetchRouteShapes(metrics, request)` assertions unchanged, so this task cannot silently alter the map's compatibility fallback.

- [ ] **Step 2: Run focused tests to verify the new APIs fail**

Run: `npm test -- --run tests/core/route-shape.test.ts tests/core/synthetic-gtfs-network.test.ts tests/core/scenario-route-execution.test.ts`

Expected: the new tests fail because the generic shape fetcher, multi-route builder, and scenario executor are not defined; existing route-shape tests remain the baseline.

- [ ] **Step 3: Extract generic stop-pair geometry handling from `route-shape.ts`**

Keep `RouteShapePoint`, `RouteShapeResult`, endpoint/coordinate/continuity validation, and the existing 256-request ceiling. Add `fetchRouteShapesForStops()` that:

1. Sends one `POST /api/route` request per stop pair with `traveler_type: 'pedestrian'` only where the current API requires it and BUS transport mode exactly as the existing function does.
2. Maps each response into `RouteShapeResult` keyed by the caller's `key`.
3. Returns `source: 'osm'` for valid geometry and `source: 'beeline'` with a warning for unavailable, invalid, or failed responses.
4. Does not hide fallback as a successful route.

Implement `calculatePolylineDistanceMeters()` with the existing haversine convention used by `draft-builder.ts`, returning `0` for fewer than two points and rejecting non-finite/out-of-range points before distance calculation.

Make the old `fetchRouteShapes(metrics, request)` convert each metric to `ScenarioRouteShapeRequest`, delegate, and map back to its current result shape so all current map callers and tests remain valid.

- [ ] **Step 4: Build multi-route Synthetic GTFS without changing the single-route contract**

In `src/core/synthetic-gtfs/network-builder.ts`, for each `MaterializedScenarioRoute`:

1. Validate the route has at least two stops and a valid operation.
2. Call `adaptRouteMasterToSynthetic()` with that route's exact stop order and operation values.
3. For every generated direction, derive stop-pair inputs, call `estimateSegmentTravelTimes()` with the route's `travelTimeModel`, and call `synthesizeSchedule()` with its first service plan.
4. Combine all routes/directions and call `compileSyntheticGtfs()` once with `shapeMode: 'missing'`.
5. Preserve route warnings and add `MODEL_ESTIMATED` provenance to the build summary when an operation originated from current defaults.

Refactor `buildSyntheticGtfsDraft()` only enough to share helpers or a one-route wrapper; its public parameters, output, defaults, and tests must remain unchanged.

- [ ] **Step 5: Aggregate directions, segments, distance, runtime, and status**

In `src/core/scenario-route-execution.ts`:

1. For every route, build adjacent stop pairs in forward order.
2. Request reverse pairs only when `operation.deriveReverseDirection` is true; never infer reverse from a failed forward request.
3. Convert each shape result to `ScenarioSegmentExecution`; calculate geometry distance from returned points and travel seconds with the route operation's `travelTimeModel`, using road class `unknown` and zero intersection/turn counts when MOTIS does not return those model inputs.
4. Assign `OSM_ROUTED`/high confidence to valid routed geometry, `BEELINE_FALLBACK`/low confidence to fallback geometry, and `MODEL_ESTIMATED`/low confidence to runtime estimates. Include the model version and each warning.
5. Mark a direction `complete` only when all segments are OSM routed. Mark it `partial` when any segment is fallback or has a warning; mark it `failed` only when no usable segment result can be materialized.
6. Sum usable segment distances and runtimes into direction and route totals. A route with at least one partial direction is `partial`; a route with no usable direction is `failed`.
7. Set network status to `complete` only when every route is complete, `failed` only when every route failed, otherwise `partial`; preserve successful routes and all warnings.

The result must include both `before` and `after` snapshots at the caller level; this function only owns one materialized network snapshot and must not compare or merge demand data.

- [ ] **Step 6: Run core tests, typecheck, and regression tests**

Run: `npm test -- --run tests/core/route-shape.test.ts tests/core/synthetic-gtfs-network.test.ts tests/core/scenario-route-execution.test.ts`

Expected: all new tests and all existing route-shape tests PASS, including OSM/fallback distinction, reverse direction, distance, runtime, and mixed-route status.

Run: `npm run typecheck`

Expected: PASS.

Run: `npm test -- --run tests/core/synthetic-gtfs* tests/core/route-shape.test.ts`

Expected: existing single-route Synthetic GTFS tests PASS without snapshot or API regressions.

- [ ] **Step 7: Commit the path execution unit**

```bash
git add src/core/route-shape.ts src/core/synthetic-gtfs/network-builder.ts src/core/scenario-route-execution.ts tests/core/route-shape.test.ts tests/core/synthetic-gtfs-network.test.ts tests/core/scenario-route-execution.test.ts
git commit -m "feat: generate multi-route scenario paths"
```

### Task 3: Main-Process Artifact Storage and IPC Boundary

**Files:**
- Modify: `src/main/project-store.ts` — execution manifest metadata, artifact path validation, atomic save/read/reuse
- Modify: `src/main/index.ts` — IPC handlers `scenario-execution:save` and `scenario-execution:read`
- Modify: `src/preload/index.ts` — typed-safe wrapper methods
- Modify: `src/renderer/env.d.ts` — renderer API declarations
- Modify: `tests/main/project-store.test.ts` — artifact and metadata tests

**Interfaces:**
- Consumes: `ScenarioExecutionManifest`, `ScenarioExecutionResult`, `ProjectManifest`, existing `saveMetadata()` and project directory resolver
- Produces:

```ts
export interface SaveScenarioExecutionPayload {
  projectId: string;
  manifest: ScenarioExecutionManifest;
  result: ScenarioExecutionResult;
}

export interface ReadScenarioExecutionPayload {
  projectId: string;
  executionId: string;
}

// ProjectStore public methods
saveScenarioExecution(
  payload: SaveScenarioExecutionPayload
): Promise<ScenarioExecutionManifest>;

readScenarioExecution(
  payload: ReadScenarioExecutionPayload
): Promise<ScenarioExecutionResult>;

listScenarioExecutionManifests(
  projectId: string
): Promise<ScenarioExecutionManifest[]>;
```

The preload surface must be exactly:

```ts
saveScenarioExecution: (payload: SaveScenarioExecutionPayload) => Promise<ScenarioExecutionManifest>;
readScenarioExecution: (payload: ReadScenarioExecutionPayload) => Promise<ScenarioExecutionResult>;
listScenarioExecutionManifests: (projectId: string) => Promise<ScenarioExecutionManifest[]>;
```

- [ ] **Step 1: Write failing project-store tests**

Add tests that create a temporary project through the existing test helper and assert:

```ts
it('round-trips the manifest in project-state and the full result artifact', async () => {
  const saved = await store.saveScenarioExecution({ projectId, manifest, result });

  expect(saved).toEqual(manifest);
  expect((await store.openProject(projectId)).scenarioExecutionManifests).toContainEqual(manifest);
  expect(await store.readScenarioExecution({ projectId, executionId: manifest.executionId })).toEqual(result);
});

it('replaces a complete execution with the same fingerprint instead of adding a duplicate', async () => {
  const first = await store.saveScenarioExecution({ projectId, manifest, result });
  const second = await store.saveScenarioExecution({ projectId, manifest: { ...manifest, updatedAt: '2026-09-20T01:00:00Z' }, result });

  expect(second.executionId).toBe(first.executionId);
  expect((await store.openProject(projectId)).scenarioExecutionManifests).toHaveLength(1);
});

it('rejects traversal IDs and marks a corrupt artifact as failed on read', async () => {
  await expect(store.readScenarioExecution({ projectId, executionId: '../project-state' })).rejects.toThrow();
  await corruptArtifact(manifest.executionId);
  await expect(store.readScenarioExecution({ projectId, executionId: manifest.executionId })).rejects.toThrow(/손상|실패|JSON/);
});
```

Add a different environment fingerprint case and assert the existing complete result remains while a second manifest is allowed.

- [ ] **Step 2: Run storage tests to verify the missing methods fail**

Run: `npm test -- --run tests/main/project-store.test.ts`

Expected: the new tests fail because no scenario execution artifact API exists; existing project metadata tests remain the baseline.

- [ ] **Step 3: Implement safe artifact paths and atomic artifact writes**

In `project-store.ts`:

1. Resolve the project directory from the already validated `projectId`; never accept an arbitrary filesystem directory from renderer.
2. Validate `executionId` against `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/` and require `manifest.artifactFileName === \`scenario-executions/${executionId}.json\``.
3. Write the result to `scenario-executions/<executionId>.json.tmp-<random>` using UTF-8 JSON, flush/close it, then rename atomically to the final file.
4. Update `project-state.json` through the existing metadata atomic writer only after the artifact write succeeds.
5. On metadata failure after artifact success, add/update a manifest with `status: 'failed'` and preserve the artifact as an orphan candidate; do not claim completion.
6. On read, validate the parsed execution schema, IDs, target, fingerprint, and artifact filename against the manifest before returning it. Convert JSON parse/schema errors to a user-facing error while preserving the failed manifest path.

- [ ] **Step 4: Implement fingerprint-aware manifest upsert**

When saving a successful execution:

1. Find an existing manifest with the same target and `inputFingerprint`.
2. If that manifest is `complete`, return the existing manifest without writing a second artifact.
3. If it is `partial` or `failed`, use the supplied execution ID to replace the same logical record only after the new artifact succeeds.
4. If target or fingerprint differs, append a new manifest and keep the old artifact.
5. Sort manifests by `updatedAt` descending for stable UI display.

Do not delete prior executions as part of this task.

- [ ] **Step 5: Add IPC handler validation and preload declarations**

In `src/main/index.ts`, register handlers that validate the payload shape before calling the store:

```ts
ipcMain.handle('scenario-execution:save', (_event, payload: unknown) =>
  projectStore.saveScenarioExecution(assertSaveScenarioExecutionPayload(payload))
);
ipcMain.handle('scenario-execution:read', (_event, payload: unknown) =>
  projectStore.readScenarioExecution(assertReadScenarioExecutionPayload(payload))
);
ipcMain.handle('scenario-execution:list', (_event, projectId: unknown) =>
  projectStore.listScenarioExecutionManifests(assertProjectId(projectId))
);
```

Expose the three methods from `src/preload/index.ts` through `ipcRenderer.invoke()` and add their imported types to `src/renderer/env.d.ts`. Renderer code must never call `fs`, `path`, or `project-store` directly.

- [ ] **Step 6: Run main tests and typecheck**

Run: `npm test -- --run tests/main/project-store.test.ts`

Expected: metadata/artifact round-trip, duplicate fingerprint reuse, changed-environment independence, traversal rejection, and corrupt artifact failure tests PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the storage boundary**

```bash
git add src/main/project-store.ts src/main/index.ts src/preload/index.ts src/renderer/env.d.ts tests/main/project-store.test.ts
git commit -m "feat: persist scenario execution artifacts"
```

### Task 4: Renderer Execution Client and UI Integration

**Files:**
- Create: `src/renderer/scenario-execution-client.ts`
- Create: `src/renderer/ScenarioExecutionPanel.tsx`
- Modify: `src/renderer/ScenarioDefinitionEditor.tsx` — render panel below definition save controls
- Modify: `src/renderer/SyntheticGtfsBuilder.tsx` — pass current route data and keep legacy single-route flow
- Modify: `src/renderer/App.tsx` — provide current project context and execution callback inputs
- Test: `tests/renderer/scenario-execution-client.test.ts`
- Test: `tests/renderer/ScenarioExecutionPanel.test.tsx`

**Interfaces:**
- Consumes: `ScenarioExecutionTarget`, `ScenarioDefinition`, `RouteStopMasterRecord[]`, `RouteServiceConfig[]`, `buildSyntheticGtfsNetwork()`, `executeScenarioNetwork()`, `window.transitDesktop.prepareMotis/startMotis/requestMotis/saveScenarioExecution/listScenarioExecutionManifests`
- Produces:

```ts
export interface ScenarioExecutionClientInput {
  projectId: string;
  target: ScenarioExecutionTarget;
  routeStops: RouteStopMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
  scenarioDefinition?: ScenarioDefinition;
  now: string;
}

export interface ScenarioExecutionProgress {
  phase: 'validating' | 'preparing-before' | 'routing-before' | 'preparing-after' | 'routing-after' | 'saving' | 'complete';
  completed: number;
  total: number;
  message: string;
}

export async function runScenarioExecution(
  input: ScenarioExecutionClientInput,
  onProgress?: (progress: ScenarioExecutionProgress) => void
): Promise<ScenarioExecutionManifest>;
```

`ScenarioExecutionPanel` props must be:

```ts
export interface ScenarioExecutionPanelProps {
  projectId: string;
  routeStops: RouteStopMasterRecord[];
  serviceConfigs: RouteServiceConfig[];
  scenarioDefinitions: ScenarioDefinition[];
  onExecutionSaved?: (manifest: ScenarioExecutionManifest) => void;
}
```

- [ ] **Step 1: Write failing client tests**

Mock `window.transitDesktop` and assert the exact lifecycle:

```ts
it('checks environment, prepares both snapshots, routes them, and saves one result', async () => {
  const result = await runScenarioExecution(input, progress.push);

  expect(api.selectMotisOsmPbf).toHaveBeenCalledTimes(1);
  expect(api.prepareMotis).toHaveBeenCalledTimes(2);
  expect(api.startMotis).toHaveBeenCalledTimes(2);
  expect(api.requestMotis).toHaveBeenCalled();
  expect(api.saveScenarioExecution).toHaveBeenCalledTimes(1);
  expect(result.status).toBe('complete');
  expect(progress.map((item) => item.phase)).toEqual([
    'validating', 'preparing-before', 'routing-before', 'preparing-after', 'routing-after', 'saving', 'complete'
  ]);
});

it('reuses a complete matching manifest without preparing MOTIS again', async () => {
  api.listScenarioExecutionManifests.mockResolvedValue([matchingCompleteManifest]);

  const result = await runScenarioExecution(input);

  expect(result).toEqual(matchingCompleteManifest);
  expect(api.prepareMotis).not.toHaveBeenCalled();
  expect(api.saveScenarioExecution).not.toHaveBeenCalled();
});

it('reports unavailable desktop runtime without pretending a path was generated', async () => {
  const previous = window.transitDesktop;
  window.transitDesktop = undefined;
  await expect(runScenarioExecution(input)).rejects.toThrow(/데스크톱|MOTIS/);
  window.transitDesktop = previous;
});
```

- [ ] **Step 2: Run client tests to verify the orchestration API is absent**

Run: `npm test -- --run tests/renderer/scenario-execution-client.test.ts`

Expected: FAIL because the client and preload methods do not exist.

- [ ] **Step 3: Implement `runScenarioExecution()`**

The client must:

1. Require `window.transitDesktop`; reject before any write when the renderer is running without the Electron preload.
2. Build materialized Before/After networks and the environment fingerprint using the Task 1 functions.
3. List manifests and reuse only a `complete` manifest with matching target and fingerprint. Do not reuse a partial/failed manifest.
4. Obtain/inspect the selected OSM PBF and verify `routingProfile: 'bus'`, the PBF SHA, and travel-time model version.
5. Build multi-route GTFS for Before, call `prepareMotis`, `startMotis`, route the snapshot with `requestMotis`, stop the sidecar, then repeat for After. Always attempt `stopMotis()` in a `finally` block after a successful start.
6. Emit progress after each phase and after each route/direction; progress totals must count all route directions in the snapshot, including unchanged routes.
7. Build a single `ScenarioExecutionResult` containing both snapshots, calculate manifest status/counts, and call `saveScenarioExecution` once. If all routes fail, save only a failed manifest according to the main-store API and surface the failure.

The client may reuse the current `SyntheticGtfsBuilder`'s existing PBF selection and MOTIS lifecycle helpers by extracting shared non-UI helpers; it must not duplicate platform filesystem logic in renderer code.

- [ ] **Step 4: Implement the execution panel with explicit quality copy**

The panel must render:

1. A saved-scenario selector and a `current` target option.
2. Environment fields: MOTIS status/version, OSM PBF filename/SHA, and routing profile.
3. A disabled Execute button when no route master, no scenario selected for a scenario target, or execution is already running.
4. Phase progress, completed/total directions, and warnings.
5. Summary counts: total routes, complete/partial/failed routes, OSM-routed segments, fallback segments, total extension, and estimated runtime.
6. A reuse message when a matching complete execution is found.
7. Clear Korean copy that runtime is model-estimated and that beeline fallback is not an actual road path.

Do not render demand changes, fares, X→Y comparison, or comparison selectors in this panel. Keep the existing ScenarioDefinition save/update behavior and existing single-route Synthetic GTFS controls working.

- [ ] **Step 5: Mount the panel without altering the main branch**

Pass project ID, `project.routeStopMaster ?? []`, `project.routeServiceConfigs ?? []`, and `project.scenarioDefinitions ?? []` from `App.tsx` through `SyntheticGtfsBuilder.tsx` to `ScenarioDefinitionEditor.tsx`. Render `ScenarioExecutionPanel` below the existing scenario save panel. Keep callback errors local to the execution panel and do not write execution geometry into `ScenarioDefinition`.

- [ ] **Step 6: Write and run UI state tests**

Test these states in `ScenarioExecutionPanel.test.tsx`: no route master, no saved scenario, ready current execution, running progress, complete summary, partial fallback warning, and reuse message. Use accessible labels/buttons rather than implementation-specific CSS selectors.

Run: `npm test -- --run tests/renderer/scenario-execution-client.test.ts tests/renderer/ScenarioExecutionPanel.test.tsx`

Expected: all orchestration and UI state tests PASS.

- [ ] **Step 7: Run renderer typecheck and regression tests**

Run: `npm run typecheck`

Expected: PASS.

Run: `npm test -- --run tests/renderer tests/core/synthetic-gtfs tests/main/project-store.test.ts`

Expected: the new panel/client tests and existing scenario editor, Synthetic GTFS, renderer, and store tests PASS.

- [ ] **Step 8: Commit the renderer integration**

```bash
git add src/renderer/scenario-execution-client.ts src/renderer/ScenarioExecutionPanel.tsx src/renderer/ScenarioDefinitionEditor.tsx src/renderer/SyntheticGtfsBuilder.tsx src/renderer/App.tsx tests/renderer/scenario-execution-client.test.ts tests/renderer/ScenarioExecutionPanel.test.tsx
git commit -m "feat: add scenario execution panel"
```

### Task 5: Full Verification and Branch Handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-09-20-scenario-path-generation.md` only if execution notes need factual updates after tests
- No production-code changes are allowed in this task unless a failing verification command identifies a concrete regression covered by a new test

**Interfaces:**
- Consumes: all Task 1–4 contracts and tests
- Produces: verified isolated branch state ready for review; no merge into the active `main` branch

- [ ] **Step 1: Run the complete test suite**

Run: `npm test -- --run`

Expected: all existing and new tests PASS, including the existing `scenarioDefinitions` metadata round-trip, legacy `scenarioDeltas`, single-route Synthetic GTFS, and MOTIS-related mocks.

- [ ] **Step 2: Run typecheck and production build**

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run build`

Expected: PASS without generated files being committed.

- [ ] **Step 3: Inspect the branch boundary**

Run: `git status --short --branch; git log --oneline --decorate -8`

Expected: branch is `codex/0.6.2-scenario-path-generation`, only the task commits and intended plan/spec files are present, and the working tree is clean. Do not run merge, rebase, push, reset, or checkout against the active project `main`.

- [ ] **Step 4: Record the handoff**

Report the branch name, commits, test/typecheck/build results, known partial-quality semantics, and the fact that integration is intentionally deferred until the 0.6.2 main build is complete. The next feature plan may consume `ScenarioExecutionResult` but must not infer demand redistribution or comparison capability from this branch alone.

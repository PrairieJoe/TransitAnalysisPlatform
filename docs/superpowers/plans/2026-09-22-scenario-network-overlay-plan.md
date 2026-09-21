# Scenario Network Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current workspace.

**Goal:** 기존 원본 노선정보를 보존하면서 시나리오 안에서 기존 정류장 추가, 신규 정류장·신규 노선 생성, 지도 편집, 현행·개편안 GTFS/MOTIS 비교를 지원한다.

**Architecture:** `ScenarioDefinition`을 overlay 필드가 포함된 v3 계약으로 확장하고, 순수 core materializer가 프로젝트 원본과 시나리오 overlay를 현행/개편안 네트워크로 조합한다. React workspace는 좌측 목록·운행조건과 우측 Leaflet 지도 편집을 같은 controlled overlay state로 연결하며, 생성·MOTIS·batch는 materializer의 결과만 사용한다.

**Tech Stack:** Electron + React + TypeScript, Leaflet, Vitest, existing Synthetic GTFS compiler, existing MOTIS IPC contract.

**Spec:** `docs/superpowers/specs/2026-09-22-scenario-network-overlay-design.md`

## Global Constraints

- 작업은 현재 `main` 브랜치에서 수행하고 별도 worktree와 원격 push를 만들지 않는다.
- `ProjectManifest`와 프로젝트 schema version `10`은 유지한다.
- overlay를 사용하는 신규 시나리오만 `ScenarioDefinition.scenarioSchemaVersion = 3`으로 저장하고, v1/v2 정의를 계속 읽고 실행한다.
- 프로젝트의 `routeStopMaster`와 `stationMaster`는 편집하지 않는다. 모든 신규 정류장·노선·좌표 변경은 scenario-owned overlay에 저장한다.
- 기본 사용자 흐름에는 텍스트 정류장 경로 입력을 렌더링하지 않는다. 기존 parser와 migration 경계만 유지한다.
- 새 지도 라이브러리나 지도 타일 공급자를 추가하지 않는다. 이미 설치된 Leaflet을 재사용한다.
- 기능 구현 중 package/package-lock 버전을 임의로 올리지 않는다. 0.9.0 release bump는 최종 검증 후 별도 승인 대상으로 남긴다.
- 실행 payload는 renderer에서 직접 조립하지 않고 core materializer와 기존 main/preload 계약을 통과시킨다.
- 각 task는 RED 테스트 → 최소 구현 → focused test → typecheck 또는 관련 회귀 → 커밋 순서로 수행한다.

## Review Focus

- 현재 노선에 포함되지 않지만 프로젝트 `stationMaster`에 존재하는 정류장을 추가하면 개편안 materialization과 GTFS에 정확히 포함되는가 — Task 2와 Task 4에서 검증한다.
- 신규 정류장 ID가 원본 정류장 ID 또는 다른 scenario-owned ID와 충돌하면 저장이 차단되는가 — Task 1과 Task 2에서 검증한다.
- 현행 대응 노선이 없는 신규 노선이 현행 네트워크에는 없고 개편안 GTFS/MOTIS에만 나타나는가 — Task 3과 Task 4에서 검증한다.
- v1/v2 시나리오와 프로젝트 원본이 overlay 편집 전후 동일하게 복원되는가 — Task 1과 Task 7에서 검증한다.
- 지도 선택, 목록 선택, 위치 변경, 제외 상태가 하나의 overlay state와 stale fingerprint에 연결되는가 — Task 5와 Task 7에서 검증한다.

---

### Task 1: Extend the scenario contract to schema v3

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/core/scenario-contract.ts`
- Modify: `src/core/scenario-editor.ts`
- Test: `tests/core/scenario-contract.test.ts`
- Test: `tests/core/scenario-editor.test.ts`

**Interfaces:**
- Produces `ScenarioAddedStation`, `ScenarioStationOverride`, and `ScenarioAddedRoute` shared types.
- Produces optional `ScenarioDefinition.addedStations`, `ScenarioDefinition.stationOverrides`, and `ScenarioDefinition.addedRoutes` fields.
- Keeps `ScenarioDefinition.routeChanges`, `scenarioDefinitionToLegacyDeltas`, and v1/v2 upgrade behavior available to later tasks.

- [ ] **Step 1: Write failing contract tests**

Add cases that exercise the exact v3 shape:

```ts
it('accepts a scenario with a new station and a new route', () => {
  const definition = {
    scenarioSchemaVersion: 3,
    scenarioId: 'scenario-1',
    label: '신규 노선 시범',
    routeChanges: [],
    addedStations: [{ stationId: 'scenario-stop-1', stationName: '신규 정류장', latitude: 37.5, longitude: 127.1 }],
    addedRoutes: [{ routeId: 'N-1', routeName: '신규 노선', transportMode: '버스', stopIds: ['scenario-stop-1', 'A-2'], afterOperation: operationPlan() }],
    source: { assumptions: [], warnings: [], modelVersions: [] },
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z'
  };

  expect(validateScenarioDefinition(definition)).toMatchObject({ isValid: true });
});

it('rejects duplicate or invalid overlay entities', () => {
  const result = validateScenarioDefinition({ ...validDefinition(), scenarioSchemaVersion: 3, addedStations: [
    { stationId: 'A-1', stationName: '', latitude: 91, longitude: 181 },
    { stationId: 'A-1', stationName: '중복', latitude: 37, longitude: 127 }
  ] });

  expect(result.errors.join(' ')).toContain('addedStations');
});

it('continues to accept v1 and v2 definitions without overlay fields', () => {
  expect(validateScenarioDefinition(v1Definition()).isValid).toBe(true);
  expect(validateScenarioDefinition(v2Definition()).isValid).toBe(true);
});
```

Use the existing test fixture operation builder rather than inventing a second operation format.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npx vitest run tests/core/scenario-contract.test.ts tests/core/scenario-editor.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because schema version 3 and overlay fields are not recognized.

- [ ] **Step 3: Add the shared v3 types and validation**

In `src/shared/types.ts` add:

```ts
export const CURRENT_SCENARIO_SCHEMA_VERSION = 3 as const;
export type ScenarioSchemaVersion = 1 | 2 | typeof CURRENT_SCENARIO_SCHEMA_VERSION;

export interface ScenarioAddedStation {
  stationId: string;
  stationName: string;
  latitude: number;
  longitude: number;
  arsNumber?: string;
}

export interface ScenarioStationOverride {
  stationId: string;
  stationName?: string;
  latitude?: number;
  longitude?: number;
  arsNumber?: string;
}

export interface ScenarioAddedRoute {
  routeId: string;
  routeName: string;
  transportMode: string;
  stopIds: string[];
  afterOperation: ScenarioOperationPlan;
}
```

Extend `ScenarioDefinition` with the three optional arrays. Update `validateScenarioDefinition` to accept schema 3, validate every overlay entity, reject source route/station ID collisions and duplicate overlay IDs, and allow `routeChanges[].scenarioStopIds` to reference an `addedStations` ID only in schema 3. For schema 3, require at least one `routeChanges` or `addedRoutes` entry; v1/v2 still require at least one `routeChanges` entry. Keep v1/v2 validation unchanged.

Make `createScenarioDefinition` choose schema 3 when any overlay array is non-empty and schema 2 otherwise, so old primary scenarios do not churn unnecessarily. Keep `upgradeScenarioDefinition` able to return v1/v2-compatible definitions and normalize only the existing journey query representation.

Update `scenarioDefinitionToLegacyDeltas` to project only `routeChanges`; overlay data remains available on the v3 definition for the new materializer.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx vitest run tests/core/scenario-contract.test.ts tests/core/scenario-editor.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: PASS. Then run `npm run typecheck` and expect exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/core/scenario-contract.ts src/core/scenario-editor.ts tests/core/scenario-contract.test.ts tests/core/scenario-editor.test.ts
git commit -m "feat: add scenario network overlay contract"
```

### Task 2: Build the pure overlay materializer and fingerprint

**Files:**
- Create: `src/core/scenario-network-overlay.ts`
- Test: `tests/core/scenario-network-overlay.test.ts`
- Modify: `src/core/route-master.ts` only if a small exported route-path helper is needed; preserve existing behavior

**Interfaces:**
- Consumes `RouteStopMasterRecord[]`, optional `StationMasterRecord[]`, and v3 `ScenarioDefinition` from Task 1.
- Produces `ScenarioNetworkMaterialization` with `currentRouteStops`, `scenarioRouteStops`, `addedRouteIds`, and warnings.
- Produces `materializeScenarioNetwork(input)` and `buildScenarioOverlayFingerprint(definition)` for execution and stale detection.

- [ ] **Step 1: Write failing pure-model tests**

Create fixtures with an existing route `R1`, an off-route station-master record `S4`, an added station `S-new`, and a new route `N-1`:

```ts
it('adds an existing station-master stop to an existing route without mutating the source', () => {
  const source = structuredClone(routeStops);
  const definition = primaryDefinition({ routeChanges: [{ ...routeChange('R1'), scenarioStopIds: ['S1', 'S4', 'S2'] }] });
  const result = materializeScenarioNetwork({ routeStops, stationMaster: [station('S4')], scenarioDefinition: definition });

  expect(result.scenarioRouteStops.filter((stop) => stop.routeId === 'R1').map((stop) => stop.stationId)).toEqual(['S1', 'S4', 'S2']);
  expect(routeStops).toEqual(source);
});

it('materializes a new station, station override, and new route only in the scenario network', () => {
  const result = materializeScenarioNetwork({ routeStops, stationMaster: [], scenarioDefinition: overlayDefinition() });

  expect(result.currentRouteStops.some((stop) => stop.routeId === 'N-1')).toBe(false);
  expect(result.scenarioRouteStops.filter((stop) => stop.routeId === 'N-1').map((stop) => stop.stationId)).toEqual(['S-new', 'S2']);
  expect(result.scenarioRouteStops.find((stop) => stop.stationId === 'S1')?.latitude).toBe(37.501);
  expect(result.addedRouteIds).toEqual(['N-1']);
});

it('rejects missing stations, route ID collisions, and paths shorter than two stops', () => {
  expect(() => materializeScenarioNetwork({ routeStops, scenarioDefinition: definitionWithMissingStop() })).toThrow('정류장');
  expect(() => materializeScenarioNetwork({ routeStops, scenarioDefinition: definitionWithRouteCollision() })).toThrow('노선 ID');
  expect(() => materializeScenarioNetwork({ routeStops, scenarioDefinition: definitionWithShortRoute() })).toThrow('최소 2개');
});

it('changes the overlay fingerprint when order, coordinates, or new routes change', () => {
  expect(buildScenarioOverlayFingerprint(baseDefinition())).not.toBe(buildScenarioOverlayFingerprint(reorderedDefinition()));
  expect(buildScenarioOverlayFingerprint(baseDefinition())).not.toBe(buildScenarioOverlayFingerprint(movedStationDefinition()));
  expect(buildScenarioOverlayFingerprint(baseDefinition())).not.toBe(buildScenarioOverlayFingerprint(newRouteDefinition()));
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npx vitest run tests/core/scenario-network-overlay.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because the materializer module does not exist.

- [ ] **Step 3: Implement immutable overlay materialization**

Implement these exact public types and functions:

```ts
export interface ScenarioNetworkMaterialization {
  currentRouteStops: RouteStopMasterRecord[];
  scenarioRouteStops: RouteStopMasterRecord[];
  addedRouteIds: string[];
  warnings: string[];
}

export interface ScenarioNetworkMaterializationInput {
  routeStops: RouteStopMasterRecord[];
  stationMaster?: StationMasterRecord[];
  scenarioDefinition?: ScenarioDefinition;
}

export function materializeScenarioNetwork(input: ScenarioNetworkMaterializationInput): ScenarioNetworkMaterialization;
export function buildScenarioOverlayFingerprint(definition: ScenarioDefinition | undefined): string;
```

Build an immutable station catalog from route-stop records, `stationMaster`, `addedStations`, and `stationOverrides`. When an existing station-master stop is inserted into a route, copy its coordinates and selected route metadata into a new `RouteStopMasterRecord` with the requested sequence. When an added route is materialized, copy its ordered stop IDs into route-stop records with its route metadata and `afterOperation` remains available to the execution layer. Never mutate either input array or any nested source record.

Sort fingerprint inputs by stable IDs and sequences, and include route changes, added stations, station overrides, added routes, and operation plans. Use `JSON.stringify` over the canonical object as existing scenario fingerprints do.

- [ ] **Step 4: Run tests, typecheck, and commit**

Run: `npx vitest run tests/core/scenario-network-overlay.test.ts --pool=threads --maxWorkers=1 --minWorkers=1` and `npm run typecheck`.

Expected: both PASS.

```bash
git add src/core/scenario-network-overlay.ts tests/core/scenario-network-overlay.test.ts
git commit -m "feat: materialize scenario network overlays"
```

### Task 3: Integrate overlay materialization with scenario execution

**Files:**
- Modify: `src/core/scenario-execution.ts`
- Test: `tests/core/scenario-execution.test.ts`
- Test: `tests/core/scenario-journey.test.ts`
- Test: `tests/renderer/scenario-execution-client.test.ts`

**Interfaces:**
- Extends `ScenarioMaterializationInput` with `stationMaster?: StationMasterRecord[]`.
- Keeps `materializeScenarioNetworks(input)` as the public execution entry point.
- Allows `MaterializedScenarioRoute.source` to distinguish current, scenario-before, and scenario-after while new routes exist only in `after`.

- [ ] **Step 1: Add failing execution tests**

Add tests that assert:

```ts
it('keeps a new route out of before and includes it in after', () => {
  const result = materializeScenarioNetworks({ target: { kind: 'scenario', scenarioId: 's-new' }, routeStops, stationMaster: [], serviceConfigs: [], scenarioDefinition: newRouteDefinition() });

  expect(result.before.routes.some((route) => route.routeId === 'N-1')).toBe(false);
  expect(result.after.routes.find((route) => route.routeId === 'N-1')?.source).toBe('scenario-after');
});

it('resolves scenario route changes through stationMaster and addedStations', () => {
  const result = materializeScenarioNetworks({ target: { kind: 'scenario', scenarioId: 's-add' }, routeStops, stationMaster: [station('S4')], serviceConfigs: [], scenarioDefinition: routeWithAddedStopDefinition() });

  expect(result.after.routes.find((route) => route.routeId === 'R1')?.stopRecords.map((stop) => stop.stationId)).toEqual(['S1', 'S4', 'S2']);
});
```

Add an input-fingerprint assertion that station override coordinates and `addedRoutes` change `buildScenarioInputFingerprint`.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npx vitest run tests/core/scenario-execution.test.ts tests/core/scenario-journey.test.ts tests/renderer/scenario-execution-client.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because execution currently requires every changed route and every stop to exist in route master.

- [ ] **Step 3: Use the overlay materializer in execution**

Pass `stationMaster` into `materializeScenarioNetworks`, call `materializeScenarioNetwork` once, and build route paths from the materialized scenario records. Keep the current snapshot based only on project route master. For existing route changes, use `baseStopIds` in before and `scenarioStopIds` in after. For `addedRoutes`, create only an after `MaterializedScenarioRoute` using `afterOperation`, `source: 'scenario-after'`, and the new route metadata. Keep current-operation inference for unchanged routes.

Update `canonicalScenarioDefinition` to include the v3 overlay fields in stable order. Do not change the execution manifest schema.

- [ ] **Step 4: Run focused tests and full core regressions**

Run: `npx vitest run tests/core/scenario-execution.test.ts tests/core/scenario-journey.test.ts tests/renderer/scenario-execution-client.test.ts --pool=threads --maxWorkers=1 --minWorkers=1` and `npx vitest run tests/core/scenario-*.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`.

Expected: PASS with existing route execution behavior unchanged and new-route cases covered.

- [ ] **Step 5: Commit**

```bash
git add src/core/scenario-execution.ts tests/core/scenario-execution.test.ts tests/core/scenario-journey.test.ts tests/renderer/scenario-execution-client.test.ts
git commit -m "feat: execute scenario network overlays"
```

### Task 4: Implement the 0.8.0 editor cleanup and existing-station add flow

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/SyntheticRouteScenarioEditor.tsx`
- Modify: `src/renderer/SyntheticScenarioStep.tsx`
- Modify: `src/renderer/SyntheticGtfsBuilder.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/renderer/SyntheticRouteScenarioEditor.test.tsx`
- Test: `tests/renderer/SyntheticScenarioStep.test.tsx`
- Test: `tests/renderer/SyntheticGtfsBuilder.test.tsx`

**Interfaces:**
- Extends `SyntheticRouteScenarioEditorProps` with `stationMaster: StationMasterRecord[]` while keeping the existing controlled stop-ID contract.
- Keeps `onScenarioStopIdsChange` and `onScenarioLabelChange` compatible with existing callers.
- Removes the rendered legacy `ScenarioDefinitionEditor` from the primary scenario path while preserving its core parser and saved-data compatibility.

- [ ] **Step 1: Write failing UI tests**

Add a station-master fixture containing a station not present on the selected route and assert:

```tsx
expect(markup).toContain('기존 정류장 추가');
expect(markup).toContain('S4 정류장');
expect(markup).toContain('정류장 목록');
expect(markup).not.toContain('Before 정류장 경로');
expect(markup).not.toContain('고급: 여러 노선·좌표 여정 시나리오');
```

Add a `SyntheticScenarioStep` assertion that the primary shell does not render `ScenarioDefinitionEditor` or any textarea-like text path control.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npx vitest run tests/renderer/SyntheticRouteScenarioEditor.test.tsx tests/renderer/SyntheticScenarioStep.test.tsx tests/renderer/SyntheticGtfsBuilder.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because the editor only exposes current-route stops and the legacy disclosure is still mounted.

- [ ] **Step 3: Implement the cleanup and existing-station add**

Pass `project.stationMaster ?? []` from `App.tsx` through `SyntheticGtfsBuilder` and `SyntheticScenarioStep`. Build the add select from the selected route's current stops plus station-master records not already in the scenario path. When an existing station-master stop is added, update `scenarioStopIds` immutably; do not create a scenario-owned station because this is an existing project station.

Remove the `scenario-legacy-disclosure` render from `SyntheticScenarioStep`. Keep `ScenarioDefinitionEditor` imports only where a real non-primary legacy tool still needs them. Add a bounded `.scenario-stop-list` height with `overflow-y: auto`, preserve keyboard focus outlines, and keep the selected row visible after add/remove/reorder.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx vitest run tests/renderer/SyntheticRouteScenarioEditor.test.tsx tests/renderer/SyntheticScenarioStep.test.tsx tests/renderer/SyntheticGtfsBuilder.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1` and `npm run typecheck`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/SyntheticRouteScenarioEditor.tsx src/renderer/SyntheticScenarioStep.tsx src/renderer/SyntheticGtfsBuilder.tsx src/renderer/styles.css tests/renderer/SyntheticRouteScenarioEditor.test.tsx tests/renderer/SyntheticScenarioStep.test.tsx tests/renderer/SyntheticGtfsBuilder.test.tsx
git commit -m "feat: add existing stations to route scenarios"
```

### Task 5: Add the shared overlay editor and Leaflet map interaction

**Files:**
- Create: `src/renderer/ScenarioNetworkOverlayEditor.tsx`
- Create: `src/renderer/ScenarioNetworkMap.tsx`
- Modify: `src/renderer/SyntheticRouteScenarioEditor.tsx`
- Modify: `src/renderer/styles.css`
- Create: `tests/renderer/ScenarioNetworkOverlayEditor.test.tsx`
- Create: `tests/renderer/ScenarioNetworkMap.test.tsx`

**Interfaces:**
- `ScenarioNetworkOverlayState` is the controlled renderer state: `{ selectedRouteId: string; selectedStationId?: string; scenarioStopIds: string[]; addedStations: ScenarioAddedStation[]; stationOverrides: ScenarioStationOverride[]; addedRoutes: ScenarioAddedRoute[] }`.
- `ScenarioNetworkOverlayEditor` consumes controlled `ScenarioNetworkOverlayState` and emits `onChange(nextState)`.
- `ScenarioNetworkMap` consumes `stations`, `currentStopIds`, `scenarioStopIds`, `selectedStationId`, and callbacks `onSelectStation`, `onCreateStationDraft`, `onExcludeStation`, `onMoveStation`.
- The map component owns only Leaflet lifecycle and map events; all domain mutations remain in the pure overlay model.

- [ ] **Step 1: Write failing render and interaction-contract tests**

Render the editor with current stops, an existing station-master candidate, and one scenario-owned station. Assert:

```tsx
expect(markup).toContain('scenario-network-overlay-editor');
expect(markup).toContain('scenario-network-map');
expect(markup).toContain('지도에서 정류장 추가');
expect(markup).toContain('개편안에서 제외');
expect(markup).toContain('현행 정류장');
expect(markup).toContain('개편안 정류장');
```

Test the pure callback adapter used by the map: selecting a marker calls `onSelectStation`, creating a draft emits latitude/longitude, and excluding a selected scenario stop removes it from the next state.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npx vitest run tests/renderer/ScenarioNetworkOverlayEditor.test.tsx tests/renderer/ScenarioNetworkMap.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the editor and Leaflet lifecycle**

Use the existing `StationDemandMap` setup as the Leaflet lifecycle reference: create the map in `useEffect`, add OpenStreetMap tiles with the existing attribution, render markers from the controlled state, remove layers on cleanup, and expose a tile-error status without blocking coordinate editing.

Keep map events accessible through explicit buttons and list actions. A map click in add mode creates a draft, but saving the draft requires the visible station form with station ID/name and coordinate summary. Use distinct marker colors for current, unchanged scenario, added, moved, and excluded states. Do not make marker drag the only way to edit coordinates.

Add CSS for a two-column workspace, independent list scrolling, selected-state focus, compact map toolbar, and a one-column rule below 900px. The primary save button remains in the editor footer; map tools are secondary actions.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx vitest run tests/renderer/ScenarioNetworkOverlayEditor.test.tsx tests/renderer/ScenarioNetworkMap.test.tsx tests/renderer/SyntheticRouteScenarioEditor.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1` and `npm run typecheck`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/ScenarioNetworkOverlayEditor.tsx src/renderer/ScenarioNetworkMap.tsx src/renderer/SyntheticRouteScenarioEditor.tsx src/renderer/styles.css tests/renderer/ScenarioNetworkOverlayEditor.test.tsx tests/renderer/ScenarioNetworkMap.test.tsx
git commit -m "feat: add map-backed scenario editing"
```

### Task 6: Implement new-route creation and v3 scenario saving

**Files:**
- Create: `src/renderer/ScenarioNewRouteEditor.tsx`
- Modify: `src/renderer/SyntheticScenarioStep.tsx`
- Modify: `src/renderer/SyntheticGtfsBuilder.tsx`
- Modify: `src/renderer/synthetic-scenario-definition.ts`
- Modify: `src/renderer/App.tsx`
- Create: `tests/renderer/ScenarioNewRouteEditor.test.tsx`
- Test: `tests/renderer/synthetic-scenario-definition.test.ts`
- Test: `tests/renderer/SyntheticScenarioStep.test.tsx`
- Test: `tests/renderer/SyntheticGtfsBuilder.test.tsx`

**Interfaces:**
- `ScenarioNewRouteEditor` emits `ScenarioAddedRoute` draft values and uses the same station catalog as the map editor.
- `buildPrimaryScenarioDefinition` accepts `routeChanges?: ScenarioRouteChange[]`, `addedStations`, `stationOverrides`, and `addedRoutes`; new-route-only mode passes an empty `routeChanges` array.
- `buildPrimaryScenarioDefinition` creates a v3 definition only when overlay values exist and otherwise preserves the v2 primary definition contract.
- `App.renderSynthetic` persists the complete definition through the existing `upsertScenarioDefinition` path without mutating `project.routeStopMaster` or `project.stationMaster`.

- [ ] **Step 1: Write failing new-route and save tests**

Assert that the new-route editor renders the metadata fields and ordered station list, rejects a one-stop draft, and emits a valid two-stop `ScenarioAddedRoute`. Extend definition tests:

```ts
const definition = buildPrimaryScenarioDefinition({
  projectId: 'project-1',
  routeStops,
  routeId: 'R1',
  label: 'R1 + 신규 정류장',
  scenarioStopIds: ['A', 'scenario-stop-1', 'B'],
  addedStations: [{ stationId: 'scenario-stop-1', stationName: '새 정류장', latitude: 37.2, longitude: 127.2 }],
  stationOverrides: [],
  addedRoutes: [{ routeId: 'N-1', routeName: '신규 노선', transportMode: '버스', stopIds: ['A', 'scenario-stop-1'], afterOperation: operation }],
  beforeOperation: operation,
  afterOperation: operation
});

expect(definition.scenarioSchemaVersion).toBe(3);
expect(definition.addedRoutes?.[0].routeId).toBe('N-1');
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npx vitest run tests/renderer/ScenarioNewRouteEditor.test.tsx tests/renderer/synthetic-scenario-definition.test.ts tests/renderer/SyntheticScenarioStep.test.tsx tests/renderer/SyntheticGtfsBuilder.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because the new-route editor and overlay fields are not wired to the primary save callback.

- [ ] **Step 3: Implement controlled new-route editing and saving**

Add a mode switch with `기존 노선 개편` and `새 노선 만들기`. In new-route mode, require route ID/name/transport mode and at least two ordered station IDs. Reuse existing station catalog entries and scenario-added stations; do not duplicate station records when a station is selected twice.

Extend `buildPrimaryScenarioDefinition` and its input type with the overlay arrays. Preserve unrelated existing definitions through the current upsert helper. In `App.tsx`, pass `project.stationMaster` into `SyntheticGtfsBuilder` and keep save feedback inside the scenario step.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx vitest run tests/renderer/ScenarioNewRouteEditor.test.tsx tests/renderer/synthetic-scenario-definition.test.ts tests/renderer/SyntheticScenarioStep.test.tsx tests/renderer/SyntheticGtfsBuilder.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1` and `npm run typecheck`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/ScenarioNewRouteEditor.tsx src/renderer/SyntheticScenarioStep.tsx src/renderer/SyntheticGtfsBuilder.tsx src/renderer/synthetic-scenario-definition.ts src/renderer/App.tsx tests/renderer/ScenarioNewRouteEditor.test.tsx tests/renderer/synthetic-scenario-definition.test.ts tests/renderer/SyntheticScenarioStep.test.tsx tests/renderer/SyntheticGtfsBuilder.test.tsx
git commit -m "feat: create and save new scenario routes"
```

### Task 7: Generate current/scenario GTFS from materialized networks

**Files:**
- Modify: `src/renderer/SyntheticGtfsBuilder.tsx`
- Modify: `src/renderer/SyntheticGenerationStep.tsx`
- Modify: `src/core/synthetic-gtfs/network-builder.ts` only for a focused route-source/provenance extension
- Test: `tests/renderer/SyntheticGtfsBuilder.test.tsx`
- Test: `tests/core/synthetic-gtfs-network.test.ts`
- Test: `tests/core/synthetic-gtfs-draft.test.ts`

**Interfaces:**
- `SyntheticGtfsBuilder` passes `stationMaster` and the saved `ScenarioDefinition` into `materializeScenarioNetworks`.
- `buildSyntheticGtfsNetwork({ routes, agencyId, agencyName, sourceName })` remains the compiler-facing boundary.
- `SyntheticGenerationStep` receives current/scenario result summaries and displays added station/route counts.

- [ ] **Step 1: Write failing GTFS tests**

Add assertions that current output excludes `N-1`, scenario output includes `N-1`, and a station-master stop inserted into `R1` appears in scenario stop records. Add renderer summary assertions for `신규 노선` and `개편안 정류장`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npx vitest run tests/renderer/SyntheticGtfsBuilder.test.tsx tests/core/synthetic-gtfs-network.test.ts tests/core/synthetic-gtfs-draft.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because the builder currently creates current/scenario drafts from the selected route-stop text/array path only.

- [ ] **Step 3: Replace route-stop-only generation with materialized networks**

Keep operation inputs and existing stale state, but derive the current and scenario route arrays from `materializeScenarioNetworks`. Feed each side to `buildSyntheticGtfsNetwork`, retain provenance and validation results, and include overlay fingerprint in the generation snapshot. Keep ZIP export pointed at the scenario artifact while clearly labeling current and scenario outputs.

- [ ] **Step 4: Run focused tests, typecheck, and commit**

Run: `npx vitest run tests/renderer/SyntheticGtfsBuilder.test.tsx tests/core/synthetic-gtfs-network.test.ts tests/core/synthetic-gtfs-draft.test.ts --pool=threads --maxWorkers=1 --minWorkers=1` and `npm run typecheck`.

```bash
git add src/renderer/SyntheticGtfsBuilder.tsx src/renderer/SyntheticGenerationStep.tsx src/core/synthetic-gtfs/network-builder.ts tests/renderer/SyntheticGtfsBuilder.test.tsx tests/core/synthetic-gtfs-network.test.ts tests/core/synthetic-gtfs-draft.test.ts
git commit -m "feat: generate GTFS from scenario networks"
```

### Task 8: Update MOTIS, batch, and comparison semantics for new routes

**Files:**
- Modify: `src/renderer/SyntheticMotisStep.tsx`
- Modify: `src/renderer/SyntheticBatchStep.tsx`
- Modify: `src/renderer/SyntheticScenarioTools.tsx`
- Modify: `src/renderer/ScenarioComparisonPanel.tsx`
- Modify: `src/renderer/ScenarioJourneyComparison.tsx`
- Test: `tests/renderer/ScenarioComparisonPanel.test.tsx`
- Test: `tests/renderer/ScenarioJourneyComparison.test.tsx`
- Create: `tests/renderer/SyntheticMotisStep.test.tsx`
- Create: `tests/renderer/SyntheticBatchStep.test.tsx`

**Interfaces:**
- Existing comparison clients continue to receive `ScenarioExecutionTarget` and execution manifests.
- UI receives route status metadata from the materialized before/after result and does not infer “new route” from display text.

- [ ] **Step 1: Write failing comparison tests**

Add fixtures with a new route only in the after network and assert the rendered result contains `신규 노선`, `현행 대응 없음`, `개편안 신규 경로`, and that missing current journey is not rendered as an execution error. Assert batch summaries count the new route as after-only.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npx vitest run tests/renderer/ScenarioComparisonPanel.test.tsx tests/renderer/ScenarioJourneyComparison.test.tsx tests/renderer/SyntheticMotisStep.test.tsx tests/renderer/SyntheticBatchStep.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because current comparison assumes both sides have corresponding routes/paths.

- [ ] **Step 3: Implement explicit before/after-only result states**

Keep current MOTIS execution and IPC behavior. Normalize comparison rows to support `before: null`, `after: journey`, and route status `new`. Render explanatory state cards instead of generic errors. Keep the same OD inputs for both sides, and ensure the same overlay fingerprint gates stale results.

- [ ] **Step 4: Run focused tests and typecheck**

Run the focused command from Step 2 and `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/SyntheticMotisStep.tsx src/renderer/SyntheticBatchStep.tsx src/renderer/SyntheticScenarioTools.tsx src/renderer/ScenarioComparisonPanel.tsx src/renderer/ScenarioJourneyComparison.tsx tests/renderer/ScenarioComparisonPanel.test.tsx tests/renderer/ScenarioJourneyComparison.test.tsx tests/renderer/SyntheticMotisStep.test.tsx tests/renderer/SyntheticBatchStep.test.tsx
git commit -m "feat: compare new routes as after-only scenarios"
```

### Task 9: Verify reopen, source immutability, and full native acceptance

**Files:**
- Modify: `src/renderer/App.tsx` only for restore/persistence wiring discovered in earlier tasks
- Modify: `tests/main/project-store.test.ts` if a new v3 fixture is needed
- Test: `tests/renderer/AppNavigation.test.tsx`
- Test: `tests/main/project-store.test.ts`
- Test: `tests/core/scenario-network-overlay.test.ts`

**Interfaces:**
- Project save continues through `saveProjectMetadata`/`saveProject` and stores `scenarioDefinitions` without changing route master arrays.
- Reopened projects expose the same v3 overlay to `SyntheticGtfsBuilder` and the editor.

- [ ] **Step 1: Write failing persistence and immutability tests**

Save a project with one v3 definition, reopen it through the existing project store, and assert `addedStations`, `stationOverrides`, and `addedRoutes` survive. Snapshot `routeStopMaster` and `stationMaster` before editing and assert they are byte-for-byte equal after materialization and save.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npx vitest run tests/main/project-store.test.ts tests/renderer/AppNavigation.test.tsx tests/core/scenario-network-overlay.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL until restore and save paths pass the v3 fields through.

- [ ] **Step 3: Implement restore/persistence wiring**

Use the existing `scenarioDefinitions` save/restore path. Do not create a second storage channel. Ensure route selection restores the saved overlay for the selected scenario, and reset only renderer-local stale state when switching projects.

- [ ] **Step 4: Run all automated verification**

Run:

```powershell
npx vitest run tests/renderer/AppNavigation.test.tsx tests/renderer/ScenarioWorkspaceEntry.test.tsx tests/renderer/SyntheticRouteScenarioEditor.test.tsx tests/renderer/ScenarioNetworkOverlayEditor.test.tsx tests/renderer/ScenarioNewRouteEditor.test.tsx tests/renderer/SyntheticGtfsBuilder.test.tsx tests/renderer/SyntheticGtfsStepper.test.tsx tests/core/scenario-contract.test.ts tests/core/scenario-network-overlay.test.ts tests/core/scenario-execution.test.ts tests/core/synthetic-gtfs-network.test.ts tests/release-version.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: all listed tests pass, full suite passes, typecheck and native build exit 0, and `out/main`, `out/preload`, and `out/renderer` exist.

- [ ] **Step 5: Perform native acceptance flow**

Start with `npm run dev` and verify in the Electron app:

1. Open a project with route and station master data.
2. Enter `계획·시나리오 → 노선 개편 시나리오`.
3. Add an existing off-route station, scroll the list, exclude and reorder a stop, and confirm map/list synchronization.
4. Create a map station and save it into the existing route.
5. Create a new route from existing and new stations, save, generate current/scenario GTFS, and confirm the new route is after-only.
6. Run the same OD through MOTIS and confirm `현행 대응 없음`/`개편안 신규 경로` is explanatory rather than an error.
7. Reopen the project and confirm overlay data remains while the original route/station master is unchanged.

- [ ] **Step 6: Commit and record results**

```bash
git add src/renderer/App.tsx tests/main/project-store.test.ts tests/renderer/AppNavigation.test.tsx tests/core/scenario-network-overlay.test.ts
git commit -m "test: verify scenario overlay persistence and native flow"
```

Record the final test counts, build result, native observations, current branch (`main`), and any pre-existing unrelated untracked files in the SDD progress ledger. Do not push remote or create a version-bump commit without a separate release decision.

## Execution Order and Handoff

Tasks 1–3 establish the contract and core network behavior. Task 4 delivers the approved 0.8.0 cleanup while Task 5 adds map interaction. Task 6 completes new-route creation and persistence before Task 7 changes generated artifacts. Task 8 updates result semantics, and Task 9 performs the whole-system gate.

The implementation method is Native inline execution in the current `main` workspace. Use `superpowers:executing-plans` and keep each task's focused test and commit boundary intact.

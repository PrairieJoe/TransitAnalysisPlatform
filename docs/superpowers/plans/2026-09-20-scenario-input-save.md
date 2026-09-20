# 다중 노선 시나리오 입력·저장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 여러 노선의 Before/After 정류장 구성과 독립적인 운행조건을 입력하고, 여러 `ScenarioDefinition`을 프로젝트 metadata에 저장·재사용할 수 있게 한다.

**Architecture:** 입력 문자열·숫자 변환, 대표 현행 경로 선택, master 정류장 검증, 저장 목록 교체는 `src/core/scenario-editor.ts`의 순수 함수로 분리한다. React 편집기는 이 함수로 draft를 관리하고 `createScenarioDefinition`을 통과한 정의만 callback으로 전달한다. `App.tsx`는 기존 `save()`를 사용해 같은 거래내역 배열을 유지한 metadata 저장으로 연결하고, 기존 단일 노선 Synthetic GTFS/`ScenarioDelta` 흐름은 그대로 둔다.

**Tech Stack:** React 19, TypeScript 5.8, Vitest 3, existing Electron renderer metadata save boundary.

**Spec:** `docs/superpowers/specs/2026-09-20-scenario-input-save-design.md`

## Global Constraints

- 이번 단계의 입력 결과는 “도로망에서 계산된 실제 경로”가 아니라 후속 Synthetic GTFS/MOTIS 실행이 재현할 수 있는 노선 경로 정의다.
- 정류장 구성을 바꾸면 해당 노선의 `scenarioStopIds`도 바뀌어야 한다.
- 정류장 사이의 실제 도로 형상, 거리, 연장, 운행시간은 이번 단계에서 계산하거나 계산된 것처럼 저장하지 않는다.
- `current`와 `scenario:{scenarioId}`를 후속 분석 대상 식별자로 사용할 수 있도록 저장된 `scenarioId`를 안정적으로 유지한다.
- 하나의 시나리오에 여러 노선을 저장하고, 각 노선의 Before/After 운행조건을 독립된 객체로 직렬화한다.
- `createScenarioDefinition` 검증 실패 시 callback과 metadata 저장을 호출하지 않는다.
- 기존 `scenarioDeltas` 저장 및 단일 노선 Synthetic GTFS 실행 흐름을 변경하지 않는다.
- MOTIS 실행, 실제 경로 geometry, 수요·요금·비교 결과 계산, 프로젝트 schema version 변경은 수행하지 않는다.

## Review Focus

- 운행일자별 master가 여러 개일 때 정적 대표 경로를 우선하고, 없을 때 한 경로를 일관되게 선택하는지 — Task 1의 `selects a stable representative route path` 테스트.
- After 정류장 입력의 공백·중복·master 밖 ID가 조용히 정상화되어 잘못 저장되지 않는지 — Task 1의 `preserves order and reports unknown or duplicate stop IDs` 테스트.
- 두 노선의 Before/After 운행조건이 한쪽 수정으로 공유 참조되거나 같이 바뀌지 않는지 — Task 1의 `builds independent operation plans per route and side` 테스트.
- 저장된 시나리오를 수정할 때 새 항목이 중복 추가되지 않고 같은 `scenarioId`를 교체하는지 — Task 1의 `upserts by stable scenario id` 테스트와 Task 3 metadata test.
- 실제 도로 경로가 아직 계산되지 않았다는 사실이 화면에 표시되고 저장 payload에 가짜 geometry가 생기지 않는지 — Task 2의 `renders route-definition disclaimer and multiple route cards` 테스트.

---

### Task 1: 순수 draft 변환·master 검증 함수

**Files:**
- Create: `src/core/scenario-editor.ts` — UI draft 타입, route master 기반 변환, 저장 목록 upsert
- Create: `tests/core/scenario-editor.test.ts` — 대표 경로·정류장 입력·독립 운행조건·upsert 테스트

**Interfaces:**
- Consumes `RouteStopMasterRecord`, `ScenarioDefinition`, `ScenarioDefinitionInput`, `ScenarioOperationPlan`, `ScenarioProvenance`, and `createScenarioDefinition` from the existing common contract.
- Produces `ScenarioOperationDraft`, `ScenarioRouteDraft`, `ScenarioJourneyQueryDraft`, `ScenarioEditorDraft`, `parseScenarioStopText`, `selectRepresentativeRouteStopIds`, `scenarioDefinitionToEditorDraft`, `buildScenarioDefinitionInput`, `validateScenarioEditorDraft`, and `upsertScenarioDefinition` for Tasks 2 and 3.

- [ ] **Step 1: Write failing tests for the pure editor contract**

Create `tests/core/scenario-editor.test.ts` with these fixtures and tests before creating `src/core/scenario-editor.ts`:

```ts
import { expect, it } from 'vitest';
import type { RouteStopMasterRecord, ScenarioDefinition, ScenarioOperationPlan } from '../../src/shared/types';
import {
  buildScenarioDefinitionInput,
  parseScenarioStopText,
  scenarioDefinitionToEditorDraft,
  selectRepresentativeRouteStopIds,
  validateScenarioEditorDraft,
  upsertScenarioDefinition,
  type ScenarioEditorDraft,
  type ScenarioOperationDraft
} from '../../src/core/scenario-editor';

const operation = (overrides: Partial<ScenarioOperationPlan> = {}): ScenarioOperationPlan => ({
  serviceDays: [1, 2, 3, 4, 5], firstDeparture: '06:00', lastDeparture: '22:00',
  headwayMinutes: 10, vehicleCount: 4, dwellSeconds: 20,
  startDate: '2026-01-01', endDate: '2026-12-31', deriveReverseDirection: true,
  travelTimeModel: {
    modelVersion: 'baseline-stop-distance-1', speedsKph: { unknown: 15 },
    intersectionDelaySeconds: 5, turnDelaySeconds: 10, minimumSegmentSeconds: 30
  },
  ...overrides
});

const stops: RouteStopMasterRecord[] = [
  { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', stationSequence: 1, stationId: 'A-1', stationName: 'A1', latitude: 37, longitude: 127 },
  { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', stationSequence: 2, stationId: 'A-2', stationName: 'A2', latitude: 37, longitude: 127 },
  { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', stationSequence: 3, stationId: 'A-3', stationName: 'A3', latitude: 37, longitude: 127 },
  { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', serviceDate: '2026-04-01', stationSequence: 1, stationId: 'A-9', stationName: 'A9', latitude: 37, longitude: 127 },
  { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', serviceDate: '2026-04-01', stationSequence: 2, stationId: 'A-10', stationName: 'A10', latitude: 37, longitude: 127 },
  { routeId: 'R-B', routeName: 'B 노선', transportMode: 'bus', stationSequence: 1, stationId: 'B-1', stationName: 'B1', latitude: 37, longitude: 127 },
  { routeId: 'R-B', routeName: 'B 노선', transportMode: 'bus', stationSequence: 2, stationId: 'B-2', stationName: 'B2', latitude: 37, longitude: 127 }
];

const operationDraft = (overrides: Partial<ScenarioOperationDraft> = {}): ScenarioOperationDraft => ({
  serviceDays: [1, 2, 3, 4, 5], firstDeparture: '06:00', lastDeparture: '22:00',
  headwayMinutes: '10', vehicleCount: '4', dwellSeconds: '20',
  startDate: '2026-01-01', endDate: '2026-12-31', deriveReverseDirection: true,
  ...overrides
});

const draft = (): ScenarioEditorDraft => ({
  scenarioId: 'scenario-1', label: '다중 노선 입력',
  routeChanges: [
    { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', baseStopIds: ['A-1', 'A-2', 'A-3'], scenarioStopText: 'A-1, A-9, A-3', beforeOperation: operationDraft(), afterOperation: operationDraft({ headwayMinutes: '15', vehicleCount: '3' }) },
    { routeId: 'R-B', routeName: 'B 노선', transportMode: 'bus', baseStopIds: ['B-1', 'B-2'], scenarioStopText: 'B-1,B-2', beforeOperation: operationDraft({ vehicleCount: '2' }), afterOperation: operationDraft({ vehicleCount: '5' }) }
  ],
  journeyQueries: [{ originStopId: 'A-1', destinationStopId: 'B-2', departureDateTime: '2026-04-01T08:00:00+09:00' }],
  source: { projectId: 'project-1', routeMasterSource: 'routes.csv', assumptions: [], warnings: [], modelVersions: ['baseline-stop-distance-1'] },
  createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z'
});

it('selects a stable representative route path', () => {
  expect(selectRepresentativeRouteStopIds(stops, 'R-A')).toEqual(['A-1', 'A-2', 'A-3']);
  expect(selectRepresentativeRouteStopIds(stops, 'missing')).toEqual([]);
});

it('preserves order and reports unknown or duplicate stop IDs', () => {
  expect(parseScenarioStopText(' A-1, A-9, A-1, ,A-3 ')).toEqual(['A-1', 'A-9', 'A-1', 'A-3']);
  const errors = validateScenarioEditorDraft({ ...draft(), routeChanges: [{ ...draft().routeChanges[0], scenarioStopText: 'A-1,A-404,A-1' }] }, stops);
  expect(errors).toEqual(expect.arrayContaining(['routeChanges[0].scenarioStopIds: master에 없는 정류장 ID A-404', 'routeChanges[0].scenarioStopIds: 정류장 ID가 중복되었습니다.']));
});

it('builds independent operation plans per route and side', () => {
  const input = buildScenarioDefinitionInput(draft());
  expect(input.routeChanges.map((change) => [change.beforeOperation.vehicleCount, change.afterOperation.vehicleCount])).toEqual([[4, 3], [2, 5]]);
  expect(input.routeChanges[0].beforeOperation).not.toBe(input.routeChanges[0].afterOperation);
  expect(input.routeChanges[0].afterOperation.headwayMinutes).toBe(15);
  expect(input.routeChanges[1].beforeOperation.vehicleCount).toBe(2);
});

it('round-trips an existing definition into an editable draft', () => {
  const definition: ScenarioDefinition = {
    scenarioSchemaVersion: 1, scenarioId: 'saved-1', label: '저장된 시나리오',
    routeChanges: [{ routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', baseStopIds: ['A-1', 'A-2'], scenarioStopIds: ['A-1', 'A-3'], beforeOperation: operation(), afterOperation: operation({ vehicleCount: 3 }) }],
    journeyQueries: [], source: { assumptions: [], warnings: [], modelVersions: ['model-1'] }, createdAt: '2026-01-01', updatedAt: '2026-01-02'
  };
  const edited = scenarioDefinitionToEditorDraft(definition);
  expect(edited.scenarioId).toBe('saved-1');
  expect(edited.routeChanges[0].scenarioStopText).toBe('A-1,A-3');
  expect(edited.routeChanges[0].afterOperation.vehicleCount).toBe('3');
});

it('upserts by stable scenario id', () => {
  const existing = { scenarioId: 'scenario-1', label: 'old' } as ScenarioDefinition;
  const replacement = { scenarioId: 'scenario-1', label: 'new' } as ScenarioDefinition;
  const appended = { scenarioId: 'scenario-2', label: 'second' } as ScenarioDefinition;
  expect(upsertScenarioDefinition([existing], replacement)).toEqual([replacement]);
  expect(upsertScenarioDefinition([existing], appended)).toEqual([existing, appended]);
});
```

- [ ] **Step 2: Run the new core tests to verify they fail for the missing editor module**

Run: `npx vitest run tests/core/scenario-editor.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because `src/core/scenario-editor.ts` and its exported draft interfaces do not exist yet.

- [ ] **Step 3: Implement the draft types and route-master helpers**

Create `src/core/scenario-editor.ts` with these exact public interfaces:

```ts
export interface ScenarioOperationDraft {
  serviceDays: number[];
  firstDeparture: string;
  lastDeparture: string;
  headwayMinutes: string;
  vehicleCount: string;
  dwellSeconds: string;
  startDate: string;
  endDate: string;
  deriveReverseDirection: boolean;
}

export interface ScenarioRouteDraft {
  routeId: string;
  routeName: string;
  transportMode: string;
  baseStopIds: string[];
  scenarioStopText: string;
  beforeOperation: ScenarioOperationDraft;
  afterOperation: ScenarioOperationDraft;
}

export interface ScenarioJourneyQueryDraft {
  originStopId: string;
  destinationStopId: string;
  departureDateTime: string;
}

export interface ScenarioEditorDraft {
  scenarioId: string;
  label: string;
  routeChanges: ScenarioRouteDraft[];
  journeyQueries: ScenarioJourneyQueryDraft[];
  source: ScenarioProvenance;
  environment?: ScenarioEnvironment;
  createdAt: string;
  updatedAt: string;
}
```

Use `buildRoutePathIndex` and the existing route master selection convention: for a route, prefer the static path (no `serviceDate`); otherwise use the first path sorted by `serviceDate`. Return the ordered `stationId` values. `parseScenarioStopText` trims comma-separated values but does not remove duplicates so validation can report them.

- [ ] **Step 4: Implement draft-to-contract conversion and editor validation**

Implement these signatures:

```ts
export function selectRepresentativeRouteStopIds(routeStops: RouteStopMasterRecord[], routeId: string): string[];
export function parseScenarioStopText(value: string): string[];
export function scenarioDefinitionToEditorDraft(definition: ScenarioDefinition): ScenarioEditorDraft;
export function buildScenarioDefinitionInput(draft: ScenarioEditorDraft): ScenarioDefinitionInput;
export function validateScenarioEditorDraft(draft: ScenarioEditorDraft, routeStops: RouteStopMasterRecord[]): string[];
export function upsertScenarioDefinition(definitions: ScenarioDefinition[], next: ScenarioDefinition): ScenarioDefinition[];
```

`buildScenarioDefinitionInput` must parse numeric draft fields with `Number`, preserve each route's independent Before/After objects, use `DEFAULT_SYNTHETIC_TRAVEL_PARAMETERS` for both sides while copying it into separate objects, and convert `scenarioStopText` with `parseScenarioStopText`. It must not add geometry or road-distance fields. `validateScenarioEditorDraft` must report empty labels, no routes, duplicate route IDs, missing route master paths, fewer than two After stops, duplicate After stops, and master-unknown After IDs using stable paths. It must also call `createScenarioDefinition({ ...input, scenarioSchemaVersion: 1 })` and include contract validation errors for invalid numeric/date/time values. `upsertScenarioDefinition` returns a new array and replaces only the matching `scenarioId`.

- [ ] **Step 5: Run the core tests to verify the pure editor layer passes**

Run: `npx vitest run tests/core/scenario-editor.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: PASS for all five tests, including two route-specific operation plans and stable upsert behavior.

- [ ] **Step 6: Commit the pure editor layer**

```bash
git add src/core/scenario-editor.ts tests/core/scenario-editor.test.ts
git commit -m "feat: add scenario editor draft transformations"
```

---

### Task 2: 다중 노선 ScenarioDefinitionEditor UI

**Files:**
- Create: `src/renderer/ScenarioDefinitionEditor.tsx` — saved scenario list, route cards, operation fields, journey queries, save callback
- Create: `tests/renderer/ScenarioDefinitionEditor.test.tsx` — server-rendered initial state and multi-route disclaimer coverage

**Interfaces:**
- Consumes Task 1 draft types and pure functions, `ScenarioDefinition`, `RouteStopMasterRecord`, and `ProjectManifest`.
- Produces `ScenarioDefinitionEditorProps` with `onSaveScenarioDefinition(definition: ScenarioDefinition): Promise<void>` for Task 3.

- [ ] **Step 1: Write failing renderer tests for initial multi-route editor output**

Create `tests/renderer/ScenarioDefinitionEditor.test.tsx` using React server rendering, which is available without adding a testing-library dependency:

```tsx
import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ScenarioDefinitionEditor from '../../src/renderer/ScenarioDefinitionEditor';
import type { ProjectManifest, RouteStopMasterRecord } from '../../src/shared/types';

const project = { id: 'project-1', name: '테스트 프로젝트', scenarioDefinitions: [] } as unknown as ProjectManifest;
const routeStops: RouteStopMasterRecord[] = [
  { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', stationSequence: 1, stationId: 'A-1', stationName: 'A1', latitude: 37, longitude: 127 },
  { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', stationSequence: 2, stationId: 'A-2', stationName: 'A2', latitude: 37, longitude: 127 },
  { routeId: 'R-B', routeName: 'B 노선', transportMode: 'bus', stationSequence: 1, stationId: 'B-1', stationName: 'B1', latitude: 37, longitude: 127 },
  { routeId: 'R-B', routeName: 'B 노선', transportMode: 'bus', stationSequence: 2, stationId: 'B-2', stationName: 'B2', latitude: 37, longitude: 127 }
];

it('renders route-definition disclaimer and multiple route cards', () => {
  const markup = renderToStaticMarkup(<ScenarioDefinitionEditor project={project} routeStops={routeStops} onSaveScenarioDefinition={vi.fn(async () => {})} />);
  expect(markup).toContain('시나리오 입력·저장');
  expect(markup).toContain('실제 도로 경로는 다음 단계에서 계산');
  expect(markup).toContain('Before 정류장 경로');
  expect(markup).toContain('After 정류장 순서');
  expect(markup).toContain('노선 추가');
});

it('renders saved scenario labels and route IDs without adding a comparison result', () => {
  const saved = { ...project, scenarioDefinitions: [{ scenarioSchemaVersion: 1, scenarioId: 'saved-1', label: '저장된 A/B 시나리오', routeChanges: [], source: { assumptions: [], warnings: [], modelVersions: [] }, createdAt: '2026-01-01', updatedAt: '2026-01-02' }] } as unknown as ProjectManifest;
  const markup = renderToStaticMarkup(<ScenarioDefinitionEditor project={saved} routeStops={routeStops} onSaveScenarioDefinition={vi.fn(async () => {})} />);
  expect(markup).toContain('저장된 A/B 시나리오');
  expect(markup).toContain('시나리오 정의를 저장');
  expect(markup).not.toContain('MOTIS 여정 비교 결과');
});
```

- [ ] **Step 2: Run the renderer tests to verify they fail for the missing component**

Run: `npx vitest run tests/renderer/ScenarioDefinitionEditor.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because `src/renderer/ScenarioDefinitionEditor.tsx` does not exist yet.

- [ ] **Step 3: Implement the editor component state and initial draft loading**

Export this prop interface:

```ts
export interface ScenarioDefinitionEditorProps {
  project: ProjectManifest;
  routeStops: RouteStopMasterRecord[];
  onSaveScenarioDefinition: (definition: ScenarioDefinition) => Promise<void>;
}
```

On mount, load the first saved definition into `scenarioDefinitionToEditorDraft`; if none exists, create a draft with a new `crypto.randomUUID()`, label `새 노선 개편 시나리오`, one route using the first available route, and one journey query row with empty values. Keep a local `selectedScenarioId` and a deep-copied draft so editing fields never mutates `project.scenarioDefinitions` before save.

- [ ] **Step 4: Render scenario list and multi-route cards**

Render controls with stable accessible labels:

```tsx
<select aria-label="저장된 시나리오" />
<button type="button">새 시나리오</button>
<button type="button">노선 추가</button>
<button type="button">노선 변경 제거</button>
<input aria-label="시나리오 라벨" />
<input aria-label="After 정류장 순서" />
<input aria-label="Before 배차간격" />
<input aria-label="After 배차간격" />
<input aria-label="Before 운행대수" />
<input aria-label="After 운행대수" />
```

Each route card must show read-only `baseStopIds`, editable `scenarioStopText`, and separate Before/After service days, times, headway, vehicle count, dwell seconds, dates, and reverse-direction controls. Show a text notice that actual road path geometry is not calculated yet. Add and remove journey query rows with origin, destination, and departure date-time inputs.

- [ ] **Step 5: Implement save validation and error state**

On the save button, call `validateScenarioEditorDraft`. If errors exist, render them in the editor and do not call `onSaveScenarioDefinition`. Otherwise call `createScenarioDefinition(buildScenarioDefinitionInput(draft))`, await the callback, replace the local draft with `scenarioDefinitionToEditorDraft(savedDefinition)`, and show a saved message. Preserve the draft when the callback rejects and render the error message.

- [ ] **Step 6: Run renderer and core tests to verify the editor behavior**

Run: `npx vitest run tests/renderer/ScenarioDefinitionEditor.test.tsx tests/core/scenario-editor.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: PASS for the two renderer tests and all core editor tests.

- [ ] **Step 7: Commit the editor component**

```bash
git add src/renderer/ScenarioDefinitionEditor.tsx tests/renderer/ScenarioDefinitionEditor.test.tsx
git commit -m "feat: add multi-route scenario definition editor"
```

---

### Task 3: App 저장 callback 연결과 회귀 검증

**Files:**
- Modify: `src/renderer/SyntheticGtfsBuilder.tsx:13-20,107-370` — editor render and callback prop while preserving existing delta flow
- Modify: `src/renderer/App.tsx:391-400,1309-1313` — metadata callback that upserts definitions
- Modify: `tests/renderer/SyntheticGtfsBuilder.test.tsx` — existing single-route behavior and editor integration helper coverage
- Modify: `tests/main/project-store.test.ts` — multiple definitions metadata round-trip

**Interfaces:**
- Consumes `ScenarioDefinitionEditorProps` and `upsertScenarioDefinition` from Tasks 1 and 2.
- Produces an `onSaveScenarioDefinition` path that updates only `project.scenarioDefinitions`, preserves `scenarioDeltas`, and reaches `project-store.saveMetadata` because `project.records === next.records`.

- [ ] **Step 1: Write a failing editor integration test**

Extend `tests/renderer/SyntheticGtfsBuilder.test.tsx` with the server-rendering imports and a minimal project/master fixture below. The assertion must fail before the builder renders `ScenarioDefinitionEditor`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import SyntheticGtfsBuilder from '../../src/renderer/SyntheticGtfsBuilder';
import type { ProjectManifest, RouteStopMasterRecord } from '../../src/shared/types';

it('renders the multi-route editor inside the Synthetic GTFS screen', () => {
  const project = { id: 'project-1', name: '테스트', records: [], scenarioDefinitions: [] } as unknown as ProjectManifest;
  const routeStops: RouteStopMasterRecord[] = [
    { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', stationSequence: 1, stationId: 'A-1', stationName: 'A1', latitude: 37, longitude: 127 },
    { routeId: 'R-A', routeName: 'A 노선', transportMode: 'bus', stationSequence: 2, stationId: 'A-2', stationName: 'A2', latitude: 37, longitude: 127 }
  ];
  const markup = renderToStaticMarkup(
    <SyntheticGtfsBuilder project={project} routeStops={routeStops} serviceConfigs={[]} onBack={() => {}} onSaveScenarioDefinition={async () => {}} />
  );
  expect(markup).toContain('시나리오 입력·저장');
});
```

Also add a metadata round-trip case to `tests/main/project-store.test.ts`. The case saves two valid definitions through `saveMetadata`, reopens the project, and asserts both definitions—including distinct route changes—round-trip unchanged. Keep the pure upsert/legacy-delta regression for Step 5, after the callback is wired.

- [ ] **Step 2: Run the integration tests to verify the editor wiring is absent**

Run: `npx vitest run tests/renderer/SyntheticGtfsBuilder.test.tsx tests/main/project-store.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: FAIL because `SyntheticGtfsBuilder` does not yet accept/render `onSaveScenarioDefinition`. The newly added project-store round-trip test may pass independently because the storage boundary already supports `scenarioDefinitions`; it is a regression fixture for the integration step, not the RED assertion.

- [ ] **Step 3: Add the editor callback without changing the legacy delta callback**

Add `onSaveScenarioDefinition?: (definition: ScenarioDefinition) => Promise<void>` to `SyntheticGtfsBuilderProps`. Render `ScenarioDefinitionEditor` with the current `project` and `routeStops` before the existing Synthetic GTFS form, and pass the new callback through. Leave `onSaveScenario` and the current `createScenarioDelta` call unchanged.

- [ ] **Step 4: Connect App metadata save and scenario upsert**

Import `upsertScenarioDefinition` and add this callback to `renderSynthetic()`:

```ts
onSaveScenarioDefinition={async (definition) => {
  const nextProject: ProjectManifest = {
    ...project,
    updatedAt: new Date().toISOString(),
    scenarioDefinitions: upsertScenarioDefinition(project.scenarioDefinitions ?? [], definition)
  };
  await save(nextProject);
}}
```

Do not modify the existing `onSaveScenario` body that writes `scenarioDeltas`. Because `nextProject.records` is the same array as `project.records`, the existing `save()` function selects `saveProjectMetadata` on desktop.

- [ ] **Step 5: Add callback/upsert regression coverage and run integration tests**

Add this renderer-level regression to `tests/renderer/SyntheticGtfsBuilder.test.tsx` with the required imports:

```ts
import { upsertScenarioDefinition } from '../../src/core/scenario-editor';
import type { ProjectManifest, ScenarioDefinition } from '../../src/shared/types';

it('replaces one saved scenario without changing legacy deltas', () => {
  const oldScenario = { scenarioId: 'scenario-1', label: 'old' } as ScenarioDefinition;
  const nextScenario = { scenarioId: 'scenario-1', label: 'new' } as ScenarioDefinition;
  const project = { scenarioDefinitions: [oldScenario], scenarioDeltas: [{ scenarioId: 'legacy-1' }] } as unknown as ProjectManifest;
  const nextDefinitions = upsertScenarioDefinition(project.scenarioDefinitions ?? [], nextScenario);
  expect(nextDefinitions).toEqual([nextScenario]);
  expect(project.scenarioDeltas).toHaveLength(1);
});
```

Use two valid definitions with scenario IDs `scenario-a` and `scenario-b`, each containing a different route change, call `saveMetadata`, reopen with `read`, and assert `scenarioDefinitions` deep equality. Keep the existing invalid-definition write-blocking test unchanged.

Run: `npx vitest run tests/renderer/SyntheticGtfsBuilder.test.tsx tests/main/project-store.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

Expected: PASS for all existing and new targeted tests; `scenarioDeltas` behavior remains unchanged.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test`

Expected: PASS for the complete configured suite with the previous 56 test files plus the new core and renderer editor files.

Run: `npm run typecheck`

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 7: Commit the App integration**

```bash
git add src/renderer/SyntheticGtfsBuilder.tsx src/renderer/App.tsx tests/renderer/SyntheticGtfsBuilder.test.tsx tests/main/project-store.test.ts
git commit -m "feat: persist multi-route scenario definitions"
```

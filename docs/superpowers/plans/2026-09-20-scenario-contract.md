# 다중 노선 시나리오 공통 계약 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여러 노선과 여러 정류장 변경, 노선별 Before/After 운행조건, 복수 여정 질의를 하나의 검증 가능한 시나리오 입력으로 저장하고 기존 `ScenarioDelta`와 호환되는 공통 계약을 추가한다.

**Architecture:** 공유 JSON 계약 타입은 `src/shared/types.ts`에 두고, 생성·검증·레거시 변환·delta 파생은 부작용 없는 `src/core/scenario-contract.ts`에 둔다. 프로젝트 저장소는 저장 직전에 이 순수 검증기를 호출해 잘못된 시나리오가 `project.json`·`project-state.json`·DuckDB 쓰기까지 도달하지 않게 한다. 기존 renderer와 `scenarioDeltas` 경로는 이번 단계에서 건드리지 않는다.

**Tech Stack:** TypeScript 5.8, Vitest 3, Electron main-process project store, JSON project metadata.

**Spec:** `docs/superpowers/specs/2026-09-20-scenario-contract-design.md`

## Global Constraints

- `CURRENT_PROJECT_SCHEMA_VERSION`은 10으로 유지하고 프로젝트 스키마 버전은 올리지 않는다.
- 새 계약은 `scenarioSchemaVersion: 1`로 내부 버전을 관리한다.
- 하나의 `ScenarioDefinition`은 `routeChanges`를 최소 1개 보유하고 노선 ID를 중복 보유하지 않는다.
- 각 Before/After 정류장 경로는 최소 2개이며 각 경로 안에서 정류장 ID를 중복 보유하지 않는다.
- `serviceDays`는 0~6 범위의 중복 없는 정수이고 비어 있지 않아야 한다.
- 첫차와 막차는 `HH:mm` 형식이며 첫차가 막차보다 늦지 않아야 한다.
- `headwayMinutes`와 `vehicleCount`는 1 이상의 정수이고, `dwellSeconds`·지연시간·최소 구간시간은 0 이상의 정수여야 한다.
- `speedsKph`의 각 기준속도는 0보다 커야 하며, 서비스 시작일은 종료일보다 늦지 않아야 한다.
- 검증 오류는 저장 전에 차단하고 `ScenarioProvenance.warnings`는 검증 오류로 취급하지 않는다.
- 기존 `ScenarioDelta`와 `ProjectManifest.scenarioDeltas`는 제거하거나 자동 승격하지 않는다.
- GTFS ZIP, MOTIS 원시 응답, 수요 재배분, 요금, 노선 연장·운행시간 계산, renderer 입력 화면은 이번 계획의 범위가 아니다.

## Review Focus

- 빈 문자열·잘못된 JSON 형태가 `validateScenarioDefinition`에서 예외 없이 필드 경로가 있는 오류로 반환되는지 — Task 1의 `rejects malformed runtime input with field paths` 테스트.
- 같은 노선이 두 번 들어오거나 한 경로에 정류장이 중복될 때 한 노선 시나리오로 잘못 합쳐지지 않는지 — Task 1의 `rejects duplicate route and stop identifiers` 테스트.
- `serviceDays`, 시각, 배차간격, 운행대수, 시간모델의 숫자 경계값이 통과하지 않는지 — Task 1의 `rejects invalid operation plans` 테스트.
- 레거시 delta를 새 계약으로 올릴 때 운행조건을 명시하지 않으면 임의의 기본값이 생기지 않는지 — Task 2의 `requires explicit operation plans when promoting legacy deltas` 테스트.
- 저장 중 검증 실패가 원본 거래내역 DB나 metadata 파일을 먼저 쓰지 않는지 — Task 3의 `blocks invalid scenario definitions before any storage write` 테스트.

---

### Task 1: 공유 계약 타입과 런타임 검증기

**Files:**
- Modify: `src/shared/types.ts:1-40,468-501` — 시나리오 계약 타입과 `ProjectManifest.scenarioDefinitions?` 추가
- Create: `src/core/scenario-contract.ts` — 생성 시 검증, 오류 수집, 저장 경계용 assertion
- Create: `tests/core/scenario-contract.test.ts` — 계약 fixture와 검증 실패/성공 테스트

**Interfaces:**
- Produces `ScenarioTravelTimeModel`, `ScenarioOperationPlan`, `ScenarioRouteChange`, `ScenarioJourneyQuery`, `ScenarioProvenance`, `ScenarioEnvironment`, `ScenarioDefinition` in `src/shared/types.ts`.
- Produces `ScenarioValidationResult`, `validateScenarioDefinition(value: unknown)`, `assertValidScenarioDefinition(value: unknown): asserts value is ScenarioDefinition`, and `assertValidScenarioDefinitions(definitions: readonly unknown[] | undefined): void` in `src/core/scenario-contract.ts`.
- `ScenarioDefinitionInput` and conversion functions are introduced in Task 2; Task 1 does not invent legacy defaults.

- [ ] **Step 1: Write the failing tests for a valid multi-route contract**

Add this shape to `tests/core/scenario-contract.test.ts` before adding production exports. The fixture intentionally gives the two routes different stop counts and operation plans.

```ts
import { expect, it } from 'vitest';
import type { ScenarioDefinition, ScenarioOperationPlan } from '../../src/shared/types';
import { validateScenarioDefinition } from '../../src/core/scenario-contract';

const operation = (overrides: Partial<ScenarioOperationPlan> = {}): ScenarioOperationPlan => ({
  serviceDays: [1, 2, 3, 4, 5],
  firstDeparture: '06:00',
  lastDeparture: '22:00',
  headwayMinutes: 10,
  vehicleCount: 4,
  dwellSeconds: 20,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  deriveReverseDirection: true,
  travelTimeModel: {
    modelVersion: 'baseline-stop-distance-1',
    speedsKph: { unknown: 15, primary: 30 },
    intersectionDelaySeconds: 5,
    turnDelaySeconds: 10,
    minimumSegmentSeconds: 30
  },
  ...overrides
});

const definition = (): ScenarioDefinition => ({
  scenarioSchemaVersion: 1,
  scenarioId: 'scenario-1',
  label: '복수 노선 개편',
  routeChanges: [
    {
      routeId: 'R-A',
      routeName: 'A 노선',
      transportMode: 'bus',
      baseStopIds: ['A-1', 'A-2', 'A-3'],
      scenarioStopIds: ['A-1', 'A-4', 'A-3'],
      beforeOperation: operation(),
      afterOperation: operation({ headwayMinutes: 15, vehicleCount: 3 })
    },
    {
      routeId: 'R-B',
      routeName: 'B 노선',
      transportMode: 'bus',
      baseStopIds: ['B-1', 'B-2'],
      scenarioStopIds: ['B-1', 'B-2', 'B-3', 'B-4'],
      beforeOperation: operation({ firstDeparture: '07:00', lastDeparture: '20:00' }),
      afterOperation: operation({ firstDeparture: '05:30', lastDeparture: '23:00', dwellSeconds: 35 })
    }
  ],
  journeyQueries: [{ originStopId: 'A-1', destinationStopId: 'B-4', departureDateTime: '2026-03-02T08:00:00+09:00' }],
  source: {
    projectId: 'project-1',
    routeMasterSource: 'route-master.csv',
    assumptions: ['역간 도로등급은 unknown으로 시작한다.'],
    warnings: ['실제 도로 형상은 후속 단계에서 보강한다.'],
    modelVersions: ['baseline-stop-distance-1']
  },
  environment: { motisVersion: '2.11.3', osmPbfFileName: 'seoul.osm.pbf', osmPbfSha256: 'abc123' },
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z'
});

it('accepts multiple routes with independent before and after operation plans', () => {
  const result = validateScenarioDefinition(definition());
  expect(result).toEqual({
    errors: [],
    warnings: ['실제 도로 형상은 후속 단계에서 보강한다.'],
    isValid: true
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails for the missing contract module**

Run: `npm test -- tests/core/scenario-contract.test.ts`

Expected: FAIL because `src/core/scenario-contract.ts` and the referenced shared contract types do not exist yet. Do not accept a passing test at this step.

- [ ] **Step 3: Add the shared contract types without changing project schema version**

Add the following shapes after `ScenarioDelta` in `src/shared/types.ts`; use mutable arrays because project JSON is persisted and existing project types use mutable arrays.

```ts
export const CURRENT_SCENARIO_SCHEMA_VERSION = 1 as const;
export type ScenarioSchemaVersion = typeof CURRENT_SCENARIO_SCHEMA_VERSION;

export interface ScenarioTravelTimeModel {
  modelVersion: string;
  speedsKph: Record<string, number>;
  intersectionDelaySeconds: number;
  turnDelaySeconds: number;
  minimumSegmentSeconds: number;
}

export interface ScenarioOperationPlan {
  serviceDays: number[];
  firstDeparture: string;
  lastDeparture: string;
  headwayMinutes: number;
  vehicleCount: number;
  dwellSeconds: number;
  startDate: string;
  endDate: string;
  deriveReverseDirection: boolean;
  travelTimeModel: ScenarioTravelTimeModel;
}

export interface ScenarioRouteChange {
  routeId: string;
  routeName?: string;
  transportMode?: string;
  baseStopIds: string[];
  scenarioStopIds: string[];
  beforeOperation: ScenarioOperationPlan;
  afterOperation: ScenarioOperationPlan;
}

export interface ScenarioJourneyQuery {
  originStopId: string;
  destinationStopId: string;
  departureDateTime: string;
}

export interface ScenarioProvenance {
  projectId?: string;
  routeMasterSource?: string;
  assumptions: string[];
  warnings: string[];
  modelVersions: string[];
}

export interface ScenarioEnvironment {
  motisVersion?: string;
  osmPbfFileName?: string;
  osmPbfSha256?: string;
}

export interface ScenarioDefinition {
  scenarioSchemaVersion: ScenarioSchemaVersion;
  scenarioId: string;
  label: string;
  routeChanges: ScenarioRouteChange[];
  journeyQueries?: ScenarioJourneyQuery[];
  source: ScenarioProvenance;
  environment?: ScenarioEnvironment;
  createdAt: string;
  updatedAt: string;
}
```

Add `scenarioDefinitions?: ScenarioDefinition[];` to `ProjectManifest` immediately after the existing `scenarioDeltas?` field. Do not alter `CURRENT_PROJECT_SCHEMA_VERSION` or `ProjectSchemaVersion`.

- [ ] **Step 4: Implement the minimal validation result and field-level validators**

In `src/core/scenario-contract.ts`, import only the shared scenario types and implement the public API below. `validateScenarioDefinition` must accept `unknown`, return all blocking errors instead of throwing, copy `source.warnings` into the returned warnings, and use stable field paths such as `routeChanges[0].afterOperation.headwayMinutes` in messages. `assertValidScenarioDefinition` throws `Error('시나리오 정의가 유효하지 않습니다: ...')` when `errors` is nonempty; `assertValidScenarioDefinitions` validates every item and includes the array index in the thrown message.

```ts
export interface ScenarioValidationResult {
  errors: string[];
  warnings: string[];
  isValid: boolean;
}

export function validateScenarioDefinition(value: unknown): ScenarioValidationResult;
export function assertValidScenarioDefinition(value: unknown): asserts value is ScenarioDefinition;
export function assertValidScenarioDefinitions(definitions: readonly unknown[] | undefined): void;
```

Implement these exact validation groups:

```ts
// Every failed condition appends one field path to errors.
scenarioSchemaVersion === 1;
scenarioId.trim() !== '';
label.trim() !== '';
routeChanges.length >= 1;
routeChanges.map((change) => change.routeId) has no duplicates;
baseStopIds.length >= 2 && scenarioStopIds.length >= 2;
each stop ID is a non-empty string and unique within its own path;
each operation has serviceDays.length >= 1, integer unique days in [0, 6];
firstDeparture and lastDeparture match /^\\d{2}:\\d{2}$/ with hours 00..47 and minutes 00..59;
firstDeparture <= lastDeparture after conversion to minutes;
headwayMinutes and vehicleCount are integers >= 1;
dwellSeconds, intersectionDelaySeconds, turnDelaySeconds, and minimumSegmentSeconds are integers >= 0;
travelTimeModel.modelVersion.trim() !== '' and speedsKph has at least one entry whose value is finite and > 0;
startDate and endDate match YYYY-MM-DD and are real calendar dates with startDate <= endDate;
each journey query has non-empty originStopId, destinationStopId, and departureDateTime;
createdAt and updatedAt are non-empty strings;
source.assumptions, source.warnings, and source.modelVersions are arrays of strings.
```

Treat `routeName`, `transportMode`, all environment fields, and `projectId`/`routeMasterSource` as optional strings when present. Never mutate the input object or its arrays.

- [ ] **Step 5: Run the focused test to verify the valid contract passes**

Run: `npm test -- tests/core/scenario-contract.test.ts`

Expected: PASS for `accepts multiple routes with independent before and after operation plans`.

- [ ] **Step 6: Add failing validation tests for malformed input and operation boundaries**

Append these tests to `tests/core/scenario-contract.test.ts`, using the `definition` and `operation` helpers from Step 1.

```ts
it('rejects duplicate route and stop identifiers', () => {
  const duplicateRoute = definition();
  duplicateRoute.routeChanges[1].routeId = 'R-A';
  const duplicateStop = definition();
  duplicateStop.routeChanges[0].scenarioStopIds = ['A-1', 'A-1'];

  expect(validateScenarioDefinition(duplicateRoute).errors).toEqual(expect.arrayContaining([
    'routeChanges[1].routeId: 노선 ID가 중복되었습니다.'
  ]));
  expect(validateScenarioDefinition(duplicateStop).errors).toEqual(expect.arrayContaining([
    'routeChanges[0].scenarioStopIds: 정류장 ID가 중복되었습니다.'
  ]));
});

it('rejects invalid operation plans', () => {
  const invalid = definition();
  invalid.routeChanges[0].afterOperation = operation({
    serviceDays: [1, 1, 7],
    firstDeparture: '23:00',
    lastDeparture: '08:00',
    headwayMinutes: 0,
    vehicleCount: 0,
    dwellSeconds: -1,
    startDate: '2026-02-30',
    endDate: '2026-01-01',
    travelTimeModel: {
      modelVersion: '',
      speedsKph: { unknown: 0 },
      intersectionDelaySeconds: -1,
      turnDelaySeconds: 0,
      minimumSegmentSeconds: -1
    }
  });

  const result = validateScenarioDefinition(invalid);
  expect(result.isValid).toBe(false);
  expect(result.errors).toEqual(expect.arrayContaining([
    'routeChanges[0].afterOperation.serviceDays: 운행요일은 0~6 범위의 중복 없는 정수여야 합니다.',
    'routeChanges[0].afterOperation.firstDeparture: 첫차가 막차보다 늦습니다.',
    'routeChanges[0].afterOperation.headwayMinutes: 배차간격은 1분 이상의 정수여야 합니다.',
    'routeChanges[0].afterOperation.vehicleCount: 운행대수는 1 이상의 정수여야 합니다.',
    'routeChanges[0].afterOperation.startDate: 유효한 날짜 범위가 아닙니다.',
    'routeChanges[0].afterOperation.travelTimeModel.speedsKph.unknown: 기준속도는 0보다 커야 합니다.'
  ]));
});

it('rejects malformed runtime input with field paths', () => {
  const malformed = { scenarioId: '', routeChanges: 'not-an-array' };
  const result = validateScenarioDefinition(malformed);
  expect(result.isValid).toBe(false);
  expect(result.errors).toEqual(expect.arrayContaining([
    'scenarioSchemaVersion: 시나리오 스키마 버전은 1이어야 합니다.',
    'scenarioId: 시나리오 ID가 비어 있습니다.',
    'routeChanges: 노선 변경은 1개 이상이어야 합니다.'
  ]));
  expect(() => assertValidScenarioDefinition(malformed)).toThrow('시나리오 정의가 유효하지 않습니다');
});
```

Add `assertValidScenarioDefinition` to the named import from `../../src/core/scenario-contract` before running this block.

- [ ] **Step 7: Run the tests to verify the new cases fail for missing validation behavior**

Run: `npm test -- tests/core/scenario-contract.test.ts`

Expected: FAIL in the newly added assertions because the implementation does not yet cover the requested invalid-input paths. If the failure is a TypeScript/import error, fix the test or type declaration before proceeding; the expected RED state is a failed assertion from incomplete validation.

- [ ] **Step 8: Complete the validators and assertion wrapper**

Keep the implementation pure: use local error arrays, a local `parseClockMinutes`, and a local calendar-date validator; never call `Date.now`, `crypto.randomUUID`, filesystem APIs, or mutate fixtures. Preserve all provenance warning strings in `ScenarioValidationResult.warnings` and set `isValid` to `errors.length === 0`.

- [ ] **Step 9: Run the focused tests to verify validation passes**

Run: `npm test -- tests/core/scenario-contract.test.ts`

Expected: PASS for all Task 1 tests, including the malformed runtime input and operation-boundary cases.

- [ ] **Step 10: Commit the completed contract and validator**

```bash
git add src/shared/types.ts src/core/scenario-contract.ts tests/core/scenario-contract.test.ts
git commit -m "feat: add multi-route scenario contract validation"
```

---

### Task 2: 생성·delta 파생·레거시 승격 경계

**Files:**
- Modify: `src/core/scenario-contract.ts` — validated definition constructor and deterministic conversion functions
- Modify: `tests/core/scenario-contract.test.ts` — multi-route conversion and explicit legacy promotion tests

**Interfaces:**
- Consumes `ScenarioDefinition`, `ScenarioRouteChange`, `ScenarioOperationPlan`, `ScenarioProvenance`, `ScenarioDelta`, and the Task 1 validation functions.
- Produces `ScenarioDefinitionInput`, `LegacyScenarioPromotionInput`, `createScenarioDefinition(input: ScenarioDefinitionInput): ScenarioDefinition`, `scenarioDefinitionToLegacyDeltas(definition: ScenarioDefinition): ScenarioDelta[]`, and `createScenarioDefinitionFromLegacyDeltas(input: LegacyScenarioPromotionInput): ScenarioDefinition`.

- [ ] **Step 1: Write failing tests for deterministic construction and delta derivation**

Append the following tests and imports to `tests/core/scenario-contract.test.ts` before adding the new functions.

```ts
import {
  createScenarioDefinition,
  scenarioDefinitionToLegacyDeltas
} from '../../src/core/scenario-contract';
import type { ScenarioDelta } from '../../src/shared/types';

it('creates one validated definition and derives one legacy delta per route', () => {
  const source = definition();
  const { scenarioSchemaVersion: _version, ...input } = source;
  const created = createScenarioDefinition(input);
  const deltas = scenarioDefinitionToLegacyDeltas(created);

  expect(created.scenarioSchemaVersion).toBe(1);
  expect(deltas).toHaveLength(2);
  expect(deltas.map((delta) => delta.routeId)).toEqual(['R-A', 'R-B']);
  expect(deltas[0]).toMatchObject({
    scenarioId: 'scenario-1:R-A',
    label: '복수 노선 개편',
    baseStopIds: ['A-1', 'A-2', 'A-3'],
    scenarioStopIds: ['A-1', 'A-4', 'A-3'],
    addedStopIds: ['A-4'],
    removedStopIds: ['A-2'],
    createdAt: source.createdAt
  });
});
```

Use `ScenarioDefinitionInput = Omit<ScenarioDefinition, 'scenarioSchemaVersion'>`; do not make callers supply or override the internal version.

- [ ] **Step 2: Run the conversion test to verify it fails for missing exports**

Run: `npm test -- tests/core/scenario-contract.test.ts`

Expected: FAIL because the constructor and delta conversion exports are not implemented.

- [ ] **Step 3: Implement validated construction and deterministic delta derivation**

Implement these exact types and rules in `src/core/scenario-contract.ts`:

```ts
export type ScenarioDefinitionInput = Omit<ScenarioDefinition, 'scenarioSchemaVersion'>;

export function createScenarioDefinition(input: ScenarioDefinitionInput): ScenarioDefinition {
  const definition: ScenarioDefinition = { scenarioSchemaVersion: 1, ...input };
  assertValidScenarioDefinition(definition);
  return definition;
}

export function scenarioDefinitionToLegacyDeltas(definition: ScenarioDefinition): ScenarioDelta[];
```

`scenarioDefinitionToLegacyDeltas` must call `assertValidScenarioDefinition` first, preserve route order, copy both stop arrays, calculate `addedStopIds` in scenario order and `removedStopIds` in base order, use `scenarioId: \`${definition.scenarioId}:${routeChange.routeId}\``, use `definition.label` as `label`, copy `definition.source.warnings` as `warnings`, and use `definition.createdAt` as `createdAt`. It must not mutate the definition.

- [ ] **Step 4: Run the focused tests to verify constructor and derivation pass**

Run: `npm test -- tests/core/scenario-contract.test.ts`

Expected: PASS for the constructor/derivation test and all prior validation tests.

- [ ] **Step 5: Write the failing test for explicit legacy promotion**

Append this test and define `promoteOperations` only in the test file. The promotion input supplies all operation plans explicitly so the converter cannot invent a default.

```ts
import { createScenarioDefinitionFromLegacyDeltas } from '../../src/core/scenario-contract';

it('requires explicit operation plans when promoting legacy deltas', () => {
  const legacy: ScenarioDelta[] = [
    {
      scenarioId: 'legacy-a', label: '기존 개편', routeId: 'R-A',
      baseStopIds: ['A-1', 'A-2'], scenarioStopIds: ['A-1', 'A-3'],
      addedStopIds: ['A-3'], removedStopIds: ['A-2'], warnings: ['경로 확인 필요'], createdAt: '2026-01-01T00:00:00.000Z'
    },
    {
      scenarioId: 'legacy-b', label: '기존 개편', routeId: 'R-B',
      baseStopIds: ['B-1', 'B-2'], scenarioStopIds: ['B-1', 'B-2', 'B-3'],
      addedStopIds: ['B-3'], removedStopIds: [], warnings: [], createdAt: '2026-01-01T00:00:00.000Z'
    }
  ];
  const input = {
    scenarioId: 'promoted-1',
    label: '승격한 개편',
    deltas: legacy,
    operationsByRouteId: {
      'R-A': { beforeOperation: operation(), afterOperation: operation({ headwayMinutes: 15 }) },
      'R-B': { beforeOperation: operation({ vehicleCount: 2 }), afterOperation: operation({ vehicleCount: 5 }) }
    },
    source: { assumptions: [], warnings: [], modelVersions: [] },
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z'
  };

  const promoted = createScenarioDefinitionFromLegacyDeltas(input);
  expect(promoted.routeChanges).toHaveLength(2);
  expect(promoted.routeChanges[0].afterOperation.headwayMinutes).toBe(15);
  expect(promoted.routeChanges[1].beforeOperation.vehicleCount).toBe(2);
  expect(promoted.source.warnings).toEqual(['경로 확인 필요']);

  expect(() => createScenarioDefinitionFromLegacyDeltas({
    ...input,
    operationsByRouteId: { 'R-A': input.operationsByRouteId['R-A'] }
  })).toThrow('R-B');
});
```

- [ ] **Step 6: Run the promotion test to verify it fails for the missing export**

Run: `npm test -- tests/core/scenario-contract.test.ts`

Expected: FAIL because `createScenarioDefinitionFromLegacyDeltas` and `LegacyScenarioPromotionInput` are not implemented.

- [ ] **Step 7: Implement explicit legacy promotion**

Add the following public input type and function:

```ts
export interface LegacyScenarioPromotionInput {
  scenarioId: string;
  label: string;
  deltas: ScenarioDelta[];
  operationsByRouteId: Record<string, Pick<ScenarioRouteChange, 'beforeOperation' | 'afterOperation'>>;
  source: ScenarioProvenance;
  journeyQueries?: ScenarioJourneyQuery[];
  environment?: ScenarioEnvironment;
  createdAt: string;
  updatedAt: string;
}

export function createScenarioDefinitionFromLegacyDeltas(input: LegacyScenarioPromotionInput): ScenarioDefinition;
```

The function must reject an empty delta list, reject any delta whose route has no `operationsByRouteId` entry, copy each delta's stop paths and route ID in input order, merge `input.source.warnings` with all delta warnings in first-seen order, leave route name and transport mode absent, and pass the resulting definition through `createScenarioDefinition`. This is the only legacy-to-new promotion path; there is no implicit promotion during project loading or saving.

- [ ] **Step 8: Run the focused tests to verify all conversion behavior passes**

Run: `npm test -- tests/core/scenario-contract.test.ts`

Expected: PASS for all Task 1 and Task 2 tests.

- [ ] **Step 9: Commit the conversion boundary**

```bash
git add src/core/scenario-contract.ts tests/core/scenario-contract.test.ts
git commit -m "feat: add scenario compatibility conversions"
```

---

### Task 3: 프로젝트 저장 경계 검증과 회귀 확인

**Files:**
- Modify: `src/main/project-store.ts:1-105` — full save와 metadata save 직전의 scenario definition validation
- Modify: `tests/main/project-store.test.ts` — valid scenario persistence and write-blocking regression tests

**Interfaces:**
- Consumes `assertValidScenarioDefinitions(definitions)` from Task 1 and `ProjectManifest.scenarioDefinitions?` from `src/shared/types.ts`.
- Produces the guarantee that `createProjectStore(...).save` and `.saveMetadata` reject invalid scenario definitions before any database or JSON write, while valid definitions round-trip unchanged.

- [ ] **Step 1: Write the failing persistence and write-blocking tests**

Add these local fixtures and tests to `tests/main/project-store.test.ts`. The fixtures remain local to the main-process test file so the storage boundary test does not depend on test-file exports from `tests/core`.

```ts
import { createScenarioDefinition } from '../../src/core/scenario-contract';
import type { ProjectMetadata } from '../../src/main/project-store';
import type { ProjectManifest, ScenarioOperationPlan } from '../../src/shared/types';

const makeOperation = (overrides: Partial<ScenarioOperationPlan> = {}): ScenarioOperationPlan => ({
  serviceDays: [1, 2, 3, 4, 5], firstDeparture: '06:00', lastDeparture: '22:00',
  headwayMinutes: 10, vehicleCount: 4, dwellSeconds: 20,
  startDate: '2026-01-01', endDate: '2026-12-31', deriveReverseDirection: true,
  travelTimeModel: {
    modelVersion: 'baseline-stop-distance-1', speedsKph: { unknown: 15 },
    intersectionDelaySeconds: 5, turnDelaySeconds: 10, minimumSegmentSeconds: 30
  },
  ...overrides
});

const makeScenarioDefinition = () => createScenarioDefinition({
  scenarioId: 'storage-scenario', label: '저장 경계 시나리오',
  routeChanges: [
    { routeId: 'R-A', baseStopIds: ['A-1', 'A-2'], scenarioStopIds: ['A-1', 'A-3'], beforeOperation: makeOperation(), afterOperation: makeOperation({ headwayMinutes: 15 }) },
    { routeId: 'R-B', baseStopIds: ['B-1', 'B-2'], scenarioStopIds: ['B-1', 'B-2', 'B-3'], beforeOperation: makeOperation({ vehicleCount: 2 }), afterOperation: makeOperation({ vehicleCount: 5 }) }
  ],
  source: { assumptions: [], warnings: [], modelVersions: ['baseline-stop-distance-1'] },
  createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z'
});

const makeProject = (): ProjectManifest => ({
  id: 'scenario-project', schemaVersion: 10, name: 'scenario-project',
  createdAt: '', updatedAt: '', sourceFiles: [], records: [],
  mapping: { dateColumn: 'date', rowSemantics: 'one-row-one-boarding' },
  parseOptions: { encoding: 'utf-8', delimiter: ',', headerRow: 1 }
});

it('persists optional multi-route scenario definitions through metadata saves', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-scenario-'));
  const writeDatabase = vi.fn(async () => {});
  const project = makeProject();
  const scenarioDefinition = makeScenarioDefinition();
  try {
    const store = createProjectStore(root, writeDatabase);
    await store.save(project);
    const { records: _records, ...metadata } = project;
    await store.saveMetadata({ ...metadata, scenarioDefinitions: [scenarioDefinition] });

    await expect(createProjectStore(root, writeDatabase).read(project.id)).resolves.toEqual({
      ...project,
      scenarioDefinitions: [scenarioDefinition]
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('blocks invalid scenario definitions before any storage write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-scenario-invalid-'));
  const writeDatabase = vi.fn(async () => {});
  const project = makeProject();
  const invalid = { ...makeScenarioDefinition(), routeChanges: [] };
  try {
    const store = createProjectStore(root, writeDatabase);
    await expect(store.save({ ...project, scenarioDefinitions: [invalid] })).rejects.toThrow('routeChanges');
    expect(writeDatabase).not.toHaveBeenCalled();

    await store.save(project);
    const { records: _records, ...metadata } = project;
    await expect(store.saveMetadata({ ...metadata, scenarioDefinitions: [invalid] } as ProjectMetadata)).rejects.toThrow('routeChanges');
    expect(await store.read(project.id)).toEqual(project);
  } finally { await rm(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run the main-process tests to verify the invalid save currently writes or accepts the value**

Run: `npm test -- tests/main/project-store.test.ts`

Expected: FAIL because `project-store.ts` does not yet invoke the scenario validator before `writeDatabase` or metadata JSON writes.

- [ ] **Step 3: Add validation before both storage write paths**

Import `assertValidScenarioDefinitions` in `src/main/project-store.ts`. At the first line inside each `save` and `saveMetadata` serial callback, call `assertValidScenarioDefinitions(project.scenarioDefinitions)` or `assertValidScenarioDefinitions(metadata.scenarioDefinitions)`, respectively. Leave all existing folder, serialization, summary, and concurrency behavior unchanged. Since `ProjectMetadata` is derived from `ProjectManifest`, no second metadata type is needed.

- [ ] **Step 4: Run the project-store tests to verify persistence and blocking pass**

Run: `npm test -- tests/main/project-store.test.ts`

Expected: PASS for all existing project-store tests plus the two new scenario persistence tests; `writeDatabase` is not called for the invalid full save and the existing project remains unchanged after invalid metadata save.

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npm test`

Expected: PASS for the complete configured Vitest suite with no new failures.

Run: `npm run typecheck`

Expected: exit code 0 with no TypeScript errors, including renderer imports that continue to use the unchanged `ScenarioDelta` path.

- [ ] **Step 6: Commit the storage boundary and regression tests**

```bash
git add src/main/project-store.ts tests/main/project-store.test.ts
git commit -m "feat: validate scenarios at project storage boundary"
```

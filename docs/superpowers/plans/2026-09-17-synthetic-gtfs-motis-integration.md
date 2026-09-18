# Synthetic GTFS 및 MOTIS 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 노선·정류장 자료 또는 사용자 운영 가정으로 분석용 Synthetic GTFS를 생성하고, 이후 MOTIS를 통해 노선개편 전후 여정을 비교할 수 있는 Windows Electron 기능을 단계별로 구축한다.

**Architecture:** 기존 프로젝트의 노선·정류장·운행 기준 데이터를 `Synthetic Transit Model`로 정규화한 뒤, provenance를 보존하는 GTFS compiler와 검증기를 거친다. MOTIS는 별도 sidecar로 실행하여 라우팅과 도보·환승 여정을 제공하고, 애플리케이션 내부 comparison layer가 MOTIS 응답을 분석 지표로 변환한다. 사용자 체감 단위는 Gate 1부터 Gate 5까지 구현하고, 외부 MOTIS 실행 파일·OSM PBF가 필요한 단계는 재현 가능한 실증 시나리오로 인수한다.

**Tech Stack:** Electron 36, React 19, TypeScript 5.8, Vite 6, Vitest 3, Node.js 20+, JSZip, 기존 project manifest 및 IPC 구조, Windows용 MOTIS executable과 OSM PBF.

**Spec:** `docs/superpowers/specs/2026-09-17-synthetic-gtfs-motis-integration-design.md`

## Global Constraints

- MVP에서는 OSRM, Valhalla, GraphHopper, R5를 추가하지 않는다.
- 공식 데이터와 Synthetic 데이터는 동일한 결과처럼 표시하지 않고 출처·신뢰도·가정을 항상 보존한다.
- 운행횟수는 방향별 편도 출발횟수로 해석하며 왕복 총횟수를 자동으로 절반 처리하지 않는다.
- `자동차 경로시간 × 1.15`는 fallback 실험값으로만 허용하고 모델 버전과 계수를 결과에 기록한다.
- 기존 교통카드 수요·혼잡도 분석과 현재 프로젝트 스키마를 깨뜨리지 않는다.
- 각 사용자 체감 Gate는 구현 검증과 외부 실증 검증을 구분하고, 최종 응답에 실행환경·실증시나리오·판정항목을 제공한다.
- 현재 `.git` 디렉터리가 읽기 전용이므로 구현 중 commit은 시도하지 않고 변경 파일과 검증 결과를 남긴다.

---

## 파일 구조

### 신규 파일

- `src/core/synthetic-gtfs/types.ts`: 정규화된 입력, 운행계획, GTFS 출력, provenance, 검증 결과 타입
- `src/core/synthetic-gtfs/provenance.ts`: 출처와 신뢰도 생성·병합 유틸리티
- `src/core/synthetic-gtfs/source-adapter.ts`: 기존 `RouteStopMasterRecord`·`RouteServiceConfig`를 Synthetic 모델로 변환
- `src/core/synthetic-gtfs/schedule-synthesizer.ts`: 방향별 출발시각·시간대별 운행횟수 생성
- `src/core/synthetic-gtfs/travel-time-estimator.ts`: 구간 거리·도로유형·정차시간 기반 예상 운행시간
- `src/core/synthetic-gtfs/gtfs-compiler.ts`: 최소 GTFS 텍스트 파일 및 provenance/config 생성
- `src/core/synthetic-gtfs/validator.ts`: 차단 오류와 검수 경고 판정
- `src/core/synthetic-gtfs/draft-builder.ts`: 기존 프로젝트 자료에서 Gate 1 생성 입력 조합
- `src/core/synthetic-gtfs/index.ts`: 외부에서 사용하는 핵심 함수의 단일 export
- `src/renderer/SyntheticGtfsBuilder.tsx`: Gate 1 입력·미리보기·검증·내보내기 화면
- `src/main/synthetic-gtfs-export.ts`: GTFS 파일 세트를 ZIP으로 저장하는 Electron main helper
- `src/main/motis-sidecar.ts`: MOTIS 프로세스 lifecycle·readiness·HTTP 요청 wrapper
- `src/core/transit-comparison.ts`: 정규화 여정과 Before/After 지표 비교

### 수정 파일

- `src/shared/types.ts`: 프로젝트에서 Synthetic 설정과 결과를 저장하기 위한 최소 타입 및 schema version 확장
- `src/main/index.ts`: `synthetic-gtfs:export` 및 MOTIS 관련 IPC handler 등록
- `src/preload/index.ts`: renderer에 안전한 Synthetic GTFS export·MOTIS API 노출
- `src/renderer/env.d.ts`: preload API 타입 추가
- `src/renderer/App.tsx`: Synthetic GTFS 화면 진입점, 프로젝트 route master 연결, 결과 저장
- `src/renderer/styles.css`: Builder의 입력·검증·provenance 표시 스타일
- `scripts/package-win.mjs`: MOTIS executable이 제공된 경우의 optional sidecar 파일 포함 규칙

### 테스트 파일

- `tests/core/synthetic-gtfs-types.test.ts`
- `tests/core/synthetic-gtfs-schedule.test.ts`
- `tests/core/synthetic-gtfs-travel-time.test.ts`
- `tests/core/synthetic-gtfs-validator.test.ts`
- `tests/core/synthetic-gtfs-draft.test.ts`
- `tests/core/synthetic-gtfs-compiler.test.ts`
- `tests/core/transit-comparison.test.ts`
- `tests/main/motis-sidecar.test.ts`

---

### Task 1: Synthetic 모델과 기존 프로젝트 자료 연결

**Implementation status:** 완료 — provenance-aware adapter, 경로 선택, loop/reverse 방향 가정을 구현하고 단위 테스트로 검증했다.

**목적:** 현재 앱이 이미 보유한 노선·정류장·운행 기준을 Synthetic GTFS 기능의 입력으로 안전하게 표현한다. 이 단계에서는 UI나 GTFS 파일을 만들지 않고 순수 타입과 변환 함수만 추가한다.

**Files:**
- Create: `src/core/synthetic-gtfs/types.ts`
- Create: `src/core/synthetic-gtfs/provenance.ts`
- Create: `src/core/synthetic-gtfs/source-adapter.ts`
- Create: `src/core/synthetic-gtfs/index.ts`
- Test: `tests/core/synthetic-gtfs-types.test.ts`
- Reference: `src/shared/types.ts`

**Interfaces:**

```ts
export type SyntheticSourceType = 'OFFICIAL' | 'USER_INPUT' | 'OSM_INFERRED' | 'MODEL_ESTIMATED' | 'DERIVED';
export type SyntheticConfidence = 'high' | 'medium' | 'low';

export interface SyntheticProvenance {
  sourceType: SyntheticSourceType;
  sourceName?: string;
  confidence: SyntheticConfidence;
  isInferred: boolean;
  modelVersion?: string;
  assumptions: string[];
}

export interface SyntheticStop {
  stopId: string;
  stopName: string;
  latitude: number;
  longitude: number;
  stopSequence: number;
  timepoint: boolean;
  provenance: SyntheticProvenance;
}

export interface SyntheticServicePlan {
  serviceId: string;
  serviceDays: number[];
  firstDeparture: string;
  lastDeparture: string;
  departureCount?: number;
  headwayMinutes?: number;
  timeBands?: SyntheticTimeBand[];
  sourceType: 'OFFICIAL' | 'USER_INPUT' | 'INFERRED';
  provenance: SyntheticProvenance;
}

export interface SyntheticTimeBand {
  startTime: string;
  endTime: string;
  departureCount?: number;
  headwayMinutes?: number;
  weight?: number;
}

export interface SyntheticDirection {
  directionId: string;
  directionLabel: string;
  stops: SyntheticStop[];
  servicePlans: SyntheticServicePlan[];
  provenance: SyntheticProvenance;
}

export interface SyntheticRoute {
  routeId: string;
  routeName: string;
  transportMode: 'BUS' | 'COACH';
  directions: SyntheticDirection[];
  provenance: SyntheticProvenance;
}

export interface SyntheticSourceAdapterOptions {
  agencyId: string;
  agencyName: string;
  serviceDays: number[];
  firstDeparture: string;
  lastDeparture: string;
  departureCountByRoute: Record<string, number>;
  sourceName: string;
  deriveReverseDirection: boolean;
}

export function adaptRouteMasterToSynthetic(
  routeStops: RouteStopMasterRecord[],
  serviceConfigs: RouteServiceConfig[],
  options: SyntheticSourceAdapterOptions
): SyntheticRoute[];
```

- [ ] **Step 1: Write failing tests** for valid route grouping, sequence ordering, invalid coordinates, missing service configuration, and derived reverse direction provenance.
- [ ] **Step 2: Run the focused test** with `npm test -- tests/core/synthetic-gtfs-types.test.ts`; confirm failures identify missing adapter exports or validation behavior.
- [ ] **Step 3: Implement the types, provenance helpers, and adapter** without changing the existing route analysis code. The adapter must mark a generated reverse direction as `DERIVED` with a low confidence and an explicit assumption.
- [ ] **Step 4: Run the focused test and typecheck** with `npm test -- tests/core/synthetic-gtfs-types.test.ts` and `npm run typecheck`.
- [ ] **Step 5: Gate 1 preparation check**: run the adapter against `fixtures/yeosu-route-station-master-sample.dat` after parsing it through the existing route master functions and verify that the returned model lists every route and preserves stop order.

**Deliverable:** a typed, provenance-aware Synthetic model that can consume the project’s existing route master data.

---

### Task 2: 방향별 운행계획 생성기

**Implementation status:** 완료 — endpoint/count/headway/time-band 합성 및 경고를 구현했다.

**목적:** 첫차·막차·운행횟수, 고정 배차간격, 시간대별 횟수·가중치를 동일한 출발시각 배열로 변환한다.

**Files:**
- Create: `src/core/synthetic-gtfs/schedule-synthesizer.ts`
- Test: `tests/core/synthetic-gtfs-schedule.test.ts`
- Modify: `src/core/synthetic-gtfs/types.ts` only if the output type needs to be declared before implementation

**Interfaces:**

```ts
export interface SynthesizedDeparture {
  serviceId: string;
  directionId: string;
  departureTime: string;
  sourceType: 'OFFICIAL' | 'USER_INPUT' | 'INFERRED';
}

export interface ScheduleSynthesisResult {
  departures: SynthesizedDeparture[];
  warnings: string[];
}

export function synthesizeSchedule(
  directionId: string,
  plan: SyntheticServicePlan
): ScheduleSynthesisResult;
```

- [ ] **Step 1: Write failing tests** for count 5 including both endpoints, count 1, fixed headway, invalid count/headway, time-band total preservation, and weighted integer allocation.
- [ ] **Step 2: Run `npm test -- tests/core/synthetic-gtfs-schedule.test.ts`** and confirm the new function is absent or failing.
- [ ] **Step 3: Implement time parsing in service-day minutes** so `24:00` is supported, count-based plans use `count - 1` intervals, and invalid plans return no departures plus a blocking warning.
- [ ] **Step 4: Implement time-band allocation** using largest-remainder distribution, preserving the requested total number of trips and returning a warning when band boundaries overlap or leave gaps.
- [ ] **Step 5: Run focused tests and `npm run typecheck`**.

**Deliverable:** deterministic direction-level departures with explicit warnings and no silent interpretation of invalid operating assumptions.

---

### Task 3: 정류장 간 예상 운행시간 모델

**Implementation status:** 완료 — 기본 모델과 명시적 자동차시간 fallback을 분리했다.

**목적:** OSM route result가 제공하는 거리·도로유형과 정류장 정보를 이용해 재현 가능한 구간시간을 만든다. 실제 교통시간 모델이 아닌 baseline임을 명확히 기록한다.

**Files:**
- Create: `src/core/synthetic-gtfs/travel-time-estimator.ts`
- Test: `tests/core/synthetic-gtfs-travel-time.test.ts`

**Interfaces:**

```ts
export type SyntheticRoadClass = 'residential' | 'tertiary' | 'secondary' | 'primary' | 'trunk' | 'motorway' | 'unknown';

export interface SegmentTravelInput {
  fromStopId: string;
  toStopId: string;
  distanceMeters: number;
  roadClass: SyntheticRoadClass;
  intersectionCount: number;
  turnCount: number;
  dwellSecondsAtFromStop: number;
}

export interface TravelTimeParameters {
  modelVersion: string;
  speedsKph: Record<SyntheticRoadClass, number>;
  intersectionDelaySeconds: number;
  turnDelaySeconds: number;
  minimumSegmentSeconds: number;
}

export interface SegmentTravelEstimate {
  fromStopId: string;
  toStopId: string;
  travelSeconds: number;
  provenance: SyntheticProvenance;
}

export function estimateSegmentTravelTimes(
  segments: SegmentTravelInput[],
  parameters: TravelTimeParameters
): SegmentTravelEstimate[];
```

- [ ] **Step 1: Write failing tests** for road-class speed, dwell addition, intersection/turn delay, minimum time clamp, and invalid distance.
- [ ] **Step 2: Run `npm test -- tests/core/synthetic-gtfs-travel-time.test.ts`** and confirm failure.
- [ ] **Step 3: Implement the deterministic estimator** with rounded integer seconds and provenance containing `MODEL_ESTIMATED`, `modelVersion`, and all non-default assumptions.
- [ ] **Step 4: Add a separately named fallback function** `estimateFromCarDuration(carSeconds, busFactor, dwellSeconds)` that is never called by the default estimator and records the fallback parameter in provenance.
- [ ] **Step 5: Run focused tests and `npm run typecheck`**.

**Deliverable:** a reproducible baseline travel-time layer that does not confuse route geometry with schedule timing.

---

### Task 4: GTFS Compiler와 Validator

**Implementation status:** 완료 — 9개 파일, 차단 오류/경고, provenance와 MOTIS config를 생성한다.

**목적:** 정규화 모델·출발시각·구간시간을 MOTIS가 읽을 수 있는 최소 파일 세트와 provenance/validation manifest로 컴파일한다. 이것이 Gate 1의 핵심 backend deliverable이다.

**Files:**
- Create: `src/core/synthetic-gtfs/gtfs-compiler.ts`
- Create: `src/core/synthetic-gtfs/validator.ts`
- Test: `tests/core/synthetic-gtfs-validator.test.ts`
- Test: `tests/core/synthetic-gtfs-compiler.test.ts`

**Interfaces:**

```ts
export interface SyntheticGtfsBuildInput {
  agencyId: string;
  agencyName: string;
  routes: SyntheticRoute[];
  travelTimesByDirection: Record<string, SegmentTravelEstimate[]>;
  scheduleByDirection: Record<string, ScheduleSynthesisResult>;
  startDate: string;
  endDate: string;
  shapeMode: 'missing';
}

export interface GtfsFileSet {
  'agency.txt': string;
  'stops.txt': string;
  'routes.txt': string;
  'trips.txt': string;
  'stop_times.txt': string;
  'calendar.txt': string;
  'tap-motis-config.json': string;
  'tap-provenance.json': string;
  'tap-validation.json': string;
}

export interface ValidationReport {
  blockingErrors: string[];
  warnings: string[];
  isValid: boolean;
}

export interface SyntheticGtfsBuildResult {
  files: GtfsFileSet;
  validation: ValidationReport;
  summary: { routeCount: number; stopCount: number; tripCount: number; estimatedFieldCount: number };
}

export function validateSyntheticGtfs(input: SyntheticGtfsBuildInput): ValidationReport;
export function compileSyntheticGtfs(input: SyntheticGtfsBuildInput): SyntheticGtfsBuildResult;
```

- [ ] **Step 1: Write failing validator tests** for missing routes/stops, invalid stop sequence, time reversal, empty service days, user-input warning, and `shapeMode: 'missing'` config.
- [ ] **Step 2: Run `npm test -- tests/core/synthetic-gtfs-validator.test.ts`** and confirm failure.
- [ ] **Step 3: Implement validation** with blocking errors separated from review warnings; every user or inferred field must contribute to the warning/provenance summary.
- [ ] **Step 4: Write failing compiler tests** that assert exact headers and representative rows for all required files, endpoint departure times, accumulated stop times, `timepoint` values, and `tap-provenance.json` content.
- [ ] **Step 5: Run `npm test -- tests/core/synthetic-gtfs-compiler.test.ts`** and confirm failure before implementation.
- [ ] **Step 6: Implement CSV escaping, deterministic row ordering, GTFS time formatting, and accumulated stop times. Generate `tap-motis-config.json` with `street_routing: true`, `with_shapes: true`, and `route_shapes.mode: 'missing'`.
- [ ] **Step 7: Run both focused test files and `npm run typecheck`**.

**Deliverable:** deterministic Synthetic GTFS file set with explicit validation, provenance, and MOTIS shape-generation configuration.

---

### Task 5: Gate 1 사용자 화면과 ZIP 내보내기

**Implementation status:** 완료 — Browser fallback과 Electron save dialog를 포함한다.

**목적:** 사용자가 기존 프로젝트의 노선자료를 선택하고 운행 가정을 입력한 뒤, 생성 결과를 눈으로 확인하고 ZIP으로 저장할 수 있게 한다.

**Files:**
- Create: `src/renderer/SyntheticGtfsBuilder.tsx`
- Create: `src/main/synthetic-gtfs-export.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/env.d.ts`
- Test: existing core compiler tests plus manual Electron verification

**Interfaces:**

```ts
export interface SyntheticGtfsExportApi {
  exportSyntheticGtfs: (payload: { fileName: string; files: GtfsFileSet }) => Promise<boolean>;
}
```

- [ ] **Step 1: Add the preload and environment types** for `exportSyntheticGtfs`, preserving the browser-only fallback behavior used by existing project storage.
- [ ] **Step 2: Add the main-process handler** that opens a save dialog, creates a JSZip archive from the file set, and returns `false` on cancel without writing a partial file.
- [ ] **Step 3: Add the Builder screen** with route selection, direction selection, service days, first departure, last departure, departure count, baseline model parameters, and a “분석용 GTFS 생성” action.
- [ ] **Step 4: Render a result summary** containing route count, stop count, trip count, estimated-field count, blocking errors, warnings, source labels, and the exact Synthetic-data disclaimer.
- [ ] **Step 5: Add a browser fallback download** using a Blob when `window.transitDesktop` is unavailable, so `npm run dev` can validate the same output without Electron IPC.
- [ ] **Step 6: Run `npm run typecheck`, `npm test`, and `npm run build`**.
- [ ] **Step 7: Gate 1 user verification**: launch with `npm run dev`, open a project containing `fixtures/yeosu-route-station-master-sample.dat`, open Synthetic GTFS Builder, generate a route with 06:00–23:00 and 60 departures, confirm the summary says 60 trips per selected direction, inspect the warnings/provenance, export `synthetic-gtfs.zip`, and inspect that the archive contains all named files.
- [ ] **Step 8: Stop and request user acceptance**. Do not begin MOTIS sidecar work until the user confirms the generated package and displayed assumptions are acceptable.

**Deliverable:** first user-visible feature: project route data plus assumptions become a downloadable, inspectable Synthetic GTFS package.

---

### Task 6: MOTIS Sidecar 연결 및 Gate 2

**Implementation status:** 구현 완료 — 셸 없는 process lifecycle, readiness polling, HTTP wrapper, `config → import → server` 준비 흐름과 actionable diagnostics를 연결했다. 실제 Gate 2는 사용자 MOTIS binary와 OSM PBF가 필요한 외부 실증 항목이다.

**목적:** 사용자가 제공한 Windows MOTIS executable과 OSM PBF를 앱에서 안전하게 실행하고, 생성 패키지를 실제 MOTIS에 전달해 readiness와 routing 결과를 확인한다.

**Files:**
- Create: `src/main/motis-sidecar.ts`
- Create: `tests/main/motis-sidecar.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/env.d.ts`
- Modify: `src/renderer/SyntheticGtfsBuilder.tsx`
- Modify: `scripts/package-win.mjs`

**Interfaces:**

```ts
export interface MotisSidecarOptions {
  executablePath: string;
  dataDirectory: string;
  port: number;
  args: string[];
  healthPath: string;
  startupTimeoutMs: number;
}

export interface MotisStatus {
  state: 'stopped' | 'starting' | 'ready' | 'failed';
  baseUrl?: string;
  message?: string;
}

export class MotisSidecar {
  start(options: MotisSidecarOptions): Promise<MotisStatus>;
  request<T>(path: string, init?: RequestInit): Promise<T>;
  stop(): Promise<void>;
}
```

- [ ] **Step 1: Write unit tests** with a fake child process for spawn arguments, readiness timeout, non-zero exit, request failure, and idempotent stop.
- [ ] **Step 2: Run `npm test -- tests/main/motis-sidecar.test.ts`** and confirm failure.
- [ ] **Step 3: Implement process lifecycle** with explicit executable/config paths, port collision handling, stdout/stderr diagnostics, timeout, and guaranteed stop on app quit.
- [ ] **Step 4: Verify the installed MOTIS distribution’s command and health endpoint** against the actual executable before wiring a default argument list; store the verified values in an app-local sidecar configuration rather than guessing them.
- [ ] **Step 5: Add a “MOTIS 상태 확인” action** to the Builder and show failed executable path, missing OSM PBF, timeout, and HTTP errors as actionable messages.
- [ ] **Step 6: Run `npm run typecheck`, `npm test`, and `npm run build`**.
- [ ] **Step 7: Gate 2 user verification**: place the agreed MOTIS Windows binary and regional OSM PBF in the documented local data directory, start the app, generate the Gate 1 package, start MOTIS, confirm status `ready`, run a sample OD, and verify the app reports either a journey or a precise no-route/error response.
- [ ] **Step 8: Stop and request user acceptance** before shape-quality work.

**Deliverable:** real local MOTIS process with visible status and reproducible failure diagnostics.

---

### Task 7: BUS shape 품질·시간 추정 검증과 Gate 3

**Implementation status:** 구현 완료 — beeline rate, detour ratio, raw metric과 경고 판정을 제공한다. 실제 형상 품질 수집은 MOTIS 응답/실증 데이터가 필요하다.

**목적:** MOTIS BUS shape 자동 생성의 실제 품질을 측정하고, beeline·정류장 매칭 실패·과도한 우회·추정 운행시간을 사용자에게 보여준다.

**Files:**
- Create: `src/core/synthetic-gtfs/shape-quality.ts`
- Create: `tests/core/synthetic-gtfs-shape-quality.test.ts`
- Modify: `src/renderer/SyntheticGtfsBuilder.tsx`
- Modify: `src/renderer/styles.css`

**Interfaces:**

```ts
export interface ShapeQualityInput {
  routeId: string;
  stopCount: number;
  routedSegments: number;
  beelinedSegments: number;
  routeDistanceMeters: number;
  stopToStopDistanceMeters: number;
}

export interface ShapeQualityReport {
  needsReview: boolean;
  warnings: string[];
  beelineRate: number;
  detourRatio: number;
}

export function assessShapeQuality(input: ShapeQualityInput): ShapeQualityReport;
```

- [ ] **Step 1: Write failing tests** for zero beeline, non-zero beeline, excessive detour, and missing segment counts.
- [ ] **Step 2: Implement quality thresholds** as named parameters and include the raw metrics in the report.
- [ ] **Step 3: Run focused tests and typecheck**.
- [ ] **Step 4: Gate 3 verification**: use 20–50 real or representative routes, record route-level shape results, inspect at least one ordinary route, one BUS-restricted route, one one-way route, and one failed/beelined route.
- [ ] **Step 5: Stop and request user acceptance** of the displayed quality warnings and whether the baseline estimator is useful enough for comparison.

**Deliverable:** measurable shape/estimate quality report rather than an unqualified generated route.

---

### Task 8: Before / After Scenario와 상세 여정 비교

**Implementation status:** 구현 완료 — Scenario Delta 저장, v6 itinerary 정규화, 원인별 델타와 무경로 보호, Builder 비교 UI를 연결했다.

**목적:** Base + Scenario Delta로 Before/After GTFS를 만들고, 동일 OD·출발시각의 MOTIS 여정을 비교한다.

**Files:**
- Create: `src/core/transit-comparison.ts`
- Create: `tests/core/transit-comparison.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`

**Interfaces:**

```ts
export interface NormalizedJourneyLeg {
  mode: string;
  routeId?: string;
  boardStopId?: string;
  alightStopId?: string;
  rideSeconds: number;
  waitSeconds: number;
  walkSeconds: number;
  walkMeters: number;
}

export interface NormalizedJourney {
  found: boolean;
  totalSeconds: number;
  accessWalkSeconds: number;
  egressWalkSeconds: number;
  initialWaitSeconds: number;
  transferWaitSeconds: number;
  transferWalkSeconds: number;
  transferCount: number;
  inVehicleSeconds: number;
  walkMeters: number;
  legs: NormalizedJourneyLeg[];
  warnings: string[];
}

export interface JourneyComparison {
  before: NormalizedJourney;
  after: NormalizedJourney;
  delta: Omit<NormalizedJourney, 'legs' | 'warnings' | 'found'>;
  causeBreakdown: Record<string, number>;
  warnings: string[];
}

export function compareJourneys(before: NormalizedJourney, after: NormalizedJourney): JourneyComparison;
```

- [ ] **Step 1: Write failing tests** for no-route on one side, total-time delta, wait/ride/walk cause decomposition, transfer count change, and warning propagation from Synthetic inputs.
- [ ] **Step 2: Implement the pure comparison function** and ensure missing journeys are never converted into zero-minute improvements.
- [ ] **Step 3: Add Scenario Delta serialization** to the project manifest without modifying Base route records.
- [ ] **Step 4: Add the comparison screen** with total time, in-vehicle, initial wait, transfer wait/walk, transfer count, access/egress walk, and provenance warnings.
- [ ] **Step 5: Run `npm test`, `npm run typecheck`, and `npm run build`**.
- [ ] **Step 6: Gate 4 verification**: change `A-B-C-D-E` to `A-B-X-Y-E`, run the same OD at the same departure time in both scenarios, and confirm route legs and every displayed delta match the test fixture.
- [ ] **Step 7: Stop and request user acceptance** before batch analysis.

**Deliverable:** user-visible route-change scenario comparison with decomposed causes and no false zero-route result.

---

### Task 9: 시간창 반복, one-to-many benchmark, 후속 엔진 판단

**Implementation status:** 구현 완료 — 시간창 샘플링, mean/median/P90, 무경로 수와 진행 표시, 벤치마크 기록 양식을 추가했다. 실제 규모 판단은 제공된 지역 데이터로 측정해야 한다.

**목적:** 단일 출발시각 편향을 제거하고 실제 필요한 분석 규모에 MOTIS가 충분한지 측정한다.

**Files:**
- Create: `src/core/transit-batch.ts`
- Create: `tests/core/transit-batch.test.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Create: `docs/benchmarks/motis-batch-template.md`

**Interfaces:**

```ts
export interface DepartureWindow {
  startTime: string;
  endTime: string;
  intervalMinutes: number;
}

export interface BatchSummary {
  sampleCount: number;
  foundBefore: number;
  foundAfter: number;
  meanTotalSecondsBefore: number | null;
  meanTotalSecondsAfter: number | null;
  medianTotalSecondsBefore: number | null;
  medianTotalSecondsAfter: number | null;
  p90TotalSecondsBefore: number | null;
  p90TotalSecondsAfter: number | null;
  warnings: string[];
}

export function summarizeJourneyWindow(comparisons: JourneyComparison[]): BatchSummary;
```

- [ ] **Step 1: Write failing tests** for 5-minute sampling, mean/median/P90, no-route exclusion, and warning aggregation.
- [ ] **Step 2: Implement batch summary** with explicit sample counts and no-route counts.
- [ ] **Step 3: Add a batch run screen** that shows progress, elapsed time, sample count, and summary statistics.
- [ ] **Step 4: Run the benchmark matrix** for 100 origins × 100 destinations × 24 departure times × Before/After and record wall time, OD/sec, CPU, peak RAM, and result size in `docs/benchmarks/motis-batch-template.md`.
- [ ] **Step 5: Decide from measured evidence** whether MOTIS alone is sufficient or an R5 adapter is justified; do not add R5 before this benchmark.
- [ ] **Step 6: Run `npm test`, `npm run typecheck`, and `npm run build`**.
- [ ] **Step 7: Gate 5 verification**: user reviews summary statistics and benchmark report; only then start fare engine, frequency output, or R5 work.

**Deliverable:** evidence-backed scale decision and time-window analysis, not a guessed performance architecture.

---

## Self-Review Checklist

- [ ] The plan covers the spec’s input normalization, provenance, schedule synthesis, travel-time separation, GTFS validation, sidecar boundary, Before/After comparison, time-window sampling, and performance decision.
- [ ] Each user-visible Gate has a concrete environment and scenario and ends with a user acceptance stop.
- [ ] No task depends on an undefined function or type; interfaces are introduced before consumers.
- [ ] Invalid data produces blocking errors or explicit warnings; no silent fallback is specified.
- [ ] The current project’s route master, service configuration, IPC, project storage, and build commands are the integration points.
- [ ] The plan does not require a MOTIS binary or OSM PBF to complete Gate 1; those external artifacts begin at Gate 2.
- [ ] No unrelated refactoring of existing demand, OD, station, or congestion analysis is included.

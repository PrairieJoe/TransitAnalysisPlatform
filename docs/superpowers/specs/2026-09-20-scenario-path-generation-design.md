# 시나리오 실제 경로 생성·저장 설계

## 목적

1단계에서 저장한 다중 노선 `ScenarioDefinition`을 실행 가능한 네트워크 상태로 변환한다. 노선의 After 정류장 순서와 운행조건을 사용해 실제 도로 경로, 구간 거리, 예상 운행시간, 운행정보를 생성하고 재현 가능한 실행 결과로 저장한다.

이번 단계의 결과는 이후 현행↔시나리오 및 시나리오↔시나리오 비교가 읽을 수 있는 경로 실행 결과다. 수요 재배분, 요금 계산, 비교 결과 화면은 다음 단계로 남긴다.

## 사용자 요구와 단계 범위

### 이번 단계에서 해결하는 것

- 저장된 시나리오의 여러 노선 변경을 한 번의 실행 단위로 처리한다.
- 각 변경 노선의 Before/After 정류장 구성과 운행조건을 사용한다.
- 변경되지 않은 노선은 현행 노선정보로 네트워크에 포함한다.
- MOTIS BUS 도로 경로를 이용해 정류장 간 geometry를 생성한다.
- 구간별 거리, 예상 운행시간, 전체 연장, 운행조건을 저장한다.
- 실제 도로 경로와 fallback 추정 경로를 결과에서 구분한다.
- 동일한 입력·환경으로 재실행한 결과를 식별하고 기존 결과를 중복 생성하지 않는다.

### 이번 단계에서 해결하지 않는 것

- 교통카드 수요의 노선·정류장 재배분
- 현행↔시나리오 또는 시나리오↔시나리오 비교 결과 화면
- 요금 계산
- 최적 경로 탐색 또는 승객별 경로 선택
- 새로운 프로젝트 schema version으로의 일괄 마이그레이션
- 기존 단일 노선 Synthetic GTFS/MOTIS 실행 흐름의 제거

## 실행 대상의 의미

후속 분석은 동일한 대상 식별자를 사용한다.

- `current`: 프로젝트에 저장된 현행 노선 master와 현행 운행정보
- `scenario:{scenarioId}`: 현행 네트워크에 해당 시나리오의 After 변경을 적용한 상태

`ScenarioDefinition`의 Before/After는 시나리오 내부 검증과 실행 결과 설명을 위한 두 snapshot이다. 실행 결과는 두 snapshot을 모두 저장한다.

- Before snapshot: 변경 노선은 `baseStopIds`와 `beforeOperation`, 미변경 노선은 현행 정보
- After snapshot: 변경 노선은 `scenarioStopIds`와 `afterOperation`, 미변경 노선은 현행 정보

따라서 하나의 시나리오에 A·B·C 노선 변경이 함께 있으면 세 노선과 미변경 노선을 포함한 전체 네트워크가 같은 실행 결과에 포함된다. 이후 비교에서 `scenario:{scenarioId}`는 이 결과의 After snapshot을 사용한다.

## 제안 아키텍처

```text
ProjectManifest
  ├─ routeStopMaster + routeServiceConfigs
  └─ scenarioDefinitions
          ↓ select target + materialize network
Scenario execution core
  ├─ Before/After 전체 노선 snapshot 생성
  ├─ 정류장 pair별 MOTIS BUS 경로 요청
  ├─ geometry 검증·거리 계산
  ├─ travelTimeModel 기반 구간 운행시간 추정
  └─ 실행 manifest/result 생성
          ↓ main-process artifact boundary
Project store
  ├─ scenario-execution manifest metadata
  └─ versioned execution result JSON
```

### 책임 경계

- `src/core/scenario-execution.ts`: 순수한 target materialization, 입력 fingerprint, 실행 결과 조립
- `src/core/route-shape.ts`: MOTIS BUS 경로 요청과 geometry 검증을 재사용하되, fallback 여부를 호출자가 구분할 수 있게 확장
- `src/core/synthetic-gtfs/*`: 여러 노선 snapshot의 Synthetic GTFS 생성에 재사용
- `src/main/project-store.ts`: 실행 manifest와 큰 geometry 결과 artifact의 원자적 저장·조회
- `src/main/*` / `src/preload/*`: renderer가 직접 파일을 다루지 않도록 실행·저장 IPC 경계 제공
- `src/renderer/*`: 저장된 ScenarioDefinition 선택, 실행 시작, 진행상태·품질·저장 결과 표시

기존 `scenarioDefinitions` metadata와 기존 `scenarioDeltas`는 유지한다. 실행 결과는 정의 자체에 geometry를 덧붙여 덮어쓰지 않고 별도 execution artifact로 저장한다.

## 실행 데이터 모델

### `ScenarioExecutionTarget`

```ts
export type ScenarioExecutionTarget =
  | { kind: 'current' }
  | { kind: 'scenario'; scenarioId: string };
```

문자열을 직접 비교하지 않고 구조화된 target을 사용해 현행과 시나리오를 혼동하지 않는다.

### `ScenarioExecutionManifest`

manifest는 프로젝트 metadata에 저장한다.

```ts
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
```

`ProjectManifest`에는 optional `scenarioExecutionManifests`를 추가한다. 기존 프로젝트는 빈 배열로 간주하고 schema version은 올리지 않는다.

### `ScenarioExecutionResult`

full result는 프로젝트 디렉터리의 versioned JSON artifact에 저장한다.

```ts
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
```

`ScenarioOperationPlan`은 기존 계약을 그대로 사용하며, 실행 결과에 geometry·거리·runtime만 추가한다.

## 경로 생성 규칙

1. target과 scenario definition을 검증한다.
2. Before/After 각각 전체 route master를 materialize한다.
3. 변경 노선은 해당 snapshot의 정류장 순서와 운행조건을 사용한다.
4. 미변경 노선은 현행 대표 경로와 현행 운행정보를 사용한다.
5. 각 방향의 인접 정류장 pair에 대해 MOTIS `/api/route` BUS 요청을 보낸다.
6. 응답 geometry가 정류장 endpoint와 연결되는지, 좌표 범위와 연속성이 유효한지 검증한다.
7. geometry의 실제 point 길이로 구간 거리를 계산하고 `travelTimeModel`로 예상 운행시간을 산출한다.
8. 역방향 파생이 활성화된 경우에만 reverse 방향을 생성한다.
9. 모든 구간이 OSM 경로이면 해당 방향을 `complete`로 표시한다.
10. 하나라도 fallback 또는 경로 오류가 있으면 해당 방향과 네트워크를 `partial`로 표시한다. fallback geometry는 저장할 수 있지만 실제 도로 경로로 표시하거나 `complete` 결과로 사용하지 않는다.

현재 `ProjectManifest`에는 모든 현행 노선의 첫차·막차·배차간격·정차시간을 보장하는 공통 운행계획이 없다. 따라서 미변경 노선의 운행조건은 다음 우선순위를 따른다.

1. 프로젝트에 향후 추가될 명시적 현행 운행계획
2. `routeServiceConfigs`에서 얻는 차량·시간대 정보와 프로젝트 기본 Synthetic 운행조건의 조합
3. 위 정보가 없으면 실행을 `partial`로 만들고 `MODEL_ESTIMATED` 가정과 경고를 저장

이 기본값을 공식 현행 운행정보로 표시하지 않는다. 변경 노선의 Before/After 운행조건은 ScenarioDefinition에 저장된 값을 우선한다.

기존 `fetchRouteShapes`가 제공하는 직선 fallback은 지도 화면 호환성을 위해 유지할 수 있다. 다만 실행 결과의 `source: 'beeline'`과 warning을 반드시 보존하고, 저장 성공 메시지에 실제 경로가 아닌 추정 구간이 포함되었음을 표시한다.

## 운행정보 산출

각 route execution에는 다음을 저장한다.

- 운행요일
- 첫차·막차
- 배차간격
- 운행대수
- 정차시간
- 서비스 시작일·종료일
- 역방향 파생 여부
- 총 노선 연장
- 방향별·구간별 예상 운행시간
- 생성된 운행횟수와 검증 warning

운행시간은 실제 운행실적이 아니라 `travelTimeModel`과 생성 geometry에서 계산한 추정값이다. 공식 시간표나 실측값이 없는 경우 provenance에 `MODEL_ESTIMATED`와 모델 버전을 기록한다.

## 저장과 재실행

### 저장 경계

- renderer는 실행 요청만 보낸다.
- main process는 `projectId`와 `executionId`를 검증한다.
- `project-state.json`에는 manifest만 원자적으로 갱신한다.
- full result는 `scenario-executions/<executionId>.json`에 임시 파일 후 rename 방식으로 저장한다.
- manifest와 artifact 중 하나만 성공한 경우 실행을 `failed`로 남기고 orphan artifact를 다음 정리 시 제거할 수 있게 한다.

### 중복 실행 방지

`current` target은 별도 scenario definition이 없으므로 Before와 After snapshot에 같은 현행 네트워크를 넣는다. 시나리오 target은 ScenarioDefinition의 Before/After snapshot을 사용한다.

`inputFingerprint`는 다음 입력을 정규화해 계산한다.

- target
- project route master와 service configs
- scenario definition의 `updatedAt` 및 route changes
- OSM PBF SHA-256
- MOTIS 버전·profile
- travel time model

같은 target과 fingerprint가 이미 `complete`이면 기존 execution을 재사용한다. fingerprint가 바뀌면 새 `executionId`를 만들고 기존 결과는 삭제하지 않는다.

### 호환성

- 기존 `scenarioDeltas`는 삭제·변환하지 않는다.
- 기존 `ScenarioDefinition`의 `scenarioSchemaVersion`은 변경하지 않는다.
- 새 manifest/artifact가 없는 프로젝트도 current 화면과 기존 GTFS 흐름을 사용할 수 있다.
- 손상된 artifact는 manifest의 `failed` 상태로 표시하고 다시 생성할 수 있다.

## 오류 처리와 품질 표시

- scenario ID가 없거나 저장된 정의가 계약 검증에 실패하면 실행하지 않는다.
- route master에 없는 After 정류장 ID는 실행 전에 거부한다.
- MOTIS가 준비되지 않았거나 PBF가 fingerprint와 일치하지 않으면 실행하지 않는다.
- 일부 route만 성공하면 전체 결과를 `partial`로 저장하고 성공·실패 route와 warning을 함께 표시한다.
- 모든 route가 실패하면 artifact를 유효한 결과로 표시하지 않고 `failed` manifest만 남긴다.
- beeline fallback은 geometry 데이터에 포함할 수 있지만 “실제 도로 경로 생성 완료”라는 문구를 사용하지 않는다.

## 화면 흐름

기존 `ScenarioDefinitionEditor` 저장 패널 아래에 실행 패널을 추가한다.

1. 저장된 시나리오 선택
2. 실행 환경 확인: MOTIS 상태, OSM PBF, fingerprint
3. Before/After 전체 노선 생성 시작
4. 노선·방향별 진행상태와 경고 표시
5. 결과 요약 표시: 성공/부분성공/실패, 노선 수, 실제 경로 구간 수, fallback 구간 수, 연장, 예상 runtime
6. 실행 결과 저장 및 동일 입력 재사용

이번 화면에서는 수요 변화나 X→Y 비교 결과를 표시하지 않는다. 실행 결과를 저장한 뒤 다음 비교 단계에서 `current`와 `scenario:{scenarioId}`를 선택한다.

## 테스트 성공 기준

- 다중 노선 ScenarioDefinition을 Before/After 전체 네트워크로 materialize한다.
- 변경 노선은 After 정류장 순서와 After 운행조건을 사용하고, 미변경 노선은 현행 정보를 유지한다.
- static master path가 있으면 dated path보다 우선한다.
- MOTIS geometry가 유효하면 OSM source와 거리·runtime을 저장한다.
- MOTIS 실패·잘못된 geometry·fallback은 `partial` 또는 `failed`로 구분한다.
- 동일 fingerprint의 재실행은 새 artifact를 중복 생성하지 않는다.
- 다른 scenarioId 또는 환경 fingerprint는 독립 execution으로 저장된다.
- manifest와 artifact 재시작 round-trip이 유지된다.
- 기존 0.6.2 전체 테스트, `scenarioDefinitions` metadata 저장, `scenarioDeltas`, 단일 노선 Synthetic GTFS 흐름이 회귀 없이 통과한다.

## 브랜치 운영

- 설계·구현은 `codex/0.6.2-scenario-path-generation`에서 진행한다.
- 현재 개발 중인 메인 브랜치에는 통합하지 않는다.
- 0.6.2 메인 구축이 끝난 뒤 최신 메인에서 통합 검토를 수행한다.

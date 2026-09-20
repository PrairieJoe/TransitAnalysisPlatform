# 다중 노선 시나리오 공통 계약 설계

## 목적

기존 `ScenarioDelta`는 한 노선의 Before/After 정류장 차이만 표현한다. 이후 개발할 수요 재배분, 운행정보 비교, X→Y 여정 비교가 같은 시나리오를 읽고 재실행할 수 있도록, 하나의 시나리오가 여러 노선과 여러 정류장 변경을 함께 담는 공통 입력 계약을 추가한다.

이번 단계의 결과는 계산 결과를 새로 만드는 기능이 아니라, 이후 기능들이 공유할 수 있는 안정적인 시나리오 정의와 저장 경계다.

## 범위

포함:

- 하나의 시나리오 안에 여러 노선 변경을 저장한다.
- 각 노선 변경에 여러 정류장의 Before/After 순서를 저장한다.
- 각 노선의 Before/After 운행조건을 독립적으로 저장한다.
- 여러 OD·출발시각 질의를 시나리오 입력으로 저장할 수 있게 한다.
- 원천자료, 모델 버전, 가정, 경고를 저장한다.
- 기존 `ScenarioDelta`를 깨뜨리지 않고 호환용 변환 경계를 제공한다.
- 프로젝트 매니페스트가 선택적으로 시나리오 정의 목록을 보유할 수 있게 한다.

제외:

- 수요 재배분 계산
- 노선 연장·운행시간 계산
- MOTIS 실행 및 원시 응답 저장
- 요금 계산
- 시나리오 편집 화면과 결과 화면
- 전체 프로젝트 스키마 버전 변경

## 핵심 설계

시나리오 정의는 결과가 아니라 재실행 가능한 입력 레시피다. GTFS ZIP, MOTIS 원시 응답, 대규모 수요 결과는 저장하지 않고 이후 기능이 같은 입력으로 다시 생성한다.

```text
ProjectManifest
  └─ scenarioDefinitions[]
       ├─ scenario metadata
       ├─ routeChanges[]
       │    ├─ route A Before/After + operation plans
       │    ├─ route B Before/After + operation plans
       │    └─ route C Before/After + operation plans
       ├─ journeyQueries[]
       ├─ source/provenance
       └─ validation warnings
```

## 계약 모델

### ScenarioOperationPlan

한 노선 방향의 운행 가정을 재현하기 위한 값이다.

- `serviceDays: number[]`
- `firstDeparture: string`
- `lastDeparture: string`
- `headwayMinutes: number`
- `vehicleCount: number`
- `dwellSeconds: number`
- `startDate: string`
- `endDate: string`
- `deriveReverseDirection: boolean`
- `travelTimeModel`: `modelVersion`, `speedsKph`, `intersectionDelaySeconds`, `turnDelaySeconds`, `minimumSegmentSeconds`

Before와 After는 서로 다른 운행조건을 가질 수 있다. 현재 UI가 같은 값을 사용하더라도 저장 계약은 두 값을 분리한다.

### ScenarioRouteChange

시나리오에 포함되는 한 노선의 변경이다.

- `routeId: string`
- `routeName?: string`
- `transportMode?: string`
- `baseStopIds: string[]`
- `scenarioStopIds: string[]`
- `beforeOperation: ScenarioOperationPlan`
- `afterOperation: ScenarioOperationPlan`

정류장 추가·삭제·유지 목록은 저장 시 중복 원천을 만들지 않도록 `baseStopIds`와 `scenarioStopIds`에서 계산한다. 기존 `ScenarioDelta`가 필요할 때는 각 `ScenarioRouteChange`별로 파생한다.

### ScenarioJourneyQuery

시나리오를 재실행할 대표 여정 질의다.

- `originStopId: string`
- `destinationStopId: string`
- `departureDateTime: string`

배치 분석을 위해 한 시나리오에 여러 질의를 저장할 수 있다. 시간창 집계 설정은 이후 배치 분석 계약에서 확장한다.

### ScenarioProvenance

- `projectId?: string`
- `routeMasterSource?: string`
- `assumptions: string[]`
- `warnings: string[]`
- `modelVersions: string[]`

### ScenarioEnvironment

- `motisVersion?: string`
- `osmPbfFileName?: string`
- `osmPbfSha256?: string`

### ScenarioDefinition

- `scenarioSchemaVersion: 1`
- `scenarioId: string`
- `label: string`
- `routeChanges: ScenarioRouteChange[]`
- `journeyQueries?: ScenarioJourneyQuery[]`
- `source: ScenarioProvenance`
- `environment?: ScenarioEnvironment`
- `createdAt: string`
- `updatedAt: string`

`routeChanges`는 최소 1개여야 하며, 같은 `routeId`를 두 번 포함할 수 없다. 각 Before/After 경로는 최소 2개 정류장을 가져야 하고, 정류장 ID 중복은 차단 오류로 처리한다.

## 기존 데이터와의 호환

- 기존 `ScenarioDelta` 타입과 `ProjectManifest.scenarioDeltas`는 당장 제거하지 않는다.
- 새 `ProjectManifest.scenarioDefinitions?`를 선택 필드로 추가한다.
- 기존 프로젝트의 `scenarioDeltas`는 그대로 읽을 수 있어야 한다.
- 운행조건이 없는 기존 delta를 자동으로 완전한 `ScenarioDefinition`으로 승격하지 않는다. 승격할 때는 현재 사용자가 입력한 운행조건을 명시적으로 받아야 한다.
- 이번 단계에서는 `CURRENT_PROJECT_SCHEMA_VERSION`을 올리지 않는다. 시나리오 내부 버전으로 새 계약의 버전을 관리한다.

## 검증 규칙

- 시나리오 ID와 노선 ID는 비어 있지 않아야 한다.
- 노선 변경 목록은 1개 이상이어야 한다.
- 노선 ID는 시나리오 안에서 유일해야 한다.
- Before/After 정류장 목록은 각각 2개 이상이어야 한다.
- 정류장 ID는 각 경로 안에서 중복되지 않아야 한다.
- `serviceDays`는 비어 있지 않고 0~6 범위의 중복 없는 정수여야 한다.
- 첫차와 막차는 `HH:mm` 형식이며 첫차가 막차보다 늦지 않아야 한다.
- `headwayMinutes`와 `vehicleCount`는 1 이상의 정수여야 한다.
- `dwellSeconds`, 지연시간, 최소 구간시간은 0 이상의 정수여야 한다.
- `speedsKph`의 기준속도는 모두 0보다 커야 한다.
- 서비스 시작일과 종료일은 유효한 날짜이며 시작일이 종료일보다 늦지 않아야 한다.
- 여정 질의의 출발·도착 정류장 ID와 출발일시는 비어 있지 않아야 한다.
- 검증 실패는 저장 전에 차단하고, provenance 경고는 저장할 수 있다.

## 파일 경계

- `src/shared/types.ts`: 공유 계약 타입과 프로젝트 매니페스트 선택 필드
- `src/core/scenario-contract.ts`: 생성, 검증, delta 파생, 레거시 변환 순수 함수
- `tests/core/scenario-contract.test.ts`: 다중 노선·다중 정류장·검증·호환성 테스트
- `tests/main/project-store.test.ts`: 시나리오 정의가 metadata 저장 경계를 통과하는지 확인

이번 단계에서는 renderer의 입력 화면과 실제 저장 callback을 바꾸지 않는다. 후속 기능 브랜치가 이 계약을 사용해 UI·수요·운행정보·여정 실행을 연결한다.

## 성공 기준

1. 하나의 시나리오에 서로 다른 두 개 이상의 노선 변경을 담을 수 있다.
2. 각 노선은 서로 다른 수의 정류장과 서로 다른 Before/After 운행조건을 가질 수 있다.
3. 저장된 입력만으로 기존 Synthetic GTFS 생성기에 필요한 값을 복원할 수 있다.
4. 기존 `ScenarioDelta` 테스트와 프로젝트 저장 테스트가 회귀 없이 통과한다.
5. 잘못된 경로·중복 노선·잘못된 운행조건은 저장 전에 명확히 거부된다.

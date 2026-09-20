# 시나리오 실행 결과 비교 설계

## 목적

경로 생성·저장 단계에서 만든 `ScenarioExecutionResult`를 사용해 현행 및 여러 시나리오를 같은 기준으로 비교한다. 비교 대상은 다음 두 종류다.

- 노선·정류장·연장·운행정보의 구조적 변화
- 동일한 출발지·도착지·출발시각에 대한 MOTIS 여정 변화

이 단계의 결과는 이후 수요 재배분과 종합 보고서가 소비할 수 있는 비교 계약이다. 비교 과정에서 요금이나 수요 변화를 임의로 계산하지 않는다.

## 사용자 요구와 범위

### 이번 단계에서 해결하는 것

- `current`와 `scenario:{scenarioId}` 비교
- `scenario:{scenarioA}`와 `scenario:{scenarioB}` 비교
- 다수 노선의 정류장 구성·순서·경로 연장·예상 운행시간 비교
- 첫차·막차·배차간격·운행대수·정차시간·운행요일 비교
- X→Y 여정의 총 소요시간·차내시간·대기시간·도보시간·이용수단·환승횟수 비교
- Before/After 중 한쪽에 경로가 없을 때 false zero가 발생하지 않도록 보호
- 실제 경로·모델 추정·fallback 및 MOTIS 경고를 비교 결과에 전달
- OSM PBF·routing profile·travel-time model이 다른 결과의 비교 위험 표시

### 이번 단계에서 해결하지 않는 것

- 교통카드 수요의 노선·정류장 재배분
- 승객별 최적 경로 또는 수요 탄력성 추정
- 한국형 환승요금 계산
- 비교 결과를 새로운 project schema version으로 일괄 마이그레이션
- 실행 artifact에 모든 X→Y 질의 결과를 영구적으로 덧붙이는 것

요금은 이 단계에서 `unavailable` 상태로 명시한다. 금액을 0으로 넣거나 다른 값으로 추정하지 않는다.

## 비교 대상 의미

`ScenarioExecutionResult`의 `after` snapshot을 비교 대상 네트워크로 사용한다.

| 사용자 대상 | 비교에 사용하는 snapshot |
| --- | --- |
| `current` | current 실행 결과의 `after` |
| `scenario:{id}` | 해당 scenario 실행 결과의 `after` |

current 실행은 현재 네트워크를 Before와 After에 동일하게 넣기 때문에 어느 쪽을 사용해도 같은 의미지만, 모든 비교 대상의 규칙을 `after`로 통일한다.

시나리오 A와 B를 비교할 때는 두 실행 결과의 `after`를 비교한다. 각각의 `ScenarioDefinition`을 다시 Before 기준에 적용해 비교하지 않는다. 따라서 사용자가 저장·실행한 결과와 비교 결과가 일치한다.

## 제안 아키텍처

```text
Project route master + service configs + scenario definitions
                         │
                         ├─ load execution artifacts
                         │       └─ route/operation comparison
                         │
                         └─ materialize target networks
                                 └─ MOTIS journey query
                                         ↓
                           normalized journey comparison
                                         ↓
                         ScenarioComparisonResult
```

책임을 세 부분으로 나눈다.

- `src/core/scenario-comparison.ts`: 저장된 실행 결과만으로 계산 가능한 순수 비교. 노선 집합, 정류장 변화, 연장·runtime delta, 운행정보 delta, 품질 경고를 계산한다.
- 기존 `src/core/transit-comparison.ts`: MOTIS 원시 여정 정규화와 단일 여정 metric delta를 유지한다. 새 비교 계층은 `NormalizedJourney`와 `compareJourneys()`를 호출한다.
- renderer orchestration: 두 target의 artifact·환경을 확인하고, 필요한 경우 각 target network를 Synthetic GTFS로 만들어 동일 질의를 MOTIS에 보낸다. core 비교 함수는 Electron API나 파일시스템에 의존하지 않는다.

실행 결과에는 정류장 좌표와 전체 `RouteStopMasterRecord`가 저장되지 않는다. 그러므로 X→Y 질의를 새로 계산할 때 renderer orchestration은 현재 프로젝트의 route master·service configs·scenario definitions로 대상 network를 다시 materialize한다. 저장된 execution result는 실행 결과의 동일성·품질 검증과 노선 비교에 사용한다.

## 비교 계약

비교 계약은 `src/core/scenario-comparison.ts`에서 정의한다. 이름은 구현 중 조정할 수 있지만 의미와 null 정책은 유지한다.

```ts
export type ScenarioComparisonTarget =
  | { kind: 'current'; executionId: string; label: string }
  | { kind: 'scenario'; scenarioId: string; executionId: string; label: string };

export interface ScenarioEnvironmentComparison {
  comparable: boolean;
  warnings: string[];
  before: ScenarioExecutionEnvironment;
  after: ScenarioExecutionEnvironment;
}

export interface ScenarioOperationComparison {
  serviceDays: { before: number[] | null; after: number[] | null; changed: boolean };
  firstDeparture: { before: string | null; after: string | null; changed: boolean };
  lastDeparture: { before: string | null; after: string | null; changed: boolean };
  headwayMinutes: { before: number | null; after: number | null; delta: number | null; changed: boolean };
  vehicleCount: { before: number | null; after: number | null; delta: number | null; changed: boolean };
  dwellSeconds: { before: number | null; after: number | null; delta: number | null; changed: boolean };
  deriveReverseDirection: { before: boolean | null; after: boolean | null; changed: boolean };
}

export interface ScenarioRouteComparison {
  routeId: string;
  routeName: { before: string | null; after: string | null; changed: boolean };
  transportMode: { before: string | null; after: string | null; changed: boolean };
  beforeStopIds: string[];
  afterStopIds: string[];
  addedStopIds: string[];
  removedStopIds: string[];
  reordered: boolean;
  distanceMeters: { before: number | null; after: number | null; delta: number | null };
  runtimeSeconds: { before: number | null; after: number | null; delta: number | null };
  operation: ScenarioOperationComparison;
  status: 'complete' | 'partial' | 'missing';
  warnings: string[];
}

export interface ScenarioJourneyComparison {
  query: ScenarioJourneyQuery;
  before: NormalizedJourney;
  after: NormalizedJourney;
  journey: JourneyComparison;
  fare: {
    status: 'unavailable';
    amount: null;
    reason: string;
  };
}

export interface ScenarioComparisonResult {
  comparisonSchemaVersion: 1;
  before: ScenarioComparisonTarget;
  after: ScenarioComparisonTarget;
  environment: ScenarioEnvironmentComparison;
  routes: ScenarioRouteComparison[];
  journeys: ScenarioJourneyComparison[];
  warnings: string[];
}
```

`ScenarioExecutionResult`의 route total은 경로를 한 번만 나타내는 forward 기준 aggregate다. reverse 방향은 상세 결과에 남아 있으므로 비교 엔진은 route total을 forward 기준으로 비교하고, reverse 품질 경고는 route warning으로 전달한다.

## 노선·운행정보 비교 규칙

1. 양쪽 `after.routes`의 route ID 합집합을 정렬해 비교한다.
2. 한쪽에만 있는 route는 반대편 값을 `null`, 상태를 `missing`으로 둔다.
3. 정류장 변화는 순서를 보존한다.
   - `addedStopIds`: after에만 존재
   - `removedStopIds`: before에만 존재
   - `reordered`: 두 목록의 정류장 집합이 같고 순서가 다를 때 true
4. `totalDistanceMeters`와 `totalRuntimeSeconds`는 한쪽 값이 없으면 delta를 `null`로 둔다.
5. 운행정보는 동일 필드끼리 비교한다. 배열인 운행요일은 정렬 후 비교하고, 숫자 필드만 delta를 계산한다.
6. route 또는 snapshot이 `partial`·`failed`이면 결과의 warnings에 원래 warning을 포함한다. partial 값을 complete로 승격하지 않는다.
7. 공통 route가 양쪽에 있지만 한쪽 geometry가 fallback이면 route 비교는 가능하되, 품질 상태는 warning과 함께 유지한다.

정류장 ID가 같아도 좌표나 명칭이 바뀐 경우의 정류장 master 변화는 이 단계에서 별도 delta로 계산하지 않는다. route execution의 route·geometry 결과와 현재 route master의 조합을 다음 데이터 품질 단계에서 확장할 수 있다.

## X→Y 여정 비교 규칙

- 두 target에 같은 `originStopId`, `destinationStopId`, `departureDateTime`을 사용한다.
- 두 target의 MOTIS 응답은 기존 `normalizeMotisJourney()`로 정규화한다.
- `compareJourneys()`의 delta를 사용한다.
- Before 또는 After 중 하나가 `found: false`이면 모든 numeric delta는 `null`이다. 없는 여정을 0분으로 간주하지 않는다.
- 이용수단은 normalized legs의 `mode`와 route ID를 사용한다.
- 환승횟수는 MOTIS 응답의 transfers를 우선하고, 없으면 transit leg 수에서 계산한다.
- 요금은 다음 계약으로만 반환한다.

```ts
{
  status: 'unavailable',
  amount: null,
  reason: '운임 규칙과 교통카드 환승 정책이 연결되지 않았습니다.'
}
```

다수 `journeyQueries`가 시나리오 정의에 있으면 동일 query set을 양쪽 target에 적용한다. 화면에서 새 query를 입력하는 경우에도 before·after에 같은 query를 전달한다.

## 환경 비교와 오류 처리

다음 세 항목이 모두 같을 때 `environment.comparable`을 true로 둔다.

- `osmPbfSha256`
- `routingProfile`
- `travelTimeModelVersion`

MOTIS 버전이 존재하고 다르면 warning을 추가한다. PBF·profile·model이 다르면 route delta는 반환할 수 있지만 `environment.comparable`은 false이고 여정 비교 실행은 중단한다. 사용자가 확인한 뒤에도 자동으로 서로 다른 도로망 결과를 같은 조건으로 표시하지 않는다.

다음 오류는 결과를 만들지 않고 명확한 오류로 반환한다.

- 대상 execution artifact가 없음
- artifact의 target 또는 fingerprint가 manifest와 불일치
- scenario target인데 해당 ScenarioDefinition이 없음
- 여정 query의 출발·도착 ID 또는 출발시각이 비어 있음
- 동일 비교에서 한 target의 MOTIS 준비가 실패함

MOTIS에서 특정 OD만 경로가 없으면 전체 비교를 실패시키지 않고 해당 `ScenarioJourneyComparison`에 `found: false`와 warning을 저장한다. 다른 query 결과는 유지한다.

## 실행 흐름

1. 사용자가 두 target과 query set을 선택한다.
2. main/preload 경계를 통해 두 execution manifest와 artifact를 읽는다.
3. target·환경·artifact identity를 검증한다.
4. core 비교 함수로 route/operation 비교를 먼저 계산한다.
5. 두 target network를 project route master와 scenario definition으로 materialize한다.
6. 동일한 Synthetic GTFS operation과 MOTIS 환경으로 Before target을 준비하고 모든 query를 실행한다.
7. MOTIS를 종료한 뒤 After target을 준비하고 동일 query를 실행한다.
8. raw response를 `NormalizedJourney`로 변환하고 query별 `compareJourneys()`를 호출한다.
9. route comparison, journey comparison, environment warnings를 합쳐 결과를 화면에 표시한다.

비교 결과는 query와 실행 환경에 종속적이므로 이 단계에서는 project metadata나 기존 execution artifact에 덮어쓰지 않는다. 필요하면 후속 단계에서 별도의 comparison artifact 저장 계약을 추가한다.

## 화면 경계

이 설계가 제공하는 UI는 다음 정보만 표시한다.

- 비교 대상 선택: current, 저장된 scenario A, 저장된 scenario B
- route 변화 표: 정류장 변화, 연장, 예상 runtime, 운행정보
- query별 여정 비교: 총시간, 차내·대기·도보시간, 이용수단, 환승횟수
- 품질 경고와 환경 불일치
- 요금: 계산 불가

수요 변화, 승객 재배분, 요금 추정값을 같은 화면에 섞지 않는다.

## 테스트 성공 기준

- current↔scenario와 scenario↔scenario 모두 after snapshot을 사용한다.
- 두 노선 이상과 양쪽에만 존재하는 노선을 route comparison으로 정확히 표현한다.
- 정류장 추가·삭제·순서 변경과 연장·runtime·운행조건 delta를 계산한다.
- partial/fallback/model-estimated 상태와 warning이 보존된다.
- 환경 fingerprint가 같을 때만 여정 비교를 실행하고, 다르면 명확히 제한한다.
- 한쪽 no-route가 다른 쪽의 개선 0분으로 표시되지 않는다.
- 이용수단과 환승횟수 변화가 normalized journey에 따라 계산된다.
- 요금은 항상 `unavailable`이며 0원이 아니다.
- 기존 단일 노선 `transit-comparison` 테스트와 scenario execution 저장 테스트가 회귀 없이 통과한다.

## 브랜치 운영

- 이 설계·후속 구현은 `codex/0.6.2-scenario-comparison`에서 진행한다.
- 기존 `codex/0.6.2-scenario-path-generation`과 현재 개발 중인 main에는 통합하지 않는다.
- 0.6.2 main 구축 완료 후 최신 main을 기준으로 통합 충돌과 계약 호환성을 재검토한다.

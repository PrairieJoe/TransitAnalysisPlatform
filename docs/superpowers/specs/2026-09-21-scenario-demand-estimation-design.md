# 시나리오 수요 변화·재배분 추정 설계

## 목적

저장된 현행·시나리오 실행 결과와 프로젝트의 관측 OD 수요를 이용해 노선 변경 이후의 수요 변화를 추정한다. 결과는 관측값이나 교통카드 재집계값으로 표시하지 않고, 명시적인 규칙형 수요 재배분 모델의 추정값으로 표시한다.

이번 기능은 다음 질문에 답할 수 있어야 한다.

1. 노선 A 변경 이후 해당 노선에 배정되는 수요가 어떻게 변하는가?
2. 노선 A와 연결된 정류장·OD의 수요가 어떻게 변하는가?
3. 다수 노선·다수 정류장 변경을 하나의 시나리오로 적용했을 때 노선·정류장·OD별 수요 증감은 얼마인가?
4. 현행↔시나리오뿐 아니라 시나리오 A↔시나리오 B도 비교할 수 있는가?

## 범위와 제한

포함 범위:

- 기존 `ProjectManifest.lastODResult`의 관측 OD 수요를 기준 수요로 사용
- 실행 artifact의 `after` 네트워크를 현행·시나리오 비교 대상으로 사용
- 다수 노선과 다수 정류장 변경을 전체 후보 노선망에 반영
- OD별, 노선별, 정류장별 예상 수요 및 증감 표시
- 운행시간·배차간격·직접 운행 가능성에 따른 규칙형 재배분
- 모델명, 버전, 파라미터, 데이터 출처와 한계를 앱 화면에 항상 표시

이번 버전에서 제외:

- 승객별 실제 선택 경로 복원
- 환승 경로를 포함한 전체 네트워크 최적 경로 선택
- 운임, 교통카드 환승 할인, 소득, 승용차·도보·자전거 등 외부 교통수단
- 가격·시간 탄력성의 통계적 추정 또는 외부 보정 데이터 학습
- 시간대별·요일별 수요 이동의 정교한 동적 추정
- 추정 결과를 기존 `project-state.json`이나 실행 artifact에 덮어쓰기

따라서 화면에는 다음 고지문을 표시한다.

> 추정 방식: 관측 OD 수요와 현행·시나리오 네트워크의 직접 운행 가능성, 예상 운행시간, 평균 대기시간을 이용한 규칙형 수요 재배분 모델 v1입니다. 결과는 실제 관측값이 아닌 추정값이며, 환승·운임·외부 교통수단은 반영하지 않습니다.

## 사용자와 모델의 공통 이해

현행 OD 결과에는 출발지·도착지별 수요량은 있지만 해당 수요가 여러 후보 노선 중 어느 노선을 실제로 선택했는지에 대한 완전한 경로 선택 기록은 없다. 그러므로 v1은 현행도 시나리오도 같은 규칙으로 재계산한 기준선과 비교하며, 시나리오 결과를 실제 승객 행동의 확정값으로 해석하지 않는다.

현행·시나리오 대상은 이미 저장된 `ScenarioExecutionResult.after` snapshot을 사용한다. 시나리오 정의의 `Before` snapshot이나 편집 중인 미저장 값은 수요 추정에 사용하지 않는다.

## 추정 모델

### 입력

추정 엔진은 다음 입력을 받는다.

```ts
interface ScenarioDemandEstimationConfig {
  modelVersion: 'scenario-demand-direct-logit-v1';
  choiceSensitivity: number;
  waitTimeWeight: number;
}

interface ScenarioDemandEstimationInput {
  demand: ODDemandResult;
  before: { target: ScenarioComparisonTarget; result: ScenarioExecutionResult };
  after: { target: ScenarioComparisonTarget; result: ScenarioExecutionResult };
  config: ScenarioDemandEstimationConfig;
}
```

`demand.metrics[].dailyAverage`를 기본 수요량으로 사용하고, `demand.selectedDays`, `demand.config`, `demand.warnings`를 결과의 출처와 품질 정보로 보존한다. 총량이 필요한 경우 `totalBoardings`를 함께 사용하되, 화면의 노선·정류장·OD 증감은 선택 기간의 일평균으로 표시한다.

### 후보 노선

각 OD `(originStationId, destinationStationId)`에 대해 각 네트워크의 `after.routes`에서 다음을 만족하는 노선을 직접 운행 후보로 만든다.

1. 노선 상태가 `failed`가 아니다.
2. 두 정류장이 노선 정류장 목록에 모두 존재한다.
3. 정방향 또는 역방향 중 하나에서 출발지가 도착지보다 앞선다.
4. 두 정류장 사이의 연속 segment를 확인할 수 있다.

정방향이면 정방향 segment, 역방향이면 역방향 segment의 비용을 사용한다. 후보가 없으면 해당 OD의 수요는 `unserved`로 남기며 다른 OD로 임의 이동시키지 않는다.

### 일반화 비용

후보 노선의 일반화 비용은 분 단위로 다음과 같이 계산한다.

```text
inVehicleMinutes = 출발지부터 도착지까지 연속 segment travelSeconds의 합 / 60
averageWaitMinutes = headwayMinutes / 2
generalizedCost = inVehicleMinutes + averageWaitMinutes × waitTimeWeight
```

segment에 `travelSeconds`가 있으면 그 값을 사용한다. 값이 없고 거리와 travel-time model이 있으면 기존 모델로 시간을 추정하고 `MODEL_ESTIMATED` 경고와 낮은 신뢰도를 부여한다. 거리와 모델 모두 없으면 해당 후보를 제외하고 원인을 경고에 기록한다.

### 재배분

후보 노선 집합을 `R`이라 하고 OD 일평균 수요를 `D`라 할 때 후보별 선택확률은 다음과 같다.

```text
utility(r) = exp(-choiceSensitivity × generalizedCost(r))
share(r) = utility(r) / Σ utility(R)
assignedDemand(r) = D × share(r)
```

v1 기본값은 다음과 같다.

```ts
{
  modelVersion: 'scenario-demand-direct-logit-v1',
  choiceSensitivity: 0.08,
  waitTimeWeight: 1
}
```

후보가 있으면 후보 노선 간 배분량의 합은 해당 OD 수요가 된다. 후보가 없으면 배분량은 0이고 `unservedDemand`에 원래 OD 수요를 기록한다. 현행과 시나리오 각각에 같은 계산을 수행하여 비교하므로, 후보 노선·운행시간·배차간격 변화가 수요 증감에 반영된다.

운행요일·서비스 기간의 일자별 수요 변화는 v1에서 별도 동적 모델로 계산하지 않는다. 분석 기간과 운행조건이 맞지 않거나 일부 기간만 운행 가능한 경우 경고를 추가하고, 결과를 일평균 추정치로 표시한다.

## 결과 계약

핵심 결과는 다음 형태를 따른다.

```ts
interface ScenarioDemandAssignment {
  routeId: string;
  direction: 'forward' | 'reverse';
  share: number;
  dailyAverage: number;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}

interface ScenarioODDemandChange {
  originStationId: string;
  destinationStationId: string;
  observedDailyAverage: number;
  beforeDailyAverage: number;
  afterDailyAverage: number;
  deltaDailyAverage: number;
  unservedBeforeDailyAverage: number;
  unservedAfterDailyAverage: number;
  beforeAssignments: ScenarioDemandAssignment[];
  afterAssignments: ScenarioDemandAssignment[];
  warnings: string[];
}

interface ScenarioRouteDemandChange {
  routeId: string;
  routeName: string | null;
  beforeBoardingsDailyAverage: number;
  afterBoardingsDailyAverage: number;
  deltaBoardingsDailyAverage: number;
  beforeAlightingsDailyAverage: number;
  afterAlightingsDailyAverage: number;
  deltaAlightingsDailyAverage: number;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}

interface ScenarioStationDemandChange {
  stationId: string;
  beforeBoardingsDailyAverage: number;
  afterBoardingsDailyAverage: number;
  deltaBoardingsDailyAverage: number;
  beforeAlightingsDailyAverage: number;
  afterAlightingsDailyAverage: number;
  deltaAlightingsDailyAverage: number;
  warnings: string[];
}

interface ScenarioDemandEstimationResult {
  demandSchemaVersion: 1;
  model: ScenarioDemandEstimationConfig;
  source: {
    selectedDays: number;
    analysisConfig: AnalysisConfig;
    demandWarnings: string[];
    assumptions: string[];
  };
  before: ScenarioComparisonTarget;
  after: ScenarioComparisonTarget;
  environment: ScenarioEnvironmentComparison;
  totals: {
    observedDailyAverage: number;
    beforeServedDailyAverage: number;
    afterServedDailyAverage: number;
    beforeUnservedDailyAverage: number;
    afterUnservedDailyAverage: number;
  };
  od: ScenarioODDemandChange[];
  routes: ScenarioRouteDemandChange[];
  stations: ScenarioStationDemandChange[];
  warnings: string[];
}
```

`delta`는 항상 `after - before`로 정의한다. 기준값이 0인 증감률은 계산하지 않고 화면에서 `신규` 또는 `계산 불가`로 표시한다. 모든 수요 수치는 추정치이며 UI는 과도한 소수점 표시를 피하고 일평균 한 자리까지 표시한다.

환경의 PBF SHA-256, routing profile, travel-time model이 다르면 일반화 비용을 비교할 수 없으므로 수치형 수요 재배분을 실행하지 않고 환경 경고만 표시한다. MOTIS 버전 차이는 기존 비교 정책과 같이 경고로 남기되, PBF·profile·model이 동일하면 계산을 허용한다.

## 데이터 흐름과 경계

```text
ProjectManifest.lastODResult
        │
        ├─ 기존 list/read scenario execution artifact
        │       └─ current/scenario after network
        │
        └─ ScenarioDemandEstimationClient
                └─ ScenarioDemandEstimationEngine (pure core)
                        ├─ OD assignment
                        ├─ route aggregation
                        ├─ station aggregation
                        └─ quality/warning provenance
                                │
                                └─ ScenarioDemandPanel (in-memory result)
```

새 IPC 채널을 추가하지 않고 기존 scenario execution list/read API를 사용한다. 추정 결과는 v1에서 기존 프로젝트 metadata나 execution artifact에 저장하지 않는다. 사용자가 재실행할 때 같은 OD snapshot과 같은 모델 파라미터로 다시 계산한다.

## UI와 고지

`ScenarioDemandPanel`은 기존 `ScenarioComparisonPanel` 다음에 표시한다.

초기 상태:

- `lastODResult`가 없으면 “먼저 OD 수요 분석을 실행하세요”와 함께 실행 버튼을 비활성화한다.
- 비교 가능한 실행 결과가 두 개 미만이면 필요한 실행 결과 수를 표시한다.
- 실패 artifact는 선택할 수 없고 상태를 “실패”로 표시한다.
- 현행↔시나리오 또는 시나리오↔시나리오 대상과 실행 시각을 표시한다.

결과 상태:

- 추정방식 안내 카드: 모델명, 버전, 공식, 파라미터, 수요 출처, 제한사항
- 요약 카드: 관측 OD 일평균, 현행·시나리오 배정 수요, 미배정 수요, 전체 경고 수
- 노선별 표: 승차·하차 수요 Before/After/델타
- 정류장별 표: 승차·하차 수요 Before/After/델타
- OD별 표: 관측 수요, 배정 수요, 미배정 수요, 델타, 주요 후보 노선
- `MODEL_ESTIMATED`, partial artifact, 후보 없음, 환경 불일치 경고

수요 재배분 결과에 숫자 운임, 수요 탄력성, 실제 승객 선택이라고 해석할 수 있는 문구를 표시하지 않는다.

## 오류 및 품질 정책

- OD 수요가 없으면 엔진을 실행하지 않고 명시적인 빈 결과 상태를 반환한다.
- execution manifest와 artifact의 execution ID, input fingerprint, target이 일치하지 않으면 중단한다.
- 실패 execution은 비교 대상이 될 수 없다.
- partial execution은 계산을 허용하되 관련 노선과 전체 결과에 경고와 낮은 신뢰도를 남긴다.
- segment runtime이 없으면 후보를 임의의 0분으로 처리하지 않는다.
- 후보 노선이 없는 OD는 수요를 다른 노선에 강제로 배분하지 않고 미배정으로 남긴다.
- 현행·시나리오 환경이 비교 불가하면 수요 변화 수치를 만들지 않는다.
- 모든 경고는 중복 제거하되 최초 발생 순서를 보존한다.

## 검증 기준

핵심 엔진 테스트:

1. 동일 네트워크 비교에서 현행·시나리오 배정 수요와 노선별 수요가 동일하다.
2. 노선 A가 후보에서 제거되면 A 수요가 다른 직접 후보로 재배분되거나 미배정으로 남는다.
3. 노선 B가 추가되면 운행시간·배차간격 기반 확률에 따라 기존 후보와 수요를 나눈다.
4. 다수 노선·다수 정류장 변경을 하나의 시나리오로 계산한다.
5. 현행↔시나리오와 시나리오 A↔시나리오 B가 같은 결과 계약으로 계산된다.
6. 후보가 없는 OD가 0분 개선이나 0원 요금으로 표시되지 않는다.
7. PBF·routing profile·travel-time model 불일치가 수요 계산을 차단한다.
8. 모델 추정 runtime과 partial 경고가 결과 provenance에 포함된다.

Renderer/client 테스트:

1. OD 결과 부재, 실행 artifact 부족, 실패 artifact 선택 불가 상태를 표시한다.
2. 모델명·버전·공식·제한사항 고지문이 항상 표시된다.
3. 시나리오 A↔시나리오 B 라벨과 실행 시각이 올바르게 표시된다.
4. 노선·정류장·OD별 Before/After/델타 결과와 미배정 수요를 표시한다.
5. 숫자 운임·수요 탄력성·수요 재배분 확정 표현을 표시하지 않는다.

전체 검증은 기존 `npm test`, `npm run typecheck`, `npm run build`를 사용하며 기존 scenario contract, execution, comparison, OD, route congestion 테스트의 회귀를 확인한다.

## 다음 단계와 명시적 비범위

이 설계가 완료되면 구현 계획에서 순수 추정 엔진, renderer orchestration, UI 통합, 검증 순서로 작업을 분리한다. 환승을 포함한 전체 경로 기반 수요모형, 시간대별 수요 이동, 운임·가격 탄력성은 이 기능의 후속 별도 설계로 남긴다.

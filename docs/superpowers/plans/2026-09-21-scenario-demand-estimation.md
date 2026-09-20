# Scenario Demand Estimation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관측 OD 수요와 현행·시나리오 실행 결과를 이용해 노선·정류장·OD 단위의 수요 변화 추정치를 계산하고, 현행↔시나리오 및 시나리오↔시나리오 비교 결과와 추정 방식을 앱 안에서 명확히 제공한다.

**Architecture:** 기존 `ProjectManifest.lastODResult`와 저장된 `ScenarioExecutionResult.after` 스냅샷을 입력으로 받는 순수 TypeScript 추정 엔진을 추가한다. 엔진은 직접 운행 가능한 노선 후보를 구성하고 일반화 비용 기반 규칙형 재배분을 수행한다. Renderer client가 기존 artifact API로 두 실행 결과를 읽어 엔진을 호출하고, 새 패널은 결과를 메모리에만 표시한다. 신규 IPC, 프로젝트 상태 저장, 실행 artifact 저장은 추가하지 않는다.

**Tech Stack:** TypeScript, React, Vitest, 기존 Electron preload artifact API, 기존 scenario execution/comparison 타입과 `estimateSegmentTravelTimes` 유틸리티

**Spec:** `docs/superpowers/specs/2026-09-21-scenario-demand-estimation-design.md`

## Global Constraints

- 구현은 현재 비교 기능 브랜치에서 바로 메인으로 병합하지 않는다. 구현 시작 시 `codex/0.6.2-scenario-demand-estimation` 브랜치를 현재 승인된 작업 기준점에서 생성하고, `main`은 읽기 전용으로 유지한다.
- 기준 수요는 `ProjectManifest.lastODResult`의 `metrics[].dailyAverage`를 사용한다. `selectedDays`, `config`, `warnings`, `totalBoardings`를 결과의 출처 정보로 보존한다.
- 네트워크 입력은 시나리오 정의나 저장되지 않은 draft가 아니라, 성공한 실행 artifact의 `after` 스냅샷만 사용한다.
- 현행 네트워크도 같은 규칙으로 재계산한다. 관측 OD는 관측된 승객의 실제 노선 선택 결과가 아니므로, 결과를 실제 승객 경로 또는 확정 수요로 표현하지 않는다.
- 모델 버전은 `scenario-demand-direct-logit-v1`로 고정한다. 기본값은 `choiceSensitivity: 0.08`, `waitTimeWeight: 1`이다.
- 직접 운행 후보만 평가한다. 환승, 운임·환승 할인, 도보·승용차 등 외부 수단, 탄력성 학습, 시간대별 동적 수요 변화는 범위에서 제외한다.
- 직접 운행 후보의 일반화 비용은 `차내시간 + 평균대기시간 × waitTimeWeight`이며, 평균대기시간은 `headwayMinutes / 2`이다.
- 인접 구간의 `travelSeconds`를 우선 사용한다. 누락 시 기존 이동시간 모델과 거리로 추정하고 `MODEL_ESTIMATED` 경고와 낮은 신뢰도를 붙인다. 실제 값도 모델 추정값도 없으면 후보를 제외하며 0분으로 대체하지 않는다.
- 재배분은 `exp(-choiceSensitivity × generalizedCost)` 비율로 수행한다. 후보가 없으면 해당 OD 수요는 `unserved`로 남기고 다른 OD나 노선으로 강제 이동시키지 않는다.
- 모든 delta는 `after - before`이고, 기준값이 0인 증감률은 `신규` 또는 `계산 불가`로 표시한다. 화면 수치는 일평균 기준 소수점 첫째 자리까지 표시한다.
- PBF SHA, routing profile, travel-time model이 다르면 수치형 재배분을 실행하지 않고 환경 경고만 표시한다. MOTIS 버전 차이는 기존 비교 정책에 따라 경고로 처리한다.
- 결과는 메모리에만 유지한다. `project-state.json`이나 실행 artifact를 변경하지 않으며, 신규 IPC를 만들지 않는다.
- 앱에는 다음 문구를 항상 표시한다.

  > 추정 방식: 관측 OD 수요와 현행·시나리오 네트워크의 직접 운행 가능성, 예상 운행시간, 평균 대기시간을 이용한 규칙형 수요 재배분 모델 v1입니다. 결과는 실제 관측값이 아닌 추정값이며, 환승·운임·외부 교통수단은 반영하지 않습니다.

## Review Focus

구현 완료 후 다음 위험을 우선 검토한다. 각 항목은 아래 태스크의 테스트로 고정한다.

1. 관측 OD에 실제 노선 선택 정보가 없는데도 실제 승객 경로처럼 보이는 문제 — Task 1의 동일 네트워크 재계산 테스트와 Task 3의 고정 안내문 테스트.
2. 역방향 운행, 다수 정류장, 구간 누락을 잘못 처리해 0분 또는 0수요로 보이는 문제 — Task 1의 다중 정류장·부분 구간·unserved 테스트.
3. 노선 추가·삭제 시 수요 보존과 노선/정류장 집계가 어긋나는 문제 — Task 1의 route conservation 테스트와 route/station aggregation 테스트.
4. 비교 환경이 다를 때 숫자를 표시하는 문제 — Task 1의 environment block 테스트와 Task 3의 차단 화면 테스트.
5. 실패 artifact, stale artifact, 현행/시나리오 대상 불일치가 섞이는 문제 — Task 2의 identity validation 테스트와 실패 선택 비활성화 테스트.

---

## Task 1: 순수 수요 추정 엔진과 계약 구현

**Files:**

- Create `src/core/scenario-demand-estimation.ts`
- Create `tests/core/scenario-demand-estimation.test.ts`
- Read-only references: `src/shared/types.ts`, `src/core/scenario-comparison.ts`, `src/core/scenario-route-execution.ts`, `src/core/scenario-execution.ts`, `src/core/analysis.ts`

### 1.1 공개 계약을 먼저 고정한다

`src/core/scenario-demand-estimation.ts`에 다음 타입과 함수를 정의한다. Renderer가 직접 import할 수 있도록 기존 `scenario-comparison.ts`의 공개 타입 패턴을 따른다.

```ts
export interface ScenarioDemandEstimationConfig {
  modelVersion: 'scenario-demand-direct-logit-v1';
  choiceSensitivity: number;
  waitTimeWeight: number;
}

export interface ScenarioDemandEstimationInput {
  demand: ODDemandResult;
  before: { target: ScenarioComparisonTarget; result: ScenarioExecutionResult };
  after: { target: ScenarioComparisonTarget; result: ScenarioExecutionResult };
  config: ScenarioDemandEstimationConfig;
}

export interface ScenarioDemandAssignment {
  routeId: string;
  direction: 'forward' | 'reverse';
  share: number;
  dailyAverage: number;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}

export interface ScenarioODDemandChange {
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

export interface ScenarioRouteDemandChange {
  routeId: string;
  routeName: string | null;
  beforeBoardings: number;
  afterBoardings: number;
  deltaBoardings: number;
  beforeAlightings: number;
  afterAlightings: number;
  deltaAlightings: number;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}

export interface ScenarioStationDemandChange {
  stationId: string;
  beforeBoardings: number;
  afterBoardings: number;
  deltaBoardings: number;
  beforeAlightings: number;
  afterAlightings: number;
  deltaAlightings: number;
  warnings: string[];
}

export interface ScenarioDemandEstimationResult {
  demandSchemaVersion: 1;
  model: ScenarioDemandEstimationConfig;
  source: {
    selectedDays: ODDemandResult['selectedDays'];
    analysisConfig: ODDemandResult['config'];
    totalBoardings: number;
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

export function estimateScenarioDemand(
  input: ScenarioDemandEstimationInput,
): ScenarioDemandEstimationResult;
```

추정 결과는 별도 `shared` 타입으로 복사하지 않는다. 현재 scenario comparison처럼 core 계약을 Renderer가 import해 타입 중복을 막는다. 설정값은 함수 입구에서 finite 여부, `choiceSensitivity > 0`, `waitTimeWeight >= 0`, `modelVersion` 일치를 검증하고 잘못된 입력은 설명 가능한 오류로 거부한다.

### 1.2 환경 비교와 입력 provenance를 구현한다

- `compareScenarioEnvironments`를 호출해 PBF SHA, routing profile, travel-time model, MOTIS 버전을 비교한다.
- PBF/routing/travel-time model 불일치이면 `environment.comparable === false`인 결과와 경고를 반환한다. 이 경우 `od`, `routes`, `stations`에는 수치 결과를 채우지 않고, Renderer는 `totals`를 숫자로 표시하지 않는다. 내부의 0은 계산 결과가 아니라 차단 상태의 빈 결과로 취급한다.
- MOTIS 버전 차이는 기존 정책처럼 계산은 허용하되 경고를 결과에 보존한다.
- 결과 `source`에는 `selectedDays`, 분석 config, `lastODResult.warnings`, 직접 운행·일평균·환승 미반영 등의 가정을 기록한다.
- 모든 경고는 순서를 보존하면서 최초 1회만 남긴다. OD/assignment/route/station 레벨 경고와 결과 전역 경고 모두 같은 dedupe 규칙을 사용한다.

### 1.3 직접 운행 후보와 비용을 계산한다

OD metric의 origin/destination에 대해 before와 after 각각 다음을 수행한다.

1. 실패하지 않은 route execution만 후보로 본다.
2. 해당 노선의 정류장 목록에서 origin과 destination이 모두 있는지 확인한다.
3. forward 정류장 순서 또는 reverse 정류장 순서에서 origin이 destination보다 앞서는지 확인한다.
4. 두 정류장 사이의 모든 인접 구간이 존재하는지 확인하고 `travelSeconds`를 합산한다.
5. `travelSeconds`가 누락됐지만 거리와 travel-time model이 있으면 기존 `estimateSegmentTravelTimes`를 사용해 추정한다. 이때 route operation의 model과 dwell 설정을 전달한다.
6. 실제·모델 추정값 모두 없으면 후보에서 제외하고 `SEGMENT_RUNTIME_UNAVAILABLE` 경고를 남긴다.
7. `inVehicleMinutes = segmentTravelSeconds / 60`, `averageWaitMinutes = headwayMinutes / 2`, `generalizedCost = inVehicleMinutes + averageWaitMinutes * waitTimeWeight`를 계산한다.
8. candidate 전체에 대해 `exp(-choiceSensitivity * generalizedCost)`를 계산하고 합으로 나눠 share를 만든다. 각 OD의 할당 합계는 후보가 있는 경우 관측 일평균과 같아야 한다.

forward/reverse 후보가 모두 가능하면 각각 별도 assignment로 유지한다. 역방향에서 사용하는 구간은 reverse execution의 ordered segment를 기준으로 찾고, 양쪽 방향에 대해 같은 routeId라도 방향을 합쳐버리지 않는다.

### 1.4 OD·노선·정류장 집계를 구현한다

- 각 OD에 대해 before assignment와 after assignment를 계산하고, `after - before`를 `deltaDailyAverage`로 저장한다.
- 후보가 없는 쪽은 해당 OD 수요 전부를 `unservedBeforeDailyAverage` 또는 `unservedAfterDailyAverage`로 기록한다. 다른 OD로 전이하거나 다른 노선에 강제 할당하지 않는다.
- assignment의 origin에 daily average를 boardings로, destination에 daily average를 alightings로 누적한다.
- routeId 기준으로 route boardings/alightings를 합산하고, 양쪽에 없는 이름은 `null`로 둔다. route가 한쪽에만 존재하면 반대편 값은 0이고 경고를 붙인다.
- stationId 기준으로 station boardings/alightings를 합산한다. 노선 수요 변화와 station 수요 변화가 서로 다른 방식으로 계산되지 않도록 동일 assignment 누적값에서 파생한다.
- 실제 구간을 모두 사용한 완전 후보는 `high`, 일부 모델 추정이 섞이면 `low`, 실제 런타임이지만 부분 경고가 있으면 `medium`으로 표시한다. confidence와 warnings는 route/OD 결과에 전파한다.
- `dailyAverage`와 총계는 부동소수점 오차를 누적하지 않도록 내부 계산 후 출력 경계에서 소수점 1자리 표시를 위한 원시값을 유지한다. 테스트에서는 `toBeCloseTo`를 사용한다.

### 1.5 테스트를 먼저 작성하고 구현한다

`tests/core/scenario-demand-estimation.test.ts`에 다음 실패 테스트를 먼저 작성한다.

- 동일 네트워크를 before/after로 넣으면 모든 OD의 before/after와 route/station 합계가 동일하다.
- route A가 제거되고 route B만 남으면 direct candidate가 있는 경우 B로 재배분되고, 후보가 없으면 unserved로 남는다.
- route B가 추가되어 A/B 비용이 다르면 두 route로 logit 비율이 나뉘고 OD 수요 총합이 보존된다.
- 다수 노선·다수 정류장 시나리오에서 origin/destination 사이의 중간 정류장과 forward/reverse 방향을 올바르게 처리한다.
- before/after target이 current↔scenario인지 scenario A↔scenario B인지와 무관하게 동일한 result contract를 사용한다.
- 구간 런타임이 없으면 후보를 0분으로 만들지 않고 제외하며 `unserved`와 경고가 증가한다.
- 거리 기반 런타임 추정이 사용되면 결과 confidence가 low이고 `MODEL_ESTIMATED` provenance가 유지된다.
- PBF/routing/travel-time model 환경이 다르면 route/OD 숫자를 계산하지 않고 비교 불가 경고만 반환한다.
- 기준값 0의 퍼센트 표시를 엔진에서 생성하지 않으며 delta는 after-before 방향을 유지한다.

그 다음 순서로 구현하고 아래 명령으로 단위 테스트를 확인한다.

```powershell
npm test -- --run tests/core/scenario-demand-estimation.test.ts
```

**Commit:** `feat: add scenario demand estimation engine`

---

## Task 2: 실행 artifact 로딩 client와 대상 검증

**Files:**

- Create `src/renderer/scenario-demand-client.ts`
- Create `tests/renderer/scenario-demand-client.test.ts`
- Read-only references: `src/renderer/scenario-comparison-client.ts`, `src/renderer/ScenarioExecutionPanel.tsx`, `src/shared/types.ts`, existing preload API type declarations

### 2.1 Client 입력과 실행 흐름을 정의한다

`scenario-demand-client.ts`에 다음 역할을 둔다.

- `runScenarioDemandEstimation`은 `projectId`, `ODDemandResult`, before/after target 및 execution manifest id, optional config을 받는다.
- config가 없으면 모델 버전과 기본 파라미터를 주입한다.
- 기존 `window.transitDesktop.listScenarioExecutionManifests`와 `readScenarioExecution`만 사용해 두 artifact를 읽는다. MOTIS를 다시 호출하지 않는다.
- manifest의 `executionId`, `projectId`, `scenarioId`, `scenarioFingerprint`, target 종류를 읽은 요청과 비교한다.
- 실패 artifact, missing artifact, target identity 불일치, fingerprint 불일치는 엔진에 넘기지 않고 설명 가능한 오류로 중단한다.
- 두 artifact를 읽은 뒤 `ScenarioExecutionResult.after`를 엔진 입력으로 구성한다. `before` 네트워크나 scenario definition의 draft를 사용하지 않는다.
- `loading → validating → estimating → complete` 진행 상태를 선택적으로 callback으로 노출한다. 기존 패널의 비동기 상태 패턴과 맞춘다.
- 결과는 호출자에게 반환하되 저장하지 않는다.

artifact 검증 로직은 기존 comparison client의 검증 규칙과 동일한 메시지 의미를 유지한다. 다만 이번 기능이 기존 비교 기능의 동작을 변경하지 않도록 기존 client를 공통화하는 리팩터링은 하지 않는다.

### 2.2 client 테스트를 먼저 작성한다

`tests/renderer/scenario-demand-client.test.ts`에서 preload API를 mock하고 다음을 검증한다.

- 정상 current↔scenario 요청이 정확히 두 artifact를 읽고, engine에 두 `after` 스냅샷과 OD 수요를 전달한다.
- scenario A↔scenario B 요청도 동일한 흐름과 결과 타입을 사용한다.
- 실패 artifact는 선택 단계에서 거부되어 engine이 호출되지 않는다.
- executionId/projectId/scenarioId/fingerprint가 다르면 거부되고 artifact 일부만 읽은 상태에서 중단한다.
- client는 MOTIS API나 프로젝트 상태 쓰기 API를 호출하지 않는다.
- artifact 읽기 중 오류가 나면 UI가 표시할 수 있는 오류 메시지와 함께 반환한다.

그 다음 client를 구현하고 다음 명령으로 확인한다.

```powershell
npm test -- --run tests/renderer/scenario-demand-client.test.ts
```

**Commit:** `feat: load scenario demand estimation artifacts`

---

## Task 3: 수요 추정 패널과 ScenarioDefinitionEditor 통합

**Files:**

- Create `src/renderer/ScenarioDemandPanel.tsx`
- Create `tests/renderer/ScenarioDemandPanel.test.tsx`
- Modify `src/renderer/ScenarioDefinitionEditor.tsx`
- Modify `src/renderer/styles.css`
- Read-only references: `src/renderer/ScenarioComparisonPanel.tsx`, `src/renderer/ScenarioExecutionPanel.tsx`, existing renderer tests and table styles

### 3.1 패널의 상태와 선택 규칙을 구현한다

`ScenarioDemandPanel`은 `ScenarioDefinitionEditor`가 이미 알고 있는 project와 execution manifest 목록을 props로 받는다.

- `project.lastODResult`가 없으면 “먼저 OD 수요 분석을 실행하세요” empty state를 표시하고 실행 버튼을 비활성화한다.
- 비교 가능한 성공 execution이 2개 미만이면 필요한 실행 수와 저장 필요성을 설명하고 실행 버튼을 비활성화한다.
- 실패하거나 artifact를 읽을 수 없는 execution은 선택 목록에서 비활성화한다.
- 기본 선택은 current 대 최신 성공 scenario로 한다. scenario가 둘 이상이면 사용자가 before/after를 각각 선택할 수 있게 한다.
- 동일 execution을 양쪽에 선택할 수 없게 한다.
- 선택 영역에는 current/scenario 표시, scenario 이름, 실행 시각, execution id를 보여준다. A↔B일 때 라벨이 current/scenario로 오해되지 않도록 선택된 두 대상의 실제 이름을 그대로 표시한다.
- 실행 중에는 loading/progress와 취소 불가 상태를 표시한다. 완료된 result는 패널 state에만 둔다.

### 3.2 추정 방식과 차단 상태를 표시한다

패널 상단에 승인된 고정 안내 문구를 항상 표시하고, 다음을 함께 보여준다.

- model version
- `choiceSensitivity = 0.08`, `waitTimeWeight = 1`
- 직접 운행 후보, 차내시간, 평균대기시간, logit share 수식의 쉬운 설명
- `lastODResult`의 선택 요일, 분석 config, 경고와 “일평균 기준” 표시
- 환승·운임·외부 교통수단·실제 승객 경로가 반영되지 않는다는 제한

PBF/routing/travel-time model 환경 불일치이면 “수요 재배분 계산 불가”를 표시하고 route/station/OD의 숫자 테이블과 숫자 summary를 렌더링하지 않는다. MOTIS 버전 경고는 계산 결과와 함께 경고 영역에 표시한다.

### 3.3 결과 뷰를 구현한다

테스트 가능한 `ScenarioDemandResultView`를 별도 named export로 둔다.

- summary: 관측 OD 일평균, before/after served, before/after unserved, 경고 수
- route table: route name/id, before/after/delta boardings, before/after/delta alightings, confidence, warnings
- station table: station id/name이 현재 데이터로 매핑 가능하면 이름도 함께, boardings/alightings before/after/delta
- OD table: origin, destination, observed demand, before/after assigned, delta, before/after unserved, before/after route assignment와 warnings
- route/station/OD 표는 다수 결과를 읽을 수 있도록 기존 `.table-scroll` 패턴을 사용하고, 컬럼 헤더에 모두 일평균 단위를 명시한다.
- 기준값 0인 증감률을 화면에 만들지 않는다. 이번 결과 표는 절대 일평균과 delta 중심으로 제공하고, 필요할 때만 `신규`/`계산 불가`를 표시한다.
- 추정 결과를 실제 이용량, 확정 노선 선택, 요금 절감, 탄력성으로 표현하는 문구를 사용하지 않는다.
- 경고가 있는 OD/route/station은 행 수준에서 확인할 수 있도록 warning 표시를 둔다.

`ScenarioDefinitionEditor.tsx`에서는 기존 `ScenarioComparisonPanel` 바로 다음에 `ScenarioDemandPanel`을 렌더링한다. 기존 scenario execution/comparison 결과, 저장 흐름, project state 업데이트는 변경하지 않는다. `styles.css`에는 패널·방법 카드·차단 상태·경고·테이블에 필요한 최소 class만 추가한다.

### 3.4 UI 테스트를 먼저 작성한다

`tests/renderer/ScenarioDemandPanel.test.tsx`와 필요한 editor 통합 테스트에서 다음을 검증한다.

- `lastODResult`가 없을 때 empty state와 비활성화가 나온다.
- 성공 execution이 둘 미만이거나 실패 execution뿐일 때 선택/실행이 막힌다.
- current↔scenario와 scenario A↔B의 이름·실행 시각·선택 상태가 올바르다.
- approved disclosure, 모델 버전, 파라미터, 일평균/추정/제한 문구가 항상 보인다.
- route/station/OD 결과 테이블과 before/after/delta, unserved, warning이 표시된다.
- 환경 불일치 결과에서는 숫자 summary/table이 숨겨지고 “계산 불가”와 원인만 표시된다.
- 실제 요금·탄력성·확정 경로를 암시하는 숫자나 문구가 표시되지 않는다.
- ScenarioDefinitionEditor는 기존 comparison panel 아래에 demand panel을 렌더링한다.

그 다음 구현하고 다음 명령으로 확인한다.

```powershell
npm test -- --run tests/renderer/ScenarioDemandPanel.test.tsx tests/renderer/ScenarioDefinitionEditor.test.tsx
```

**Commit:** `feat: add scenario demand estimation panel`

---

## Task 4: 회귀 검증과 구현 인수인계 문서

**Files:**

- Modify `docs/superpowers/plans/2026-09-21-scenario-demand-estimation.md` only when recording factual verification results
- Create `docs/superpowers/verification/2026-09-21-scenario-demand-estimation.md`

### 4.1 단계별 검증을 실행한다

구현 브랜치에서 다음을 순서대로 실행한다.

```powershell
npm test -- --run tests/core/scenario-demand-estimation.test.ts tests/renderer/scenario-demand-client.test.ts tests/renderer/ScenarioDemandPanel.test.tsx
npm test
npm run typecheck
npm run build
git diff --check
```

각 명령의 기대 결과는 다음과 같다.

- targeted tests: 엔진·client·패널의 요구사항 테스트가 모두 통과한다.
- full `npm test`: 기존 scenario execution/comparison/OD 분석 테스트를 포함해 전체 통과한다.
- `npm run typecheck`: core 공개 계약과 renderer import 사이에 타입 오류가 없다.
- `npm run build`: 새 panel/client가 production bundle에 포함되고 기존 preload 계약을 깨지 않는다.
- `git diff --check`: trailing whitespace와 patch 오류가 없다.

### 4.2 수동 검증 체크리스트를 기록한다

실제 fixture 또는 개발 데이터로 다음을 확인하고 verification 문서에 결과를 기록한다.

- 동일 네트워크: before/after 수요와 route/station 합계가 보존됨
- 다수 노선·다수 정류장: 노선 추가/삭제, 역방향, 중간 정류장 변경이 올바른 후보와 assignment를 만듦
- route A 제거: route B 재배분 또는 unserved가 발생하고 다른 OD로 누수되지 않음
- scenario A↔scenario B: current 라벨을 강제로 사용하지 않고 두 시나리오의 실제 이름/실행 시각을 표시함
- 구간 runtime 누락: 0분으로 보이지 않고 warning/low confidence/unserved로 설명됨
- 환경 불일치: 수치가 숨겨지고 계산 불가 상태만 표시됨
- 방법 안내: 앱 안에서 모델, 버전, 파라미터, 출처, 제한사항을 확인할 수 있음
- 프로젝트 상태와 실행 artifact 파일이 변경되지 않음

### 4.3 검증 결과와 브랜치 경계를 기록한다

verification 문서에는 실행한 명령, 통과 여부, 알려진 제한사항, 테스트 fixture 범위, 현재 구현 브랜치와 병합하지 않은 main 상태를 기록한다. 제품 코드 구현 커밋과 검증 문서는 분리한다.

**Commit:** `docs: record scenario demand estimation verification`

---

## Completion Criteria

- [ ] Task 1~3의 제품 코드와 테스트가 각각 독립 커밋으로 완료된다.
- [ ] Task 4의 전체 테스트, 타입 검사, build, diff 검사가 통과한다.
- [ ] current↔scenario와 scenario A↔B가 같은 엔진·client·result contract로 동작한다.
- [ ] 다수 노선·다수 정류장 변경과 노선 구성 변경이 execution `after` 스냅샷에 반영된 뒤 수요 후보에 반영된다.
- [ ] 실제 관측 노선 선택으로 오해할 수 없는 고정 안내문과 제한사항이 앱에 표시된다.
- [ ] 환경 불일치, 실패 artifact, stale identity, runtime 누락이 숫자를 조용히 왜곡하지 않는다.
- [ ] `main`에는 어떤 커밋도 통합하지 않고, 최종 병합은 별도 검토와 사용자 승인 이후에만 수행한다.

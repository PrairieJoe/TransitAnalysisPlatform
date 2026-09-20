# 다중 노선 시나리오 입력·저장 설계

## 목적

공통 `ScenarioDefinition` 계약을 실제 화면에서 작성하고 여러 개 저장할 수 있게 한다. 하나의 시나리오는 여러 노선 변경을 포함하고, 각 노선은 현행(Before) 정류장 순서와 시나리오(After) 정류장 순서 및 독립적인 운행조건을 가진다.

이번 단계의 입력 결과는 “도로망에서 계산된 실제 경로”가 아니라 후속 Synthetic GTFS/MOTIS 실행이 재현할 수 있는 노선 경로 정의다.

## 사용자 요구 반영

### 정류장 구성 변경과 시나리오 경로

정류장 구성을 바꾸면 해당 노선의 `scenarioStopIds`도 바뀌어야 한다. 편집기는 노선별 After 정류장 순서를 저장하고, 이 순서를 시나리오 경로 정의로 취급한다.

다만 정류장 사이의 실제 도로 형상, 거리, 연장, 운행시간은 정류장 목록만으로 확정하지 않는다. 다음 단계의 도로·Synthetic GTFS/MOTIS 실행기가 `scenarioStopIds`를 사용해 실제 경로와 운행정보를 계산하고, 그 실행 결과를 별도로 저장한다. 이번 단계에서 계산되지 않은 경로를 계산된 것처럼 저장하지 않는다.

### 현행·시나리오 간 및 시나리오·시나리오 간 분석

각 시나리오는 특정 비교 결과가 아니라 프로젝트 현행 노선에 대한 독립적인 정의로 저장한다. 따라서 후속 분석기는 다음 대상을 선택할 수 있다.

- `current`: 프로젝트의 현행 노선·운행정보
- `scenario:{scenarioId}`: 저장된 시나리오 정의

후속 단계에서 이 대상을 조합해 다음 비교를 지원한다.

- 현행 ↔ 시나리오 A
- 시나리오 A ↔ 시나리오 B
- 시나리오 A ↔ 시나리오 C

이번 단계에서는 시나리오를 여러 개 저장·선택·수정할 수 있게 하며, 실제 비교 실행·결과 화면은 구현하지 않는다.

## 범위

포함:

- 저장된 시나리오 목록 표시 및 기존 시나리오 불러오기
- 새 시나리오 생성 및 기존 시나리오 수정
- 하나의 시나리오에 여러 노선 추가·삭제
- 노선별 현행 정류장 경로 표시
- 노선별 After 정류장 ID 순서 입력
- 노선별 Before/After 운행조건 입력
- 복수 출발지·도착지·출발일시 질의 입력
- `createScenarioDefinition` 검증 후 metadata 저장
- 저장 성공·실패 상태와 검증 오류 표시
- 기존 `scenarioDeltas` 저장 및 단일 노선 Synthetic GTFS 실행 흐름 유지

제외:

- 정류장 사이의 실제 도로 경로·geometry·거리 계산
- Synthetic GTFS 다중 노선 생성
- MOTIS 실행 및 실행 결과·원시 응답 저장
- 노선 연장·운행시간 계산
- 수요 재배분 및 현행·시나리오 비교 계산
- 현행↔시나리오 또는 시나리오↔시나리오 결과 화면
- 요금 계산
- 프로젝트 schema version 변경

## 화면 설계

기존 `SyntheticGtfsBuilder` 안에 `ScenarioDefinitionEditor` 패널을 추가한다. 편집기와 Synthetic GTFS 실행기는 같은 화면에 있을 수 있지만 상태와 저장 계약은 분리한다.

### 시나리오 목록

- `새 시나리오` 버튼은 새 `scenarioId`와 기본 입력값을 만든다.
- 저장된 `project.scenarioDefinitions`를 라벨과 수정시각으로 표시한다.
- 목록에서 시나리오를 선택하면 편집기에 깊은 복사한 값을 불러온다.
- 저장은 같은 `scenarioId`를 가진 기존 정의를 교체하고, 새 정의는 목록에 추가한다.
- 삭제는 이번 단계에서 구현하지 않는다. 저장된 정의를 실수로 잃지 않도록 후속 관리 기능으로 분리한다.

### 노선 변경 카드

각 카드에는 다음을 표시한다.

- 노선 선택: 프로젝트 `routeStopMaster`에 존재하는 노선만 선택
- 노선명·교통수단: 선택한 노선 master에서 표시
- Before 경로: 대표 경로의 정류장 ID 순서를 읽기 전용으로 표시
- After 경로: 정류장 ID를 쉼표로 입력하며 입력 순서를 보존
- `노선 변경 제거` 버튼

After 입력은 최소 2개 정류장, 중복 없는 ID, 노선 master에 존재하는 ID만 허용한다. 저장 전에 입력 오류를 카드별로 표시한다. 이번 단계에서는 지도에서 도로 선형을 직접 편집하지 않는다.

### 노선별 운행조건

각 노선 카드 안에 Before와 After 운행조건을 별도로 둔다.

- 운행요일
- 첫차·막차
- 배차간격
- 운행대수
- 정차시간
- 서비스 시작일·종료일
- 역방향 파생 여부

시간모델은 현재 Synthetic GTFS 기본 모델을 초기값으로 사용하고, 모델 버전과 기준속도는 `ScenarioOperationPlan.travelTimeModel`에 함께 저장한다. 사용자가 시간모델 자체를 편집하는 기능은 이번 단계에서 노출하지 않는다.

새 노선 카드는 프로젝트의 현행 운행조건 또는 명시된 기본값을 Before/After에 복사해 시작하되, 저장 시에는 두 계획을 항상 독립된 객체로 직렬화한다. 이후 사용자가 한쪽만 바꾸어도 다른 쪽은 바뀌지 않는다.

### 여정 질의

시나리오 전체에 대해 다음 행을 여러 개 추가할 수 있다.

- 출발 정류장 ID
- 도착 정류장 ID
- 출발일시

질의는 실행 결과가 아니라 후속 비교 실행에 사용할 입력으로만 저장한다.

## 데이터 흐름

```text
routeStopMaster + project.scenarioDefinitions
        ↓
ScenarioDefinitionEditor draft
        ↓ createScenarioDefinition()
검증 성공
        ↓
onSaveScenarioDefinition(definition)
        ↓
App.save({ ...project, scenarioDefinitions: replacedOrAppended })
        ↓
project-store.saveMetadata()
```

`App.save`에 전달되는 새 프로젝트는 기존 `project.records` 배열을 그대로 참조한다. 따라서 데스크톱 환경에서는 기존 저장 경계가 metadata 전용 저장으로 분기되고 DuckDB 원본 거래내역을 다시 쓰지 않는다.

기존 Synthetic GTFS 생성 버튼은 기존 `onSaveScenario(delta)` 흐름을 유지한다. 새 편집기의 저장 버튼은 `onSaveScenarioDefinition`을 사용하며, 두 저장 경로를 서로 덮어쓰지 않는다.

## 컴포넌트·파일 경계

- `src/renderer/ScenarioDefinitionEditor.tsx`: 시나리오 목록, 다중 노선 카드, 질의 입력, 저장 이벤트
- `src/renderer/SyntheticGtfsBuilder.tsx`: 편집기 렌더링과 새 저장 callback 연결; 기존 GTFS/MOTIS 동작 유지
- `src/renderer/App.tsx`: `scenarioDefinitions`의 추가·교체와 metadata 저장 callback
- `src/core/scenario-editor.ts`: route master에서 대표 Before 경로를 고르고 편집 draft를 구성하는 순수 함수
- `src/shared/types.ts`: 기존 공통 `ScenarioDefinition` 타입을 그대로 사용하며 프로젝트 버전은 변경하지 않음
- `tests/core/scenario-editor.test.ts`: 대표 경로 선택, After 정류장 순서 정규화, 독립 Before/After draft 테스트
- `tests/renderer/ScenarioDefinitionEditor.test.tsx`: 다중 노선·다중 질의 저장 payload와 검증 오류 표시 테스트
- `tests/renderer/SyntheticGtfsBuilder.test.tsx`: 기존 단일 노선 실행·delta 저장 회귀 테스트 유지
- `tests/main/project-store.test.ts`: 기존 scenario definition metadata round-trip 및 저장 경계 회귀 테스트 유지

## 오류 처리

- 빈 시나리오 ID·라벨, 노선 미선택, 정류장 master에 없는 ID, 중복 정류장, 2개 미만 경로는 저장하지 않고 입력 카드에 표시한다.
- `createScenarioDefinition`의 계약 검증 오류는 사용자에게 표시하고 저장 callback을 호출하지 않는다.
- metadata 저장 실패는 기존 화면의 오류 표시 영역에 전달하며, 성공 전까지 편집 draft를 유지한다.
- 저장 성공 후에만 편집기의 선택 시나리오를 저장된 값으로 교체한다.
- 실제 경로 계산이 아직 수행되지 않았다는 점을 화면에 표시해 After 정류장 순서와 도로망 경로를 혼동하지 않게 한다.

## 성공 기준

1. 사용자가 서로 다른 2개 이상의 노선을 하나의 시나리오에 추가하고 저장할 수 있다.
2. 각 노선은 서로 다른 After 정류장 수와 독립적인 Before/After 운행조건을 가진다.
3. 한 프로젝트에 시나리오 A와 B를 저장한 뒤 각각 다시 불러올 수 있다.
4. 저장된 정의에는 후속 경로 생성기가 사용할 ordered `scenarioStopIds`가 보존된다.
5. 저장된 시나리오의 `scenarioId`가 안정적으로 유지되어 후속 현행↔시나리오 및 시나리오↔시나리오 비교 대상이 될 수 있다.
6. 잘못된 입력은 metadata 파일을 쓰기 전에 거부되고, 기존 `ScenarioDelta` 및 Synthetic GTFS 테스트는 회귀 없이 통과한다.

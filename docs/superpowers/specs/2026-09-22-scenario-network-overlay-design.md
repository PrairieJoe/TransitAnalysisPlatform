# 시나리오 네트워크 Overlay 및 지도 편집 설계

## 상태

- 작성일: 2026-09-22
- 대상 범위: 0.8.0 후속 보완 + 0.9.0 기능 확장
- 설계 승인: 사용자 승인 완료
- 구현 상태: 구현 전
- 실행 방식: 현재 `main` 브랜치의 네이티브 workspace에서 진행

## 배경

0.8.0의 노선 개편 시나리오 화면은 현행 정류장 목록의 순서 변경과 제외만 지원한다. 기존 정류장 사전에서 다른 정류장을 개편안에 추가하거나, 지도에서 정류장을 만들거나, 신규 노선을 구성하는 기능은 없다. 정류장 목록은 긴 화면 안에 배치되어 조작하기 어렵고, 기존 상세 편집기에 남아 있는 텍스트 나열형 입력은 완성도와 신뢰감을 떨어뜨린다.

현재 데이터 계약도 이 한계를 반영한다. `ScenarioRouteChange.scenarioStopIds`는 프로젝트의 `routeStopMaster`에서 해석되는 정류장 ID 배열이며, `ScenarioDefinition`에는 시나리오가 새로 만든 정류장·노선 엔티티를 저장할 공간이 없다. 기존 Leaflet 지도는 정류장과 흐름을 조회·선택할 뿐 편집하지 않는다.

## 버전 및 범위 판정

이번 의견은 두 릴리스 범위로 나눈다.

### 0.8.0 후속 보완

- 기존 정류장 사전에서 개편안 정류장을 추가한다.
- 정류장 목록을 독립 스크롤 영역으로 만들고 선택된 항목을 유지한다.
- 기본 사용자 흐름에서 텍스트 경로 나열형 편집기를 제거한다.
- 기존 v1/v2 시나리오 저장·복원·실행 호환성을 유지한다.

### 0.9.0 기능 확장

- 시나리오 스키마 v3 overlay를 추가한다.
- 신규 정류장을 지도에서 만들고 이름·ID·좌표를 관리한다.
- 신규 노선을 만들고 기존·신규 정류장을 순서대로 구성한다.
- 지도에서 정류장 추가·제외·선택·위치 조정을 수행한다.
- 신규 노선을 개편안 GTFS와 MOTIS 네트워크에 포함한다.
- 현행에 대응 노선이 없는 신규 노선과 신규 경로를 비교 결과에서 명시한다.

이번 변경에서 프로젝트 원본 `routeStopMaster` 또는 `stationMaster`를 직접 수정하지 않는다.

## 목표

1. 사용자가 텍스트 ID를 직접 조합하지 않고 목록과 지도로 노선 개편을 구성한다.
2. 기존 노선 개편, 신규 정류장, 신규 노선을 하나의 시나리오에서 저장한다.
3. 현행 원본과 개편안 overlay를 분리해 데이터 신뢰성을 보장한다.
4. 현행 GTFS와 개편안 GTFS, 동일 OD 여정 결과를 현행·개편안 관점으로 비교한다.
5. 기존 프로젝트와 기존 시나리오의 호환성을 깨지 않는다.

## 비목표

- 실제 프로젝트의 원본 노선·정류장 파일을 수정하거나 덮어쓰지 않는다.
- 이번 범위에서 지도 타일 공급자나 OSM 도로 경로 알고리즘을 변경하지 않는다.
- 자동 노선 최적화, 수요 기반 노선 추천, 정류장 입지 최적화를 추가하지 않는다.
- 신규 노선의 폐지 기능은 추가하지 않는다. 기존 노선의 제외와 신규 노선 생성에 집중한다.
- 기존 시나리오의 실행·수요 추정 엔진을 별도 엔진으로 교체하지 않는다.

## 정보 구조와 편집 흐름

시나리오 workspace는 다음 두 영역으로 나눈다.

```text
노선 개편 시나리오
├─ 좌측: 시나리오 편집 패널
│  ├─ 기존 노선 개편 / 새 노선 만들기
│  ├─ 노선 정보와 운행조건
│  ├─ 현행·개편안 정류장 목록
│  └─ 변경 상태 및 저장
└─ 우측: 지도 편집 패널
   ├─ 현행 정류장
   ├─ 개편안 정류장
   ├─ 지도에서 정류장 추가
   └─ 선택 정류장 상세·제외·위치 조정
```

### 기존 노선 개편

1. 현행 노선을 선택한다.
2. 현행 정류장과 현재 개편안 목록을 동시에 확인한다.
3. 기존 정류장 사전에서 정류장을 추가하거나 지도에서 신규 정류장을 만든다.
4. 목록의 이동·제외 또는 지도 선택으로 개편안 순서를 수정한다.
5. 변경 상태를 확인하고 시나리오를 저장한다.

기존 노선의 `baseStopIds`는 현행 경로의 snapshot으로 유지한다. `scenarioStopIds`는 프로젝트 원본 정류장과 시나리오 신규 정류장을 함께 참조한다.

### 새 노선 만들기

1. `새 노선 만들기`를 선택한다.
2. 노선 ID·노선명·교통수단을 입력한다.
3. 기존 정류장을 지도 또는 검색 목록에서 재사용하거나 신규 정류장을 만든다.
4. 정류장을 선택한 순서대로 개편안 노선 목록에 배치한다.
5. 최소 2개 정류장, 중복 정류장, 좌표 누락을 즉시 검증한다.
6. 운행조건 disclosure에서 운행대수·첫차·막차·배차간격을 입력하고 저장한다.

신규 노선은 현행 대응 노선이 없으므로 현행 경로는 존재하지 않는 상태로 저장한다. 비교 결과에는 `신규 노선` 및 `현행 대응 없음`을 표시한다.

### 지도 상호작용

- 현행 정류장은 중립 색상, 개편안 추가 정류장은 강조 색상으로 표시한다.
- 목록에서 항목을 선택하면 지도가 해당 정류장으로 이동하고 popup/detail card를 연다.
- `지도에서 정류장 추가` 모드에서 지도를 클릭하면 신규 정류장 draft를 만든다.
- 신규 정류장 draft는 이름·정류장 ID·좌표를 입력한 뒤 목록과 지도에 반영한다.
- 개편안에 포함된 정류장을 선택하면 `개편안에서 제외`와 `위치 조정`을 제공한다.
- 현행 원본 정류장의 좌표를 직접 변경하지 않는다. 위치 조정은 시나리오의 override 또는 신규 정류장으로 저장한다.
- 지도와 목록은 동일한 overlay state를 구독하며, 어느 한쪽의 변경도 다른 쪽에 즉시 반영한다.

### 스크롤과 텍스트 입력

- 정류장 목록은 화면 전체가 아니라 패널 내부에서 스크롤한다.
- 지도 영역은 편집 패널 스크롤과 독립적으로 유지한다.
- 선택된 정류장은 스크롤 후에도 강조 상태를 유지한다.
- 텍스트 경로 입력은 기본·고급 UI에서 제거한다.
- 기존 텍스트 저장 데이터는 core parser와 migration 경계에서만 읽는다.

## 데이터 모델

프로젝트 schema version은 `10`을 유지하고, `ScenarioDefinition.scenarioSchemaVersion`을 `3`으로 확장한다. v1/v2 정의는 기존 필드로 읽으며, overlay를 사용하는 정의만 v3으로 저장한다.

개념적 모델은 다음과 같다.

```text
ScenarioDefinition v3
├─ routeChanges[]
│  └─ 기존 노선의 baseStopIds / scenarioStopIds / 운행조건
├─ addedStations[]
│  └─ scenarioStationId / name / latitude / longitude / optional ARS
├─ stationOverrides[]
│  └─ 원본 정류장의 시나리오 좌표·표시정보 override
├─ addedRoutes[]
│  └─ routeId / routeName / transportMode / stopIds / afterOperation
└─ journeyQueries / source / environment
```

### 신규 정류장

신규 정류장은 프로젝트 원본 ID와 충돌하지 않는 scenario-owned ID를 사용한다. 표시용 이름, 위도, 경도는 필수이며 ARS 번호는 선택이다. 신규 정류장의 원천은 `scenario`로 표시하고, 원본 정류장과 같은 ID를 재사용하지 않는다.

### 기존 정류장 override

기존 정류장의 위치나 표시명을 개편안에서만 바꿀 때는 `stationOverrides`에 원본 정류장 ID와 변경된 값을 저장한다. 현행 네트워크는 원본 좌표를 사용하고, 개편안 네트워크만 override를 적용한다. 원본과 동일한 값으로 저장되는 override는 저장 전에 제거한다.

### 신규 노선

신규 노선은 원본 route ID와 충돌하지 않는 ID, 이름, 교통수단, 정류장 순서, 개편안 운행조건을 저장한다. 신규 노선의 정류장 순서는 프로젝트 원본 정류장과 `addedStations`를 모두 참조할 수 있다.

### Overlay materialization

실행 직전에 다음 두 네트워크를 materialize한다.

```text
currentNetwork = project.routeStopMaster
scenarioNetwork = currentNetwork
                + scenario.addedStations
                + scenario.stationOverrides 적용
                + scenario.routeChanges 적용
                + scenario.addedRoutes
```

이 materializer는 GTFS 생성, MOTIS 실행, 시나리오 비교가 공유한다. renderer가 실행 payload를 임의로 조합하지 않고 core 계약을 통해 검증된 네트워크만 main/preload 경계로 전달한다.

## 검증과 오류 처리

저장 전 검증 오류는 해당 입력과 가까운 위치에 표시한다.

- 신규 정류장 ID 중복 또는 원본 ID 충돌
- 기존 정류장 override의 대상 ID 누락 또는 좌표 오류
- 신규 정류장 이름 누락
- 위도 `-90~90`, 경도 `-180~180` 범위를 벗어난 좌표
- 노선 ID 충돌 또는 노선명 누락
- 노선 정류장 2개 미만
- 동일 노선 안의 중복 정류장
- 존재하지 않는 원본/신규 정류장 참조
- 기존 노선의 현행 snapshot과 개편안이 모두 유효하지 않은 경우

지도 타일을 불러오지 못해도 정류장 편집은 좌표와 목록을 기준으로 계속할 수 있다. 좌표가 없는 프로젝트에서 신규 노선을 시작하면 먼저 정류장 생성 또는 좌표 입력을 요구한다.

## 실행 및 비교 규칙

- 현행 GTFS는 `currentNetwork`만 사용한다.
- 개편안 GTFS는 `scenarioNetwork`를 사용한다.
- 기존 노선은 현행·개편안 정류장 변경과 운행조건 차이를 표시한다.
- 신규 노선은 개편안에만 존재하며, 결과 카드에 `신규 노선`을 표시한다.
- 동일 OD 비교에서 현행 경로가 없고 개편안 경로만 있으면 `개편안 신규 경로`로 분류한다.
- 개편안 경로가 없으면 기존 오류가 아니라 `개편안 경로 없음`으로 분류한다.
- overlay, 신규 정류장, 신규 노선, 운행조건 변경은 GTFS/MOTIS/반복 검증 input fingerprint에 포함한다.
- 정류장 override는 개편안 fingerprint에 포함하고 현행 fingerprint에는 포함하지 않는다.
- 저장 후 프로젝트를 다시 열어도 scenario-owned 정류장·노선과 기존 routeChanges가 유지된다.

## 호환성

- v1/v2 `ScenarioDefinition`은 기존 upgrade 경로로 읽는다.
- v3 overlay 필드가 없는 정의는 기존 실행 경로를 사용한다.
- 기존 `scenarioDeltas`는 v3 routeChanges에서 계속 파생할 수 있다.
- 프로젝트 원본 route master와 station master의 저장 형식은 변경하지 않는다.
- 기존 텍스트 입력을 저장한 프로젝트는 migration 시 배열 기반 경로로 정규화하고, UI에서는 다시 텍스트 입력으로 노출하지 않는다.

## 컴포넌트 경계

- `ScenarioNetworkOverlayEditor`: overlay state와 저장 흐름을 조정한다.
- `ScenarioNetworkMap`: Leaflet marker, 선택, 신규 정류장 draft, 지도 이벤트를 담당한다.
- `SyntheticRouteScenarioEditor`: 기존 노선의 목록 편집과 overlay editor를 연결한다.
- `ScenarioNewRouteEditor`: 신규 노선의 메타데이터와 순서 편집을 담당한다.
- `scenario-network-overlay.ts`: 신규 정류장·노선 추가, 제외, 순서 변경, materialize, fingerprint를 담당하는 순수 core 모델이다.
- `scenario-contract.ts`: v3 validation, v1/v2 upgrade, legacy delta projection을 담당한다.

기존 `ScenarioDefinitionEditor`의 실행·여정·수요 패널은 primary route editor에서 제거한다. 필요한 legacy parsing과 core contract만 유지한다.

## 테스트 계획

### 0.8.0 후속 보완

- 기존 정류장 사전에서 개편안 목록으로 정류장을 추가할 수 있다.
- 목록이 독립 스크롤되고 선택 상태가 유지된다.
- primary scenario editor에 `Before/After` 텍스트 입력이 렌더링되지 않는다.
- v1/v2 시나리오 fixture가 기존 결과와 동일하게 복원된다.

### 0.9.0 overlay 기능

- 신규 정류장 생성·좌표 검증·ID 충돌 검증
- 신규 노선 생성·최소 정류장 수·중복 참조 검증
- 기존 노선 + 신규 정류장 조합 materialization
- 기존 정류장 override가 개편안에만 적용되는지 확인
- 신규 노선이 개편안 GTFS에만 포함되는지 확인
- Leaflet 지도 선택과 목록 선택의 양방향 동기화
- 지도에서 신규 정류장 draft를 취소·저장하는 흐름
- 기존 프로젝트 원본이 overlay 편집 후에도 동일한지 확인
- overlay 변경 후 GTFS/MOTIS/batch stale 상태 전환
- 현행 경로 없음·개편안 신규 경로의 비교 결과 표시

### 회귀 및 정적 검증

- `npm test`
- `npm run typecheck`
- `npm run build`
- Native Electron flow: 프로젝트 열기 → 계획·시나리오 → 지도 편집 → 저장 → 현행·개편안 생성·비교

## 수용 기준

- 사용자는 기존 정류장 목록에서 개편안 정류장을 추가할 수 있다.
- 사용자는 지도에서 신규 정류장을 만들고 기존 노선 또는 신규 노선에 배치할 수 있다.
- 사용자는 신규 노선을 만들고 기존/신규 정류장을 순서대로 구성할 수 있다.
- 정류장 목록은 독립적으로 스크롤되며 지도 선택과 상태가 동기화된다.
- 기본 사용자 흐름에는 텍스트 경로 나열 입력이 없다.
- 현행 원본 데이터는 편집 전후 동일하게 유지된다.
- 기존 v1/v2 시나리오와 프로젝트는 계속 열리고 실행된다.
- 현행 GTFS와 개편안 GTFS의 차이 및 신규 노선 상태가 결과에 표시된다.
- 테스트, typecheck, native build가 통과한다.

# Synthetic GTFS 및 MOTIS 통합 설계

## 1. 목적

Transit Analysis Platform에 GTFS가 없는 지역에서도 최소 노선 정보로 분석용 대중교통 네트워크를 만들고, MOTIS를 이용해 노선개편 전후 여정을 비교할 수 있는 기능을 추가한다.

최종 사용자 흐름은 다음과 같다.

```text
노선·정류장 자료 또는 공식 GTFS 선택
        ↓
운영 가정과 노선개편 시나리오 입력
        ↓
분석용 GTFS 생성 및 검증
        ↓
MOTIS 라우팅
        ↓
Before / After 여정·시간대·OD 비교
```

이 기능의 산출물은 실제 운행을 보장하는 시간표가 아니라, 입력값과 추정값을 명시한 분석용 데이터다.

## 2. 설계 판단

아이디어 1과 아이디어 2는 다음 경계로 결합한다.

- Synthetic GTFS Builder는 입력 정규화, 사용자 시나리오, 추정 운행시간, 배차계획, GTFS 생성, provenance를 담당한다.
- MOTIS는 대중교통·도보·환승 라우팅과 상세 여정 생성을 담당한다.
- Comparison Engine은 Before/After 결과를 지표별로 분해하고 시간대별·다수 OD 결과를 집계한다.
- Renderer는 입력 가정, 추정 상태, 경고, 비교 결과를 사용자가 확인하고 수정하는 화면을 담당한다.

MVP에서는 OSRM, Valhalla, GraphHopper, R5를 추가하지 않는다. MOTIS의 BUS profile과 OSM을 우선 검증하고, 성능이나 품질의 부족이 측정될 때만 다른 엔진을 도입한다.

## 3. 범위

### 포함

1. 기존 정류장·노선·운행 기준 자료를 분석용 내부 모델로 변환한다.
2. 공식 GTFS가 없을 때 정류장 좌표와 순서로 Synthetic GTFS를 생성한다.
3. 방향별 첫차·막차·운행횟수 또는 배차간격으로 기본 운행계획을 만든다.
4. 정류장 간 예상시간과 정차시간을 이용해 `stop_times.txt`를 생성한다.
5. 추정·사용자입력·공식값의 출처와 신뢰도를 보존한다.
6. 생성 결과를 GTFS 검증 결과와 함께 사용자에게 보여준다.
7. MOTIS sidecar를 통해 생성된 데이터의 라우팅 가능 여부를 확인한다.
8. 동일 OD와 출발시각 표본에 대해 Before/After 여정 지표를 비교한다.

### 후속 범위

- MOTIS가 실제로 처리하는 방식이 검증된 뒤 `frequencies.txt` 출력 지원
- OSM 도로등급·시간대별 혼잡·실제 BIS 기록 기반 운행시간 보정
- 한국형 환승요금 계산
- 도시 규모의 대규모 matrix와 R5 연동
- 자동 차량 제원 검증과 복잡한 운영 제약

### 제외

- 실시간 승객용 내비게이션
- 공식 운행정보로 오인될 수 있는 무표시 시간표 배포
- MVP 이전의 다중 도로 라우팅 엔진 병렬 도입

## 4. 내부 데이터 모델

현재 프로젝트의 `RouteStopMasterRecord`와 `RouteServiceConfig`를 그대로 외부 GTFS 모델로 노출하지 않고, 다음 정규화 모델을 새로 둔다. 기존 수요·혼잡도 분석은 기존 모델을 계속 사용하며, Synthetic GTFS 기능은 정규화 모델에서 필요한 기존 모델을 읽는다.

```ts
type DataSourceType =
  | 'OFFICIAL'
  | 'USER_INPUT'
  | 'OSM_INFERRED'
  | 'MODEL_ESTIMATED'
  | 'DERIVED';

type Confidence = 'high' | 'medium' | 'low';

interface Provenance {
  sourceType: DataSourceType;
  sourceName?: string;
  confidence: Confidence;
  isInferred: boolean;
  modelVersion?: string;
  assumptions: string[];
}

interface SyntheticRoute {
  routeId: string;
  routeName: string;
  transportMode: 'BUS' | 'COACH';
  directions: SyntheticDirection[];
  provenance: Provenance;
}

interface SyntheticDirection {
  directionId: string;
  directionLabel: string;
  stops: SyntheticStopSequence[];
  servicePlans: ServicePlan[];
  provenance: Provenance;
}

interface SyntheticStopSequence {
  stopId: string;
  stopName: string;
  latitude: number;
  longitude: number;
  stopSequence: number;
  timepoint: boolean;
  provenance: Provenance;
}

interface ServicePlan {
  serviceId: string;
  serviceDays: number[];
  firstDeparture: string;
  lastDeparture: string;
  departureCount?: number;
  headwayMinutes?: number;
  timeBands?: TimeBand[];
  sourceType: 'OFFICIAL' | 'USER_INPUT' | 'INFERRED';
  provenance: Provenance;
}

interface TimeBand {
  startTime: string;
  endTime: string;
  departureCount?: number;
  headwayMinutes?: number;
  weight?: number;
}
```

운행횟수는 방향별 편도 출발횟수로 정의한다. 왕복 총횟수만 알고 있는 경우 사용자가 방향별 배분을 입력하거나 명시적인 가정으로 변환해야 하며, 자동으로 조용히 절반으로 나누지 않는다.

## 5. 생성 파이프라인

### 5.1 입력 정규화

기존 `routeStopMaster`와 `routeServiceConfigs`, 공식 GTFS, 사용자 수기 입력을 하나의 정규화 모델로 변환한다. 필수 검증 항목은 다음과 같다.

- 노선 ID와 방향 ID 존재
- 방향별 정류장 2개 이상
- 정류장 순번 중복·누락·역순 여부
- 좌표의 유효 범위와 중복 ID 여부
- 서비스 요일 존재
- 첫차가 막차보다 늦지 않음
- 운행횟수 또는 배차간격이 양수

### 5.2 Route Geometry

MVP에서는 MOTIS의 OSM 기반 BUS profile과 `route_shapes.mode=missing` 설정을 우선 사용한다. 기존 shape가 있으면 유지하고 없는 경우만 추정한다.

정류장 도로망 매칭 실패, BUS 경로 실패, beeline 연결, 비정상 우회가 발생하면 결과를 차단하지 않고 검수 경고로 승격한다. 단, 해당 노선이 라우팅에 사용될 때는 경고와 추정 상태를 여정 결과까지 전파한다.

독립 `shapes.txt` 물질화가 MOTIS 인터페이스로 안정적으로 제공되지 않으면, MVP의 분석용 패키지는 shape가 없는 GTFS와 MOTIS import 설정을 함께 보존한다. 독립 shape export는 MOTIS PoC 결과가 확인된 뒤 별도 구현한다.

### 5.3 Travel Time Estimator

Shape와 운행시간은 분리한다. `TravelTimeEstimator`는 정류장 간 거리·도로 속성·정류장 수·정차시간·회전 및 교차로 지연을 받아 방향별 구간시간을 반환한다.

초기 모델은 결정론적이고 버전이 고정된 기준 모델로 둔다.

```text
구간 기본시간 = BUS 경로 거리 / 도로유형별 기준속도
구간 예상시간 = 구간 기본시간 + 정차시간 + 교차로·회전 보정
```

`자동차 경로시간 × 1.15`는 비교 실험용 fallback parameter로만 허용하고, 생산 결과의 보편적인 진실값으로 취급하지 않는다. 모든 결과에는 모델 버전과 보정값을 기록한다.

### 5.4 Schedule Synthesizer

MVP는 개별 `trips.txt`와 `stop_times.txt`를 생성한다. 첫차·막차·운행횟수의 양 끝 출발을 포함해 내부적으로 `count - 1`개 간격을 배분한다. `count === 1`이면 첫차만 생성하며 첫차와 막차가 다른 경우 경고한다.

시간대별 직접 입력은 각 시간대의 출발횟수 합이 전체 계획과 일치하는지 검증한다. 시간대별 가중치는 정수 운행횟수로 배분한 뒤 반올림 잔여분을 가장 큰 소수 잔여 순서로 분배해 총횟수를 보존한다.

`frequencies.txt`는 의미상 Synthetic 데이터에 적합할 수 있지만 MOTIS 호환성과 결과 재현성을 먼저 검증한 뒤 선택 출력으로 추가한다.

### 5.5 GTFS Compiler와 Validator

MVP 출력 파일은 다음과 같다.

```text
agency.txt
stops.txt
routes.txt
trips.txt
stop_times.txt
calendar.txt
shapes.txt 또는 MOTIS shape-missing 설정
tap-provenance.json
tap-validation.json
```

검증 실패는 두 종류로 나눈다.

- 차단 오류: 필수 파일 누락, 노선·정류장·서비스 없음, 잘못된 좌표, 시간 역전, 방향별 정류장 부족
- 검수 경고: OSM 추정, 낮은 신뢰도, beeline, 과도한 우회, 사용자 가정, 모델 추정

생성 패키지와 분석 화면에는 다음 문구를 노출한다.

```text
본 데이터는 교통 분석을 위해 생성된 추정 운행계획입니다.
실제 버스 운행시간표와 다를 수 있습니다.
```

## 6. MOTIS Sidecar 경계

Electron Main Process가 MOTIS 프로세스를 시작·종료·상태확인하고, Renderer는 IPC를 통해서만 요청한다.

```text
Renderer
   ↓ IPC
Electron Main
   ↓ localhost HTTP
motis.exe
```

Main Process는 다음만 담당한다.

- 실행 파일 경로와 임시 데이터 디렉터리 결정
- 포트 선택과 readiness 확인
- Before·After 인스턴스의 생명주기 관리
- 요청 timeout·종료·stderr 진단
- Renderer에 안전한 상태·오류만 전달

MOTIS OpenAPI 응답의 세부 구조는 `Comparison Engine` 경계에서 애플리케이션 내부 지표로 변환한다. Renderer가 MOTIS 응답 형식에 직접 의존하지 않도록 한다.

## 7. Before / After 비교

Scenario Builder는 Base GTFS를 직접 수정하지 않고 변경분을 별도로 유지한다.

```text
Base Transit Model
        + Scenario Delta
        ↓
Before GTFS / After GTFS
        ↓
MOTIS Before / MOTIS After
        ↓
Comparison Engine
```

비교 엔진은 최소한 다음 값을 반환한다.

```text
totalTravelTime
inVehicleTime
initialWaitTime
transferCount
transferWalkTime
transferWaitTime
accessWalkTime
egressWalkTime
totalWalkDistance
routeLegs
fare (별도 엔진 결과 또는 unavailable)
```

합성 데이터가 포함된 결과는 값과 함께 신뢰도·가정·경고를 표시한다. 단일 출발시각 결과는 참고용으로만 보여주고, MVP 검증 흐름은 지정 시간창의 평균·중앙값·P90을 함께 산출한다.

## 8. 구현 게이트

각 게이트는 독립적으로 실행 가능하고 사용자 확인을 받아야 다음 게이트로 이동한다.

### Gate 1: Synthetic GTFS 초안 생성

사용자가 기존 노선·정류장 자료와 운행 가정을 선택하면 GTFS 파일 목록, 생성된 trip 수, 추정값·사용자 입력값 구분, 검증 경고를 화면에서 확인하고 ZIP으로 내보낸다.

합격 기준:

- 정류장 순서와 방향이 미리보기와 일치
- 요청한 방향별 운행횟수와 생성 trip 수가 일치
- 첫차·막차·중간 정류장 시간이 역전되지 않음
- provenance와 Synthetic 경고가 ZIP과 화면에 존재

### Gate 2: MOTIS 연결

Gate 1 결과를 MOTIS sidecar로 import하고 샘플 OD의 라우팅 성공 여부, process 상태, 오류 원인을 화면에서 확인한다.

### Gate 3: Shape·시간 검증

실제 지역 OSM PBF와 20~50개 노선 샘플을 이용해 BUS shape, beeline, 우회, 정류장 매칭, 예상시간을 검증한다.

### Gate 4: Before / After 분석

한 노선의 정류장 또는 운행횟수를 변경해 동일 OD·출발시각의 차량시간, 대기시간, 환승, 보행시간 차이를 확인한다.

### Gate 5: 반복·성능 검증

시간창 반복 계산과 one-to-many benchmark를 실행하고, 실제 규모에 따라 MOTIS 단독 유지 또는 R5 추가를 결정한다.

## 9. 성공 기준

1. GTFS가 없는 입력으로도 사용자가 분석용 GTFS를 생성할 수 있다.
2. 모든 추정값과 사용자 가정은 결과에서 추적 가능하다.
3. MOTIS를 통해 동일 OD의 Before/After 여정을 재현할 수 있다.
4. 생성 실패와 낮은 품질이 조용히 숨겨지지 않는다.
5. Synthetic 결과가 공식 시간표로 오인되지 않는다.
6. 기존 교통카드 수요·혼잡도 분석 기능과 프로젝트 저장·복원을 깨뜨리지 않는다.

## 10. 후속 구현계획으로 넘길 파일 경계

예상 신규 모듈은 다음 책임을 가진다.

- `src/core/synthetic-gtfs/types.ts`: 정규화 모델·입출력 타입
- `src/core/synthetic-gtfs/provenance.ts`: 출처·신뢰도·가정 생성
- `src/core/synthetic-gtfs/schedule-synthesizer.ts`: 운행계획 생성
- `src/core/synthetic-gtfs/travel-time-estimator.ts`: 구간시간 추정
- `src/core/synthetic-gtfs/gtfs-compiler.ts`: GTFS 파일 생성
- `src/core/synthetic-gtfs/validator.ts`: 차단 오류·검수 경고
- `src/core/synthetic-gtfs/__tests__/*`: 순수 로직 테스트와 fixture
- `src/main/motis-sidecar.ts`: MOTIS 프로세스 생명주기와 localhost 통신
- `src/preload/index.ts`: 안전한 IPC API 노출
- `src/renderer/*`: 단계별 입력·검증·결과 화면

기존 `src/core/*` 분석 모듈과 기존 프로젝트 스키마는 새 기능에 필요한 최소 확장만 하고, 무관한 리팩터링은 수행하지 않는다.

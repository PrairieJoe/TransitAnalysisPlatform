# Synthetic GTFS·MOTIS 단계별 실증 시나리오

이 문서는 구현된 기능을 이용자가 순서대로 검증하는 실증 절차다. 앱은 공식 시간표가 없는 지역에서도 분석용 Synthetic GTFS를 생성할 수 있지만, 생성 데이터와 MOTIS 결과를 실제 운행 사실로 해석하지 않는다. 노선 매핑을 마친 마지막 가져오기 단계에서 `GTFS 구축으로 이동`을 선택하면 분석 결과 화면을 거치지 않고 프로젝트를 저장한 뒤 Builder로 바로 이동한다.

## 0. 실증 준비

1. 저장소 루트에서 `npm install`, `npm run typecheck`, `npm test`, `npm run build`를 실행한다.
2. `fixtures/yeosu-card-transaction-sample.dat`, `fixtures/yeosu-station-master-sample.dat`, `fixtures/yeosu-route-station-master-sample.dat`를 준비한다.
3. 현재 저장소에는 다음 실증 자산이 준비되어 있다.
   - 개발용 MOTIS: `vendor/motis/patched-windows/motis.exe`
   - 설치본의 MOTIS: `resources/motis/motis.exe`와 `resources/motis/tiles-profiles`
   - 대한민국 전체 PBF 검증용 실행 파일: `vendor/motis/patched-windows/motis.exe`
   - 대한민국 전체 PBF: `data/osm/south-korea-latest.osm.pbf`
   - fixture: `fixtures/yeosu-card-transaction-sample.dat`, `fixtures/yeosu-station-master-sample.dat`, `fixtures/yeosu-route-station-master-sample.dat`
4. `npm run dev`로 앱을 실행한다. 세 fixture를 매칭한 뒤 마지막 노선별 정류장정보 단계에서 `GTFS 구축으로 이동`을 선택한다. 프로젝트가 저장되고 Synthetic GTFS Builder가 바로 열려야 한다. `분석 실행`을 선택한 경우에도 분석 결과 화면의 `GTFS 구축` 버튼으로 Builder를 열 수 있다.
5. MOTIS는 앱이 관리한다. 배포본은 `resources/motis/motis.exe`를 숨겨진 sidecar로 실행하고, 개발 환경은 `vendor/motis/patched-windows/motis.exe`를 우선 사용하며 없을 때만 `vendor/motis/windows/motis.exe`로 fallback한다. import/server가 생성하는 변경 데이터는 `%LOCALAPPDATA%\Transit Analysis Platform\motis-data` 아래에 두며, `127.0.0.1`의 사용 가능한 포트는 앱이 자동 선택한다. Builder의 `고급 진단`은 읽기 전용 경로·포트 확인용이며 실행 파일 경로, 작업 폴더, 포트를 입력하지 않는다.
6. Builder에서 기본으로 보이는 최소 입력은 분석 노선, 운행대수, 첫차, 막차, 배차간격(분), After 시나리오 정류장 ID다. 기관명, 서비스 기간, 운행 요일, 정차시간, 역방향 파생은 접힌 `고급 설정`의 기본값으로 처리한다. 운행대수는 실제 차량 배정이 아니라 입력 가정이며, provenance와 결과 주의사항에만 기록된다.
7. 배차간격으로 방향별 Trip 수를 계산한다. `floor((막차-첫차)/배차간격)+1`이며, 예를 들어 `06:00`~`23:00`에 `20분`이면 방향당 `52회`, 역방향 파생을 켜면 총 `104 Trip`이다. 운행 종료 시각에 정확히 맞지 않는 경우에도 막차를 넘지 않는 출발만 생성한다.
8. PBF가 없으면 Builder의 `Geofabrik 다운로드 페이지 열기`로 공식 페이지를 열고, 다운로드 후 `파일 선택`과 `PBF 파일 검증`을 실행한다. 화면에 파일 크기와 SHA-256이 표시되어야 한다. 앱은 Windows 호환성을 위해 `TBB_NUM_THREADS=1`을 자동 전달하고 지도 tiles 생성도 자동으로 끄므로 이용자가 환경변수를 따로 설정할 필요는 없다.
9. MOTIS 작업 폴더와 OSM PBF가 백신/권한 정책으로 차단되지 않는지 확인한다. 앱은 shell을 사용하지 않고 내장 실행 파일에 인자를 배열로 전달한다.

## 1. Gate 1 — 단일 노선 Synthetic GTFS

1. `npm run dev`로 앱을 실행하고 새 분석을 시작한다.
2. 거래내역·정류장정보·노선별 정류장정보를 각각 연결한다. 노선별 정류장정보는 `fixtures/yeosu-route-station-master-sample.dat`를 사용한다.
3. 마지막 매핑 단계에서 `GTFS 구축으로 이동`을 눌러 Builder를 직접 연다. 노선 `여수2 · 325000002 · B`를 선택한다.
4. 기본 최소 입력을 확인한다. 운행대수 `8`, 첫차 `06:00`, 막차 `23:00`, 배차간격 `20분`이며, After 시나리오 정류장 ID는 비워 둔다. 평일 운행·정차시간 `20초`·역방향 파생은 고급 설정의 기본값이다.
5. `Before/After GTFS 생성`을 누른다.
6. 다음을 판정한다.
   - 생성 결과에 `agency.txt`, `stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`, `calendar.txt`, `tap-motis-config.json`, `tap-provenance.json`, `tap-validation.json`이 보인다.
   - 요약의 Trip 수가 배차간격에서 파생된 방향당 52회와 일치한다. 역방향 파생을 켠 경우 총 Trip 수는 104개다.
   - `tap-provenance.json` 미리보기에서 공식 원본, 사용자 입력, 파생 방향, 모델 추정이 구분된다.
   - `tap-validation.json`의 차단 오류가 없고, Synthetic 데이터·OSM shape 추정 경고가 보인다.
7. `After Synthetic GTFS ZIP 저장`을 눌러 ZIP을 저장하고 압축 내부의 9개 파일을 확인한다.

## 2. Gate 4 — A-B-C-D-E → A-B-X-Y-E Scenario Delta

1. 1번 절차와 동일한 노선·최소 입력으로 Builder를 연다. 운행대수는 실제 차량 배정이 아닌 provenance용 가정이다.
2. 원본 경로의 정류장 ID를 확인해 기준이 `A,B,C,D,E` 형태가 되도록 선택한다. `X`, `Y`는 반드시 정류장 master에 실제 좌표·이름이 있는 ID를 사용한다. 자료에 없으면 임의 좌표를 입력하지 말고, 먼저 정류장 master에 검증된 행을 추가한다.
3. `After 시나리오 정류장 ID`에 `A,B,X,Y,E`를 입력하고 생성한다.
4. `Scenario Delta`에서 추가 ID `X,Y`, 제거 ID `C,D`, 기준 경로와 After 경로가 각각 올바르게 보이는지 확인한다.
5. 프로젝트를 저장한 뒤 `project.json`의 `scenarioDeltas`에 scenario ID, 경로, 추가·제거 ID, 경고, 생성시각이 남는지 확인한다. Base 노선 master 자체가 수정되어서는 안 된다.

## 3. Gate 2 — 실제 MOTIS readiness와 단일 OD

1. Builder의 `앱 내장 MOTIS · 로컬 데이터 자동 관리 · 타일 지도 제외` 상태를 확인하고, 별도로 받은 OSM PBF를 `파일 선택`으로 지정한다. 필요하면 `PBF 파일 검증`으로 파일 크기와 SHA-256을 확인한다. 실행 파일·작업 폴더·포트는 입력하지 않는다.
2. 출발 정류장과 도착 정류장을 선택하고 출발 일시는 화면 기본값인 KST 오늘 08:00을 사용한다. 서비스 기간 안의 날짜를 직접 입력해도 된다.
3. `MOTIS 준비·실행 + Before/After OD`를 누른다. 앱은 각 패키지에 대해 다음을 수행한다.
   - Synthetic GTFS를 데이터 폴더의 `tap-synthetic-gtfs.zip`으로 저장
   - `motis config <OSM PBF> <GTFS ZIP>` 실행
   - 내장 MOTIS 배포 폴더에서 `motis import -c <작업폴더>\config.yml -d <작업폴더>\data` 실행
   - 앱이 관리하는 포트에서 `motis server` 실행 후 health endpoint polling. sidecar가 tiles 없는 config와 지정한 환경변수를 import와 server 모두에 전달한다.
4. 상태가 `ready`가 되는지 확인한다. 실패 시 화면에 실행 파일 누락, OSM PBF 누락, 포트 충돌, readiness timeout, HTTP 오류와 최근 MOTIS 로그가 표시되어야 한다.
5. 결과의 Before/After에서 총 소요시간, 차량 탑승시간, 초기 대기, 환승 대기·보행, 접근·귀가 보행, 환승 횟수와 델타를 확인한다.
   - plan API에는 원본 ID가 아니라 `tap-synthetic-gtfs_3250842`처럼 MOTIS dataset-qualified 정류장 ID가 사용된다.
6. 어느 한쪽이 무경로이면 개선시간이 `0분`으로 표시되지 않고 `—`와 무경로 경고가 표시되어야 한다.

## 4. Gate 3 — shape와 시간 추정 품질

1. 일반 노선, BUS 제한 또는 복잡한 도로가 있는 노선, 일방통행이 의심되는 노선, 경로 실패가 예상되는 노선을 각각 최소 1개씩 선택한다.
2. MOTIS 결과에 `shapeQuality` 또는 `tapShapeQuality` 원시 지표가 포함되는 경우 Builder가 beeline 비율과 우회비율을 표시하는지 확인한다.
3. beeline 구간이 1개라도 있으면 검수 경고가 표시되어야 한다. 우회비율이 1.75를 초과하면 추가 경고가 표시되어야 한다.
4. 원시 shape 품질 지표가 없는 경우 앱이 임의의 0% 품질을 표시하지 않고 “원시 지표가 포함될 때 표시”라고 남기는지 확인한다.

## 5. Gate 5 — 시간창 반복

1. 동일 OD에 시작 `06:00`, 종료 `09:00`, 간격 `5분`을 설정한다. 포함 시점은 37개다.
2. `시간창 배치 실행`을 누르고 Base/Scenario 질의 진행률을 확인한다.
3. 평균, 중앙값, P90, Base/After별 발견 여정 수와 경고를 확인한다.
4. 일부 시점이 무경로이면 통계의 분모에 무경로를 넣지 않고 `sampleCount`, `foundBefore`, `foundAfter`로 별도 표시하는지 확인한다.

## 6. 규모 벤치마크

1. `docs/benchmarks/motis-batch-template.md`를 복사해 측정일·MOTIS 버전·OSM·하드웨어를 기록한다.
2. 100개 출발지 × 100개 도착지 × 24개 출발시각을 Base와 Scenario 각각 실행한다. 시나리오별 240,000건, 양쪽 합계 480,000건이다.
3. wall time, OD/s, 평균·P90 지연, CPU, 피크 RAM, 결과 크기, 오류·무경로 수를 기록한다.
4. 수치가 없는 칸은 `미측정`으로 남긴다. 이 결과로 MOTIS 단독 유지와 별도 R5 어댑터 도입을 결정하며, 측정 전에는 R5를 추가하지 않는다. 현재 패치 빌드는 지도 tiles를 생성하지 않으므로 tiles API 성능은 별도 측정 대상이다.

## 재현성·실패 판정

- `tap-provenance.json`, `tap-validation.json`, 입력 가정, MOTIS 버전, OSM PBF 파일명과 hash를 함께 보관한다.
- 공식 GTFS와 Synthetic GTFS를 같은 출처로 표시하지 않는다.
- 기준·After의 OD, 출발시각, 포트, OSM PBF가 다르면 Before/After 비교를 판정하지 않는다.
- 실제 수행 결과는 `docs/test-reports/2026-09-18-synthetic-gtfs-motis-scenario-report.md`에 기록한다. 공식 v2.11.3 release는 `node 1642968 ... has 18 ways, maximum is 16` 오류로 전국 PBF import가 불가능하지만, `patched-windows` 빌드는 32-way OSR 패치와 단일 TBB worker로 full-OSM Base/After import·server·plan을 통과한다.

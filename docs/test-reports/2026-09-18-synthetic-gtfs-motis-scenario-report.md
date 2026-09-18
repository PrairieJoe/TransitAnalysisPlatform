# Synthetic GTFS·MOTIS 실제 시나리오 테스트 보고서

## 결론

동일한 여수2 노선 시나리오로 앱의 Synthetic GTFS 생성과 MOTIS 시간표·OD 비교를 검증했다.

| 영역 | 판정 | 결과 |
| --- | --- | --- |
| 앱 UI에서 Synthetic GTFS 생성 | 통과 | 기준 10개 정류장, After 8개 정류장, `06:00~23:00`·20분 간격으로 방향당 52회·왕복 파생 총 104 Trip |
| MOTIS timetable-only import/server/plan | 통과 | Base·After 모두 37/37개 시점에서 직행 BUS 여정 발견 |
| Before/After 결과 일치성 | 통과 | 총 소요시간 4,920초→4,200초, 델타 -720초(-12분) |
| 대한민국 전체 OSM PBF 포함 routing import | 통과(패치 빌드) | 32-way OSR 패치 + tiles 비활성화 + `TBB_NUM_THREADS=1`로 Base·After import/server/plan 완료 |

따라서 패치 MOTIS 실행 파일을 사용할 경우 “Synthetic GTFS와 시간표 기반 노선개편 비교”와 “대한민국 전체 PBF를 이용한 OSM 보행 접근·귀가 routing”까지 end-to-end로 동작한다. 현재 Windows MinGW 패치 빌드는 지도 tiles shard 병합에서 heap corruption이 발생하므로 앱은 tiles 생성을 끄고 `TBB_NUM_THREADS=1`을 자동 전달한다. MOTIS 지도 tile API가 필요한 경우에는 별도 MSVC/공식 Windows 빌드 검증이 필요하다.

## 고정한 테스트 입력

- 노선: `여수2`, route ID `325000002`
- 기준 경로: `3250842,3250843,3250844,3250847,3250848,3250913,3251188,3251189,3251204,3250845`
- After 경로: `3250842,3250843,3250847,3250913,3251188,3251189,3251204,3250845`
- 제거 정류장: `3250844`, `3250848`
- 출발지→도착지: `3250842`→`3250845`
- 운행: 월~금, 06:00~23:00, 운행대수 8대(차량 배정 가정), 배차간격 20분, 방향당 52회, 정차 20초, 역방향 파생 총 104 Trip
- 기준일: 실행 당시 KST `2026-09-18`, 08:00
- 배치: 06:00~09:00, 5분 간격, 37개 시점
- MOTIS Windows 배포본: `v2.11.3-dirty`
- MOTIS ZIP SHA-256: `34655045EE02B45F32A7F99F86BE3195CB5FA44E1B791CA84FFBA2EB284A67E3`
- full-OSM 검증 바이너리: `MOTIS 98ca609-dirty` (`vendor/motis/patched-windows/motis.exe`)
- full-OSM 검증 바이너리 SHA-256: `CFBF19B51AB1EBC89A720EE731AF6BC566311D4D53A83D3919CFE4A56CCDD719`
- 대한민국 PBF SHA-256: `78A5EFD96B5E69798797346380F015F86237DE754AA0B70D780296ED9A112540`

MOTIS API에는 GTFS 원본 정류장 ID를 그대로 보내지 않고 `tap-synthetic-gtfs_3250842`처럼 dataset tag가 붙은 ID를 보내야 한다. 이 형식은 MOTIS 공식 설정 문서의 dataset tag prefix 규칙에 맞춘 것이다. [MOTIS setup 문서](https://github.com/motis-project/motis/blob/master/docs/setup.md)

## 앱 UI 실행 확인

동일 fixture를 renderer에서 실제로 가져와 마지막 노선 매핑 단계의 `GTFS 구축으로 이동`으로 Builder를 직접 열었다. 분석 결과 기간은 `2024-04-15 ~ 2024-04-21`, 분석 행은 `48개`로 표시됐다. Builder에서 기준 경로는 10개 정류장·104 Trip으로 생성됐고, 위 After 경로를 입력한 뒤 8개 정류장·104 Trip과 제거 ID 2개가 표시됐다. 기본 화면에는 노선·운행대수·첫차·막차·배차간격·After 정류장 ID만 보였고, 기관·서비스 기간·요일·정차시간·역방향은 접힌 고급 설정에 있었다.

## 실제 실행 결과

재현 스크립트는 앱과 동일한 parser·Synthetic GTFS builder·MOTIS sidecar·journey normalizer를 사용한다.

```powershell
npm run test:motis-scenario
```

실행 결과:

```text
Base:     found=true, 4,920초, BUS 1개, 환승 0회
After:    found=true, 4,200초, BUS 1개, 환승 0회
Delta:    -720초 (-12분)
Batch:    37/37 → 37/37
평균:     4,920초 → 4,200초
중앙값:   4,920초 → 4,200초
P90:      4,920초 → 4,200초
```

실행 산출물:

- [실행 보고서](../../test-artifacts/motis-scenario/2026-09-18T05-31-15-558Z/report.json)
- [Base MOTIS plan 원문](../../test-artifacts/motis-scenario/2026-09-18T05-31-15-558Z/base/plan-response.json)
- [After MOTIS plan 원문](../../test-artifacts/motis-scenario/2026-09-18T05-31-15-558Z/scenario/plan-response.json)
- [Base 배치 정규화 결과](../../test-artifacts/motis-scenario/2026-09-18T05-31-15-558Z/base/batch-journeys.json)
- [After 배치 정규화 결과](../../test-artifacts/motis-scenario/2026-09-18T05-31-15-558Z/scenario/batch-journeys.json)

### 대한민국 전체 PBF 포함 최종 실행

최종 full-OSM 실행은 `2026-09-18T01-24-15-875Z`에 패치 바이너리로 수행했다. Base·After 모두 tiles 없이 import 완료, health readiness 통과, 동일 OD의 plan 응답 및 37개 배치 질의를 확인했다.

```text
Base:     found=true, 1,380초, WALK + BUS, 환승 0회
After:    found=true, 1,380초, WALK + BUS, 환승 0회
Delta:    총 소요시간 0초, 초기 대기 +300초, 차량시간 0초
Batch:    37/37 → 37/37
```

full-OSM 결과에서 총 소요시간이 동일한 것은 오류가 아니다. OSM 보행 연결이 요청한 출발 정류장 `3250842`에서 `3251189`까지 300초로 계산되어 두 경로 모두 같은 정류장에서 탑승했기 때문이다. 정류장 제거 자체와 Synthetic GTFS 생성 변화는 아래 `summary` 및 원시 plan 응답에서 확인할 수 있고, 도로 접근까지 포함한 결과는 timetable-only 결과와 다를 수 있다.

- [full-OSM 실행 보고서](../../test-artifacts/motis-scenario/2026-09-18T01-24-15-875Z/report.json)
- [full-OSM Base plan 원문](../../test-artifacts/motis-scenario/2026-09-18T01-24-15-875Z/base/plan-response.json)
- [full-OSM After plan 원문](../../test-artifacts/motis-scenario/2026-09-18T01-24-15-875Z/scenario/plan-response.json)

### Task 6 수동 fixture 흐름

이번 Task 6에서는 개발 renderer에서 세 fixture를 업로드하고 마지막 노선 매핑 단계의 `GTFS 구축으로 이동`을 선택했다. 프로젝트 저장 후 Builder가 분석 결과 화면을 건너뛰고 열렸으며, 기본 화면에는 분석 노선·운행대수·첫차·막차·배차간격·After 정류장 ID만 보였다. `여수2 · 325000002 · B`를 선택해 Before/After를 생성한 결과 10개/8개 정류장, 104/104 Trip, 제거 ID `3250844`, `3250848`이 표시됐다. 접힌 고급 설정에는 기관·서비스 기간·요일·정차시간·역방향 기본값이 있었다.

현재 UI 자동화 표면에서는 native Electron 창 대신 localhost renderer를 조작할 수 있었기 때문에 Windows 파일 선택 대화상자, 내장 MOTIS IPC, 실제 PBF 선택 후 UI 버튼 실행은 수동으로 재현하지 못했다. 이 native-only 구간은 `npm run test:motis-scenario`의 실제 MOTIS import/server/plan 결과로 보완했다. renderer 콘솔에는 한 건의 React controlled-input 경고가 기록됐지만 화면 전환·생성 결과에는 영향이 없었다.

## 이용자 재현 절차

### A. 앱 UI에서 GTFS 생성 결과 확인

1. `npm run dev`로 Electron 앱을 실행한다.
2. 새 분석에서 다음 세 fixture를 순서대로 연결한다.
   - `fixtures/yeosu-card-transaction-sample.dat`
   - `fixtures/yeosu-station-master-sample.dat`
   - `fixtures/yeosu-route-station-master-sample.dat`
3. 분석을 완료한 뒤 프로젝트의 `Synthetic GTFS`를 연다.
4. 노선 `여수2 · 325000002 · B`를 선택한다.
5. 운행대수 `8`, 첫차 `06:00`, 막차 `23:00`, 배차간격 `20분`을 유지한다. 월~금, 정차시간 `20초`, 역방향 파생은 고급 설정의 기본값이다. 이 입력은 `floor((23:00-06:00)/20)+1 = 52`회/방향, 왕복 파생 시 104 Trip을 만든다.
6. 기준 경로 그대로 `Before/After GTFS 생성`을 눌러 기준 결과를 확인한다.
7. After 입력란에 다음을 입력하고 다시 생성한다.

```text
3250842,3250843,3250847,3250913,3251188,3251189,3251204,3250845
```

8. 다음 결과를 기대한다.
   - 기준: 정류장 10개, Trip 104개
   - After: 정류장 8개, Trip 104개
   - Scenario Delta 제거: `3250844`, `3250848`
   - 예상 경고: Synthetic 사용자/추정 데이터, MOTIS OSM shape 추정

### B. MOTIS 시간표·OD 비교 재현

전국 PBF의 OSR import 제한과 시간표 계산을 분리하여 확인하려면 저장소 루트에서 다음을 실행한다. 이 스크립트도 Builder와 같은 운행대수·배차간격 입력을 사용한다.

```powershell
npm run test:motis-scenario
```

스크립트는 Base와 After를 각각 새 MOTIS 데이터 폴더에 import하고, `http://127.0.0.1:8080/api/v1/health`가 준비된 뒤 동일 OD를 질의한다. 앱 UI에서는 포트를 자동 선택하지만 이 개발용 재현 스크립트는 결과 재현을 위해 8080을 고정한다. 실행 날짜는 KST 기준 오늘로 사용하므로, 2026년 서비스 기간 안에서 같은 결과를 얻는다. 출력된 `outputRoot` 아래의 `report.json`에서 실제 결과를 확인한다.

같은 입력으로 대한민국 전체 PBF import와 Before/After API 비교를 확인하려면 다음을 실행한다.

```powershell
npm run test:motis-scenario -- --full-osm
```

스크립트는 일반 timetable-only 실행과 `--full-osm` 실행 모두 `vendor/motis/patched-windows/motis.exe`를 우선 선택하고, 해당 파일이 없을 때만 `vendor/motis/windows/motis.exe`로 fallback한다. `MOTIS_EXECUTABLE_PATH`가 지정되면 그 경로가 우선한다. tiles 설정을 제거한 뒤 patched MinGW 빌드의 안정성을 위해 import/server 자식 프로세스에 `TBB_NUM_THREADS=1`을 자동 전달한다. 앱 설치본에서는 사용자가 바이너리 경로를 지정하지 않으며 `resources/motis/motis.exe`를 사용한다. 개발 스크립트에서 다른 바이너리를 지정하려면 다음처럼 명시한다.

```powershell
$env:MOTIS_EXECUTABLE_PATH = "C:\\path\\to\\motis.exe"
npm run test:motis-scenario -- --full-osm
```

공식 v2.11.3 release를 지정하면 다음 제한으로 실패한다.

```text
node 1642968 (osm=10729381152) has 18 ways, maximum is 16
```

원문은 실행 산출물의 `base/data/logs/osr.txt`에 남는다. 이 오류는 GTFS 시나리오의 정류장·시간표 검증 실패가 아니라, 공식 Windows 배포본이 대한민국 전체 PBF를 OSR graph로 만드는 단계에서 중단된 것이다. 패치 빌드는 이 제한을 32-way로 확장했으며, 병렬 import의 `0xC0000374` heap corruption을 피하기 위해 단일 TBB worker로 실행한다.

- [full-Osm OSR 원문 로그](../../test-artifacts/motis-scenario/2026-09-17T16-43-12-039Z/base/data/logs/osr.txt)

## 변경 및 회귀 확인

- MOTIS import를 배포 폴더에서 실행하고 `-c <작업폴더>\config.yml -d <작업폴더>\data`를 명시하도록 sidecar를 보완했다. 이에 따라 `tiles-profiles/full.lua` 상대경로 오류를 제거했다.
- plan 요청에 MOTIS dataset-qualified stop ID를 사용하도록 보완했다.
- MOTIS의 기본 timetable window(`TODAY`)와 맞도록 출발일시 기본값을 KST 오늘 08:00으로 보완했다.
- Windows 패치 빌드의 tiles 병렬 import 불안정성을 config의 tiles 제거와 앱 경계의 `environment` 전달(`TBB_NUM_THREADS=1`)로 자동 회피한다.
- Geofabrik 대한민국 페이지 열기, OSM PBF 파일 선택, 파일 크기·SHA-256 확인 IPC를 Builder에 연결했다.
- `npm test` 전체 회귀 테스트를 통과시켜야 최종 완료로 판정한다. 최신 실행에서 26개 파일·174개 테스트가 통과했다.

## 다음 조치

1. 운영 목적이 시간표·정류장 기반 비교라면 현재 timetable-only 경로를 우선 검증 대상으로 사용한다.
2. OSM shape와 보행/접근·귀가 routing이 필요하면 앱이 관리하는 내장 MOTIS를 사용한다. 개발 환경은 `vendor/motis/patched-windows/motis.exe`, 설치본은 `resources/motis/motis.exe`를 자동 선택하며, tiles 비활성화와 스레드 환경변수는 자동 적용된다. 사용자가 실행 파일·작업 폴더·포트를 입력하지 않는다.
3. PBF는 설치본에 포함하지 않고 Geofabrik에서 별도로 받은 뒤 Builder에서 선택한다. 공식 release를 계속 사용할 경우 전국 PBF는 지원 범위 밖이므로, 패치 빌드 또는 지역 추출/분할 전략을 선택해야 한다.

Synthetic GTFS의 운행시간·정류장 순서는 원본 공식 시간표가 아니라 분석 가정이다. 따라서 위 결과는 “시나리오 간 계산 차이”를 검증한 것이며 실제 운행시간의 보증이 아니다.


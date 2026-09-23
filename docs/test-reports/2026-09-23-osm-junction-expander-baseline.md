# OSM junction expander baseline test — 2026-09-23

## 판정

현재 checkout에는 junction expander, 변환된 PBF, 변환기 테스트 fixture가 없다. 따라서 이 실행은 실제 PBF의 회전제한 사례를 골라 **변환 전 기준 경로를 확보한 단계**다. 변환 전후 전환 집합 일치와 OSR 16 occurrence 준수는 아직 실행할 대상이 없어 판정하지 않았다.

## 입력과 실행 환경

- PBF: `data/osm/south-korea-latest.osm.pbf`
- 현재 PBF 크기: 287,629,706 bytes
- 현재 PBF SHA-256: `68ed4bbb72e41b73421e28d8282d82e5fc6f4a2cb78a0913b6812d32aa910252`
- MOTIS: `vendor/motis/patched-windows-msvc-candidate/motis.exe`
- MOTIS binary SHA-256: `d91627ab9f74959fb97dd2996c5df610059b565d29f95a1358056a4b7b458bff`
- CAR 경로: `/api/v1/one-to-many`, `mode=CAR`, `maxMatchingDistance=30`, `arriveBy=false`; 같은 PBF에서 import된 2026-09-22 시나리오 데이터 사용
- 기존 exact-hash 증거: `test-artifacts/motis-validation-attestation.json`은 동일 PBF 및 binary hash에 묶여 있고 공식 16-way의 18-way 실패와 32-way 후보 검증을 기록한다. `docs/test-reports/2026-09-21-geofabrik-south-korea-pbf-validation.md`의 입력 hash는 `f4f836…e749c`여서 이번 PBF 기준으로 재사용하지 않았다.

## 실제 회전제한 표본

표본 탐색의 occurrence 값은 PBF 안의 `highway=*` way를 세어 얻은 **예비값**이다. construction/proposed/abandoned/razed/disused/planned 값은 제외했지만, OSR의 고정된 retained-way 필터와 같은지 확인하지 못했으므로 정식 occurrence 판정이 아니다.

| relation / via node | restriction | 예비 occurrence | CAR 원본 결과 | 판정 |
| --- | --- | ---: | --- | --- |
| `370748` / `304995293` | `no_left_turn` | 4 | from→to: 30초 제한에서 경로 없음, 3600초 제한에서 64초. 반대 방향: 9초 | 방향 차이가 관측됨; 원본 기준 후보 |
| `2869314` / `2260053042` | `only_straight_on` | 4 | from→to: 30초 제한에서 경로 없음, 3600초 제한에서 43초. 반대 방향: 30초에서 경로 없음, 3600초에서 79초 | 두 one-way way의 순서는 from이 via로 들어오고 to가 via에서 나감; 원본 기준 후보 |
| `3217282` / `2464856341` | `no_u_turn` | 3 | 양방향 모두 60초. 요청 `max=30`에서도 응답이 60초 | 제한 동작으로 판정하지 않음; cutoff/경로 의미 추가 확인 필요 |

좌표는 relation의 from/to way에 붙은 인접 OSM node 좌표다. `no_left_turn` 표본의 from/to 좌표는 각각 `36.3410387,127.4490134`와 `36.3402847,127.4489043`이다. `only_straight_on`은 `36.628583,127.4282903`에서 `36.6284254,127.42841`, `no_u_turn`은 `34.9745465,126.7300206`에서 `34.9745021,126.7300626`이다.

CAR API 결과는 endpoint 사이 최단시간이며 전체 도시망을 경유할 수 있다. 따라서 원본 route 결과는 변환 후 비교의 기준자료로 남기되, 개별 turn만 통과했는지 확정하는 전환표를 대신하지 않는다.

## 실행한 프로젝트 검증

- `npm test`: **98 test files / 515 tests passed**.
- `node scripts/motis/verify-patched-build.mjs vendor/motis/patched-windows-msvc-candidate/motis-manifest.json`: 실패 — `Builder toolchain is not locked.` 현재 빌드 후보의 lock 검증 게이트가 충족되지 않았다. 이는 junction expander의 회전 동등성 결과가 아니다.

## 후속 판정에 필요한 테스트 자산

1. OSR `v2.11.3` retained-way 필터를 기준으로 표본 occurrence를 재계산한다.
2. 표본 junction에 대한 수작업 기대 전환표와 동일 영역 원본·변환 PBF를 만든다.
3. 원본·변환 PBF를 동일 MOTIS 16-way binary/profile로 import한 다음 F12의 CAR 허용/금지 쌍 및 그래프 전환 집합을 전수 비교한다.
4. `only_straight_on` 표본의 30초 제한 결과와 U-turn 요청에서 `max`보다 긴 duration이 반환된 원인을 확인하거나, 통제 가능한 더 적합한 표본/질의를 선택한다.


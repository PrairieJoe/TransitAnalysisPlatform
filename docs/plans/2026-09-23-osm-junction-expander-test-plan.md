# 16 occurrence 초과 OSM junction 변환 테스트 계획

작성일: 2026-09-23  
대상: 첨부 제안의 PBF 전처리 방식. 이 문서는 테스트 설계이며 구현·실행 결과가 아니다.

## 목적과 판정 범위

공식 MOTIS/OSR `v2.11.3`의 노드당 16 retained way-node occurrence 제한을 만족시키면서, 변환 전후의 **방향별·교통수단별·조건별 허용 경로**가 같은지 검증한다. PBF 작성 성공이나 단일 경로 발견만으로 동등성을 선언하지 않는다. 기존 32-way Custom MOTIS는 동일 원본 PBF에 대한 비교 기준으로 사용한다. 사용할 검증 자료는 PBF 해시까지 일치해야 한다. 2026-09-21 보고서(`f4f836…e749c`)와 현재 로컬 PBF(`68ed4b…10252`)는 서로 다른 입력이며, 현재 PBF 기준 통제·후보 근거는 `test-artifacts/motis-validation-attestation.json` 및 `test-artifacts/motis-scenario/2026-09-22T12-05-44-987Z/report.json`이다. 여기에는 공식 16-way 빌드가 OSM node `10729381152`의 18 ways에서 실패하고 32-way 후보가 import한 기록이 있다.

테스트는 `unrestricted`, `oneway`, 정적 `no_*`/`only_*` via-node restriction을 우선 지원 범위로 잡는다. `restriction:conditional`, mode-specific/`except`, via-way, barrier·층위가 섞인 junction은 의미 모델과 MOTIS 지원 여부를 확인한 뒤 지원하거나 **변환 전에 명시적으로 거부**한다. 모르는 태그·잘못된 relation·해석 불가 조건을 조용히 무시한 결과는 실패다.

## 검증의 기준선

1. 고정된 원본 PBF, MOTIS/OSR binary, routing profile, 질의 좌표·시각을 SHA-256 및 버전과 함께 기록한다. 원본 PBF와 생성 PBF는 별도 보관하고 원본을 수정하지 않는다.
2. 원본의 각 과밀 노드에 대해 **OSR이 실제 유지하는 way-node occurrence**를 계산한다. distinct way 수나 단순 OSM degree를 대용치로 쓰지 않는다. 수집기가 계산한 값은 공식 OSR의 실패 로그와 16/17/18 경계 fixture로 교차 검증한다. 불일치하면 변환 테스트를 중단한다.
3. 독립적인 원본 oracle을 만든다. 진입·진출은 way ID만이 아니라 **방향이 지정된 접점**으로 식별하고, `mode × departure time`별로 `T_original = {(entry, exit) | 이동 허용}`을 만든다. OSM 태그·relation 해석에 독립성이 부족하면 사람이 작성한 기대 전환표도 fixture에 고정한다.
4. 변환 PBF의 synthetic 영역 안에서 실제 유향 경로 탐색으로 `T_transformed`를 구한다. 외부 네트워크를 통한 우회는 제외하고, 원래 junction의 경계 진입·진출 사이만 비교한다. `T_original − T_transformed`는 소실, 반대 차집합은 새로 생긴 불법 이동으로 보고 둘 다 빈 집합이어야 한다.
5. 정적 전환 집합 이외에 one-way, access, restriction relation의 member·role·tag 유효성, synthetic ID 충돌, dangling reference, 원본 외부 way 연결점 보존을 검사한다. 작은 양의 오차를 허용하는 통계가 아니라 전수 집합 동등성으로 판정한다.

## 테스트 매트릭스

| ID | fixture / 변형 | 핵심 검증 | 기대 결과 |
| --- | --- | --- | --- |
| F01 | retained occurrence 15, 16, 17, 18, 32, 33; distinct way 수와 occurrence 수가 다른 반복 노드 포함 | 변환 대상 선택, 경계값, 모든 synthetic node의 재계수 | 16 이하는 OSM element와 의미가 그대로 유지; 17 이상만 변환; 결과는 모두 `<=16` |
| F02 | 18방향 보행·차량 unrestricted, 다양한 진입/진출 분할 | 모든 허용 쌍의 양방향 도달성, 불필요한 막다른 길·self-loop 방지 | 허용 전환 집합이 정확히 동일 |
| F03 | 양방향 way와 `oneway=yes`, `oneway=-1` 혼합 | 역주행과 불법 U-turn 추가 여부 | 각 방향별 전환 집합 동일 |
| F04 | 같은 진출 C에 대해 A→C 금지, E→C 허용; `no_left/right/straight/u_turn` | 진입 이력 분리, 허용 경로 손실 여부 | 금지 쌍은 불가, 다른 진입의 C는 가능 |
| F05 | `only_right_turn`과 다른 `no_*`가 겹치는 입력 | 우선순위·충돌·다른 출구 제거 범위 | 원본 oracle과 일치하거나 충돌을 명시적으로 거부 |
| F06 | 보행·자전거·motorcar·bus·hgv별 access/`except`/mode-specific restriction | 차량 금지가 보행으로 번지거나 예외가 사라지는지 | 지원한 모든 mode에서 각자의 전환 집합 동일; 미지원 mode는 거부 |
| F07 | 시간대 경계 직전·시작·종료·직후의 conditional restriction | 정적 topology가 시간 조건을 영구 금지로 바꾸는지 | relation 재작성과 MOTIS 해석까지 입증되면 각 시각에 동등; 아니면 거부 |
| F08 | via-way 1개·복수, junction 밖까지 이어지는 제한 | 전환쌍만으로 표현되지 않는 경로 이력 | 전체 제한 경로의 동등성이 입증되면 통과; 아니면 거부 |
| F09 | 교량/터널/층위, barrier, 서로 닿지 않는 교차 geometry | 가짜 connector의 횡단 연결 | 원래 분리된 컴포넌트는 계속 분리 |
| F10 | 중복·누락 member, relation 충돌, 미지 태그, 좌표·ID 경계 | 잘못된 입력 및 생성물 구조 | 원인과 OSM ID를 포함해 결정적으로 실패; 부분 출력 사용 금지 |
| F11 | 입력 순서 뒤섞기, 동일 PBF 재실행, 다른 PBF 해시 | 결정성·멱등성·불필요한 전역 변경 | 동일 입력의 출력 해시/전환표 동일; 비대상 element 의미 변화 없음 |
| F12 | 실제 PBF에서 16 occurrence 이하인 차량 교차로 몇 곳: `no_*`, `only_*`, U-turn 제한을 각각 포함 | 원본·처리 후 PBF의 전환 집합과 공식 MOTIS의 방향별 허용·금지 경로를 같은 방식으로 비교 | 제한 relation과 교차로가 변환되지 않고, 모든 선택 사례에서 전환·경로 결과가 동일 |

F02–F08은 허용·금지 사례를 **한 쌍씩 반전한 음성 fixture**도 둔다. 변환기와 oracle이 같은 잘못된 규칙을 공유하지 않도록 수작업 기대표, 생성 graph 탐색, MOTIS 실경로 질의의 세 경로로 핵심 사례를 대조한다. property-based 생성은 17–40방향, seed 고정 및 실패 seed 재현을 포함하되 수작업 fixture를 대체하지 않는다.

## 단계별 실행과 승인 기준

### 1. 수집기 및 정적 oracle 검증

- 작은 PBF에서 16/17/18/33 occurrence와 동일 way의 반복 node 사례를 만든다. 공식 OSR의 관측 수와 수집기가 일치해야 한다.
- F01–F11의 지원된 범위에서 전환 집합을 전수 비교한다. 변환 후 모든 retained node occurrence가 16 이하이고 relation 참조가 유효해야 한다.
- 미지원 입력은 원본 OSM ID, relation ID, 사유를 내고 **원본을 성공한 변환물로 대체하지 않는다**.

### 2. 공식 MOTIS 소형 통합 검증

- 각 대표 fixture를 변환 전에는 32-way Custom MOTIS, 변환 후에는 공식 16-way MOTIS로 import한다. 16 초과 원본의 공식 import 실패는 통제군으로 기록한다.
- F12의 16 occurrence 이하 실제 차량 교차로도 동일한 endpoint·mode·시각으로 원본과 처리 후 PBF를 공식 MOTIS에서 각각 질의한다. 회전제한이 적용되는 금지 방향과 인접한 허용 방향을 모두 확인한다.
- 방향별 허용 쌍·금지 쌍을 경계 way 위의 명시적 endpoint로 양쪽에서 질의한다. `found/no-route`를 비교하고, 허용 쌍은 junction 통과 geometry가 해당 synthetic 영역을 지나는지도 확인한다. 스냅·다른 도로 우회로 금지 전환이 `found`가 되는 거짓 양성을 배제한다.
- 정적 graph oracle이 통과해도 공식 MOTIS가 connector를 보행/차량별로 다르게 해석하거나 relation을 적용하지 못하면 해당 기능은 불합격이다. 조건부·via-way는 공식 MOTIS의 실제 지원 여부가 확인되기 전까지 지원 완료로 표기하지 않는다.

### 3. 실제 데이터 및 회귀 검증

- 기존 검증의 **같은 해시**인 대한민국 PBF를 입력으로 사용한다. node `10729381152`를 포함한 모든 `>16` occurrence를 탐지하고, 변환 전후의 변경 element 목록과 건수를 남긴다.
- 공식 MOTIS가 변환 전국 PBF를 import하고 health가 준비 상태가 되어야 한다. 인천대 해당 junction을 가로지르는 FOOT 양방향 질의와 기존 BUS 및 좌표 A–B 보행 포함 시나리오를 32-way 원본 기준선과 비교한다. 성공 여부, 경로 geometry, access/egress walk, 비대상 지역의 대표 질의를 확인한다. 단순 총 시간 차이는 connector 거리·스냅 영향과 분리해 조사한다.
- 기존 `npm run test`, `npm run typecheck`, `npm run build` 및 MOTIS release 검증 계약을 회귀 검사한다. 현 패키징은 Custom MOTIS artifact를 전제로 하므로, 공식 MOTIS 전환은 별도의 package/lock/manifest 변경과 packaged smoke 검증 전까지 제품 전환으로 인정하지 않는다.

### 4. 운영성 및 결정

- 전국 입력·출력 크기, synthetic element 수, peak RSS, 처리 시간, MOTIS import 시간·메모리를 두 방식에서 측정한다. 성능은 고정 하드 한계보다 현 32-way 빌드 대비 차이와 재현성을 보고 판단한다.
- **PoC 통과:** F01–F05 및 F12와 실제 18 occurrence 보행 junction에서 전환 집합 일치, 전 synthetic node `<=16`, 공식 MOTIS import·실경로 통과, 미지원 사례의 명시적 거부.
- **범용 차량 지원 선언:** 여기에 F06–F09의 요구 mode·시간·via 경로 전부의 실제 MOTIS 동등성 증거를 추가한다. 어느 한 축이 미지원이면 해당 축을 지원 범위에서 제외하고 입력을 거부한다.
- **제품 전환 결정:** nationwide·패키징 회귀와 운영 지표, 공식 MOTIS artifact의 배포/lock 정책 변경 계획까지 승인된 뒤에만 한다. PoC 성공을 즉시 Custom MOTIS 제거 근거로 쓰지 않는다.

## 제안하는 테스트 자산

- `tests/fixtures/osm-junctions/`: 사람이 검토한 원본 소형 OSM/PBF, 기대 전환표, mode/time 사례.
- `tests/main/osm-junction-occurrence.test.ts`: OSR retained occurrence 경계·탐지 회귀.
- `tests/main/osm-junction-expander.test.ts`: 구조 무결성, 전환 동등성, 실패 닫힘, 결정성.
- `scripts/motis/validate-junction-expansion.mts`: 공식/Custom MOTIS 비교 및 전국 PBF 증거 수집. 기존 `scripts/motis/validate-release-candidate.mts`와 입력 해시·결과 기록 관례를 맞춘다.
- `docs/test-reports/`: 입력·출력 PBF와 두 binary의 SHA-256, fixture별 전환 차집합, OSR import 로그, 질의 결과, 미지원 목록, 메모리·시간, 최종 판정을 남긴다. 전국 PBF와 실행파일은 저장소에 커밋하지 않는다.

## 계획 단계의 확인 사항

1. OSR `v2.11.3`이 유지하는 way의 정확한 필터와 occurrence 계산을 고정된 upstream source 또는 관측 로그로 확정한다.
2. 공식 MOTIS의 `restriction:conditional`, vehicle-specific restriction, via-way 해석 범위를 확인한다. OSM 표기 가능성과 MOTIS 지원은 별개다.
3. 사용자가 원하는 첫 릴리스 범위를 정한다: 정적 via-node까지의 제한된 sanitizer인지, 조건부·via-way를 포함한 범용 sanitizer인지. 이 선택에 따라 제품 전환 게이트가 달라진다.

참고: [OSM restriction relation](https://wiki.openstreetmap.org/wiki/Relation:restriction), [OSM conditional restrictions](https://wiki.openstreetmap.org/wiki/Conditional_restrictions). OSM 문서는 입력 의미의 근거이며, MOTIS 동작은 별도 통합 시험으로 확정한다.

---
title: "Station Catalog, Scenario Workspace, and Route Search - Plan"
type: feat
date: 2026-09-22
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Station Catalog, Scenario Workspace, and Route Search - Plan

## Goal Capsule

- 전체 의견 묶음은 `0.9.0` 기능 릴리스로 분류한다.
- 입력 단계의 기본 UX 개선, 정류장 검색, 시나리오 지도 초점 개선은 `0.8.1`로 먼저 제공되었지만, 실제 사용성 피드백에서 확인된 잔여 문구·행동 계층 문제는 `0.9.0` 출시 차단 범위로 보완한다.
- 정류장 catalog의 독립 저장, 기존 노선과 신규 노선의 복합 시나리오, 지도 우클릭 정류장 생성, 지도 중심 독립 MOTIS 경로탐색 workspace를 `0.9.0`에 포함한다.
- `0.9.0` 경로탐색은 텍스트 입력 도구가 아니라 지도에서 출발지·도착지를 선택하고 결과 경로를 지도에 표시하는 작업공간이어야 한다.
- 실행 전까지 프로젝트 원본 `stationMaster`와 `routeStopMaster`를 직접 수정하지 않는다.
- PBF와 지도 배경의 준비 상태가 불완전한 후보는 native acceptance를 통과한 것으로 간주하지 않는다.
- 추가 구현은 이 계획 확정 후 시작하고, 현재 0.9.0 후보에 이미 반영된 U1/U2/U5/U6은 변경 기준선으로 삼는다.

## Implementation Status (2026-09-22)

- **0.8.1 확정:** `codex/0.8.1-input-scenario-ux` 브랜치에 release metadata, 입력·시나리오 UX, packaged smoke 수정까지 반영하고 원격 push를 완료했다. 구버전 `out`·`release` 산출물은 정리했으며, 0.8.1 설치 파일은 검증 후 생성된 상태다.
- **0.9.0 완료 단위:** U1/U2 canonical station catalog·DuckDB 독립 저장·v10→v11 migration(`b69f2fd`), U5 복합 노선 시나리오·우클릭 정류장 추가(`7788208`), U6 현행 네트워크 독립 MOTIS 경로탐색(`ad775a6`)을 현재 작업 브랜치에 구현했다.
- **현재 경계:** 0.9.0 후보 version bump와 release note, Windows 설치 파일 생성, packaged smoke까지 완료했다. 후보는 로컬에만 설치·실행했으며 원격 push와 최종 릴리스 승격은 아직 하지 않았다.
- **피드백 반영 상태:** 현재 후보의 경로탐색은 정류장 picker·수동 PBF 경로·텍스트 결과 중심이라 지도 기반 실사용 요구를 충족하지 못한다. PBF 자동 탐색·Geofabrik 안내, 지도 중심 endpoint 선택·경로 표시, 시간 입력 UX, 데이터 입력 문구 정리는 추가 구현이 필요하다.
- **남은 확인:** 위 보완 구현 후 실제 Electron 화면에서 PBF 부재/재탐색, 지도 endpoint 선택, 경로 오버레이, 혼합 시나리오 저장·재개방, 독립 경로탐색의 MOTIS 실행을 native acceptance로 확인한다.

## Product Contract

### Summary

사용자는 교통카드 분석, 노선 개편 시나리오, 일반 경로탐색을 서로 다른 목적의 작업으로 이해할 수 있어야 한다. 이를 위해 정류장과 노선 경로의 데이터 계약을 분리하고, 시나리오 편집기는 선택한 노선과 변경된 정류장을 중심으로 보여주며, MOTIS는 지도에서 출발지·도착지를 고르고 결과 경로를 확인하는 독립적인 현재 기준 경로탐색 기능으로 제공한다.

### Problem Frame

현재 버전은 다음을 부분적으로 지원한다.

- `src/core/station-master.ts`는 정류장 사전 내부 중복을 `stationId`로 제거하고, `mergeStationMasterRecords`는 정류장 사전을 우선해 노선정보의 누락 정류장을 보완한다.
- `ProjectManifest`에는 `stationMaster`와 `routeStopMaster`가 별도 배열로 존재한다.
- 그러나 `src/main/duckdb.ts`에는 거래 records 테이블만 있고, 정류장 catalog와 노선-정류장 관계를 저장하는 독립 테이블은 없다. 현재 정류장 데이터는 프로젝트 JSON metadata 배열에 머문다.
- `ScenarioDefinition` v3와 overlay materializer는 기존 노선 변경 및 신규 노선의 실행 모델을 갖고 있다. 하지만 `SyntheticScenarioStep`의 UI는 `기존 노선 개편`과 `새 노선 만들기`를 모드로 나누며, 한 저장 흐름에서 여러 기존 노선 변경과 신규 노선을 함께 편집하는 모델은 제공하지 않는다.
- 시나리오 지도는 모든 정류장을 기본으로 표시하고, 정류장 추가는 지도 클릭 모드와 긴 선택 목록에 의존한다. 선택 노선 중심의 계층, 검색, 우클릭 contextual action이 없다.
- 데이터 입력 단계에는 `입력 완료 → 하차 추정`, `관측값 분석`, `GTFS 구축으로 이동`이 같은 시각적 레벨에 놓여 있어 다음 행동과 대체 행동의 차이가 약하다.
- `src/renderer/RouteSearchWorkspace.tsx`는 출발·도착 정류장 picker, 사용자가 직접 입력하는 OSM PBF 경로, `datetime-local` 입력, 텍스트 결과 목록만 제공한다. 지도, 지도 기반 endpoint 선택, 경로 geometry 오버레이가 없다.
- PBF가 없는 최초 실행을 자동 탐지하거나 최근에 확인한 경로를 재사용하는 흐름이 없고, 사용자가 매번 파일 경로를 직접 선택해야 한다. 기존 Geofabrik 안내는 시나리오 화면에만 있어 독립 경로탐색의 준비 상태와 연결되지 않는다.
- 기존 분석 지도 컴포넌트는 Leaflet과 OSM 타일 배경을 이미 사용하지만, 경로탐색 workspace가 이를 재사용하지 않아 지도 없는 경로탐색 화면이 된다.
- 경로탐색의 시간 입력은 사용자 관점의 `지금 출발`·빠른 시간 선택·명확한 날짜/시간 편집보다 raw `datetime-local` 필드에 가깝고, 입력 화면의 버튼 문구와 화살표가 다음 행동을 충분히 설명하지 못한다.

### Requirements

- **R1 — 정류장 catalog:** STTN 계열 정류장정보와 ROUTESTTN 계열 노선-정류장정보를 `stationId` 기준의 하나의 canonical station entity와 별도의 route membership으로 정규화한다. 같은 ID의 명칭·좌표 충돌은 보존 가능한 경고와 provenance로 남긴다.
- **R2 — 입력 행동 계층:** 입력 단계에는 현재 단계의 권장 다음 행동 하나를 primary action으로 표시하고, 관측 분석·GTFS 구축 같은 대체 목적은 secondary action 또는 별도 output 선택으로 낮춘다.
- **R3 — 시나리오 지도 초점:** 기본 지도는 선택한 노선의 현행·개편안 및 변경 정류장만 보여주고, 전체 정류장·노선 레이어는 사용자가 켤 때만 표시한다.
- **R4 — 검색 가능한 선택:** 기존 정류장과 노선 선택은 이름·ID·ARS 번호를 검색하고 키보드로 선택할 수 있어야 한다. 단순 장문 `<select>`에 의존하지 않는다.
- **R5 — 지도 contextual add:** 지도 우클릭으로 해당 좌표의 신규 정류장 draft를 만들 수 있어야 한다. 우클릭을 사용할 수 없는 환경에서는 동일 기능을 제공하는 키보드/버튼 경로를 유지한다.
- **R6 — 복합 시나리오:** 한 시나리오 안에서 기존 노선 여러 개의 개편과 신규 노선 여러 개의 생성을 함께 저장·재개방·실행할 수 있어야 한다. 현행 원본은 불변이어야 한다.
- **R7 — 경로탐색 workspace:** MOTIS 지점 간 경로탐색을 분석 또는 시나리오 편집의 하위 단계가 아닌 독립 workspace로 제공한다. 기본 대상은 현행 네트워크이며, 필요할 때 시나리오 네트워크를 선택한다.
- **R8 — 일관된 결과 언어:** 현행에 없는 신규 노선, 현행 경로 없음, 개편안 신규 경로를 오류와 구분하여 표시하고, 동일한 OD에 대해 현행·개편안 결과를 비교할 때만 비교 영역에서 사용한다.
- **R9 — 지도 중심 경로탐색:** 독립 경로탐색 workspace는 진입 즉시 Leaflet 지도 배경을 표시하고, 지도에서 출발지·도착지를 순서대로 선택할 수 있어야 한다. 정류장 검색은 정확한 보조 입력으로 유지하며, 지도·마커·검색 선택 상태는 동기화한다.
- **R10 — 경로 지도 표시:** 경로탐색 결과는 선택된 경로를 지도 위에 그려야 하며, 출발·도착 마커, 대중교통 구간, 도보·환승 구간, 대안 경로 선택 상태를 결과 카드와 함께 표시한다. geometry가 불완전하면 시각화의 품질과 한계를 명시한다.
- **R11 — PBF 준비 자동화:** 알려진 앱·프로젝트·다운로드 위치에서 PBF를 제한적으로 자동 탐색하고, 마지막으로 확인한 경로와 파일 fingerprint를 재사용한다. 찾지 못하면 Geofabrik 대한민국 다운로드 안내와 재탐색을 제공하며, 수동 파일 선택은 고급 fallback으로 낮춘다.
- **R12 — 경로탐색 시간 UX:** 기본값은 현재 시각 기준의 `지금 출발`이며, 사용자가 날짜·시각을 분리해 편집하고 `+15분`, `+30분`, `+1시간` 같은 빠른 선택을 사용할 수 있어야 한다. 내부 MOTIS 요청에는 기존 KST 기준 ISO 값으로 변환한다.
- **R13 — 입력 행동 언어:** 데이터 불러오기와 경로탐색의 primary action은 하나만 두고, `→` 같은 의미가 약한 표기를 제거한다. 버튼 문구는 실제 결과를 설명하는 동사형으로 통일하고 secondary·고급 설정은 시각적으로 낮춘다.

### Acceptance Examples

- 같은 `stationId`가 STTN 파일과 ROUTESTTN 파일에 모두 있으면 station catalog에는 한 번만 나타나고, route membership에는 각 노선의 순서가 남는다. 명칭 또는 좌표가 다르면 사전 우선 규칙과 충돌 경고를 볼 수 있다.
- 노선정보 입력이 완료된 화면에서 사용자가 가장 먼저 보는 primary action은 하나이며, 하차 추정 실행과 관측값만 분석하는 흐름은 별도의 secondary action으로 구분된다.
- 시나리오를 열면 선택 노선과 변경 정류장만 크게 보인다. 전체 정류장 레이어를 켜야 다른 정류장이 표시된다.
- 정류장 추가 검색창에 이름 일부 또는 ID를 입력하면 후보가 즉시 좁혀지고, 후보 선택 후 순서 목록과 지도 선택 상태가 동시에 갱신된다.
- 지도에서 우클릭한 좌표로 신규 정류장 draft가 열리고, ID·명칭을 입력해 저장하기 전에는 원본 catalog가 변하지 않는다.
- `R1`을 개편하면서 `N-1`과 `N-2`를 함께 추가한 시나리오를 저장하고 재개방하면 세 변경이 모두 유지된다. 현행 GTFS에는 `N-1`, `N-2`가 없고 개편안 GTFS에만 존재한다.
- 별도 경로탐색 workspace에서 현행 네트워크의 출발지·도착지를 선택해 MOTIS 경로를 조회할 수 있다. 같은 질의를 시나리오 비교로 보낼 때만 현행·개편안 차이가 표시된다.
- 독립 경로탐색 workspace를 열면 지도가 먼저 보인다. 지도에서 출발지와 도착지를 차례로 클릭하거나 검색 후보를 선택하면 두 마커가 표시되고, 결과 카드와 지도 강조 경로가 함께 갱신된다.
- PBF가 기본 검색 위치에 있으면 별도 파일 선택 없이 자동으로 준비된다. 없으면 Geofabrik 안내와 `다시 찾기` 상태가 표시되고, 사용자가 다운로드한 뒤 재탐색하면 자동으로 인식된다.
- 경로탐색 결과가 반환되면 최적 경로가 강조되고, 대안 경로 카드 선택 시 지도 강조도 변경된다. 경로 geometry가 정류장 연결선 fallback인 경우 그 사실이 결과에 표시된다.
- 경로탐색의 시간 기본값은 현재 시각이며, 사용자는 빠른 시간 preset 또는 명시적 날짜·시각 편집으로 질의를 바꿀 수 있다.

### Success Criteria

- v0.8.1 범위는 기존 프로젝트/시나리오 저장 형식을 변경하지 않고 입력·검색·지도 초점의 회귀 테스트를 통과한다.
- v0.9.0 범위는 v10 프로젝트를 읽어 canonical catalog를 안전하게 만들고, 재저장 후에도 원본 배열과 기존 시나리오를 보존한다.
- 복합 시나리오가 현행/개편안 GTFS, MOTIS 실행, 비교 결과에서 동일한 overlay materialization을 사용한다.
- 신규 경로와 결과 없음이 generic failure로 표시되지 않는다.
- 독립 경로탐색이 지도 없이도 실행되는 구조가 아니며, 지도 endpoint 선택·경로 오버레이·PBF 준비 상태가 하나의 흐름으로 동작한다.
- PBF 파일을 이미 확인한 사용자는 반복해서 파일 경로를 입력하지 않고, 파일이 없을 때만 Geofabrik 안내를 받는다.
- typecheck, 전체 테스트, build, packaged smoke와 native acceptance flow가 통과한다.

### Scope Boundaries

**0.8.1 minor patch**

- 입력 단계의 primary/secondary action 재배치와 상태 문구 정리.
- 기존 노선·정류장 picker의 검색, 키보드 선택, 선택 항목 요약.
- 시나리오 지도의 높이·레이아웃 개선, 선택 노선/변경 정류장 중심 표시, 전체 레이어 토글.
- 저장 계약과 MOTIS 실행 경계는 변경하지 않는다.

**0.9.0 feature release**

- canonical station catalog와 route membership의 독립 저장 및 v10→v11 migration.
- 우클릭 신규 정류장 draft와 scenario-owned station 저장.
- 여러 기존 노선 변경과 여러 신규 노선을 하나의 시나리오에서 관리.
- 현재/시나리오 네트워크를 선택할 수 있는 지도 중심 독립 MOTIS route search workspace.
- 지도에서의 출발·도착 endpoint 선택, 경로 geometry/정류장 순서 표시, 결과 카드와 지도 강조 동기화.
- PBF 자동 탐색·최근 경로 재사용·Geofabrik 다운로드 안내와 고급 수동 경로 fallback.
- `지금 출발`·빠른 시간 preset·분리된 날짜/시간 편집과 데이터 입력 action copy 정리.
- overlay fingerprint, 결과 상태, 프로젝트 재개방 계약 확장.

**Out of scope**

- 네이버·카카오·구글 지도를 앱 안에 임베드하거나 서비스별 브랜드·화면을 복제하지 않는다. 지도 중심 정보구조와 상호작용만 참고하고, 기존 Leaflet/OSM 타일 경계를 유지한다.
- 자동 노선 최적화, 수요 기반 노선 추천, 정류장 입지 최적화를 추가하지 않는다.
- 정류장 ID를 좌표 근접성만으로 자동 병합하지 않는다.
- 실시간 차량 위치·도착정보를 이번 범위에 포함하지 않는다.

### Dependencies and Deferred Questions

- MOTIS runtime과 기존 IPC 실행 계약을 재사용한다. 경로탐색의 ranking 정책은 현재 MOTIS 결과를 우선 사용하며, 사용자별 선호도 저장은 후속 범위다.
- 지도 우클릭은 Leaflet `contextmenu` 이벤트를 사용한다. 우클릭을 사용할 수 없는 입력장치에서도 버튼과 키보드 단축 경로를 제공한다.
- 경로탐색 지도는 기존 `ODDemandMap`과 `ScenarioNetworkMap`의 Leaflet·OSM 타일·tile error 패턴을 재사용한다. 새 지도 공급자나 인증키는 추가하지 않는다.
- PBF는 앱에 번들하지 않는다. 제한된 후보 경로를 자동 탐색하고, 없을 때 공식 Geofabrik 대한민국 페이지를 열어 안내하며, 확인된 경로와 SHA-256을 앱 사용자 데이터에 저장한다.
- MOTIS 요청은 정류장 endpoint와 좌표 endpoint를 모두 허용하는 기존 `ScenarioJourneyEndpoint`/`buildMotisPlanPath` 계약을 재사용한다. 사용자가 지도에서 클릭한 지점은 좌표 endpoint로 보내고, 가까운 정류장 snapping은 보조 표시로만 사용한다.
- station catalog의 원천 파일명·행번호 provenance는 v0.9.0에서 최소한 충돌 조사에 필요한 수준으로 저장한다. 원본 행 전체의 감사 로그는 후속 범위다.

## Planning Contract

### Key Technical Decisions

1. **전체 분류는 0.9.0으로 한다.** 정류장 데이터의 저장 경계, 시나리오 모델의 cardinality, MOTIS 기능의 정보 구조가 함께 바뀌므로 UI-only minor patch가 아니다. 다만 R2–R4는 v0.8.1로 선행 배포해 사용자 불편을 즉시 줄인다.
2. **station catalog와 route membership을 분리한다.** 프로젝트 DB에는 canonical `stations` 논리 테이블과 `route_stops` 논리 테이블을 둔다. `route_stops.station_id`가 stations를 참조하며, 노선 순서·운행일자·노선 메타데이터는 route membership에 남긴다. 기존 `ProjectManifest.stationMaster`와 `routeStopMaster`는 v0.9.0 한 릴리스 동안 v10 호환 snapshot으로 읽고 쓰되, 새 기능은 catalog adapter를 통해 접근한다.
3. **충돌은 deterministic하게 처리한다.** 독립 station source가 있으면 canonical station의 명칭·좌표를 우선하고, 없으면 route-stop에서 최초로 정규화된 값을 사용한다. 다른 값은 삭제하지 않고 source/conflict warning으로 노출한다. 위치가 가까워 보인다는 이유만으로 서로 다른 ID를 합치지 않는다.
4. **시나리오 원본과 overlay를 분리한다.** 현재 `ScenarioDefinition` v3의 `routeChanges`, `addedStations`, `stationOverrides`, `addedRoutes`를 유지하고, renderer가 아니라 `scenario-network-overlay.ts`가 여러 변경을 materialize한다. 편집기 상태만 단일 route에서 collection 상태로 확장한다.
5. **경로탐색은 공유 core 실행 client 위의 독립 workspace로 추출한다.** `SyntheticMotisStep`의 scenario comparison 전용 흐름과 일반 route search를 같은 MOTIS 요청 client로 연결하되, 저장·탐색·결과 화면의 목적은 분리한다. 기본 route search target은 `current`다.
6. **공식 지도 UX의 구조만 차용한다.** 지도 중심 endpoint 선택 → 후보 또는 경로 카드 → 지도 강조 → 상세 stop sequence라는 계층을 사용한다. 서비스별 색상·문구·브랜드 UI를 복제하지 않는다.
7. **경로탐색의 지도는 필수 화면 요소다.** `RouteSearchWorkspace`는 지도와 질의 패널을 함께 렌더링하고, 지도 클릭·정류장 검색·결과 카드가 하나의 endpoint/선택 상태를 공유한다. Leaflet과 기존 OSM 타일 경계를 재사용하며 지도 타일 장애 시에도 경로 목록과 좌표 fallback을 숨기지 않는다.
8. **PBF 준비와 지도 배경을 분리한다.** PBF는 MOTIS가 경로를 계산하기 위한 도로망 artifact이고, Leaflet 타일은 사용자가 위치와 경로를 이해하기 위한 화면 배경이다. PBF가 있어도 타일이 자동으로 생기지 않으며, 둘 중 하나가 없을 때 각자 원인과 해결책을 표시한다.
9. **PBF는 bounded discovery 후 안내한다.** 앱은 마지막 성공 경로, 프로젝트·앱 데이터 디렉터리, 사용자 다운로드 디렉터리와 개발용 `data/osm` 같은 제한된 후보만 검색한다. 마지막 경로와 metadata는 사용자 데이터 아래 `routing-assets.json`에 원자적으로 저장한다. 찾지 못하면 공식 Geofabrik 대한민국 페이지와 권장 저장 위치를 여는 안내 상태를 보여주고, 전체 디스크 검색이나 매 실행 파일 선택을 하지 않는다.
10. **시간 입력은 사용자 의도 중심으로 저장한다.** 화면은 `지금 출발`과 명시적 출발 시각을 구분하고 preset으로 빠른 변경을 지원한다. 내부 계약은 기존 `departureDateTime`을 유지해 저장·MOTIS 호환성을 보존하며, `도착 시각` 질의는 MOTIS 요청 계약이 확장되기 전까지 0.9.0에 포함하지 않는다.
11. **버튼은 결과 동사와 단계로 표현한다.** 입력 화면의 primary action은 현재 상태에서 다음으로 이어지는 하나의 동사형 문구로 정하고, 방향 화살표·기술용어·중복 동작은 제거한다. 고급 PBF 검증과 MOTIS 중지는 보조 또는 기술 상세 영역에 둔다.

### Sequencing and rollout

- **기준선:** 이미 구현된 U1/U2/U5/U6을 0.9.0의 기준선으로 고정한다. 0.8.1 산출물과 저장 계약은 이 작업에서 되돌리지 않는다.
- **1단계 — 실행 준비:** U7을 먼저 구현해 PBF 발견·재사용·부재 안내를 안정화한다. 지도는 타일 배경만으로 경로탐색 가능 상태를 의미하지 않으므로, MOTIS가 사용할 routing asset 상태를 먼저 확정한다.
- **2단계 — 지도 상호작용:** U8에서 지도 표시, 지도 클릭 endpoint, route geometry/fallback, 결과 카드 동기화를 연결한다. 이 단계가 끝나기 전에는 route search를 native acceptance 대상으로 보지 않는다.
- **3단계 — 질의 입력:** U9에서 시간 입력을 `지금 출발`·preset·분리된 날짜/시각으로 교체하고, 기존 KST/MOTIS 계약과의 변환을 고정한다.
- **4단계 — 문구와 행동 계층:** U10에서 데이터 입력·경로탐색의 primary action과 고급 설정을 정리한다. 지도·PBF·시간 흐름이 동작한 뒤 문구를 확정해, 실제 상태와 라벨이 어긋나지 않게 한다.
- **5단계 — 출시 게이트:** U11에서 전체 테스트, packaged smoke, native acceptance, migration/rollback 문서를 함께 확인한다. 모든 0.9.0 게이트가 통과되기 전에는 원격 push 또는 최종 릴리스 승격을 하지 않는다.

### High-Level Technical Design

```text
STTN / ROUTESTTN files
        │ normalize + source/conflict policy
        ▼
Canonical station catalog ─────── route membership (route_stops)
        │                                  │
        ├── Analysis read model            ├── Scenario overlay materializer
        │                                  │       ├── current network
        ├── Scenario station picker       │       └── scenario network
        │                                  │
        └── Route Search workspace ──┬── endpoint/map interaction
                                    ├── PBF readiness resolver
                                    └── shared MOTIS execution client
                                                    │
                         Scenario comparison ───────┘
```

The project store owns migration and persistence. Core catalog, overlay, and route-search modules remain pure where possible. Renderer components own only transient selection, focus, context-menu draft, and loading state. Main/preload owns DuckDB writes and MOTIS execution. All current/scenario GTFS and comparison inputs originate from the same materialized network result.

### System-Wide Impact

- **Shared types:** add catalog, membership, route-search query/result, migration metadata, and explicit route status types in `src/shared/types.ts`.
- **Persistence:** extend `src/main/duckdb.ts` and `src/main/project-store.ts`; migrate v10 projects to v11 without losing JSON compatibility fields.
- **Import boundary:** `src/renderer/App.tsx` and `src/main/import-job.ts` must normalize both source files once and pass catalog/membership to analysis and scenario consumers.
- **Renderer navigation:** extend the current `home/import/report/synthetic` view model with a route-search workspace without nesting it under scenario editing.
- **Route-search map:** add a map-first layout, endpoint selection state, route overlay model, route-card/map synchronization, and explicit map tile error state.
- **Routing assets:** add a main-process bounded PBF resolver and persisted last-known metadata; expose readiness and Geofabrik guidance through preload instead of exposing filesystem scanning to the renderer.
- **Time controls:** preserve `departureDateTime` as the transport contract while introducing visible `now`/preset/date/time state in the route-search UI.
- **Input copy:** audit the existing input action bar and route-search actions for one primary action, consistent verbs, and removal of ambiguous arrow suffixes.
- **Staleness:** catalog version, route membership version, scenario overlay fingerprint, and MOTIS environment must participate in stale-result gating.
- **Performance:** do not render all station markers by default. Search and layer filters operate on the catalog before Leaflet marker creation.
- **Accessibility:** context-menu actions have visible button and keyboard alternatives; selection is not conveyed by color alone.

### Risks and Dependencies

- **Migration risk:** a v10 project may have only route-stop data or only station data. Mitigation: derive missing catalog rows from route stops, keep source warnings, write migration fixtures for both cases, and make migration idempotent.
- **Identity risk:** the same numeric ID may be reused across source systems. Mitigation: keep source provenance and do not merge by name or coordinate.
- **Scenario state risk:** switching between routes or editor modes can leak transient overlay state. Mitigation: store a scenario-level collection keyed by route ID and test switching, save, reopen, and reset.
- **MOTIS dependency:** runtime startup and network artifacts can fail independently of UI. Mitigation: preserve current status/error boundaries and show route-search-specific empty/error states.
- **MOTIS/PBF readiness:** a missing or changed PBF must not appear as a generic route failure. Mitigation: centralize discovery, inspect/hash, readiness state, and Geofabrik guidance in the main process.
- **Map dependency:** OSM tiles may be unavailable. Mitigation: still render endpoint markers, route overlays, and a clear tile error state; keep search/list controls usable and never omit the map container.
- **Journey geometry:** MOTIS response geometry may be absent or incomplete. Mitigation: normalize returned geometry when available, otherwise derive a clearly labeled stop-to-stop fallback from canonical station coordinates and preserve a warning.
- **Time semantics:** local browser datetime values can be interpreted in the wrong timezone. Mitigation: keep KST conversion in one core helper and test daylight/date-boundary cases.
- **Scope creep:** copying consumer map applications can add navigation, alerts, and live data. Mitigation: limit this release to search, route/stop context, and analysis-grade results.

## Implementation Units

### U1. Canonical station catalog and conflict policy

**Goal:** Make STTN/ROUTESTTN deduplication a named core domain instead of an incidental merge between two arrays.

**Requirements:** R1.

**Files:** Create `src/core/station-catalog.ts` and `tests/core/station-catalog.test.ts`. Modify `src/shared/types.ts`, `src/core/station-master.ts`, `src/core/route-master.ts`, `tests/core/station-master.test.ts`, and `tests/core/route-master.test.ts`.

**Approach:** Define canonical station records, route membership records, source provenance, and conflict diagnostics. Keep station master authoritative when present, fill missing IDs from route stops, and make the output order and warning text deterministic. Adapt existing demand joins and route path builders to consume the catalog adapter.

**Test scenarios:** same ID in both sources yields one station and two memberships; differing name/coordinates produce a warning; missing station master derives stations from route stops; duplicate route rows remain deduped by route/date/sequence/station ID; invalid coordinates are rejected.

**Verification:** focused core tests, `npm run typecheck`, and existing analysis/route regression tests pass.

### U2. Persist the catalog separately and migrate projects

**Goal:** Materialize the canonical catalog and route membership in the project database while keeping v10 projects readable.

**Requirements:** R1, R6.

**Files:** Modify `src/main/duckdb.ts`, `src/main/project-store.ts`, `src/main/import-job.ts`, `src/renderer/App.tsx`, `src/shared/types.ts`, `tests/core/duckdb.test.ts`, `tests/main/project-store.test.ts`, and `tests/main/import-job.test.ts`.

**Approach:** Add project schema v11 migration metadata and idempotent `stations`/`route_stops` writes. Keep `records` unchanged. On v10 load, normalize the two legacy arrays into the new tables; on save, keep compatibility snapshots until the next planned removal. Ensure project reopen returns the same canonical IDs, conflict diagnostics, and memberships.

**Test scenarios:** v10 with both masters migrates with station-master precedence; v10 with only route stops derives a catalog; repeated migration produces the same result; a failed write does not replace the existing project metadata; reopening preserves the catalog and route memberships.

**Verification:** focused persistence tests, `npm run typecheck`, `npm run build`, and a native open/migrate/reopen flow.

### U3. Simplify the data-input action model (0.8.1)

**Goal:** Make the next recommended action obvious and reduce competing buttons in the input wizard.

**Requirements:** R2.

**Files:** Create `src/renderer/ImportActionBar.tsx` if extraction reduces `App.tsx` complexity. Modify `src/renderer/App.tsx`, `src/renderer/styles.css`, `src/core/import-navigation.ts`, `tests/core/import-navigation.test.ts`, and `tests/renderer/AppNavigation.test.tsx`.

**Approach:** Represent the input flow as explicit states: data review, optional station/route master review, ready for inference, and ready for analysis/GTFS. Render one primary next action per state. Put alternate outputs in a labeled secondary group and show why an action is disabled. Preserve deep links and current import behavior.

**Test scenarios:** incomplete mapping blocks the primary action with a local explanation; complete route data makes `하차 추정` primary; choosing observation-only analysis does not accidentally run inference; navigation back to mapping retains selected files and mappings; no state presents multiple visually-primary buttons.

**Verification:** focused import navigation and renderer tests, typecheck, and native input flow.

### U4. Focus the scenario workspace and add search (0.8.1)

**Goal:** Make the scenario map and station picker useful before adding new persistence semantics.

**Requirements:** R3, R4, R8.

**Files:** Modify `src/renderer/SyntheticScenarioStep.tsx`, `src/renderer/SyntheticRouteScenarioEditor.tsx`, `src/renderer/ScenarioNetworkMap.tsx`, `src/renderer/ScenarioNetworkOverlayEditor.tsx`, `src/renderer/ScenarioNewRouteEditor.tsx`, `src/renderer/styles.css`, and the existing renderer tests for these components.

**Approach:** Use a wider map-first layout with independent list scrolling. Default to the selected route and changed stops. Add explicit `현행 노선`, `개편안`, `변경 정류장`, and `전체 정류장` layer controls. Replace long selects with a reusable searchable station/route picker that matches name, ID, and ARS number, preserves ordering, and exposes the same selection state to the list and map.

**Test scenarios:** a route with many unrelated stations renders only the route by default; toggling all stations adds the layer without changing scenario state; searching by partial name or ID returns the expected candidate; list selection centers/highlights the marker; map/list selection stays synchronized after reorder and exclusion; tile failure leaves search and list editing usable.

**Verification:** existing scenario renderer tests plus new picker/map visibility tests, typecheck, and native scenario workspace inspection.

### U5. Complete mixed-route scenario editing and map contextual add (0.9.0)

**Goal:** Support multiple existing-route reforms and multiple new routes in one saved overlay, including right-click station creation.

**Requirements:** R5, R6, R8.

**Files:** Modify `src/shared/types.ts`, `src/core/scenario-contract.ts`, `src/core/scenario-network-overlay.ts`, `src/renderer/SyntheticScenarioStep.tsx`, `src/renderer/SyntheticRouteScenarioEditor.tsx`, `src/renderer/ScenarioNetworkOverlayEditor.tsx`, `src/renderer/ScenarioNetworkMap.tsx`, `src/renderer/ScenarioNewRouteEditor.tsx`, `src/renderer/SyntheticGtfsBuilder.tsx`, `src/renderer/ScenarioComparisonPanel.tsx`, and related existing tests. Add `tests/core/scenario-mixed-network.test.ts` if the existing overlay test file becomes too broad.

**Approach:** Replace the current single-route/single-new-route editor state with a scenario-level collection keyed by route ID. Use Leaflet `contextmenu` to open a draft containing latitude/longitude, then require visible ID/name confirmation before adding a scenario-owned station. Add keyboard and toolbar equivalents. Materialize all route changes and added routes together, reject route/station ID collisions, and emit explicit route status metadata for current-only, scenario-only, and changed routes.

**Test scenarios:** right-click opens and cancel discards a draft; save rejects duplicate IDs and invalid coordinates; one scenario containing two `routeChanges` and two `addedRoutes` round-trips through project storage; current network remains byte-for-byte unchanged; current GTFS excludes scenario-only routes while scenario GTFS includes them; comparison labels new routes and missing current paths without treating them as execution errors.

**Verification:** focused contract/overlay/GTFS/comparison tests, full typecheck and build, native save/reopen flow, and source immutability assertion.

### U6. Extract MOTIS into an independent route-search workspace (0.9.0)

**Goal:** Let users run current-network point-to-point transit search without entering scenario analysis.

**Requirements:** R7, R8.

**Files:** Create `src/core/route-search.ts`, `src/renderer/RouteSearchWorkspace.tsx`, and `tests/core/route-search.test.ts`, `tests/renderer/RouteSearchWorkspace.test.tsx`. Modify `src/shared/types.ts`, `src/renderer/App.tsx`, `src/renderer/SyntheticMotisStep.tsx`, `src/renderer/SyntheticScenarioTools.tsx`, `src/renderer/ScenarioJourneyComparison.tsx`, and existing MOTIS tests.

**Approach:** Define a route-search query with origin, destination, departure time, target network, and constraints. Reuse the existing MOTIS request/result client and runtime status. Split the workspace into a map-first canvas and a compact query/result panel. Support both station search and map-selected coordinate endpoints through the existing `ScenarioJourneyEndpoint` contract. Normalize route legs into map layers using returned geometry when available and canonical station coordinates as an explicitly labeled fallback. Keep route cards, endpoint markers, selected route emphasis, and stop-by-stop detail synchronized. Make scenario comparison call the same client with two targets instead of owning the general route-search UI.

**Test scenarios:** current target works with station endpoints; map clicks create origin then destination coordinate endpoints; station search and map markers stay synchronized; coordinate endpoints validate range; route geometry renders when present and stop-coordinate fallback is labeled when absent; selecting a route card changes the highlighted map layer; missing runtime reports an actionable state; empty result is distinct from execution failure; scenario target uses the materialized overlay; identical query and environment produce a stable fingerprint; comparison consumes route-search results without changing the standalone workspace state.

**Verification:** core route-search tests, renderer/MOTIS tests, typecheck, build, and native current-network route-search flow.

### U7. Resolve routing assets and guide first-run PBF setup (0.9.0)

**Goal:** Make a usable PBF a discovered application resource rather than a path the user must repeatedly type or select.

**Requirements:** R11.

**Files:** Create `src/main/routing-assets.ts` and `tests/main/routing-assets.test.ts`. Modify `src/main/motis-osm.ts`, `src/main/motis-runtime.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/RouteSearchWorkspace.tsx`, `src/renderer/SyntheticMotisStep.tsx`, `src/renderer/ScenarioJourneyComparison.tsx`, `tests/main/motis-osm.test.ts`, `tests/main/motis-ipc.test.ts`, and related renderer tests.

**Approach:** Add a main-process resolver that checks the persisted last-known PBF, project/app routing data directories, the bounded user Downloads directory, and the development `data/osm` location in deterministic order. Reinspect the candidate and compare its SHA-256 before reporting it ready. Persist only the resolved path and metadata needed to reuse it in an atomic user-data `routing-assets.json`; do not scan the whole drive or expose arbitrary filesystem enumeration to the renderer. When no candidate exists, return a structured `missing` state with the official Geofabrik South Korea URL, recommended storage location, expected filename, and a `다시 찾기` action. Keep manual selection behind an advanced fallback for unusual storage locations.

**Test scenarios:** a valid candidate is found without opening a file dialog; the last-known path is reused when unchanged; a missing or changed file becomes `missing`/`stale` with an actionable Geofabrik message; candidate search order is deterministic and bounded; manual selection remains available only as fallback; the same resolver state is rendered consistently by standalone route search and scenario MOTIS screens.

**Verification:** focused routing-asset and IPC tests, `npm run typecheck`, packaged smoke with a missing-PBF profile, and native first-run guidance followed by re-detection after the PBF is placed in the managed location.

### U8. Add map-first route interaction and route overlays (0.9.0)

**Goal:** Make the route-search map the primary interaction surface for choosing endpoints and understanding returned journeys.

**Requirements:** R9, R10.

**Files:** Create `src/core/route-search-map.ts`, `src/renderer/RouteSearchMap.tsx`, `tests/core/route-search-map.test.ts`, and `tests/renderer/RouteSearchMap.test.tsx`. Modify `src/renderer/RouteSearchWorkspace.tsx`, `src/core/transit-comparison.ts`, `src/shared/types.ts`, `src/renderer/styles.css`, and the existing route-search tests.

**Approach:** Reuse the Leaflet/OSM tile and tile-error patterns from `ODDemandMap` and `ScenarioNetworkMap`. Render the map on every route-search entry, fit it to the current catalog when coordinates exist, and offer an explicit endpoint mode that assigns the first click to origin and the second to destination. Provide visible `출발지 다시 선택`, `도착지 다시 선택`, and `선택 초기화` controls so click order is never implicit after a query has run. Keep station search as a precise fallback and allow marker/list selection to replace either endpoint. Normalize journey legs into a pure map model with origin/destination markers, transit/walk/transfer styles, alternative route identities, and a quality flag for actual versus stop-coordinate fallback geometry. The map component owns only display and click events; query and result state remain in the workspace.

**Test scenarios:** the map container is present before a query; first and second map clicks create distinct endpoints; clicking a station marker or search candidate updates the matching endpoint; origin/destination markers remain visible after a result; returned geometry creates a polyline; missing geometry creates a labeled fallback; route-card selection changes only the selected overlay; tile failure shows a warning without removing endpoint controls or result cards; coordinate bounds and identical endpoints are rejected locally.

**Verification:** core map-model tests, renderer interaction tests, `npm run build`, and native acceptance with map endpoint selection, result overlay, route-card synchronization, and tile-error fallback.

### U9. Replace raw route-search time input with intent-based controls (0.9.0)

**Goal:** Let users express when they want to depart without treating a raw datetime field as the primary interaction.

**Requirements:** R12.

**Files:** Create `src/renderer/RouteSearchTimeControls.tsx` and `tests/renderer/RouteSearchTimeControls.test.tsx`. Modify `src/renderer/RouteSearchWorkspace.tsx`, `src/core/motis.ts`, `tests/core/motis.test.ts`, and route-search styles.

**Approach:** Default to `지금 출발`, expose a visible date field and time field only when the user chooses an explicit departure time, and provide `+15분`, `+30분`, and `+1시간` presets. Keep the internal value as a single KST-compatible `departureDateTime` for the existing MOTIS request contract. Centralize formatting, rounding, and date rollover in a core helper. Do not add arrival-time search until the MOTIS request contract explicitly supports `arriveBy` semantics.

**Test scenarios:** current time initializes the control in KST; `지금 출발` resets a manually edited value; presets roll over midnight correctly; explicit date/time edits produce the same ISO value accepted by `buildMotisPlanPath`; invalid or empty values block search with local guidance; the chosen time is shown consistently in the query summary and result.

**Verification:** focused core and renderer tests, full typecheck/build, and native route-search checks using current-time and explicit-time flows.

### U10. Normalize input and route-search action language (0.9.0)

**Goal:** Remove the remaining ambiguity in the data-input and route-search action hierarchy observed during native use.

**Requirements:** R13.

**Files:** Modify `src/renderer/App.tsx`, `src/renderer/ReportDomainNavigation.tsx`, `src/renderer/RouteSearchWorkspace.tsx`, `src/renderer/SyntheticMotisStep.tsx`, `src/renderer/styles.css`, `tests/renderer/AppNavigation.test.tsx`, `tests/renderer/ReportDomainNavigation.test.tsx`, `tests/renderer/RouteSearchWorkspace.test.tsx`, and relevant Synthetic MOTIS tests.

**Approach:** Audit every action in the import and route-search surfaces. Keep one primary action per state with result-oriented labels such as `입력 완료`, `경로 찾기`, or `다음 단계로`; move PBF verification, technical diagnostics, and MOTIS stop into secondary/advanced areas; remove decorative `→` suffixes and duplicate verbs. Preserve existing deep links and disabled-state explanations. Treat copy changes as a behavior contract tested through accessible button names, not screenshots alone.

**Test scenarios:** each import state has exactly one visually primary action; primary labels contain no ambiguous arrow-only cue; PBF preparation and search actions are distinct; disabled actions explain the missing prerequisite locally; keyboard focus order follows the intended sequence; route-search and scenario MOTIS screens use consistent PBF and time language.

**Verification:** focused renderer tests, `npm run typecheck`, `git diff --check`, and native inspection of import and route-search action hierarchy.

### U11. Release documentation and end-to-end acceptance

**Goal:** Ship the two release slices with explicit migration and user-facing behavior documentation.

**Requirements:** R1–R13.

**Files:** Modify `CHANGELOG.md`, `README.md`, `docs/release-process.md`, and add `docs/releases/0.8.1.md` and `docs/releases/0.9.0.md` when each release is approved. Add or update a native acceptance report under `docs/test-reports/`.

**Approach:** Document the partial-to-canonical station migration, the difference between analysis, scenario, and map-first route search, the PBF discovery/Geofabrik first-run flow, and the meaning of current-only/scenario-only results. Record rollback guidance for v11 migration and remove dead legacy picker/action UI after the replacement is verified. Treat native acceptance as a release gate, not as a post-release demonstration.

**Test scenarios:** install/open a v0.8.0 project, migrate it, run analysis, edit a mixed scenario, reopen it, prepare a missing-PBF first-run state, re-detect a downloaded PBF, choose route-search endpoints on the map, run current route search, inspect the result overlay and time controls, and compare the same OD against the scenario target. Confirm package smoke still finds the expected executable and bundled MOTIS assets.

**Verification:** `npm test`, `npm run typecheck`, `npm run build`, `npm run release:verify`, `npm run test:packaged-smoke`, and the native acceptance checklist.

## Verification Contract

### 0.8.1 gate

- Focused import and scenario renderer tests pass.
- `npm test` passes with no snapshot or accessibility regressions.
- `npm run typecheck` and `npm run build` pass.
- Native flow confirms one primary input action, searchable station selection, focused scenario map, and no change to saved project schema.

### 0.9.0 gate

- v10 migration fixtures pass for both complete and partial master inputs.
- Catalog, route membership, scenario overlay, GTFS, MOTIS, route-search map, PBF discovery, time controls, and comparison tests pass against the same IDs and fingerprints.
- `npm test`, `npm run typecheck`, `npm run build`, `npm run release:verify`, and packaged smoke pass.
- Native flow confirms PBF absence guidance, automatic re-detection, a visible map on route-search entry, map-selected origin/destination, route overlay and card synchronization, current-time/preset search, mixed existing/new route scenario save and reopen, current/scenario output distinction, and independent current-network route search.
- No route-search acceptance is granted if the screen falls back to a text-only query/result workflow or requires recurring manual PBF selection after a successful discovery.
- `git diff --check` is clean and abandoned experimental picker/action code is removed.

## Definition of Done

- R1–R8 are traceable to at least one implementation unit and one observable test scenario.
- 0.8.1 can be released independently without requiring the v11 migration or new route-search workspace.
- 0.9.0 preserves v10 project readability, does not mutate original master data, and supports mixed route scenarios after reopen.
- The route-search workspace is reachable without opening scenario analysis, opens with a usable Leaflet map, accepts map or search endpoints, and draws synchronized route results.
- PBF readiness is automatic after first setup, missing assets produce Geofabrik guidance, and manual path entry is an advanced fallback rather than the normal flow.
- Time controls express `지금 출발` or an explicit departure time with presets while preserving the existing MOTIS request contract.
- User-facing labels distinguish analysis, scenario editing, and route search, with one clear primary action and no ambiguous arrow-only suffixes.
- No stale duplicate UI, dead experimental code, or unreferenced migration path remains.

## Appendix

### Current repository evidence

- `src/core/station-master.ts:89-141` already normalizes and merges station records but does not persist a standalone station DB.
- `src/core/route-master.ts:199-270` already separates route path indexing from station identity at runtime.
- `src/main/duckdb.ts:33-64` currently creates only the `records` table.
- `src/shared/types.ts:174-182` and `src/core/scenario-network-overlay.ts` already provide the v3 overlay foundation.
- `src/renderer/SyntheticScenarioStep.tsx:45-101` currently switches between existing-route and new-route modes and stores only the active editor's route collection.
- `src/renderer/App.tsx:1508-1510` currently renders three same-level input actions, which motivates U3.
- `src/renderer/RouteSearchWorkspace.tsx` currently renders only station pickers, a raw PBF path field, `datetime-local`, and a text-only journey result; it has no Leaflet map or map endpoint state.
- `src/main/motis-osm.ts` exposes Geofabrik URL metadata and PBF inspection, but `src/main/index.ts` currently exposes only open-page, file-select, and explicit-path inspection IPC handlers.
- `src/renderer/ODDemandMap.tsx` and `src/renderer/ScenarioNetworkMap.tsx` provide the existing Leaflet/OSM tile, bounds, marker, and tile-error patterns to reuse for route search.

### External UX references

- [Naver Map Help: start/destination selection](https://help.naver.com/service/5637/contents/8301?osType=PC) documents both search-based endpoint selection and map right-click selection. This supports the contextual-add and endpoint-picker interaction pattern.
- [Google Maps Help: public transit map layer](https://support.google.com/maps/answer/3092439?hl=en) describes transit lines as an optional map layer and station-stop selection, supporting an opt-in all-network layer rather than rendering every stop by default.
- [Google Maps Help: directions and route selection](https://support.google.com/maps/answer/144339/get-directions-amp-show-routes-android?hl=en-GB) describes multiple route options, a highlighted best route, and map selection of alternatives. This supports route cards plus selected-route emphasis.
- [Kakao Map service page](https://www.kakaocorp.com/page/service/service/KakaoMap) presents public transit as a distinct route-finding mode and emphasizes boarding/alighting guidance, supporting a separate route-search workspace.
- [Moovit Help: getting started](https://support.moovitapp.com/hc/en-us/articles/211391869-Getting-Started-with-Moovit) describes line search with route maps and stop lists, supporting name/ID search and stop-sequence detail for this app.

### Existing related design documents

- `docs/superpowers/specs/2026-09-22-scenario-network-overlay-design.md`
- `docs/superpowers/plans/2026-09-22-scenario-network-overlay-plan.md`
- `docs/superpowers/specs/2026-09-21-synthetic-gtfs-ux-expansion-design.md`
- `docs/superpowers/plans/2026-09-21-synthetic-gtfs-ux-expansion-plan.md`

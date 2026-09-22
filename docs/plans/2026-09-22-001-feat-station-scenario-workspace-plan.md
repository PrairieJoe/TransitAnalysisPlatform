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
- 입력 단계의 행동 계층 정리, 정류장 검색, 시나리오 지도 기본 표시 개선은 호환성 변경 없이 `0.8.1`로 먼저 제공한다.
- 정류장 catalog의 독립 저장, 기존 노선과 신규 노선의 복합 시나리오, 지도 우클릭 정류장 생성, 독립 MOTIS 경로탐색 workspace는 `0.9.0`에 포함한다.
- 실행 전까지 프로젝트 원본 `stationMaster`와 `routeStopMaster`를 직접 수정하지 않는다.
- 계획 승인 전에는 코드를 수정하지 않는다.

## Implementation Status (2026-09-22)

- **0.8.1 확정:** `codex/0.8.1-input-scenario-ux` 브랜치에 release metadata, 입력·시나리오 UX, packaged smoke 수정까지 반영하고 원격 push를 완료했다. 구버전 `out`·`release` 산출물은 정리했으며, 0.8.1 설치 파일은 검증 후 생성된 상태다.
- **0.9.0 완료 단위:** U1/U2 canonical station catalog·DuckDB 독립 저장·v10→v11 migration(`b69f2fd`), U5 복합 노선 시나리오·우클릭 정류장 추가(`7788208`), U6 현행 네트워크 독립 MOTIS 경로탐색(`ad775a6`)을 현재 작업 브랜치에 구현했다.
- **현재 경계:** 0.9.0 후보 version bump와 release note, Windows 설치 파일 생성, packaged smoke까지 완료했다. 후보는 로컬에만 설치·실행했으며 원격 push와 최종 릴리스 승격은 아직 하지 않았다.
- **남은 확인:** 실제 Electron 화면에서 우클릭과 `좌표 직접 입력` fallback, 혼합 시나리오 저장·재개방, 독립 경로탐색의 MOTIS 실행을 native acceptance로 확인한다.

## Product Contract

### Summary

사용자는 교통카드 분석, 노선 개편 시나리오, 일반 경로탐색을 서로 다른 목적의 작업으로 이해할 수 있어야 한다. 이를 위해 정류장과 노선 경로의 데이터 계약을 분리하고, 시나리오 편집기는 선택한 노선과 변경된 정류장을 중심으로 보여주며, MOTIS는 독립적인 현재 기준 경로탐색 기능으로 이동시킨다.

### Problem Frame

현재 버전은 다음을 부분적으로 지원한다.

- `src/core/station-master.ts`는 정류장 사전 내부 중복을 `stationId`로 제거하고, `mergeStationMasterRecords`는 정류장 사전을 우선해 노선정보의 누락 정류장을 보완한다.
- `ProjectManifest`에는 `stationMaster`와 `routeStopMaster`가 별도 배열로 존재한다.
- 그러나 `src/main/duckdb.ts`에는 거래 records 테이블만 있고, 정류장 catalog와 노선-정류장 관계를 저장하는 독립 테이블은 없다. 현재 정류장 데이터는 프로젝트 JSON metadata 배열에 머문다.
- `ScenarioDefinition` v3와 overlay materializer는 기존 노선 변경 및 신규 노선의 실행 모델을 갖고 있다. 하지만 `SyntheticScenarioStep`의 UI는 `기존 노선 개편`과 `새 노선 만들기`를 모드로 나누며, 한 저장 흐름에서 여러 기존 노선 변경과 신규 노선을 함께 편집하는 모델은 제공하지 않는다.
- 시나리오 지도는 모든 정류장을 기본으로 표시하고, 정류장 추가는 지도 클릭 모드와 긴 선택 목록에 의존한다. 선택 노선 중심의 계층, 검색, 우클릭 contextual action이 없다.
- 데이터 입력 단계에는 `입력 완료 → 하차 추정`, `관측값 분석`, `GTFS 구축으로 이동`이 같은 시각적 레벨에 놓여 있어 다음 행동과 대체 행동의 차이가 약하다.

### Requirements

- **R1 — 정류장 catalog:** STTN 계열 정류장정보와 ROUTESTTN 계열 노선-정류장정보를 `stationId` 기준의 하나의 canonical station entity와 별도의 route membership으로 정규화한다. 같은 ID의 명칭·좌표 충돌은 보존 가능한 경고와 provenance로 남긴다.
- **R2 — 입력 행동 계층:** 입력 단계에는 현재 단계의 권장 다음 행동 하나를 primary action으로 표시하고, 관측 분석·GTFS 구축 같은 대체 목적은 secondary action 또는 별도 output 선택으로 낮춘다.
- **R3 — 시나리오 지도 초점:** 기본 지도는 선택한 노선의 현행·개편안 및 변경 정류장만 보여주고, 전체 정류장·노선 레이어는 사용자가 켤 때만 표시한다.
- **R4 — 검색 가능한 선택:** 기존 정류장과 노선 선택은 이름·ID·ARS 번호를 검색하고 키보드로 선택할 수 있어야 한다. 단순 장문 `<select>`에 의존하지 않는다.
- **R5 — 지도 contextual add:** 지도 우클릭으로 해당 좌표의 신규 정류장 draft를 만들 수 있어야 한다. 우클릭을 사용할 수 없는 환경에서는 동일 기능을 제공하는 키보드/버튼 경로를 유지한다.
- **R6 — 복합 시나리오:** 한 시나리오 안에서 기존 노선 여러 개의 개편과 신규 노선 여러 개의 생성을 함께 저장·재개방·실행할 수 있어야 한다. 현행 원본은 불변이어야 한다.
- **R7 — 경로탐색 workspace:** MOTIS 지점 간 경로탐색을 분석 또는 시나리오 편집의 하위 단계가 아닌 독립 workspace로 제공한다. 기본 대상은 현행 네트워크이며, 필요할 때 시나리오 네트워크를 선택한다.
- **R8 — 일관된 결과 언어:** 현행에 없는 신규 노선, 현행 경로 없음, 개편안 신규 경로를 오류와 구분하여 표시하고, 동일한 OD에 대해 현행·개편안 결과를 비교할 때만 비교 영역에서 사용한다.

### Acceptance Examples

- 같은 `stationId`가 STTN 파일과 ROUTESTTN 파일에 모두 있으면 station catalog에는 한 번만 나타나고, route membership에는 각 노선의 순서가 남는다. 명칭 또는 좌표가 다르면 사전 우선 규칙과 충돌 경고를 볼 수 있다.
- 노선정보 입력이 완료된 화면에서 사용자가 가장 먼저 보는 primary action은 하나이며, 하차 추정 실행과 관측값만 분석하는 흐름은 별도의 secondary action으로 구분된다.
- 시나리오를 열면 선택 노선과 변경 정류장만 크게 보인다. 전체 정류장 레이어를 켜야 다른 정류장이 표시된다.
- 정류장 추가 검색창에 이름 일부 또는 ID를 입력하면 후보가 즉시 좁혀지고, 후보 선택 후 순서 목록과 지도 선택 상태가 동시에 갱신된다.
- 지도에서 우클릭한 좌표로 신규 정류장 draft가 열리고, ID·명칭을 입력해 저장하기 전에는 원본 catalog가 변하지 않는다.
- `R1`을 개편하면서 `N-1`과 `N-2`를 함께 추가한 시나리오를 저장하고 재개방하면 세 변경이 모두 유지된다. 현행 GTFS에는 `N-1`, `N-2`가 없고 개편안 GTFS에만 존재한다.
- 별도 경로탐색 workspace에서 현행 네트워크의 출발지·도착지를 선택해 MOTIS 경로를 조회할 수 있다. 같은 질의를 시나리오 비교로 보낼 때만 현행·개편안 차이가 표시된다.

### Success Criteria

- v0.8.1 범위는 기존 프로젝트/시나리오 저장 형식을 변경하지 않고 입력·검색·지도 초점의 회귀 테스트를 통과한다.
- v0.9.0 범위는 v10 프로젝트를 읽어 canonical catalog를 안전하게 만들고, 재저장 후에도 원본 배열과 기존 시나리오를 보존한다.
- 복합 시나리오가 현행/개편안 GTFS, MOTIS 실행, 비교 결과에서 동일한 overlay materialization을 사용한다.
- 신규 경로와 결과 없음이 generic failure로 표시되지 않는다.
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
- 현재/시나리오 네트워크를 선택할 수 있는 독립 MOTIS route search workspace.
- overlay fingerprint, 결과 상태, 프로젝트 재개방 계약 확장.

**Out of scope**

- 네이버·카카오·구글 지도를 앱 안에 임베드하거나 타일 공급자를 교체하지 않는다.
- 자동 노선 최적화, 수요 기반 노선 추천, 정류장 입지 최적화를 추가하지 않는다.
- 정류장 ID를 좌표 근접성만으로 자동 병합하지 않는다.
- 실시간 차량 위치·도착정보를 이번 범위에 포함하지 않는다.

### Dependencies and Deferred Questions

- MOTIS runtime과 기존 IPC 실행 계약을 재사용한다. 경로탐색의 ranking 정책은 현재 MOTIS 결과를 우선 사용하며, 사용자별 선호도 저장은 후속 범위다.
- 지도 우클릭은 Leaflet `contextmenu` 이벤트를 사용한다. 우클릭을 사용할 수 없는 입력장치에서도 버튼과 키보드 단축 경로를 제공한다.
- station catalog의 원천 파일명·행번호 provenance는 v0.9.0에서 최소한 충돌 조사에 필요한 수준으로 저장한다. 원본 행 전체의 감사 로그는 후속 범위다.

## Planning Contract

### Key Technical Decisions

1. **전체 분류는 0.9.0으로 한다.** 정류장 데이터의 저장 경계, 시나리오 모델의 cardinality, MOTIS 기능의 정보 구조가 함께 바뀌므로 UI-only minor patch가 아니다. 다만 R2–R4는 v0.8.1로 선행 배포해 사용자 불편을 즉시 줄인다.
2. **station catalog와 route membership을 분리한다.** 프로젝트 DB에는 canonical `stations` 논리 테이블과 `route_stops` 논리 테이블을 둔다. `route_stops.station_id`가 stations를 참조하며, 노선 순서·운행일자·노선 메타데이터는 route membership에 남긴다. 기존 `ProjectManifest.stationMaster`와 `routeStopMaster`는 v0.9.0 한 릴리스 동안 v10 호환 snapshot으로 읽고 쓰되, 새 기능은 catalog adapter를 통해 접근한다.
3. **충돌은 deterministic하게 처리한다.** 독립 station source가 있으면 canonical station의 명칭·좌표를 우선하고, 없으면 route-stop에서 최초로 정규화된 값을 사용한다. 다른 값은 삭제하지 않고 source/conflict warning으로 노출한다. 위치가 가까워 보인다는 이유만으로 서로 다른 ID를 합치지 않는다.
4. **시나리오 원본과 overlay를 분리한다.** 현재 `ScenarioDefinition` v3의 `routeChanges`, `addedStations`, `stationOverrides`, `addedRoutes`를 유지하고, renderer가 아니라 `scenario-network-overlay.ts`가 여러 변경을 materialize한다. 편집기 상태만 단일 route에서 collection 상태로 확장한다.
5. **경로탐색은 공유 core 실행 client 위의 독립 workspace로 추출한다.** `SyntheticMotisStep`의 scenario comparison 전용 흐름과 일반 route search를 같은 MOTIS 요청 client로 연결하되, 저장·탐색·결과 화면의 목적은 분리한다. 기본 route search target은 `current`다.
6. **공식 지도 UX의 구조만 차용한다.** 입력/검색 → 후보 또는 경로 카드 → 지도 강조 → 상세 stop sequence라는 계층을 사용한다. 서비스별 색상·문구·브랜드 UI를 복제하지 않는다.

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
        └── Route Search workspace ◄──────┴── shared MOTIS execution client
                                                    │
                         Scenario comparison ───────┘
```

The project store owns migration and persistence. Core catalog, overlay, and route-search modules remain pure where possible. Renderer components own only transient selection, focus, context-menu draft, and loading state. Main/preload owns DuckDB writes and MOTIS execution. All current/scenario GTFS and comparison inputs originate from the same materialized network result.

### System-Wide Impact

- **Shared types:** add catalog, membership, route-search query/result, migration metadata, and explicit route status types in `src/shared/types.ts`.
- **Persistence:** extend `src/main/duckdb.ts` and `src/main/project-store.ts`; migrate v10 projects to v11 without losing JSON compatibility fields.
- **Import boundary:** `src/renderer/App.tsx` and `src/main/import-job.ts` must normalize both source files once and pass catalog/membership to analysis and scenario consumers.
- **Renderer navigation:** extend the current `home/import/report/synthetic` view model with a route-search workspace without nesting it under scenario editing.
- **Staleness:** catalog version, route membership version, scenario overlay fingerprint, and MOTIS environment must participate in stale-result gating.
- **Performance:** do not render all station markers by default. Search and layer filters operate on the catalog before Leaflet marker creation.
- **Accessibility:** context-menu actions have visible button and keyboard alternatives; selection is not conveyed by color alone.

### Risks and Dependencies

- **Migration risk:** a v10 project may have only route-stop data or only station data. Mitigation: derive missing catalog rows from route stops, keep source warnings, write migration fixtures for both cases, and make migration idempotent.
- **Identity risk:** the same numeric ID may be reused across source systems. Mitigation: keep source provenance and do not merge by name or coordinate.
- **Scenario state risk:** switching between routes or editor modes can leak transient overlay state. Mitigation: store a scenario-level collection keyed by route ID and test switching, save, reopen, and reset.
- **MOTIS dependency:** runtime startup and network artifacts can fail independently of UI. Mitigation: preserve current status/error boundaries and show route-search-specific empty/error states.
- **Map dependency:** OSM tiles may be unavailable. Mitigation: coordinate and list editing remain usable without tiles.
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

**Approach:** Define a route-search query with origin, destination, departure time, target network, and constraints. Reuse the existing MOTIS request/result client and runtime status. Add a top-level workspace with searchable station/coordinate endpoints, route option cards, selected route map highlighting, and stop-by-stop detail. Make scenario comparison call the same client with two targets instead of owning the general route-search UI.

**Test scenarios:** current target works with station endpoints; coordinate endpoints validate range; missing runtime reports an actionable state; empty result is distinct from execution failure; scenario target uses the materialized overlay; identical query and environment produce a stable fingerprint; comparison consumes route-search results without changing the standalone workspace state.

**Verification:** core route-search tests, renderer/MOTIS tests, typecheck, build, and native current-network route-search flow.

### U7. Release documentation and end-to-end acceptance

**Goal:** Ship the two release slices with explicit migration and user-facing behavior documentation.

**Requirements:** R1–R8.

**Files:** Modify `CHANGELOG.md`, `README.md`, `docs/release-process.md`, and add `docs/releases/0.8.1.md` and `docs/releases/0.9.0.md` when each release is approved. Add or update a native acceptance report under `docs/test-reports/`.

**Approach:** Document the partial-to-canonical station migration, the difference between analysis, scenario, and route search, and the meaning of current-only/scenario-only results. Record rollback guidance for v11 migration and remove dead legacy picker/action UI after the replacement is verified.

**Test scenarios:** install/open a v0.8.0 project, migrate it, run analysis, edit a mixed scenario, reopen it, run current route search, and compare the same OD against the scenario target. Confirm package smoke still finds the expected executable and bundled MOTIS assets.

**Verification:** `npm test`, `npm run typecheck`, `npm run build`, `npm run release:verify`, `npm run test:packaged-smoke`, and the native acceptance checklist.

## Verification Contract

### 0.8.1 gate

- Focused import and scenario renderer tests pass.
- `npm test` passes with no snapshot or accessibility regressions.
- `npm run typecheck` and `npm run build` pass.
- Native flow confirms one primary input action, searchable station selection, focused scenario map, and no change to saved project schema.

### 0.9.0 gate

- v10 migration fixtures pass for both complete and partial master inputs.
- Catalog, route membership, scenario overlay, GTFS, MOTIS, and comparison tests pass against the same IDs and fingerprints.
- `npm test`, `npm run typecheck`, `npm run build`, `npm run release:verify`, and packaged smoke pass.
- Native flow confirms mixed existing/new route scenario save, reopen, current/scenario output distinction, and independent current-network route search.
- `git diff --check` is clean and abandoned experimental picker/action code is removed.

## Definition of Done

- R1–R8 are traceable to at least one implementation unit and one observable test scenario.
- 0.8.1 can be released independently without requiring the v11 migration or new route-search workspace.
- 0.9.0 preserves v10 project readability, does not mutate original master data, and supports mixed route scenarios after reopen.
- The route-search workspace is reachable without opening scenario analysis, while scenario comparison reuses its execution contract.
- User-facing labels distinguish analysis, scenario editing, and route search.
- No stale duplicate UI, dead experimental code, or unreferenced migration path remains.

## Appendix

### Current repository evidence

- `src/core/station-master.ts:89-141` already normalizes and merges station records but does not persist a standalone station DB.
- `src/core/route-master.ts:199-270` already separates route path indexing from station identity at runtime.
- `src/main/duckdb.ts:33-64` currently creates only the `records` table.
- `src/shared/types.ts:174-182` and `src/core/scenario-network-overlay.ts` already provide the v3 overlay foundation.
- `src/renderer/SyntheticScenarioStep.tsx:45-101` currently switches between existing-route and new-route modes and stores only the active editor's route collection.
- `src/renderer/App.tsx:1508-1510` currently renders three same-level input actions, which motivates U3.

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

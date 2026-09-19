# Road shapes v0.6.1 — 2026-09-18

## Plan
1. Verify native MOTIS BUS geometry contract from official source and local patched source.
2. Write failing unit tests for BUS-only requests, geometry validation, ordered keys, unavailable service and per-segment fallback.
3. Implement bounded sequential native OSR requests with explicit source and quality summary.
4. Reuse prepared graph if present; otherwise import local Korea PBF using patched binary and a single worker. Evaluate 20–50 directed Yeosu station pairs, including reverse direction, and document restriction coverage honestly.
5. Save raw local validation artifacts and rerun focused tests.

## Contract evidence
Native endpoint is POST `/api/route`, JSON `{profile:"bus", direction:"forward", start:{lat,lng}, destination:{lat,lng}, max:3600}`. Result is GeoJSON FeatureCollection with LineString features, OSM way IDs and distance/duration metadata. CAR is never substituted.

Sources: [official endpoint](https://github.com/motis-project/motis/blob/master/src/endpoints/osr_routing.cc), [official profiles](https://github.com/motis-project/osr/blob/master/include/osr/routing/profile.h). Local source `C:/Users/User/AppData/Local/Temp/tap-motis-master/include/motis/motis_instance.h` registers POST `/api/route`; local OSR profile parser recognizes lower-case `bus`.

Prepared scenario directories currently retain reports/logs only, with no config or graph binaries. Runtime validation results will be appended.

## 실제 여수시 형상 검증 결과

`scripts/validate-road-shapes.mts`를 실제 ROUTESTTN 2024-04-15 원천에서 실행했다. 노선 ID가 `460`으로 시작하는 노선 중 결정론적으로 20개를 골라 2,804개 연속 정류장 구간을 BUS 프로파일로 조회했다. 네이티브 MOTIS OSR 경로는 1,862개 구간(66.41%)에서 유효한 LineString을 반환했고, 942개(33.59%)는 검증된 직선 대체 형상으로 표시했다. 유효하지 않은 형상은 0개였고, 요청 수는 2,804건이었다. 정류장과 도로 사이 연결선, 긴 비도로 직선, 1.75 초과 우회비율 경고를 결과에 남겼다. 실패 프로브는 의도적으로 없는 좌표를 조회해 `no path found`를 받았으며, 이후 회로 차단과 직선 대체가 동작했다.

증빙은 `test-artifacts/road-shapes/evaluation-real.json`이다. 입력 ROUTESTTN SHA-256은 `a0423867a0a8cfb2a42ca7da325a57787e9be8888fb1b32f8e55f4be59557280`이며, 실행 바이너리는 `vendor/motis/patched-windows/motis.exe`이다. 이 결과는 네이티브 `bus` 프로파일과 GeoJSON 형상·끝점 검증을 확인한 것이다. 특정 일방통행·BUS 접근 태그를 독립적으로 대조한 결과는 아니므로 규제 준수 증거로 해석하지 않는다. 현재 구현은 결과를 프로젝트에 영구 저장하지 않고 현재 노선 조회에 사용한다.

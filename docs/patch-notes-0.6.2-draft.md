# 0.6.2 업데이트 초안

> 기준: `v0.6.1` (`de49a70`) → `codex/0.6.2-main-integration` (로컬 통합 후보, `8d2c66c` 포함)
>
> 이 문서는 최종 patch note가 아니라, 통합·테스트 후 승인 전 검토용 초안입니다.

## 핵심 변경

- 대용량 분석·가져오기·하차 추론을 main-process job 경계로 이동했습니다.
- 작업 상태를 `queued`, `running`, `cancelling`, `completed`, `cancelled`, `failed`로 관리하고 진행률·취소 IPC를 연결했습니다.
- 프로젝트 revision을 검증해 오래된 분석 결과나 취소된 결과가 저장되지 않도록 했습니다.
- 파일 파싱·정규화·품질 분류를 import prepare/commit 단계로 분리했습니다.
- 프로젝트 목록 응답을 bounded `ProjectSummary`로 축소해 전체 거래내역·노선 마스터·분석 결과가 목록 IPC로 전달되지 않도록 했습니다.
- 노선 혼잡도 분석에서 renderer가 노선 정류장 마스터 전체를 IPC로 보내지 않고 main이 프로젝트 메타데이터를 직접 읽도록 했습니다.
- 분석 결과 탭이 저장 완료 전에 활성화되어 stale revision이 발생하던 전환 경합을 수정했습니다.
- 노선 혼잡도 표를 250행 페이지로 제한해 수만 개 구간 결과도 renderer DOM을 과도하게 점유하지 않도록 했습니다. 전체 결과·지도 데이터는 유지됩니다.
- 패키지 검증을 위해 공식 MOTIS Windows 배포본을 로컬에 준비하고 NSIS 번들 smoke 검증을 완료했습니다.

## 확인된 검증 결과

- 전체 자동 테스트: 54개 파일, 264개 테스트 통과
- TypeScript typecheck 통과
- 7일 benchmark: 762,499행, JS/DuckDB 합계 일치
- 실제 여수시 1일·7일 UI: 가져오기, 하차 추론, 요일·OD·노선 분석, 추정값 토글, 3D, reload 복원 통과
- 1일 renderer timer p95/p99/max: 532.7/1,214.9/1,378.4ms
- 7일 renderer timer p95/p99/max: 46.4/2,839.1/19,133.6ms
- 7일 renderer 오류: 0건
- 통합 브랜치의 7일 UI 결과: 762,499행, 추정 553,534행, OD observed/high-confidence 199,037/199,976건, route expected-flow 761,644건
- 통합 브랜치의 MOTIS timetable-only 시나리오: Before/After 동일 OD 응답·배치 샘플 37건 통과

## 확인한 외부 입력/제한

- 공식 MOTIS Windows `v2.11.3`과 공식 Geofabrik 대한민국 PBF를 로컬에 준비했습니다. 패키지에는 MOTIS 실행 파일과 tiles 프로필이 포함됩니다.
- MOTIS timetable-only Synthetic GTFS 시나리오는 통과했습니다.
- 공식 MOTIS `v2.11.3`은 대한민국 전체 PBF OSR import에서 `node ... has 18 ways, maximum is 16`으로 중단됩니다. 이는 저장소 문서에 기록된 공식 배포본 제한이며 애플리케이션/GTFS 계산 실패가 아닙니다. 전국 OSM routing은 기존 32-way 패치 MOTIS 빌드 또는 지역 추출 PBF가 필요합니다.
- 도로 형상 검증 스크립트는 `ROAD_SHAPES_SOURCE`, `ROAD_SHAPES_PBF`, `ROAD_SHAPES_OUTPUT` 환경변수로 사용자 PC 경로와 지역 PBF를 지정할 수 있도록 보완했습니다.
- 원본 Desktop `main` 작업 상태를 보존한 채 통합 브랜치에서 검증했으며, 원격 push와 실제 `main` 갱신은 아직 하지 않았습니다.

최종 patch note의 버전 문구, 변경 범위, 알려진 제한은 위 항목의 통합 결과와 사용자 승인 후 확정합니다.

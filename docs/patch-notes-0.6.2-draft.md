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
- 공식 MOTIS `v2.11.3` 소스/OSR commit을 고정하고, OSR의 `kMaxWaysPerNode`만 `16`에서 `32`로 확장한 TAP 커스텀 Windows 빌드를 재현 가능하게 만들었습니다. Windows/MinGW 빌드 호환성 패치와 필요한 런타임 DLL·MIT 라이선스 고지도 함께 패키징합니다.
- 커스텀 MOTIS를 Electron 리소스에 포함한 NSIS 번들 smoke 검증을 완료했습니다. 공식 MOTIS 배포본은 명시적 환경변수 없이는 패키징 경로에서 선택되지 않습니다.

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
- 통합 후보의 7일 분석 benchmark: 762,499행, 제외 0행, JS/DuckDB 합계 일치, 프로세스 최대 RSS 약 2.62GiB(현 장비 단일 측정)
- 288MB급 대한민국 PBF로 커스텀 MOTIS Base/After import·server readiness·대표 경로 및 37개 배치 질의를 통과했습니다. 양쪽 모두 37/37 경로 발견, tiles 비활성화와 `TBB_NUM_THREADS=1` 조건을 사용했습니다.

## 확인한 외부 입력/제한

- 공식 MOTIS Windows `v2.11.3`과 공식 Geofabrik 대한민국 PBF를 로컬에 준비했습니다. 패키지에는 MOTIS 실행 파일과 tiles 프로필이 포함됩니다.
- MOTIS timetable-only Synthetic GTFS 시나리오는 통과했습니다.
- 공식 MOTIS `v2.11.3`은 대한민국 전체 PBF OSR import에서 `node ... has 18 ways, maximum is 16`으로 중단되지만, 이번 후보에는 공식 commit을 기준으로 해당 값만 `32`로 확장한 커스텀 빌드를 반영했습니다. 따라서 이번 검증은 공식 바이너리의 결과가 아니라 TAP 커스텀 빌드의 결과이며, 32개 초과 연결을 지원한다는 의미는 아닙니다.
- 0.6.2 메모리 개선은 새 대형 캐시를 추가한 것이 아니라 main-process 작업 경계·bounded IPC payload·페이지 렌더링·취소/revision 보호로 renderer의 대형 원시 배열 보유를 줄이는 구조 변경입니다. 기존 0.6.1의 7일 프로세스 최대 RSS 약 2.82GiB와 이번 단일 benchmark 약 2.63GiB는 장비·실행 경로가 달라 직접 개선 배수로 단정하지 않습니다.
- 도로 형상 검증 스크립트는 `ROAD_SHAPES_SOURCE`, `ROAD_SHAPES_PBF`, `ROAD_SHAPES_OUTPUT` 환경변수로 사용자 PC 경로와 지역 PBF를 지정할 수 있도록 보완했습니다.
- 원본 Desktop `main` 작업 상태를 보존한 채 통합 브랜치에서 검증했으며, 원격 push와 실제 `main` 갱신은 아직 하지 않았습니다.

최종 patch note의 버전 문구, 변경 범위, 알려진 제한은 위 항목의 통합 결과와 사용자 승인 후 확정합니다.

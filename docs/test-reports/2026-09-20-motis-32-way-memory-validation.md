# 0.6.2 MOTIS 32-way and memory-boundary validation

기준일: 2026-09-20 KST. 대상 브랜치: `codex/0.6.2-main-integration`.
원본 Desktop 체크아웃과 원격 브랜치는 수정하지 않았다.

## MOTIS 입력과 산출물

| 항목 | 값 |
|---|---|
| MOTIS 기준 | 공식 tag `v2.11.3`, commit `b228a4519d196d9dd01b5ce80be46e642abc953e` |
| OSR 기준 | commit `a7b2ec2728544304ef1d8397b3042abc8d10f7e7` |
| 기능 패치 | `kMaxWaysPerNode`: `16` -> `32` 한정 변경 |
| PBF | `data/osm/south-korea-latest.osm.pbf`, 287,579,345 bytes |
| PBF SHA-256 | `f4f83623cf1d6e127d04d7b999d5a5c1d07bbee9e9e3e7457ac9b1e5b08e749c` |
| MOTIS SHA-256 | `8c1caf30e8457722070897105ee65deb2bb77ad959a65375b350cc3bd739694d` |
| MOTIS 크기 | 76,108,171 bytes |
| 검증 실행 | `MOTIS v2.11.3-dirty`, `--help` 정상 |

`dirty` 표시는 공식 MOTIS tag에서 TAP 패치를 적용했기 때문이다. 기능
변경은 OSR 16-way capacity 확장 하나이며, 나머지 tracked patch는
Windows/MinGW 빌드·링크·리소스 생성 호환성 보정이다.

## 전국 PBF 실행 결과

실행: `npm run test:motis-scenario -- --full-osm`

- Base와 After 모두 대한민국 PBF import 완료
- 두 실행 모두 MOTIS health readiness 통과
- 대표 OD 경로 Base/After 모두 발견, 총 소요시간 1,380초
- 06:00~09:00, 5분 간격 배치 37개에서 Base 37/37, After 37/37 경로 발견
- tiles는 비활성화하고 `TBB_NUM_THREADS=1`로 실행
- 결과 원문: `test-artifacts/motis-scenario/2026-09-20T08-57-41-406Z/report.json`

공식 Windows `v2.11.3` 배포본의 동일 제한 `node ... has 18 ways,
maximum is 16`은 기존 검증 보고서에 기록되어 있다. 이번 결과는 공식
바이너리의 결과가 아니라, 그 공식 commit을 기준으로 `16 -> 32`만 적용한
TAP 커스텀 빌드의 결과다. 32개를 초과하는 연결 노드를 지원한다고
해석하지 않는다.

초기 패키징 스모크에서는 MinGW 런타임 DLL 3개가 누락되어 `0xC0000135`
실행 실패가 발생했다. 빌드 스크립트와 배포본에 다음 파일을 추가한 뒤
PATH 없이 재검증했다.

- `libgcc_s_seh-1.dll`
- `libstdc++-6.dll`
- `libwinpthread-1.dll`

## 메모리·대용량 분석 경계

실행: `npm run benchmark:analysis -- "C:\Users\jojae\Desktop\Study\교통카드모음\1. 여수시\2. 교통카드" 7`

- 762,499행, 제외 0행
- JS/DuckDB observed `199,037`, high-confidence `199,976`, expected-flow `771,515` 일치
- 이번 Node benchmark 최대 RSS: 2,749,108 KiB, 약 2.62 GiB
- 결과: `test-artifacts/analysis-benchmark/2026-09-20T08-58-50.771Z/report.json`

0.6.2의 메모리 개선은 새 대형 캐시를 추가한 것이 아니다. main-process
job 경계, bounded project/IPC payload, 250행 renderer 표 페이지, 취소 및
revision 검증으로 renderer가 대형 원시 배열을 계속 보유·복제하지 않도록
한 구조 개선이다. 0.6.1의 7일 단일 측정 약 2.82 GiB와 이번 약 2.63 GiB는
장비·실행 경로가 다르므로 직접적인 개선 배수로 단정하지 않는다. 이전
실제 7일 UI 측정의 명시적 GC 후 heap은 약 525~526 MiB였고, 0.6.2
검증 harness의 동일 계열 측정은 약 670MB였으므로 이 값 역시 동일 조건
재측정 없이 단순 비교하지 않는다.

## 애플리케이션 검증

- `npm test`: 55개 파일, 270개 테스트 통과
- `npm run typecheck`: 통과
- `npm run build`: 통과
- `node scripts/motis/verify-patched-build.mjs ...`: 통과
- `node scripts/package-win.mjs`: NSIS 설치파일 및 unpacked MOTIS smoke 통과
- 패키지 내부 MOTIS `--help`: PATH를 `C:\Windows\System32`로 제한해도 통과
- `npm run motis:prepare -- --offline`: 검증된 로컬 배포본 재사용 통과

루트 Vitest 명령은 MOTIS UI의 Playwright 스펙을 잘못 수집하지 않도록
프로젝트 테스트 경로와 해당 외부 UI 스펙 제외 패턴을 명시했다.

## 브랜치와 원본 체크아웃 상태

- 구현·검증 대상은 `codex/0.6.2-main-integration`이며 MOTIS Release bootstrap
  반영 로컬 커밋은 `42dffc6`이다.
- `origin/main`은 `2017818` (`v0.5.1`)을 가리킨다. `v0.6.1`은
  `de49a70`이며 현재 통합 브랜치와 `origin/codex/0.6.2-responsive-execution-boundary`
  의 조상이지 `origin/main`의 조상은 아니다. 따라서 0.6.1 이력이 사라진
  것이 아니라 main과 0.6.2 작업 브랜치의 기준점이 갈라져 보였던 것이다.
- `C:\Users\jojae\Desktop\Study\TransitAnalysisPlatform`는 현재 `.git`
  메타데이터만 남아 있고 tracked 프로젝트 파일이 삭제(`D`)로 표시된다.
  이번 작업은 해당 경로를 복구하거나 수정하지 않았으며, 모든 구현·빌드·테스트는
  `C:\Users\jojae\.codex\worktrees\main-integration-062\TransitAnalysisPlatform`
  에서 수행했다.
- 원격 push, `main` 병합, 원본 Desktop 체크아웃 복구는 아직 수행하지 않았다.

Custom MOTIS 바이너리는 소스 저장소에 커밋하지 않는다. `motis-release-config.mjs`가
공식 MOTIS 기준 commit, OSR commit, `16 -> 32` 패치 식별자, Release asset URL과
검증 대상 바이너리 hash를 고정하고, `prepare-patched-windows.mjs`가 온라인에서는
Release asset을 다운로드하고 오프라인에서는 이미 검증된 로컬 배포본을 재사용한다.
GitHub Actions는 수동 실행 시 동일 빌드를 재생성하고, 명시적인 publish 선택이 있을
때만 Release asset을 갱신한다. 이 커밋 시점에는 원격 Release asset을 생성하지 않았다.

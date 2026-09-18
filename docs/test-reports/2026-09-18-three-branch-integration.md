# 3개 브랜치 통합 및 검증 — 2026-09-18

## 통합 범위

| 원본 | 통합 시작 시점 | 기능 |
| --- | --- | --- |
| `main` | `1ddbb3e` + 작업 폴더 변경분 | 내장 MOTIS, Synthetic GTFS, PBF 링크·선택, Before/After 비교 |
| `codex/alighting-inference-v1` | `775bdc6` | 하차누락 추정, 설정 화면, 관측·추정 분석 레이어 |
| `codex/threejs-route-3d` | `990e67c` + 작업 폴더 변경분 | 선택형 3D 노선 혼잡도, 입체 구간·정류장, 배포 preload 수정 |

통합 브랜치: `codex/integrate-transit-features-20260918`. 검증 후 로컬 `main`을 fast-forward로 반영한다. 원격 push와 기존 기능 브랜치 삭제는 수행하지 않는다.

기존 main의 미커밋 소스는 `74fcb0b`에 먼저 보존했다. 하차 추정 병합은 `c3da130`, 3D 병합은 `b7dc158`이다. 두 기능 작업 폴더의 원본은 수정하지 않았다. 3D 작업 폴더의 미커밋 소스·테스트 6개도 별도로 복사해 통합했다.

대용량 `data/`, `deps/`, `vendor/`, 기존 `test-artifacts/`, 패키징 임시 파일은 삭제하거나 Git에 추가하지 않았다. MOTIS 바이너리/PBF는 소스 저장소만 복제해 얻을 수 있는 파일이 아니므로 새 PC에서 패키징할 때는 별도 준비가 필요하다.

## 충돌 해결

- 가져오기 완료 화면에서 **하차 추정 / 관측값 분석 / GTFS 구축** 세 경로를 모두 제공한다.
- 노선정보 없이 관측값만 분석하는 기존 경로도 유지한다.
- 분석 화면에 **추정 방법 설정**과 **GTFS 구축** 진입 버튼을 함께 유지한다.
- 노선 혼잡도에서 2D/3D 전환을 유지한다. 추정 레이어를 바꾸면 같은 분석 결과가 표·지도·3D로 전달된다.
- Electron sandbox에서 사용할 CJS preload와 main의 경로를 맞춰 내장 MOTIS IPC도 함께 유지한다.
- 미커밋 지도 배경 준비 코드는 보존했지만 현재 3D 컴포넌트에 연결된 기능은 아니다. 이번 통합으로 온라인 지도 타일 기능을 새로 활성화하지 않았다.

## 검증 결과

| 검증 | 결과 |
| --- | --- |
| `npm test` | 41개 파일, 220개 테스트 통과 |
| `npm run typecheck` | 통과 |
| `npm run package:win` | TypeScript/Vite 빌드, NSIS 설치 파일 생성, 내장 MOTIS 파일 확인 통과 |
| `npm run test:motis-scenario` | 실제 MOTIS Before/After 서버 실행·경로 조회 통과 |
| `node scripts/smoke-packaged.mjs` | 실제 Windows 배포 실행 파일 UI·preload·DuckDB IPC 연계 통과 |
| `git diff --check` | 공백 오류 없음 |

제한된 실행 환경의 `spawn EPERM` 때문에 첫 Vitest 실행은 테스트를 시작하지 못했다. 하위 프로세스 실행 권한을 허용한 재실행에서 전체 통과했다. UI 테스트 스크립트 작성 중 선택자 문자열 오류 1건을 수정한 뒤 전체 UI 시나리오를 다시 통과했다. 이 두 건은 앱 기능 실패가 아니다.

### 기능 간 연계 테스트

`tests/core/feature-integration.test.ts`에 두 개를 추가했다.

1. 하차누락 A→C 추정 → 관측값 분석 5명 / 고신뢰 포함 15명 → 3D 구간 키·혼잡도·선택 가능 입체 객체 확인. 입력 원본은 불변이다.
2. 같은 노선 사전을 추정·3D 이후 GTFS 생성에 재사용 → 1개 노선, 4개 정류장, 왕복 104개 Trip, 유효성 통과. 노선 사전 원본은 불변이다.

### 실제 Windows 배포 앱

테스트용 프로젝트와 사용자 데이터 폴더를 `test-artifacts/packaged-smoke/<실행시각>/`에 격리했다. 사용자 기존 프로젝트를 열거나 덮어쓰지 않았다.

- 실제 `release/win-unpacked/Transit Analysis Platform.exe` 실행.
- CJS preload의 프로젝트 목록 IPC 확인.
- MOTIS 실행 파일이 **배포 앱의 `resources/motis/motis.exe`**로 해석되는지 확인.
- 노선 혼잡도 → 3D 시각화 → WebGL 장면 준비 완료 확인 및 화면 캡처.
- 추정 방법 설정 → 하차 추정 실행 → 누락 하차지 C가 실제 프로젝트에 저장됨을 확인.
- 노선 혼잡도 → 하차 추정값 사용 → 네이티브 분석 IPC 결과가 5명에서 15명으로 바뀌고 `high-confidence` 설정이 저장됨을 확인.
- GTFS 구축 → Before/After GTFS 생성 → 104개 Trip 생성 화면 확인.
- 처리되지 않은 renderer 예외: 0건.

최종 UI 증빙 폴더: `test-artifacts/packaged-smoke/2026-09-18T08-15-39.331Z/`

- `result.json`: 단계별 확인 결과와 실제 MOTIS 경로
- `route-3d.png`: 3D 표시 화면
- `gtfs-generated.png`: GTFS 생성 결과 화면
- `profile/`: 테스트 프로젝트와 격리된 앱 사용자 데이터

### 실제 MOTIS

증빙 폴더: `test-artifacts/motis-scenario/2026-09-18T08-10-49-340Z/`

- Before: 4,920초(82분)
- After: 4,200초(70분)
- 차이: -720초(-12분)
- 06:00–09:00, 5분 간격 37개 시점: Before 37/37, After 37/37 경로 발견
- 경고 없음

이번 재검증은 **timetable-only**이다. 대한민국 전체 PBF 재전처리, 도보·도로 접근 경로, 실제 대용량 업무 데이터 성능을 이번 결과로 보증하지 않는다. NSIS 파일은 생성했지만 이 테스트에서 사용자 PC에 설치/업그레이드하지는 않았다. 실행 검증은 같은 패키징 결과의 `win-unpacked` 배포본으로 수행했다.

## 이용자 재현 절차

프로젝트 폴더에서 다음 명령을 실행한다. 개발 의존성과 `vendor/motis` 배포 파일이 준비된 환경을 전제로 한다.

```powershell
npm test
npm run typecheck
npm run package:win
npm run test:motis-scenario
node scripts/smoke-packaged.mjs
```

마지막 명령은 실제 앱을 잠시 열어 자동 조작한 뒤 닫고, 매번 새로운 테스트 폴더에 기록한다. 콘솔의 `checks` 다섯 단계와 `rendererErrors: []`, 프로세스 종료코드 0을 확인한다. 테스트 창을 조작하지 말고 완료를 기다린다. MOTIS 스크립트는 8080 포트를 사용하므로 다른 MOTIS가 실행 중이면 먼저 종료한다.

수동 확인은 생성된 `profile` 폴더를 `--user-data-dir` 인자로 지정해 배포 실행 파일을 열어 진행할 수 있다. 테스트 프로젝트에서 추정 방법 설정 → 하차 추정 실행 → 노선 혼잡도 → 추정값 사용 해제/선택을 비교한다. 관측값만은 5명, 고신뢰 추정 포함은 15명이다. 3D로 전환해 입체 구간을 확인하고, GTFS 구축에서 06:00–23:00·20분 간격으로 생성하면 왕복 104개 Trip이 나온다.

GTFS의 운행시간과 하차 추정 결과는 테스트 가정의 결과이며 실제 운행 실적·정답을 의미하지 않는다. GPU가 WebGL2를 지원하지 않는 PC에서는 3D 대신 2D 대체 안내가 나올 수 있다.

## 배포 파일

- `release/TransitAnalysisPlatform-0.5.3-setup.exe`
- 크기: 153,687,995 bytes
- SHA-256: `36C23BC089A8D807A1DE78760339C1CAA7C1F3A5B5A2449CCF0AFE33EB32275F`

버전 번호는 기존 0.5.3을 유지했다. 같은 버전의 과거 설치 파일과 구분하려면 위 해시와 빌드 시각을 확인한다.

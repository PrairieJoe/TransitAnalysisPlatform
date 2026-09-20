# MOTIS MSVC 빌드와 A–B 보행 통합 재설계

기준일: 2026-09-20 KST

대상 릴리스: Transit Analysis Platform 0.6.2

상태: 사용자 방향 승인 후 작성한 구현 전 설계

## 결정 요약

Transit Analysis Platform(TAP)은 MOTIS 공식 `v2.11.3` 소스와 고정된 OSR 소스를 기준으로 `kMaxWaysPerNode`를 `16`에서 `32`로 확장한 Windows 배포본을 사용한다. 기능 패치는 이 용량 변경 하나로 제한한다.

기존 MSYS2/MinGW 빌드 경로는 폐기한다. 새 빌더는 MOTIS의 공식 Windows 빌드 방식과 호환되는 MSVC 및 Ninja 계열로 구성하고, 실제 도구 버전을 lock 파일과 산출물 manifest에 기록한다. TAP 애플리케이션 저장소에는 MOTIS 실행 파일을 커밋하지 않는다. 승인된 빌드는 GitHub Release asset으로 배포하고 TAP 패키징은 URL, SHA-256, manifest를 모두 검증한 뒤 사용한다.

시나리오 Before/After A–B 비교는 정류장 간 비교에 머물지 않는다. 동일한 출발·도착 좌표와 출발시각을 Before와 After에 적용하고, 접근 보행, 환승 보행, 귀가 보행을 총소요시간과 원인 분해에 포함한다. 따라서 OSM 보행망을 제거하거나 BUS 전용 PBF로 대체하지 않는다.

## 배경과 확인된 문제

대한민국 전체 PBF의 검증 스냅샷에는 OSM 노드 `10729381152`처럼 18개 way가 연결된 지점이 있다. 공식 MOTIS `v2.11.3`에 포함된 OSR은 노드당 최대 16개 way를 허용하므로 이 PBF의 OSR import를 중단한다. 문제 노드는 인천대학교 내부 보행로 교차점이므로, 분석 지역을 잘라내거나 보행로를 제거하는 방식은 해당 지역의 보행 접근성을 보존하는 일반 해법이 아니다.

기존 TAP 빌드는 기능 변경 한 줄 외에 MinGW 호환을 위한 다수의 의존성 패치를 적용했다. 최신 CI는 Windows 헤더 충돌을 우회한 뒤 Abseil `Win32Waiter`와 WinRT UUID 링크 오류에서 실패했다. 이 실패는 OSR 용량 값 때문이 아니라, 공식 배포 환경과 다른 MinGW 재빌드 경로가 만든 별도 호환성 문제다.

한편 현재 시나리오 공통 계약의 `ScenarioJourneyQuery`는 `originStopId`와 `destinationStopId`만 저장한다. 이 계약만으로는 임의 A–B 지점에서 정류장까지의 접근·귀가 보행을 표현할 수 없다. `scenario-path-generation` 설계도 BUS 노선 geometry 생성을 대상으로 하며 승객의 최적 A–B 여정 탐색은 후속 범위로 남겨 두었다.

## 목표

- 대한민국 전체 PBF를 포함해 노드당 17~32개 way가 있는 지역에서도 MOTIS import가 완료된다.
- 공식 MOTIS의 통합 보행·대중교통 여정 계산을 유지한다.
- Before와 After는 동일한 A–B 좌표, 출발시각, OSM 스냅샷을 사용한다.
- 접근·환승·귀가 보행시간을 결과와 델타 원인에 별도로 기록한다.
- Windows MOTIS 빌드는 깨끗한 환경에서 반복 가능하고, 출처·패치·도구 버전·해시를 감사할 수 있다.
- 개발자는 바이너리를 직접 들고 다니지 않고 검증된 Release asset을 내려받아 개발·패키징할 수 있다.
- Release 생성은 검증과 명시적 승인 없이는 실행되지 않는다.

## 비목표

- OSR을 32보다 크게 확장하지 않는다.
- OSM PBF의 과밀 노드를 삭제하거나 가상 노드로 변형하지 않는다.
- BUS 전용 PBF로 보행망을 제거하지 않는다.
- 0.6.2에서 별도 도로 라우팅 엔진이나 새로운 멀티모달 조합기를 도입하지 않는다.
- MOTIS 또는 OSR의 공식 배포본이라고 표시하지 않는다.
- 빌드 도구나 대용량 MOTIS 바이너리를 Git 소스 이력에 커밋하지 않는다.

## 검토한 대안

### OSR 16 유지와 지역 추출

문제 노드가 분석 지역 밖에 있을 때만 동작한다. 해당 노드가 분석 범위에 포함되면 같은 import 오류가 재현되므로 일반 해법에서 제외한다.

### OSR 16 유지와 BUS용 PBF 필터링

현재 실패 지점은 보행로 교차점이어서 BUS 형상 생성만 보면 우회할 수 있다. 그러나 A–B 비교에 필요한 접근·환승·귀가 보행망을 손실하므로 요구사항과 충돌한다.

### OSR 16 유지와 PBF 위상 정규화

17개 이상 way가 연결된 노드를 가상 노드 여러 개로 분할할 수 있다. 하지만 회전 제한, 접근 권한, 보행 연결성과 거리 비용을 TAP이 새로 정의해야 한다. 비교 결과의 보행시간을 바꾸는 데이터 변형이므로 채택하지 않는다.

### 별도 보행 라우터

MOTIS를 시간표 전용으로 실행하고 외부 엔진에서 출발지·정류장·환승·목적지 보행을 계산할 수 있다. 그러나 후보 정류장 탐색, 시간 의존 대중교통 결과와의 결합, 환승 보행, 경로 provenance를 새로 구현해야 한다. 이는 0.6.2의 목적보다 큰 멀티모달 라우팅 재설계이므로 후속 대안으로만 남긴다.

### OSR 32와 공식 계열 Windows 빌드

기존 MOTIS 여정 의미와 API를 유지하면서 입력 용량만 확장한다. 변경 범위가 가장 작고 A–B 보행 요구와 충돌하지 않으므로 채택한다.

## 빌드 아키텍처

### 소스와 패치 잠금

체크인된 builder lock은 다음 항목을 단일 기준으로 관리한다.

- MOTIS tag와 commit: `v2.11.3`, `b228a4519d196d9dd01b5ce80be46e642abc953e`
- OSR commit: `a7b2ec2728544304ef1d8397b3042abc8d10f7e7`
- 기능 패치 파일과 SHA-256
- runner 계열, MSVC toolset, Windows SDK, CMake, Ninja 버전
- 패키지 형식과 manifest schema version

빌더는 실행 시 관측된 도구 버전이 lock과 다르면 빌드를 중단한다. 도구 버전 갱신은 별도 변경으로 검토하고, 이전 승인 바이너리와 함께 자동으로 바꾸지 않는다.

초기 lock은 MSVC builder proof가 동일한 source와 patch로 두 번 성공한 뒤 그 실행에서 관측한 정확한 버전으로 생성한다. lock이 아직 없거나 두 실행의 도구 metadata가 다르면 proof 결과는 실험 artifact로만 보관하고 publish job은 실행할 수 없다. 이후 runner image가 갱신되어 관측값이 달라지면 자동 추종하지 않고 lock 갱신 변경과 전국 PBF 재검증을 요구한다.

### 빌드 경계

전용 GitHub Actions workflow가 다음 순서로 실행된다.

1. 깨끗한 Windows checkout을 만든다.
2. lock에 지정된 MOTIS와 OSR commit을 가져온다.
3. OSR `16 -> 32` 패치가 정방향으로 정확히 한 번 적용되는지 확인한다.
4. 활성 MinGW 호환 패치 없이 MSVC/Ninja 구성과 빌드를 수행한다.
5. `motis.exe`, 필수 런타임, UI, profile, 라이선스와 manifest를 stage한다.
6. 바이너리 실행 스모크와 manifest 검증을 수행한다.
7. 전국 PBF 및 A–B 보행 검증이 완료된 경우에만 publish job을 허용한다.
8. publish 입력이 명시된 수동 실행 또는 승인된 릴리스 흐름에서만 GitHub Release asset을 생성한다.

빌드와 게시를 같은 workflow에 둘 수 있지만 job 권한과 조건을 분리한다. 일반 push와 pull request는 빌드·검증까지만 수행하고 Release를 변경하지 않는다.

### 산출물 manifest

manifest에는 최소한 다음을 기록한다.

- MOTIS 및 OSR commit
- 기능 패치 SHA-256과 `kMaxWaysPerNode: 32`
- compiler, toolset, Windows SDK, CMake, Ninja 버전
- 빌드 시각과 workflow run URL
- `motis.exe` SHA-256 및 크기
- 포함 파일 목록과 각 라이선스 위치
- 검증한 PBF SHA-256
- 지원 범위와 제한: 32 초과 노드는 보장하지 않음

TAP bootstrap은 archive SHA-256을 먼저 확인하고, 안전한 임시 디렉터리에 압축을 푼 뒤 manifest와 실행 파일 SHA-256을 다시 확인한다. 검증이 끝난 배포본만 `vendor/motis/patched-windows` 또는 패키징 stage에 원자적으로 반영한다.

## A–B 보행 여정 계약

`ScenarioJourneyQuery`는 좌표 기반 endpoint를 기본으로 사용한다. 기존 정류장 기반 테스트와 명시적 정류장 질의를 위해 stop endpoint도 호환 형식으로 허용한다.

```ts
type ScenarioJourneyEndpoint =
  | {
      kind: 'coordinate';
      latitude: number;
      longitude: number;
      label?: string;
    }
  | {
      kind: 'stop';
      stopId: string;
    };

interface ScenarioJourneyQuery {
  origin: ScenarioJourneyEndpoint;
  destination: ScenarioJourneyEndpoint;
  departureDateTime: string;
}
```

신규 UI의 일반 A–B 입력은 `coordinate`를 저장한다. `stop` endpoint는 회귀 테스트, 기존 데이터 변환, 사용자가 정류장 자체를 명시적으로 선택한 경우에만 사용한다. 기존 `originStopId`와 `destinationStopId` 데이터는 읽을 때 stop endpoint로 변환하되, 좌표 기반으로 가장하지 않는다.

이 필드 변경은 `ScenarioDefinition`의 시나리오 schema version을 `1`에서 `2`로 올린다. v1 reader는 기존 `originStopId`와 `destinationStopId`를 각각 `kind: 'stop'` endpoint로 변환하고, 저장 시에만 v2로 승격한다. 읽기만으로 기존 프로젝트를 덮어쓰지 않으며, 알 수 없는 상위 schema version은 실행하지 않는다.

여정 실행 환경에는 기존 BUS geometry profile과 별도로 승객 보행 profile 및 허용 대중교통 mode를 기록한다. 이 값도 input fingerprint에 포함해 서로 다른 routing 조건의 결과가 같은 실행으로 재사용되지 않게 한다.

Before와 After 실행은 다음 값을 공유한다.

- origin과 destination
- 요청 출발시각 또는 동일한 출발시각 표본 창
- OSM PBF SHA-256
- MOTIS build manifest와 routing profile
- 최대 환승 수와 기타 검색 조건

각 결과는 최소한 다음 값을 보존한다.

- 총소요시간
- 접근 보행시간과 거리
- 초기 대기시간
- 차량 탑승시간
- 환승 대기시간
- 환승 보행시간과 거리
- 귀가 보행시간과 거리
- 환승 횟수
- 경로 발견 여부와 경고

어느 한쪽에 경로가 없으면 총소요시간 개선·악화 델타를 만들지 않는다. 보행 geometry 또는 MOTIS 응답을 직선으로 대체한 결과는 `partial`로 표시하고 완전한 실제 경로로 집계하지 않는다.

## 데이터 흐름

```text
동일한 A/B 좌표 + 출발시각 + 전국 PBF
                    │
                    ├─ Current/Before Synthetic GTFS ─┐
                    └─ Scenario/After Synthetic GTFS ─┤
                                                     ▼
                                Custom MOTIS v2.11.3 / OSR 32
                                                     │
                         WALK 접근 → TRANSIT/환승 → WALK 귀가
                                                     │
                                                     ▼
                       정규화된 Before/After 여정과 원인별 델타
```

BUS 노선 geometry 생성과 승객 A–B 여정 실행은 같은 OSM fingerprint와 MOTIS manifest를 참조하지만 결과 artifact는 분리한다. 노선 geometry 성공이 승객 여정 성공을 의미하지 않으며, 두 작업의 상태와 경고를 독립적으로 저장한다.

## 오류 처리

- PBF import에서 32 초과 노드가 발견되면 입력 파일과 노드 ID를 포함해 지원 한계를 명확히 표시한다.
- MOTIS manifest, archive 또는 binary SHA가 다르면 실행하지 않는다.
- MSVC toolchain 버전이 lock과 다르면 CI가 새 바이너리를 게시하지 않는다.
- 좌표 범위가 잘못되거나 A와 B가 같은 경우 저장 전에 차단한다.
- Before와 After의 PBF 또는 MOTIS fingerprint가 다르면 비교하지 않는다.
- 보행 구간이 누락되거나 fallback이면 해당 실행을 `partial`로 저장하고 사용자에게 영향을 받는 구간을 표시한다.
- Release asset이 없거나 검증에 실패하면 패키징을 실패시키며 공식 16-way 바이너리로 조용히 대체하지 않는다.

## 검증 계획

### 빌드 검증

- 깨끗한 checkout에서 MSVC/Ninja build를 두 번 수행한다.
- 기능 소스 diff가 OSR `kMaxWaysPerNode 16 -> 32` 한 건인지 자동 검사한다.
- MinGW 호환 패치가 활성 빌드 입력에 포함되지 않는지 검사한다.
- 패키지의 `motis.exe --help`, DLL 격리 실행, manifest 검증을 수행한다.
- 두 빌드의 도구·소스·패치 metadata가 같은지 확인한다. 바이너리 해시가 다르면 원인을 기록하고 승인 없이 release lock을 갱신하지 않는다.

### OSM과 여정 검증

- 공식 `v2.11.3` 바이너리로 동일 전국 PBF가 18-way 노드에서 실패하는 통제 결과를 유지한다.
- 새 OSR 32 빌드로 전국 PBF import, health readiness와 대표 BUS 경로를 검증한다.
- 문제 노드가 있는 인천대학교 권역에서 해당 노드를 통과하거나 주변을 이용하는 보행 경로를 검증한다.
- 출발지와 도착지를 각각 정류장에서 떨어진 좌표로 설정해 접근·귀가 보행시간이 0보다 큰 A–B 여정을 검증한다.
- 환승 정류장이 분리된 fixture로 환승 보행시간이 결과에 포함되는지 검증한다.
- 같은 A/B와 출발시각에 대해 Before/After를 실행하고 총소요시간 델타가 원인별 항목의 의미와 일치하는지 확인한다.
- 기존 37개 출발시각 배치, BUS geometry, timetable-only 회귀를 유지한다.

### 애플리케이션과 배포 검증

- 전체 unit/integration test, typecheck와 renderer build를 수행한다.
- fresh clone에서 Release asset 다운로드, SHA 검증과 Windows 패키징을 수행한다.
- `win-unpacked`와 NSIS 설치본에서 내장 MOTIS 실행 및 A–B 스모크를 수행한다.
- 대규모 분석 메모리 경계와 renderer 응답성 검증을 다시 수행한다.
- 검증 결과에는 PBF, archive, binary, scenario input fingerprint를 기록한다.

## 브랜치와 통합 순서

1. 현재 실패한 MinGW workflow를 추가 수정하지 않고 실험 상태로 동결한다.
2. 이 설계를 기준으로 MSVC builder proof와 lock/manifest 검증을 구현한다.
3. 병렬 개발 중인 시나리오 계약에 좌표 endpoint와 보행 결과 요구를 전달한다.
4. builder와 시나리오 브랜치를 최신 main 기준 통합 브랜치에서 함께 검증한다.
5. 승인된 Custom MOTIS asset을 생성하고 release lock을 갱신한다.
6. fresh-clone 패키징과 설치본 A–B 검증 후에만 `v0.6.2` Release를 게시한다.
7. 최종 patch note에는 0.6.1 대비 앱 변경, MOTIS 기준 commit, 32-way 한정 변경, 보행 검증과 알려진 제한을 기록한다.

## 문서와 운영 기록

구현 시 다음 문서를 현재 설계와 일치하도록 갱신한다.

- `docs/motis-custom-build.md`: MSVC builder, lock, manifest, 재현 절차
- `docs/release-process.md`: builder 검증, 수동 publish 승인, fresh-clone 확인 체크리스트
- `docs/patch-notes-0.6.2-draft.md`: 사용자 기능과 정확한 제한
- MOTIS 검증 보고서: 전국 PBF, 문제 노드 보행, A–B Before/After 결과와 모든 hash

기존 MinGW 패치와 실패 이력은 원인 분석 자료로 남길 수 있지만 활성 빌드 절차로 안내하지 않는다. 이후 개발자는 release checklist를 완료하지 않으면 MOTIS asset hash나 GitHub Release를 갱신할 수 없다.

## 완료 기준

- MSVC 기반 Custom MOTIS가 전국 PBF와 18-way 보행 노드 import를 완료한다.
- 좌표 기반 A–B Before/After에서 접근·환승·귀가 보행이 계산되고 결과에 분리되어 표시된다.
- fresh clone과 설치본이 동일한 검증 asset을 자동으로 준비한다.
- 바이너리·도구·입력·시나리오 fingerprint가 결과와 문서에서 추적 가능하다.
- 사용자의 최종 원격 게시 승인 전에는 Release가 생성되지 않는다.

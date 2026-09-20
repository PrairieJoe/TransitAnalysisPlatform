# Release process

이 문서는 TAP 코드 병합과 Windows 배포용 Custom MOTIS Release asset 발행을
분리해서 관리하기 위한 체크리스트입니다. 코드가 `main`에 병합된 것만으로는
새 개발 환경의 MOTIS 자동 다운로드가 동작하지 않습니다. 해당 버전의 GitHub
Release에 검증된 ZIP이 실제로 올라가 있어야 합니다.

## 0.6.x 배포 전 확인

- [ ] `npm test`, `npm run typecheck`, `npm run build`가 통과한다.
- [ ] `npm run package:win`과 Custom MOTIS verifier가 통과한다.
- [ ] `scripts/motis/motis-release-config.mjs`의 MOTIS commit, OSR commit,
      `16 -> 32` patch ID, asset 이름, 승인된 바이너리 SHA-256과 크기를 확인한다.
- [ ] Custom MOTIS 바이너리나 `vendor/motis/patched-windows`를 Git에 추가하지
      않는다. 소스에는 재현용 script·patch·검증 설정만 둔다.

## Release 발행 순서

1. 구현 브랜치를 원격에 푸시하고 `main`에 병합한다.
2. GitHub Actions의 `Build Custom MOTIS release asset` workflow를 `main`에서
   수동 실행한다.
3. 입력값은 다음처럼 지정한다.

   - `publish_release`: `true`
   - `release_tag`: 해당 TAP 버전, 예: `v0.6.2`

4. `build` job의 다음 단계를 모두 확인한다.

   - 고정된 MOTIS `pkg v0.23` 다운로드·SHA-256 검증·dependency hydrate
   - `.pkg.lock` 기준 Windows 패치 대상 의존성 커밋 정렬 및 상태 기록
   - `Build pinned Custom MOTIS`
   - `Verify Custom MOTIS`
   - `Verify approved binary release lock`
   - `Create release asset`
   - `Upload workflow artifact`

5. `publish` job이 성공하고 GitHub Release에 다음 세 파일이 있는지 확인한다.

   - `motis-windows-x64-v2.11.3-osr32.zip`
   - `motis-windows-x64-v2.11.3-osr32.sha256`
   - `motis-manifest.json`

6. 깨끗한 clone 또는 MOTIS cache가 없는 개발 환경에서
   `npm run motis:prepare`를 실행해 Release asset 다운로드·SHA-256 검증·manifest
   검증이 실제로 동작하는지 확인한다.

## 절차를 생략하면 안 되는 이유

`package:win`은 먼저 `vendor/motis/patched-windows`를 재사용하고, 없으면
고정된 Release URL에서 ZIP을 받습니다. 따라서 Release asset을 만들기 전에
새 PC에서 패키징하면 해당 URL이 404가 됩니다. 이 과정은 앱 실행 때마다 MOTIS
소스를 빌드하는 방식이 아니라, Maintainer가 버전별로 한 번 빌드·검증하고
개발 환경이 그 결과물을 받는 방식입니다.

깨끗한 Windows runner에서는 oneTBB가 첫 CMake configure 단계에서 컴파일러
probe를 실행하므로 `windows-mingw-tbb.patch`를 첫 configure 전에 적용해야
합니다. 또한 `pkg`가 dependency tree를 hydrate한 직후 `.pkg.lock`의 고정
커밋으로 모든 Windows 패치 대상 의존성을 다시 확인하고, GitHub Actions에서는
해당 커밋으로 작업 트리를 정렬합니다. 이 순서는
`tests/main/motis-release-bootstrap.test.ts`의 회귀 테스트로 고정되어 있습니다.
하위 저장소 패치는 MOTIS 상위 저장소가 아니라 각 dependency의 Git 루트에서
적용합니다.

## 실패 시 처리

- build가 실패하면 Release가 발행되지 않은 상태로 간주한다.
- 먼저 실패한 job의 마지막 오류와 source/toolchain 차이를 기록한다.
- 승인된 바이너리 SHA-256 잠금을 임의로 제거하거나 완화하지 않는다.
- 수정 후 `main`에 반영하고 workflow를 다시 실행한다.
- Release 페이지와 fresh clone의 `npm run motis:prepare`까지 성공한 뒤에만
  배포 절차 완료로 기록한다.

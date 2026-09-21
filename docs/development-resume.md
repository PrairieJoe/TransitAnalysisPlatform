# 다른 환경에서 0.7.1 개발 재개하기

이 문서는 0.7.1로 통합한 `main` 작업을 다른 Windows 개발 환경에서 이어가기 위한 절차입니다.

## 기준 브랜치

```powershell
git clone https://github.com/PrairieJoe/TransitAnalysisPlatform.git
Set-Location TransitAnalysisPlatform
git fetch origin --prune
git switch main
git pull --ff-only origin main
```

개발 기준은 `main`입니다. Custom MOTIS 소스 체크포인트는 `v0.6.2`, 현재 TAP 릴리스는 `v0.7.1`입니다. 기존 `v0.7.0`은 유지되며, Custom MOTIS는 `motis-v2.11.3-osr32.1` component Release로 독립 관리합니다. 범위와 검증 결과는 [0.6.2](releases/0.6.2.md), [0.7.0](releases/0.7.0.md), [0.7.1](releases/0.7.1.md) 기록을 확인합니다.

## 일반 개발 환경 준비

Node.js 20 이상과 Git이 필요합니다.

```powershell
npm ci
npm test
npm run typecheck
npm run build
```

현재 MOTIS·PBF 파일은 저장소에 커밋하지 않습니다. 따라서 위 unit/type/build 검증은 MOTIS 실행파일 없이도 수행할 수 있지만, 실제 MOTIS·전국 PBF·Windows 패키징 검증은 다음 단계를 추가해야 합니다.

## 검증된 MOTIS 준비

MOTIS 실행파일은 소스 저장소가 아니라 승인된 GitHub Release asset에서 받습니다. 고정 URL·MOTIS/OSR commit·`16 → 32` 패치 식별자·실행파일 SHA-256은 [`scripts/motis/motis-release-config.mjs`](../scripts/motis/motis-release-config.mjs)에 있습니다.

```powershell
npm run motis:prepare
```

이 명령은 `vendor/motis/patched-windows`를 먼저 검사하고, 유효한 로컬 배포본이 없으면 Release asset을 다운로드한 뒤 archive, manifest, 실행파일, UI, profile, 라이선스를 검증합니다. 네트워크 없는 환경에서 이미 검증된 배포본을 사용할 때만 다음을 사용합니다.

```powershell
npm run motis:prepare -- --offline
```

Release asset이 아직 게시되지 않았거나 SHA/manifest가 lock과 맞지 않으면 명령이 실패하는 것이 정상입니다. 공식 16-way MOTIS로 조용히 대체하지 않습니다.

## 전국 PBF 준비

전국 PBF도 저장소에 넣지 않습니다. Geofabrik의 South Korea 파일을 별도로 내려받아 `data/osm/south-korea-latest.osm.pbf`로 두고, 다운로드 페이지의 checksum과 실행 로그의 SHA-256을 기록합니다.

```powershell
New-Item -ItemType Directory -Force data/osm
Invoke-WebRequest https://download.geofabrik.de/asia/south-korea-latest.osm.pbf -OutFile data/osm/south-korea-latest.osm.pbf
Get-FileHash data/osm/south-korea-latest.osm.pbf -Algorithm SHA256
```

실제 A–B 검증은 `npm run test:motis-scenario -- --full-osm`으로 수행하며, 좌표 endpoint·PBF·MOTIS binary hash를 결과 artifact에 남깁니다.

## Windows 패키징

MOTIS Release asset이 준비된 환경에서만 실행합니다.

```powershell
npm run package:win
```

패키징은 검증된 Custom MOTIS를 `release/win-unpacked/resources/motis`에 포함하고, manifest·설치 산출물 smoke 검사를 수행합니다. `release/`, `out/`, `data/osm/`, `test-artifacts/`는 로컬 검증 산출물이므로 Git에 추가하지 않습니다.

## 다음 개발자가 확인할 문서

1. [`docs/release-process.md`](release-process.md) — 0.7.1 TAP/component 분리와 fresh clone 검증
2. [`docs/motis-custom-build.md`](motis-custom-build.md) — Release bootstrap과 라이선스/manifest 검증
3. [0.7.1 릴리스 기록](releases/0.7.1.md) — TAP/component 분리와 fresh clone 검증 결과
4. [`docs/test-reports/2026-09-21-geofabrik-south-korea-pbf-validation.md`](test-reports/2026-09-21-geofabrik-south-korea-pbf-validation.md) — 공식 16-way 실패와 기존 32-way 검증 증거
5. [`docs/test-reports/2026-09-20-scenario-ab-walking-validation.md`](test-reports/2026-09-20-scenario-ab-walking-validation.md) — 통합 좌표 A–B full-OSM Before/After 결과
6. `docs/superpowers/sdd/2026-09-20-scenario-ab-walking/progress.md` — 좌표 A–B 작업 ledger

마지막으로 작업을 넘길 때는 다음을 기록합니다.

```powershell
git status --short
git log --oneline --decorate -12
git branch -vv
```

main 소스 push와 MOTIS Release asset publish는 별도 단계입니다. 소스 push만으로 MOTIS 바이너리나 전국 PBF가 공유되는 것은 아닙니다.

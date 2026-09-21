# Release process

이 문서는 TAP 코드 병합과 Windows 배포용 Custom MOTIS Release asset 발행을
분리해서 관리하기 위한 체크리스트입니다. Custom MOTIS 실행 파일은 저장소에
커밋하지 않으며, build-only 후보·전국 검증·lock 승격·publish를 순서대로
수행해야 합니다.

## Candidate build and validation

1. Windows runner에서 `.github/workflows/motis-build.yml`을 수동 실행합니다.
   이 workflow는 MSVC `cl.exe` + Ninja로 후보만 만들고 Release를 수정하지
   않습니다. MinGW와 공식 16-way binary fallback은 사용하지 않습니다.
2. 두 build run의 `builder-observation.json`, MOTIS/OSR source commit, OSR
   patch hash가 동일한지 확인합니다.
3. 동일 후보 archive와 대한민국 PBF로 공식 control, Custom import/health/BUS,
   문제 노드 FOOT와 좌표 A-B transit의 양수 access/egress walking seconds,
   32-way 초과 노드의 `unsupported` 진단을 기록합니다.

4. 검증 명령을 실행합니다.

   ```powershell
   npm run motis:validate-release-candidate -- `
     --archive .\candidate.zip `
     --pbf .\data\osm\south-korea-latest.osm.pbf `
     --build-run-id <build-run-id> `
     --scenario-report .\validation\scenario-report.json `
     --output .\validation\motis-validation-attestation.json
   ```

   archive, binary, PBF, scenario report hash가 attestation에 묶이며 exact
   archive/PBF가 없으면 실패합니다. 성공하지 않은 결과를 attestation으로
   만들지 않습니다.

5. 두 observation과 attestation에 대해 lock mechanism을 실행합니다.

   ```powershell
   node scripts/motis/lock-release-candidate.mjs `
     --first-proof proof-1/motis-build-proof.json `
     --second-proof proof-2/motis-build-proof.json `
     --attestation validation/motis-validation-attestation.json
   ```

   이 단계 전의 `scripts/motis/motis-builder-lock.json`은 `probe`여야 합니다.

## Release 발행 순서

1. candidate build·nationwide validation·lock promotion 증거를 확인합니다.
2. `.github/workflows/motis-publish.yml`을 `build_run_id`와 이미 생성·검증된
   Custom MOTIS component tag (예: `motis-v2.11.3-osr32.1`)로 수동 실행합니다.
   이 workflow는 앱의 `v0.7.0` 태그를 만들거나 게시하지 않습니다.
3. publish job이 cross-run artifact, `npm run motis:verify-builder-lock`,
   archive checksum, manifest v2, builder observation, binary hash, committed
   validation attestation, 압축 해제 후 manifest를 모두 확인하는지 봅니다.
4. 검증이 통과한 경우에만 ZIP, SHA 파일, `motis-manifest.json`, validation
   report/attestation이 GitHub Release에 업로드됩니다. publish workflow는
   재빌드하지 않습니다.
5. 깨끗한 clone 또는 MOTIS cache가 없는 환경에서 `npm run motis:prepare`를
   실행해 Release asset 다운로드·SHA-256·manifest 검증을 확인합니다.

## 0.7.0 최종 후보와 승격

최종 후보는 `.github/workflows/release-validation.yml`을 `app_candidate_sha`,
두 번째 build run, canonical component tag, 고정 PBF URL/SHA, 그리고 별도
feature validation fragment와 함께 실행합니다. 이 workflow는 정확한 commit을
checkout한 뒤 packaged smoke와 좌표 A–B 시나리오를 실행하고, installer·archive·
binary·PBF·scenario·feature 결과를 `release-readiness.json` 하나로 묶습니다.

그 산출물에 대해 `npm run release:verify -- --mode stable --target-sha <sha>`가
성공한 뒤에만 `.github/workflows/release.yml`을 실행합니다. 이 workflow는
`stable-release` 보호 환경에서 `main`을 후보 SHA로 fast-forward하고 `v0.7.0`을
만든 뒤 Release를 게시합니다. 원격 저장소에는 `v0.7.0` 생성자를 제한하는 tag
ruleset과 해당 보호 환경 승인이 별도로 구성되어 있어야 합니다.

## Local release readiness

- `npm run release:verify -- --mode rc` must report `releaseReady: false`
  while the external build, package, and feature gates are open.
- `npm run release:verify -- --mode stable` must fail until those gates bind to
  the exact candidate commit and locked Custom MOTIS asset.
- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run motis:prepare -- --offline` (검증된 local distribution이 있을 때)
- [ ] clean directory에서 bootstrap 및 packaged `motis.exe --help`
- [ ] coordinate A-B walking smoke와 nationwide evidence
- [ ] lock state가 `locked`이고 archive/binary/PBF/report hash가 일치

## 실패 시 처리

- build, nationwide validation, 또는 verifier가 실패하면 Release를 발행하지 않습니다.
- 실패한 job의 마지막 오류와 source/toolchain/hash를 기록합니다.
- 승인된 binary/archive SHA-256 잠금을 임의로 제거하거나 완화하지 않습니다.
- 수정 후 candidate build부터 다시 실행하고, 기존 attestation을 재사용하지 않습니다.
- Release 페이지와 clean clone의 `npm run motis:prepare`까지 성공한 뒤에만
  배포 절차 완료로 기록합니다.

# Release process

이 문서는 TAP 코드 병합과 Windows 배포용 Custom MOTIS component artifact를
분리해서 관리하기 위한 체크리스트입니다. Custom MOTIS 실행 파일은 저장소에
커밋하지 않으며, 검증된 후보를 배포 가능한 artifact로 확정하고 0.7.0 패키지에
포함한 뒤 packaged smoke를 실행합니다.

## Candidate build and validation

1. Windows runner에서 `.github/workflows/motis-build.yml`을 수동 실행합니다.
   이 workflow는 MSVC `cl.exe` + Ninja로 후보만 만들고 Release를 수정하지
   않습니다. MinGW와 공식 16-way binary fallback은 사용하지 않습니다.
2. 후보 distribution manifest와 archive를 확인하고 동일 후보를 실제 데이터로
   검증합니다. 독립 2회 빌드와 builder proof는 0.7.0 승격을 차단하지 않으며
   후속 릴리즈 인프라 개선 항목으로 기록합니다.
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

5. 검증된 후보를 배포 가능한 component artifact로 확정하고 archive, distribution,
   packaged app 내부 binary의 SHA-256과 manifest를
   `scripts/release/verify-custom-motis-artifact.mjs`로 묶습니다.

## Release 발행 순서

1. candidate build와 실제 데이터 검증을 확인합니다.
2. component artifact verifier로 archive·distribution·packaged binary가 같은
   후보인지 확인합니다.
3. `npm run package:win`으로 artifact가 포함된 Windows 패키지를 만들고
   `npm run test:packaged-smoke`를 실행합니다.
4. 아래 네 가지 필수 gate가 모두 통과하면 `0.7.0-rc.1`을 `0.7.0`으로
   승격합니다. 독립 2회 빌드, builder proof, immutable asset provenance,
   fresh-clone bootstrap은 후속 인프라 개선으로 남깁니다.

## 0.7.0 최종 후보와 승격

정식 승격 전 `npm run release:verify -- --mode stable`을 실행합니다. verifier는
32-way 실제 데이터, 33-way 경계, 앱 회귀/typecheck/build, artifact가 포함된
packaged smoke만 차단 조건으로 검사합니다.

## Local release readiness

- `npm run release:verify -- --mode rc` reports the RC state while the app version
  remains prerelease.
- `npm run release:verify -- --mode stable` succeeds when the four required gates
  and the current package version are valid.
- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run motis:prepare -- --offline` (검증된 local distribution이 있을 때)
- [ ] clean directory에서 bootstrap 및 packaged `motis.exe --help`
- [ ] coordinate A-B walking smoke와 nationwide evidence
- [ ] component artifact archive/distribution/packaged binary hash가 일치

## 실패 시 처리

- build, nationwide validation, 또는 verifier가 실패하면 Release를 발행하지 않습니다.
- 실패한 job의 마지막 오류와 source/toolchain/hash를 기록합니다.
- 검증된 artifact와 packaged binary가 달라지면 패키지를 다시 만들고 smoke를
  재실행합니다.
- 새로운 완료 조건을 임의로 추가하지 않습니다. 독립 proof와 fresh-clone 검증은
  후속 인프라 개선으로 별도 추적합니다.

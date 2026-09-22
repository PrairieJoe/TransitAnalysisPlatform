# Release process

이 문서는 TAP 코드 병합과 Windows 배포용 Custom MOTIS component artifact를
분리해서 관리하기 위한 체크리스트입니다. Custom MOTIS 실행 파일은 저장소에
커밋하지 않으며, 이미 검증된 동일 artifact를 `motis-v2.11.3-osr32.1`
component Release로 게시하고 TAP 0.7.1은 그 component tag를 참조합니다.

## Candidate build and validation

1. Windows runner에서 `.github/workflows/motis-build.yml`을 수동 실행합니다.
   이 workflow는 MSVC `cl.exe` + Ninja로 후보만 만들고 Release를 수정하지
   않습니다. MinGW와 공식 16-way binary fallback은 사용하지 않습니다.
2. 기존 검증 기록의 distribution manifest와 archive를 확인합니다. 0.7.1에서는
   artifact를 재빌드하지 않고 archive SHA-256이 기존 검증값과 같은지 확인합니다.
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

## 0.9.0 application candidate gate

0.9.0은 0.8.1의 UX 유지보수 범위를 넘어 station catalog 저장 경계와
지도 중심 독립 경로탐색을 추가한 기능 릴리스입니다. 다음 순서를 지킵니다.

1. `npm test`, `npm run typecheck`, `npm run build`를 실행합니다.
2. `npm run package:win`과 `npm run test:packaged-smoke`로 설치 산출물과 내장 MOTIS를 확인합니다.
3. PBF가 없는 사용자 데이터에서 자동 탐색 결과가 Geofabrik 안내로 이어지고,
   권장 위치에 파일을 둔 뒤 `다시 찾기`로 fingerprint가 재사용되는지 확인합니다.
4. 경로탐색 workspace 진입 시 지도가 먼저 보이고, 지도 클릭 또는 검색으로
   출발·도착을 선택한 뒤 경로가 지도와 결과 카드에 함께 표시되는지 확인합니다.
5. mixed scenario 저장·재개방, v10→v11 migration, 현행/개편안 구분을 native에서 확인합니다.
6. 위 native acceptance 보고서가 완료되기 전에는 원격 push나 최종 릴리스 승격을 하지 않습니다.

## 0.7.1 Release 발행 순서

1. 기존 TAP `v0.7.0` tag와 Release asset을 그대로 유지합니다.
2. 검증된 기존 archive를 같은 바이트로 `motis-v2.11.3-osr32.1` component
   Release에 게시하고 archive SHA-256을 대조합니다.
3. `scripts/motis/motis-release-config.mjs`가 component tag의 asset URL을
   가리키는지 확인합니다.
4. fresh clone에서 아래 명령만 순서대로 실행합니다.

   ```powershell
   npm ci
   npm run motis:prepare
   npm run build
   npm run package:win
   npm run test:packaged-smoke
   ```

5. 위 검증이 통과하면 TAP `v0.7.1`을 생성합니다. 이후 TAP 버전과 Custom
   MOTIS component 버전은 각각의 tag와 Release에서 독립적으로 관리합니다.

## 0.7.1 검증 범위

이번 릴리스는 새로운 릴리즈 gate나 빌드 증명 체계를 추가하지 않습니다. 기존
검증 artifact를 재사용하고, fresh clone의 bootstrap·build·package·smoke 경로만
위 순서로 확인합니다.

## 실패 시 처리

- build, nationwide validation, 또는 verifier가 실패하면 Release를 발행하지 않습니다.
- 실패한 job의 마지막 오류와 source/toolchain/hash를 기록합니다.
- 검증된 artifact와 packaged binary가 달라지면 패키지를 다시 만들고 smoke를
  재실행합니다.
- 새로운 완료 조건을 임의로 추가하지 않습니다. 독립 proof와 fresh-clone 검증은
  후속 인프라 개선으로 별도 추적합니다.

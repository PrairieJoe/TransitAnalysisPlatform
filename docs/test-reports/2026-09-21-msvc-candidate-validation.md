# 2026-09-21 MSVC Custom MOTIS candidate validation

대상 브랜치: `codex/0.6.2-main-integration`  
대상 PBF: [Geofabrik South Korea](https://download.geofabrik.de/asia/south-korea.html) 최신 다운로드  
검증 시각: 2026-09-21 KST

이 문서는 현재 환경에서 만든 MSVC/Ninja 후보의 검증 결과다. GitHub
Release에 발행된 asset이나 최종 lock 승격 결과가 아니다.

## 입력과 후보 식별

| 항목 | 값 |
|---|---|
| MOTIS | `v2.11.3`, `b228a4519d196d9dd01b5ce80be46e642abc953e` |
| OSR | `a7b2ec2728544304ef1d8397b3042abc8d10f7e7` |
| 기능 패치 | `osr-max-ways-per-node-32`, `16 -> 32` |
| Toolchain | MSVC `19.44.35229`, Windows SDK `10.0.26100.0`, CMake `4.4.3`, Ninja `1.13.2` |
| Compiler generator | Ninja / Windows x64 |
| PBF 크기 | `287,629,706` bytes |
| PBF SHA-256 | `68ed4bbb72e41b73421e28d8282d82e5fc6f4a2cb78a0913b6812d32aa910252` |
| 후보 binary SHA-256 | `d91627ab9f74959fb97dd2996c5df610059b565d29f95a1358056a4b7b458bff` |
| 후보 archive SHA-256 | `f4896e578f9acc272295077e9e41e922fb94cb64419455234cc8f32201159ff5` |
| 후보 상태 | manifest v2 / `unvalidated` |

## 실행 결과

- 공식 16-way control: `node 1642860 (osm=10729381152) has 18 ways, maximum is 16`으로 중단.
- Custom 후보의 동일 PBF 전체 import: 통과.
- 후보 server health 및 BUS route: 통과.
- 여수 좌표 A–B transit: 통과. 접근 보행 `300초`, 이탈 보행 `120초`, 총 `1,980초`; 06:00~09:00 5분 간격 37개 샘플에서 Before/After 모두 `37/37`.
- 문제 노드 `10729381152` 주변 FOOT 양방향: 통과. 양방향 각각 `225초`, 약 `271m`.
- 별도 33-way 최소 PBF: `node 0 (osm=10729381152) has 33 ways, maximum is 32`로 중단. 즉 32-way를 초과하면 unsupported로 거부됨을 실제 로그로 확인.
- 위 결과는 `test-artifacts/motis-validation-attestation.json`에 archive/binary/PBF/scenario-report SHA-256과 함께 기록됐고, `npm run motis:validate-release-candidate`를 통과했다.

## 코드/환경 이슈와 처리

1. Windows MSVC 출력이 한국어인 환경에서 toolchain observer가 compiler version을 읽지 못해 `버전` 형식을 허용했다.
2. Windows checkout의 CRLF 때문에 고정 OSR patch hash와 적용 결과가 달라졌다. patch hash는 LF 정규화 기준으로 검사하고 `.gitattributes`에서 `*.patch`를 LF로 고정했다.
3. upstream `buildcache`가 Windows protobuf `version.rc` 리소스 컴파일에서 실패했다. MSVC builder는 `NO_BUILDCACHE=ON`으로 일반 CMake/Ninja 경로를 사용한다.
4. CMake가 `tiles-profiles`/`ui` symbolic link 생성에서 권한 오류를 냈다. 후보 staging은 관리자 권한으로 수행했고, 최종 archive에는 실제 디렉터리 payload가 포함됐다.
5. 검증기 공식 control 정규식이 MOTIS의 실제 `node <local> (osm=<id>)` 출력 형식을 인식하지 못해 양쪽 형식을 허용하도록 수정했다.
6. PowerShell 보조 리포트의 UTF-8 BOM 때문에 JSON parser가 실패했으며, BOM 없는 UTF-8로 생성하도록 수정했다.

## 아직 승인하지 않은 항목

- 이 환경의 두 번째 clean MSVC proof는 CMake 4.4.3가 최소 C++ 프로젝트에서도 `Detecting CXX compiler ABI info` 단계의 `lib.exe`/Ninja probe에서 정지하여 완료하지 못했다. `cl.exe` 단독 컴파일은 정상이다. 이는 후보 기능 실패가 아니라 현재 환경의 CMake/MSVC 초기 probe 문제다.
- 따라서 `scripts/motis/motis-builder-lock.json`은 의도대로 `probe` 상태이며, offline bootstrap은 `Builder toolchain is not locked`로 거부된다.
- GitHub Release 발행, lock 승격, main 병합은 수행하지 않았다. 최종 승인을 위해서는 독립적인 두 번째 proof observation과 fresh-clone/package smoke가 남아 있다.

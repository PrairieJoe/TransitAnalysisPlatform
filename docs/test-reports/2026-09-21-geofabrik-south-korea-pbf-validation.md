# Geofabrik 대한민국 PBF 재검증 — 2026-09-21

## 입력

- 출처: https://download.geofabrik.de/asia/south-korea.html
- 파일: `data/osm/south-korea-latest.osm.pbf`
- Geofabrik 최신 페이지 기준 데이터 시점: `2026-09-19T20:22:34Z`
- 크기: `287,579,345` bytes
- 공식 MD5: `18debe476441fa08f1373592c78638c5`
- 실제 SHA-256: `f4f83623cf1d6e127d04d7b999d5a5c1d07bbee9e9e3e7457ac9b1e5b08e749c`

PBF와 checksum 파일은 Git에 커밋하지 않는 ignored 입력이다.

## 공식 16-way control

실행 시점: `2026-09-20T23-02-02-065Z` output directory

공식 MOTIS Windows `v2.11.3`로 동일 PBF를 import한 결과:

```text
node 1642854 (osm=10729381152) has 18 ways, maximum is 16
```

즉, 이번에도 공식 16-way 제한으로 전국 PBF OSR import가 중단됐다.
원문은 다음 파일에 남아 있다.

`test-artifacts/motis-scenario/2026-09-20T23-02-02-065Z/base/data/logs/osr.txt`

## 기존 32-way 커스텀 바이너리 재검증

실행 시점: `2026-09-20T22-59-54-518Z` output directory

- 바이너리: 기존 `vendor/motis/patched-windows/motis.exe`
- 빌드 계열: MinGW historical custom build
- binary SHA-256: `8c1caf30e8457722070897105ee65deb2bb77ad959a65375b350cc3bd739694d`
- Base/After 전국 PBF import: 통과
- 두 MOTIS server health readiness: 통과
- Base/After 대표 경로: 발견
- 접근 보행: `300초`, `338m`
- 귀가 보행: `0초` — 목적지를 정류장에 직접 지정한 stop-to-stop 질의이므로 정상
- 시간창 배치: Base `37/37`, After `37/37`
- 총 소요시간: 양쪽 모두 `1,380초`

실행 결과는 다음 보고서에 저장되어 있다.

`test-artifacts/motis-scenario/2026-09-20T22-59-54-518Z/report.json`

## 판정

이번 재검증으로 다음 두 사실을 같은 Geofabrik PBF 기준으로 확인했다.

1. 공식 MOTIS `v2.11.3`은 해당 전국 PBF에서 16-way 제한으로 실패한다.
2. 16 → 32 OSR 패치를 적용한 기존 커스텀 빌드는 동일 PBF를 import하고
   보행 포함 대중교통 경로를 계산한다.

다만 사용한 커스텀 바이너리는 아직 MSVC/Ninja 후보가 아니다. 따라서 이
결과는 전국 PBF·패치 동작의 재현 증거이며, 0.6.2 Release용 MSVC 후보의
최종 승인 attestation으로 사용하지 않는다.

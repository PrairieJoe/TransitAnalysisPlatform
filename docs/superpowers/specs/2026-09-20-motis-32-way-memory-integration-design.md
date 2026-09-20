# MOTIS 32-Way Custom Build and Memory Boundary Integration Design

## 목적

Transit Analysis Platform 0.6.2에서 대한민국 전국 OSM PBF를 이용한 MOTIS 도로 경로 계산을 지원하고, 이미 통합된 대용량 처리 메모리 경계를 공식 변경사항으로 고정한다.

## 확정 범위

- 기준 MOTIS 버전은 공식 `v2.11.3`이다.
- 기준 OSR 커밋은 MOTIS `v2.11.3`의 의존성 고정값 `a7b2ec2728544304ef1d8397b3042abc8d10f7e7`이다.
- OSR의 `kMaxWaysPerNode`만 `16`에서 `32`로 변경한다.
- `32`는 최대값이며, 제한을 무제한으로 제거하지 않는다.
- MOTIS 자체 API, GTFS 처리, 경로 계산 알고리즘, PBF 파서의 다른 동작은 변경하지 않는다.
- Electron 배포물은 커스텀 Windows MOTIS 실행 파일을 `resources/motis/motis.exe`로 포함한다.
- 분석·가져오기·하차 추론은 main-process job 경계를 사용하고, renderer에는 요약·페이지 단위 데이터만 전달한다.

## 구현 설계

### MOTIS 패치와 재현성

패치 파일과 빌드 절차를 저장소에 보관한다. 빌드 절차는 소스가 정확한 MOTIS 태그와 OSR 커밋에서 시작하는지 확인한 뒤 OSR 제한 변경만 적용한다. 산출물에는 기준 버전, OSR 커밋, 패치 식별자, Windows 실행 파일 SHA-256을 기록한다.

바이너리 자체는 저장소의 기존 `vendor/` 제외 정책을 따른다. 대신 패치와 빌드 매니페스트를 추적해 다른 개발 환경에서 동일한 실행 파일을 재생성할 수 있게 한다. 현재 패키징 스크립트의 우선순위인 `patched-windows`를 유지하고, 패치 바이너리가 없으면 패키징이 공식 바이너리로 조용히 대체되지 않도록 검증한다.

### Electron 배포

개발 환경에서는 `vendor/motis/patched-windows/motis.exe`를 우선 선택한다. 설치본에서는 `resources/motis/motis.exe`를 사용한다. 패키징 단계에서 커스텀 빌드 매니페스트와 라이선스 고지 파일을 함께 포함하고, 필요한 MOTIS 구성 파일(`tiles-profiles`)이 없는 배포물을 거부한다.

### 메모리 경계

현재 0.6.2 통합 후보에 있는 다음 변경을 유지·검증한다.

- 대용량 분석, 가져오기, 하차 추론을 main-process job으로 실행
- DuckDB 기반 분석으로 원본 거래 전체를 renderer IPC에 전달하지 않음
- 프로젝트 목록 IPC를 `ProjectSummary`로 제한
- 노선 혼잡도 표를 250행 페이지로 렌더링
- 작업 취소·revision 검증으로 오래된 결과가 메모리에 남거나 저장되지 않게 함

이번 범위에서는 새로운 메모리 캐시나 무제한 버퍼를 추가하지 않는다. 기존 benchmark와 실제 1일·7일 데이터 검증을 0.6.2 기준값으로 문서화한다.

## 오류 처리와 운영 제한

- 공식 `v2.11.3` 바이너리는 전국 PBF 도로망 import에 사용하지 않는다. 공식 바이너리 사용 시 `maximum is 16` 오류가 발생하면 커스텀 빌드가 필요하다는 메시지를 남긴다.
- 패치 바이너리는 전국 PBF import, MOTIS health readiness, 대표 경로 질의를 모두 통과해야 배포 후보로 인정한다.
- 패치 Windows 빌드에서 확인된 tiles 병렬 처리 불안정성은 기존과 같이 tiles 비활성화 및 `TBB_NUM_THREADS=1`로 제한한다.
- OSM PBF는 앱 설치물에 포함하지 않는다. 사용자가 별도로 받은 PBF의 출처·데이터 라이선스는 MOTIS 실행 파일 라이선스와 별도로 관리한다.

## 라이선스와 고지

MOTIS와 OSR의 MIT 라이선스 문구 및 저작권 고지를 배포물에 포함한다. 수정 사실과 기준 버전을 고지하고, 커스텀 빌드가 공식 MOTIS 배포물이나 공식 지원을 의미하지 않음을 명시한다. MOTIS 의존성의 추가 라이선스 고지도 패키지의 third-party notices에 포함한다.

## 검증 기준

1. 기준 소스와 패치 적용을 자동 확인하는 빌드 검증
2. `kMaxWaysPerNode`의 패치 결과가 최대 32인지 확인
3. 공식 바이너리의 최신 대한민국 PBF 실패 원인 재현
4. 패치 바이너리의 최신 대한민국 PBF import 성공
5. 패치 바이너리의 health/server/대표 plan 성공
6. `npm test`, `npm run typecheck`, `npm run build`, `npm run package:win` 통과
7. 기존 메모리 기준 benchmark와 실제 데이터 회귀 검증

## 비범위

- 32를 초과하는 연결 도로 수를 지원하기 위한 추가 자료구조 변경
- upstream MOTIS에 패치를 제출하거나 공식 릴리스에 포함시키는 작업
- 전국 PBF 파일을 Electron 설치 파일에 번들링하는 작업
- 기존 분석 기능의 새로운 알고리즘 추가

# 변경 이력

## 0.1.0 - 2026-09-14

첫 동결 릴리스입니다.

### 포함 기능

- CSV/DAT/TXT/XLSX 다중 파일 불러오기, 클릭/드래그앤드롭
- 상위 10개 행 데이터 미리보기
- 첫 행 필드명 유무 선택 및 무헤더 파일의 `필드1`, `필드2` 자동 생성
- 날짜·이용인원·노선·정류장·지역 필드 매핑
- 이용인원 합계/통행량(행 수) 집계
- 요일별 그래프·비율 표, 실제 관측일/전체 날짜 기준, 필터
- PNG/PDF/XLSX 내보내기, 로컬 DuckDB 프로젝트 저장, `.taproj` 백업/복원
- 개인정보 식별 필드 방어, 중복 행 경고, UTF-8/EUC-KR 자동 판별

### 검증

- `npm test`: 4개 테스트 파일, 13개 테스트 통과
- `npm run typecheck`: 통과
- `npm run build`: 통과
- `npm run package:win`: 통과
- 운영 의존성 `npm audit --omit=dev`: 0 vulnerabilities
- 샘플 `fixtures/reference.csv`로 브라우저 화면 및 결과 확인

### 산출물

- `release/TransitAnalysisPlatform-0.1.0-setup.exe`

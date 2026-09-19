# 반응형 실행 경계 설계

## 상태

- 승인: 2026-09-19
- 대상: Transit Analysis Platform 1단계 반응성 우선 분석 런타임
- 범위: 대용량 import·추정·분석·저장 작업의 실행 경계와 프로젝트 데이터 전송 경계

## 목적

7일·762,499행 검증에서 import+persist 36.98초, inference+persist 67.08초, renderer 최대 타이머 지연 33.8초가 관측됐다. 현재 `src/renderer/App.tsx`의 `importData`는 파일 파싱, 정규화, 중복 확인, 품질 분류, 초기 분석, 저장을 한 renderer 흐름에서 수행하고, `runAlightingEstimation`도 추정과 저장을 renderer에서 직접 수행한다.

이 설계의 목적은 사용자가 긴 작업 중에도 화면을 조작할 수 있게 하고, 작업을 취소할 수 있게 하며, 취소·실패한 작업이 이미 저장된 프로젝트를 손상시키지 않도록 하는 것이다. 기능 결과의 의미와 기존 분석 알고리즘은 유지한다.

## 성공 기준

1. 대용량 작업 중 renderer의 이벤트 루프가 장시간 독점되지 않는다.
2. 모든 장시간 작업은 `queued`, `running`, `cancelling`, `completed`, `cancelled`, `failed` 중 하나의 명확한 상태를 가진다.
3. renderer는 작업 진행률과 현재 단계를 표시하고 취소 요청을 보낼 수 있다.
4. 취소 요청 이후 새 결과가 현재 프로젝트에 반영되지 않는다.
5. 작업이 실패하거나 취소되어도 이전에 커밋된 프로젝트와 DuckDB가 읽힌다.
6. 프로젝트 목록 IPC는 전체 `records` 배열을 renderer로 반환하지 않는다.
7. 기존 요일·시간대·정류장·OD·노선 분석 결과, 저장·재실행·복원 동작이 유지된다.
8. 초기 성능 목표는 제안 목표로 기록한다. 7일 검증에서 renderer timer delay p95 100ms 이하, 취소 요청 접수 1초 이내를 목표로 측정하되, 달성 여부는 실제 측정값으로만 판단한다.

## 범위

### 포함

- 공통 job 계약과 main-process job manager
- job progress 이벤트와 취소 IPC
- 작업 revision 검증 및 오래된 결과 무시
- 프로젝트 목록 요약 응답과 명시적 프로젝트 열기 IPC
- 기존 DuckDB 분석 handler의 job 전환
- 하차 추정과 전체 프로젝트 저장의 job 전환
- transaction 파일의 main-side parsing·normalization·quality classification 경계
- 기존 브라우저 fallback의 IndexedDB 동작 보존
- 단위·통합·회귀·대용량 성능 검증

### 제외

- 분석 결과의 분모·coverage evidence 기능 자체
- 시나리오 실행 기록 및 MOTIS provenance
- 보고서 빌더
- 전체 renderer를 한 번에 재작성하는 컴포넌트 분해
- 작업 재개(resume)와 영속 job queue
- 부분 분석 결과를 사용자가 조회하는 기능
- 새 외부 런타임 또는 npm 의존성 추가

## 현재 구조와 문제

- `src/main/index.ts`에는 `analysis:run`, `analysis:hourly-run`, `analysis:station-run`, `analysis:od-run`, `analysis:route-run` IPC가 이미 있고 실제 DuckDB 분석은 main에서 실행된다. 그러나 진행률·취소·revision 계약은 없다.
- `src/preload/index.ts`는 Promise 기반 invoke 함수만 노출하며 main→renderer 이벤트 브리지가 없다.
- `src/renderer/App.tsx`의 `importData`가 `parseFileRows`, `normalizeRows`, `classifyDataQuality`, `analyzeRecords`, `save`를 직접 호출한다.
- `runAlightingEstimation`은 `inferAlighting(project.records, ...)`를 renderer에서 호출한 뒤 전체 프로젝트를 저장한다.
- `project:list`는 `projectStore.read()`를 사용하므로 프로젝트 목록 조회 때도 `records` 배열을 읽어 IPC로 반환한다.
- `src/main/project-store.ts`의 full save는 DuckDB와 `project.json`을 함께 갱신하고, metadata save는 `project-state.json`만 갱신한다. 이 원자성·직렬화 패턴은 유지한다.
- 기존 브라우저 fallback은 Electron IPC가 없을 때 `File`과 IndexedDB를 사용하므로 Electron 경계 변경과 분리한다.

## 접근 방식 비교

### A. main-process cooperative job manager — 채택

기존 DuckDB 분석 경계를 활용하고 main에 공통 job manager를 둔다. 장시간 반복은 chunk 단위로 수행하고 각 chunk 사이에서 `setImmediate` 또는 동등한 양보 지점을 사용해 취소와 progress 전송을 처리한다. 파일 파싱·정규화·추정도 같은 job 계약을 사용한다.

장점은 기존 분석 모듈과 저장 흐름을 재사용하고 762,499개 record를 worker와 복제하지 않는 점이다. 단점은 잘못된 동기 함수가 남아 있으면 main event loop가 막힐 수 있으므로 chunked helper를 별도로 만들어야 한다.

### B. `worker_threads` 기반 실행

각 import·추정·분석 작업을 worker thread에서 실행한다. main event loop는 가장 안정적으로 보호되지만, Electron/Vite worker bundling, DuckDB 연결 경계, 큰 record 전달, 취소와 임시 저장의 소유권이 새로 생긴다.

이번 단계에서는 도입하지 않는다. A의 측정 결과 main event loop가 여전히 목표를 충족하지 못할 때 후속 구조 변경으로 검토한다.

### C. renderer Web Worker 기반 실행

renderer에서 데이터를 worker로 보내 UI만 보호한다. 하지만 main 저장 경계는 별도로 해결해야 하고 대용량 `File`·record 복제가 발생한다. Electron native path와 browser fallback이 서로 다른 실행 모델이 되어 유지 비용이 커지므로 채택하지 않는다.

## 결정된 아키텍처

### Job 계약

공유 타입은 `src/shared/job-types.ts`에 두고, 분석 결과 타입과 분리한다.

```ts
export type JobOperation = 'analysis' | 'alighting-inference' | 'project-save' | 'import';
export type JobStatus = 'queued' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed';

export interface JobProgress {
  jobId: string;
  projectId?: string;
  operation: JobOperation;
  phase: string;
  completed: number;
  total?: number;
  status: JobStatus;
  message?: string;
}

export interface JobRequest {
  jobId: string;
  projectId?: string;
  operation: JobOperation;
  projectRevision?: string;
}

export interface JobCancellationResult {
  jobId: string;
  accepted: boolean;
}
```

각 작업은 main에만 저장되는 cancellation token을 갖는다. renderer가 job id를 추측하거나 임의의 상태를 완료로 바꿀 수 없다.

### Main job manager

`src/main/job-manager.ts`는 다음 책임만 갖는다.

- job 등록 및 중복 job id 거부
- `queued → running → cancelling → terminal` 상태 전이
- progress callback 호출
- chunk 사이 cancellation 확인
- 성공·실패·취소 결과 전달
- terminal job 정리

분석 도메인과 파일 저장 로직은 job manager에 넣지 않는다. handler가 job manager를 호출하고 각 domain operation이 `shouldCancel`과 `reportProgress`를 받는다.

```ts
interface JobExecutionContext {
  shouldCancel(): boolean;
  reportProgress(update: Omit<JobProgress, 'jobId' | 'status'>): void;
}

interface JobManager {
  start<T>(request: JobRequest, execute: (context: JobExecutionContext) => Promise<T>): Promise<T>;
  cancel(jobId: string): JobCancellationResult;
}
```

취소는 강제 thread kill이 아니다. 취소 가능한 경계에서 `JobCancelledError`를 발생시키고 commit 단계에 진입하지 않는 cooperative cancellation이다.

### IPC와 preload

기존 결과 반환 IPC의 호출 형태는 유지하되, 내부적으로 job manager를 사용한다. 이를 통해 기존 renderer 호출부를 단계별로 교체할 수 있다.

- `job:cancel`: renderer→main
- `job:progress`: main→renderer
- `analysis:*` 및 이후 `project:import-job`, `alighting:run-job`: 기존 invoke 결과와 동일한 typed result 반환
- preload에는 `onJobProgress(listener): () => void`와 `cancelJob(jobId)`를 노출한다.

listener는 cleanup 함수를 반환하고 `App`의 `useEffect` cleanup에서 해제한다. preload는 허용된 channel만 연결하며 임의 channel 이름을 renderer에 노출하지 않는다.

### Revision과 stale result 방지

작업 시작 시 요청에 `projectRevision`을 포함한다. 첫 구현에서는 프로젝트의 `updatedAt`을 revision으로 사용한다. main은 저장 commit 직전에 현재 metadata의 revision을 다시 읽는다.

- revision이 같으면 결과를 commit한다.
- revision이 달라졌으면 결과를 버리고 `failed`가 아닌 `cancelled`와 구분되는 stale-result 오류를 반환한다.
- renderer도 최신 `jobId`만 state에 반영한다.

새 import처럼 아직 project id가 없는 작업은 job id를 화면 세션의 revision으로 사용하고, 중복 확인이 끝난 뒤에만 새 project id로 commit한다.

### 프로젝트 목록과 bounded query

공유 타입에 `ProjectSummary`를 추가한다.

```ts
export type ProjectSummary = Omit<ProjectManifest, 'records'> & {
  recordCount: number;
};
```

`project:list`는 `ProjectSummary[]`를 반환한다. `project:open(id)`가 full `ProjectManifest`를 반환한다. 기존 `project.json`의 records 저장 포맷은 당장 바꾸지 않는다. main 내부에서 full manifest를 읽더라도 IPC 응답에 record 배열을 포함하지 않는 것이 이번 단계의 메모리·전송 개선점이다.

renderer의 project card는 `recordCount`를 표시하고, 열기·Synthetic GTFS 진입 시 먼저 `project:open`을 호출한다. Electron이 아닌 브라우저 fallback은 기존 full manifest IndexedDB 목록을 유지하되 renderer 타입만 summary/full로 분리한다.

### Import 경계

Electron에서는 preload의 제한된 파일 경로 브리지로 사용자가 선택한 파일의 path를 얻고, main이 허용된 path를 읽는다. 경로를 임의로 입력받는 API는 만들지 않는다.

core parser는 browser `File` 전용 API와 Node file read를 분리한다.

- `parseFileRows(file: File, options)`는 기존 browser API를 유지한다.
- `parseFileBytes(bytes, fileName, options)`를 추가해 browser와 main이 동일한 parsing logic을 사용한다.
- main은 `readFile`로 bytes를 읽은 뒤 `parseFileBytes`를 호출한다.
- normalization/classification은 chunked helper를 사용한다.

중복 확인은 다음 두 단계로 처리한다.

1. prepare job이 임시 staging 결과와 중복 건수·날짜·경고를 만든다.
2. renderer가 기존 confirm UI로 유지/제외를 선택한다.
3. commit job이 선택 결과를 반영하고 새 프로젝트를 저장한다.

staging 파일은 terminal 상태 후 정리하며, 앱 종료나 실패 시 다음 시작 시 오래된 staging을 정리한다. 이번 설계에서 staging은 사용자에게 별도 데이터로 노출하지 않는다.

### 저장 안전성

작업 중에는 현재 프로젝트의 `records.duckdb`, `project.json`, `project-state.json`을 직접 수정하지 않는다.

- full save는 기존 `projectStore.save`의 serial + atomic JSON 동작을 재사용한다.
- inference job은 새 record 세트를 임시 DB에 쓴 후 검증하고 기존 DB를 교체한다.
- 취소·실패 시 임시 결과만 삭제한다.
- `project:list`가 읽는 summary는 commit 완료 후에만 갱신된다.

## 오류와 취소 처리

- 사용자가 취소를 누르면 버튼은 즉시 `cancelling` 상태가 되고, 실제 취소 완료 전까지 진행률을 유지한다.
- 취소 지점에 도달하면 renderer에는 `cancelled` 결과가 전달되고 오류 알림으로 처리하지 않는다.
- 파일 읽기·파싱·DuckDB 오류는 `failed`로 전환하고 기존 저장본을 보존한다.
- main window가 닫히면 실행 중 job에 cancellation을 요청하고 job manager가 terminal 상태까지 정리한다.
- progress listener가 제거되어도 작업은 main에서 계속되며, 저장된 결과는 다음 open에서 확인할 수 있다.
- job id가 존재하지 않거나 이미 terminal이면 cancel은 `accepted: false`를 반환한다.

## 테스트 설계

TDD 순서로 각 behavior-bearing unit마다 failing test를 먼저 작성하고, 해당 테스트가 기능 부재로 실패하는 것을 확인한 후 최소 구현한다.

### Unit tests

- `tests/main/job-manager.test.ts`
  - queued/running/completed 상태 전이
  - cancellation 요청 후 다음 chunk에서 `JobCancelledError`
  - 이미 완료된 job 취소 거부
  - progress payload에 job id와 operation 유지
  - execute 오류가 failed로 전환
- parser tests
  - `parseFileBytes`가 기존 `parseFileRows`와 같은 결과 생성
  - chunked normalization이 source row와 excluded count를 유지
  - cancellation이 중간에 중단
- `tests/main/project-store.test.ts`
  - summary가 records를 반환하지 않고 recordCount를 반환
  - full open은 기존 manifest와 동일
  - 취소/실패 staging이 기존 project 파일을 바꾸지 않음
- `tests/preload/job-boundary.test.ts`
  - 허용된 channel만 invoke/on에 연결
  - cleanup이 listener를 제거
  - cancel이 정확한 job id를 전달

### Integration tests

- `tests/main/analysis-jobs.test.ts`
  - fixture project를 실제 DuckDB에 저장하고 job 기반 weekday/hourly/OD 분석 결과가 기존 direct 함수와 동일한지 확인
  - 분석 중 취소 후 결과와 기존 DB가 유지되는지 확인
- `tests/main/alighting-job.test.ts`
  - 실제 project record와 route master로 추정을 실행하고 저장 후 재개봉 결과 확인
  - no route/invalid input은 failed가 되고 기존 DB 유지
- `tests/main/project-list-ipc.test.ts`
  - list 결과에 `records`가 없고 open 결과에는 records가 있음

### System verification

```text
npm run typecheck
npm test
npm run build
npm run test:week-ui
```

7일 검증은 기존 합계·저장·복원 결과와 새 timer delay·취소 응답 시간을 함께 기록한다. 기존 전체 테스트가 sandbox에서 Electron process spawn 문제로 실패할 경우 그 사실과 통과한 개별 테스트를 구분해 보고한다.

## 단계별 구현 순서

1. 공유 job 타입과 main job manager를 테스트로 고정한다.
2. preload progress/cancel 브리지와 renderer 작업 상태를 추가한다.
3. project summary/open 경계를 추가해 목록 IPC의 full record 반환을 제거한다.
4. 기존 DuckDB 분석 IPC를 job manager에 연결하고 direct 결과와 대조한다.
5. inference job과 안전한 임시 저장/교체를 추가한다.
6. parser bytes API와 import prepare/commit staging을 추가한다.
7. full workflow에서 import·inference·analysis·save 취소를 검증한다.
8. 목표를 충족하지 못하면 worker_threads 도입 여부를 별도 설계로 재검토한다.

## 비목표 및 후속 판단

이번 단계에서 `App.tsx` 전체를 컴포넌트별로 재작성하지 않는다. 실행 경계에 필요한 state와 orchestration만 추출한다. 또한 partial results, resume, cloud execution, evidence layer는 다음 단계에서 이 job contract를 소비하는 기능으로 남긴다.

## 자체 검토

- 목표와 성공 기준은 현재 관측된 renderer 지연·대용량 import 구조와 연결되어 있다.
- job 상태, IPC, revision, 저장 원자성, browser fallback의 책임이 분리되어 있다.
- import는 prepare/commit 두 단계로 나누어 기존 중복 확인 UI와 대용량 전송 제한을 함께 만족한다.
- worker_threads는 현재 기본안에서 제외하고 측정 결과에 따라 후속 결정하도록 명시했다.
- 테스트는 상태 전이, 취소, stale result, 저장 보존, parser 일치, 실제 DuckDB chain을 포함한다.
- 미정 placeholder나 구현을 미루는 TODO는 없다.

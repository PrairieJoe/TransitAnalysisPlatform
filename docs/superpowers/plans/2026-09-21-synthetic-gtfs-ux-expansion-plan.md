# 0.8.0 Synthetic GTFS UX 확장 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보고서 유틸리티와 분리된 `계획·시나리오 → 노선 개편 시나리오` 흐름을 만들고, 현행 노선을 세로 목록에서 편집해 현행/개편안의 동일 조건 효과를 비교할 수 있는 사용자 중심 0.8.0 UX를 완성한다.

**Architecture:** `App.tsx`는 보고서의 분석/계획 domain navigation을 조정하고, 계획 영역은 `ScenarioWorkspaceEntry`로 진입한다. `SyntheticGtfsBuilder`는 현행 노선·개편안·GTFS/MOTIS 상태 coordinator로 남고, 새로운 `SyntheticRouteScenarioEditor`는 정류장 배열과 diff를 controlled 방식으로 편집한다. 기존 `ScenarioDefinition` 저장 계약, GTFS draft 생성기, provenance, ZIP export, MOTIS preload/main IPC는 유지한다.

**Tech Stack:** React 19, TypeScript, Electron, Vitest, 기존 CSS, 기존 `ScenarioDefinition`/Synthetic GTFS/MOTIS contracts.

**Spec:** `docs/superpowers/specs/2026-09-21-synthetic-gtfs-ux-expansion-design.md`

## Global Constraints

- 이번 확장은 아직 push/배포되지 않은 로컬 `0.8.0` 범위이며 `0.8.1`·`0.9.0`으로 버전을 올리지 않는다.
- `GTFS 구축`은 보고서 헤더의 추정·백업·엑셀·이미지·PDF 유틸리티 영역에 렌더링하지 않는다.
- 계획 영역의 사용자 명칭은 `노선 개편 시나리오`, 내부 산출물 명칭은 `현행 GTFS`·`개편안 GTFS`로 일관되게 사용한다.
- Naver/Kakao/Google 지도 API, 새 외부 dependency, 프로젝트 schema version 변경은 추가하지 않는다.
- `buildSyntheticGtfsDraft`, `createScenarioDelta`, provenance, `exportSyntheticGtfs`, MOTIS preload API와 main IPC 경계를 변경하지 않는다.
- 기존 `ScenarioDefinition`을 읽고 저장하는 호환성을 유지하며, 기존 다중 노선/여정 도구는 고급 경로로 보존한다.
- Native inline execution을 유지하고, 각 task는 RED → GREEN → full verification → atomic commit 순서로 수행한다.

## Review Focus

- 계획 기능이 분석/유틸리티와 섞이지 않고 `계획·시나리오`에서 발견되는가 — `ScenarioWorkspaceEntry.test.tsx`, `AppNavigation.test.tsx`에 진입/비활성 상태 고정.
- 현행 정류장 master에 없는 ID, 중복 정류장, 2개 미만 경로가 저장되지 않는가 — `synthetic-route-scenario.test.ts`에 validation cases 고정.
- 정류장 순서를 바꿨다가 원상복귀하면 변경 없음으로 돌아가는가 — pure diff reducer test에 고정.
- 라벨이 비어도 자동 라벨로 저장되고, 기존 다중 노선 definition이 primary editor에서 손실되지 않는가 — adapter/editor tests에 고정.
- 입력 변경 뒤 현행/개편안 GTFS·MOTIS·반복 결과가 stale 처리되는가 — `SyntheticGtfsBuilder.test.tsx`와 workflow tests에 고정.

---

### Task 1: 보고서에 분석/계획 domain navigation을 만든다

**Files:**
- Create: `src/renderer/ScenarioWorkspaceEntry.tsx`
- Create: `src/renderer/ReportDomainNavigation.tsx`
- Create: `tests/renderer/ScenarioWorkspaceEntry.test.tsx`
- Create: `tests/renderer/ReportDomainNavigation.test.tsx`
- Modify: `src/renderer/App.tsx` — report state, header action, report body
- Modify: `tests/renderer/AppNavigation.test.tsx`
- Modify: `src/renderer/styles.css`

**Interfaces:**
- `ReportDomainNavigationProps`:

  ```tsx
  export type ReportDomain = 'analysis' | 'planning';

  export interface ReportDomainNavigationProps {
    activeDomain: ReportDomain;
    onSelectDomain: (domain: ReportDomain) => void;
  }
  ```

- `ReportDomainNavigation` renders `분석` and `계획·시나리오` as the top-level domain tabs. It does not contain export or project-management actions.
- `ScenarioWorkspaceEntryProps`:

  ```ts
  export interface ScenarioWorkspaceEntryProps {
    routeCount: number;
    hasRouteStops: boolean;
    onOpen: () => void;
  }
  ```

- `ScenarioWorkspaceEntry` renders a plan card titled `노선 개편 시나리오`, a short explanation, route count, and one `노선 개편 시나리오 시작` button. When `hasRouteStops` is false, the button is disabled and the card explains that 노선별 정류장정보 is required.
- `App.tsx` adds `reportDomain: 'analysis' | 'planning'` state, renders a separate domain nav above the existing analysis-mode tabs, and renders `ScenarioWorkspaceEntry` when `planning` is selected. The old report-header `GTFS 구축` button is removed. Opening the synthetic view sets/retains the current project; returning sets `reportDomain` back to `analysis`.

- [ ] **Step 1: Write the failing tests**

  Add assertions that `ReportDomainNavigation` renders the two top-level domains and `ScenarioWorkspaceEntry` renders the plan copy and disabled reason without route stops. Keep the isolated project-card navigation test asserting that the project card still has no Synthetic button. The report header removal is covered by rendering the domain/utility composition through the new isolated navigation seam rather than importing the Leaflet-heavy `App.tsx`.

  ```tsx
  it('renders the plan entry separately from report utilities', () => {
    const markup = renderToStaticMarkup(<ScenarioWorkspaceEntry routeCount={2} hasRouteStops onOpen={() => {}} />);
    expect(markup).toContain('노선 개편 시나리오');
    expect(markup).toContain('노선 개편 시나리오 시작');
  });

  it('explains why planning is unavailable without route master data', () => {
    const markup = renderToStaticMarkup(<ScenarioWorkspaceEntry routeCount={0} hasRouteStops={false} onOpen={() => {}} />);
    expect(markup).toContain('노선별 정류장정보가 필요합니다');
    expect(markup).toContain('disabled');
  });
  ```

- [ ] **Step 2: Run the focused tests and confirm failure**

  Run: `npx vitest run tests/renderer/ScenarioWorkspaceEntry.test.tsx tests/renderer/ReportDomainNavigation.test.tsx tests/renderer/AppNavigation.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

  Expected: FAIL because `ScenarioWorkspaceEntry` and the report domain navigation do not exist yet.

- [ ] **Step 3: Implement the domain entry**

  Keep existing report analysis rendering intact under `reportDomain === 'analysis'`. Place the new planning nav in a distinct block, not in `header-actions`. The synthetic entry callback must call the existing `openProject(project, 'synthetic')` path so project state and route master loading remain unchanged.

- [ ] **Step 4: Run focused and regression tests**

  Run: `npx vitest run tests/renderer/ScenarioWorkspaceEntry.test.tsx tests/renderer/ReportDomainNavigation.test.tsx tests/renderer/AppNavigation.test.tsx tests/renderer/SyntheticGtfsBuilder.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

  Expected: PASS, including the existing project-card and synthetic builder navigation assertions.

- [ ] **Step 5: Commit**

  ```bash
  git add src/renderer/ScenarioWorkspaceEntry.tsx src/renderer/ReportDomainNavigation.tsx src/renderer/App.tsx src/renderer/styles.css tests/renderer/ScenarioWorkspaceEntry.test.tsx tests/renderer/ReportDomainNavigation.test.tsx tests/renderer/AppNavigation.test.tsx
  git commit -m "feat: separate Synthetic GTFS planning entry"
  ```

### Task 2: 현행/개편안 정류장 편집 pure model을 만든다

**Files:**
- Create: `src/renderer/synthetic-route-scenario.ts`
- Create: `tests/renderer/synthetic-route-scenario.test.ts`

**Interfaces:**
- Add a renderer-only model that does not call IPC:

  ```ts
  export type ScenarioStopChange = 'unchanged' | 'added' | 'removed' | 'moved';

  export interface ScenarioStopRow {
    stationId: string;
    stationName: string;
    latitude: number;
    longitude: number;
    sequence: number;
    change: ScenarioStopChange;
  }

  export interface ScenarioRouteEditState {
    routeId: string;
    routeName: string;
    transportMode: string;
    baseStopIds: string[];
    scenarioStopIds: string[];
    label: string;
  }

  export function buildScenarioStopRows(
    routeStops: RouteStopMasterRecord[],
    routeId: string,
    baseStopIds: string[],
    scenarioStopIds: string[]
  ): ScenarioStopRow[];

  export function applyScenarioStopEdit(
    state: ScenarioRouteEditState,
    action: { type: 'add' | 'remove' | 'move'; stationId: string; targetIndex?: number }
  ): ScenarioRouteEditState;

  export function validateScenarioRouteEdit(
    routeStops: RouteStopMasterRecord[],
    state: ScenarioRouteEditState
  ): string[];

  export function defaultScenarioLabel(routeName: string, scenarioStopIds: string[], baseStopIds: string[]): string;
  ```

- `buildScenarioStopRows` must preserve the displayed scenario order, mark removed base stops in a stable position after the active rows, mark newly inserted stops as `added`, and mark retained stops as `moved` only when their index differs from the base index.
- `applyScenarioStopEdit` must reject no-op duplicates by returning the unchanged state and must support moving an existing row to a bounded target index.
- `validateScenarioRouteEdit` must reject unknown station IDs, duplicates, empty labels only when a caller explicitly requires custom labels, and fewer than two scenario stops. Blank labels are valid for the primary editor because the caller can use `defaultScenarioLabel`.

- [ ] **Step 1: Write failing pure tests**

  Cover unchanged paths, added/removed/moved rows, add/remove/move actions, duplicate prevention, unknown IDs, fewer-than-two stops, and label fallback.

  ```ts
  it('marks a stop moved when its order changes', () => {
    const rows = buildScenarioStopRows(fixtureStops, 'R1', ['A', 'B', 'C'], ['B', 'A', 'C']);
    expect(rows.map((row) => row.change)).toEqual(['moved', 'moved', 'unchanged']);
  });

  it('returns an automatic label for a blank scenario label', () => {
    expect(defaultScenarioLabel('101번', ['A', 'X', 'C'], ['A', 'B', 'C'])).toBe('101번 정류장 개편안');
  });
  ```

- [ ] **Step 2: Run pure tests and confirm failure**

  Run: `npx vitest run tests/renderer/synthetic-route-scenario.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

  Expected: FAIL because the pure model module and exports do not exist.

- [ ] **Step 3: Implement the pure model**

  Use route master records as the only station source. Keep all edits immutable so React state updates can use reducer-style actions. Compute diff status from the base array and final scenario array rather than storing per-row status.

- [ ] **Step 4: Run pure and core regression tests**

  Run: `npx vitest run tests/renderer/synthetic-route-scenario.test.ts tests/core/scenario-editor.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/renderer/synthetic-route-scenario.ts tests/renderer/synthetic-route-scenario.test.ts
  git commit -m "feat: model current and scenario route edits"
  ```

### Task 3: 사용자용 정류장 편집기를 만든다

**Files:**
- Create: `src/renderer/SyntheticRouteScenarioEditor.tsx`
- Create: `tests/renderer/SyntheticRouteScenarioEditor.test.tsx`
- Modify: `src/renderer/styles.css`

**Interfaces:**
- `SyntheticRouteScenarioEditorProps`:

  ```tsx
  export interface SyntheticRouteScenarioEditorProps {
    routeOptions: Array<{ routeId: string; routeName: string; transportMode: string }>;
    routeStops: RouteStopMasterRecord[];
    selectedRouteId: string;
    scenarioStopIds: string[];
    scenarioLabel: string;
    onRouteChange: (routeId: string) => void;
    onScenarioStopIdsChange: (stopIds: string[]) => void;
    onScenarioLabelChange: (label: string) => void;
    onSave: () => Promise<void>;
  }
  ```

- Render a `현행 노선` select and a `현행 정류장` read-only vertical list. Render a separate `개편안 정류장` list using `buildScenarioStopRows`.
- Each scenario row must expose accessible `위로 이동`, `아래로 이동`, and `정류장 제거` buttons. The add control is a search/select over route master records for the selected route and must not accept IDs from another route.
- Use `시나리오 이름` as a secondary input with the automatic label as its value when blank. The primary action is `시나리오 저장`.
- Do not render `Before 정류장 경로` as an arrow-separated `output`; the base list is the visual Before representation. Do not render before/after full operation grids here.
- A closed `운행조건 변경` disclosure is reserved for Task 4 and must not appear as a required primary input in this task.

- [ ] **Step 1: Write failing component tests**

  Render a fixture with three current stops and assert the vertical list, `현행`, `개편안`, add/remove/reorder labels, diff status, and automatic label. Assert that the raw comma input and the old `Before 정류장 경로` output are absent.

  ```tsx
  it('shows current and scenario stops as editable lists', () => {
    const markup = renderToStaticMarkup(<SyntheticRouteScenarioEditor {...fixtureProps} />);
    expect(markup).toContain('현행 정류장');
    expect(markup).toContain('개편안 정류장');
    expect(markup).toContain('정류장 추가');
    expect(markup).toContain('위로 이동');
    expect(markup).toContain('아래로 이동');
    expect(markup).not.toContain('Before 정류장 경로');
    expect(markup).not.toContain('쉼표로 구분');
  });
  ```

- [ ] **Step 2: Run focused test and confirm failure**

  Run: `npx vitest run tests/renderer/SyntheticRouteScenarioEditor.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

  Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the editor**

  Keep it presentational/controlled. Search options must be limited to the selected route and must display station name plus ID. Use `aria-label` values for all row actions and status badges. Do not call `window.transitDesktop` from the component.

- [ ] **Step 4: Run focused and route-model tests**

  Run: `npx vitest run tests/renderer/SyntheticRouteScenarioEditor.test.tsx tests/renderer/synthetic-route-scenario.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/renderer/SyntheticRouteScenarioEditor.tsx src/renderer/styles.css tests/renderer/SyntheticRouteScenarioEditor.test.tsx
  git commit -m "feat: add user-facing route scenario editor"
  ```

### Task 4: 편집기를 기존 ScenarioDefinition 저장 계약에 연결한다

**Files:**
- Create: `src/renderer/synthetic-scenario-definition.ts`
- Create: `tests/renderer/synthetic-scenario-definition.test.ts`
- Modify: `src/renderer/SyntheticScenarioStep.tsx`
- Modify: `src/renderer/SyntheticRouteScenarioEditor.tsx`
- Reuse: `src/renderer/ScenarioDefinitionEditor.tsx` inside a lazy legacy/advanced disclosure; do not change its storage contract

**Interfaces:**
- Add a pure adapter:

  ```ts
  export interface PrimaryScenarioDefinitionInput {
    projectId: string;
    routeStops: RouteStopMasterRecord[];
    routeId: string;
    label: string;
    scenarioStopIds: string[];
    beforeOperation: ScenarioOperationPlan;
    afterOperation: ScenarioOperationPlan;
  }

  export function buildPrimaryScenarioDefinition(input: PrimaryScenarioDefinitionInput): ScenarioDefinition;
  export function preserveLegacyScenarioDefinitions(
    existing: ScenarioDefinition[],
    next: ScenarioDefinition
  ): ScenarioDefinition[];
  ```

- `buildPrimaryScenarioDefinition` must create one valid `routeChanges` entry, use the selected route’s base stop IDs, use the automatic label when input label is blank, set `journeyQueries` only when an explicit query exists, and populate provenance from project/route-master context.
- `preserveLegacyScenarioDefinitions` must replace only the same `scenarioId`; it must not discard other one-route or multi-route definitions.
- `SyntheticScenarioStep` becomes the primary editor shell: heading, current/scenario summary, `SyntheticRouteScenarioEditor`, and a closed `운행조건 변경` disclosure. The old `ScenarioDefinitionEditor` is no longer rendered as the first-screen editor. It remains reachable through a closed `고급: 여러 노선·좌표 여정 시나리오` disclosure; the legacy editor is mounted only after that disclosure is opened so its dense fields are not present in the initial DOM.

- [ ] **Step 1: Write failing adapter and shell tests**

  Assert that an empty label produces a valid automatic label, the selected route’s current path is persisted in `baseStopIds`, After order is persisted in `scenarioStopIds`, existing definitions remain in the result, and the primary shell no longer renders the old label/Before output form.

- [ ] **Step 2: Run focused tests and confirm failure**

  Run: `npx vitest run tests/renderer/synthetic-scenario-definition.test.ts tests/renderer/SyntheticScenarioTools.test.tsx tests/renderer/ScenarioDefinitionEditor.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

  Expected: FAIL because the adapter and primary shell are not implemented.

- [ ] **Step 3: Implement adapter and controlled shell**

  Reuse `createScenarioDefinition`, `upsertScenarioDefinition`, `selectRepresentativeRouteStopIds`, and existing operation defaults. Keep operation editing collapsed and inherit current values until the user expands it.

- [ ] **Step 4: Run focused and existing scenario tests**

  Run: `npx vitest run tests/renderer/synthetic-scenario-definition.test.ts tests/renderer/SyntheticScenarioTools.test.tsx tests/renderer/ScenarioDefinitionEditor.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/renderer/synthetic-scenario-definition.ts src/renderer/SyntheticScenarioStep.tsx src/renderer/SyntheticRouteScenarioEditor.tsx tests/renderer/synthetic-scenario-definition.test.ts tests/renderer/SyntheticScenarioTools.test.tsx tests/renderer/ScenarioDefinitionEditor.test.tsx
  git commit -m "feat: save route scenarios through the existing definition contract"
  ```

### Task 5: Synthetic coordinator를 새 편집 상태와 연결한다

**Files:**
- Modify: `src/renderer/SyntheticGtfsBuilder.tsx`
- Modify: `src/renderer/SyntheticGenerationStep.tsx`
- Modify: `src/renderer/SyntheticScenarioStep.tsx`
- Modify: `tests/renderer/SyntheticGtfsBuilder.test.tsx`
- Modify: `tests/renderer/synthetic-gtfs-workflow.test.ts`

**Interfaces:**
- Replace the primary scenario text input with coordinator-owned `scenarioStopIds` and `scenarioLabel`; keep a derived comma string only at the legacy adapter boundary.
- `SyntheticScenarioStep` receives the selected route and scenario arrays from the builder and reports changes through callbacks. On save it calls `onSaveScenarioDefinition` and reports the saved definition ID back to the coordinator.
- `SyntheticGenerationStep` receives `scenarioStopIds` and displays a compact `현행 정류장 n개 / 개편안 정류장 n개` summary. It no longer exposes the raw After comma input on the primary path.
- Existing `GenerationInputSnapshot`, stale keys, `ScenarioDelta`, and generation callbacks must capture the array order and label so changing a stop or label invalidates downstream outputs.

- [ ] **Step 1: Write failing coordinator tests**

  Extend the builder static markup test to assert initial view contains `노선 개편 시나리오`/`현행 정류장` and not `시나리오 입력·저장`, `Before 정류장 경로`, or the raw After comma hint. Add workflow pure cases proving a stop-order mutation makes generation/MOTIS/batch stale.

- [ ] **Step 2: Run focused tests and confirm failure**

  Run: `npx vitest run tests/renderer/SyntheticGtfsBuilder.test.tsx tests/renderer/synthetic-gtfs-workflow.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

  Expected: FAIL because the builder still owns the old text-based scenario input and the new shell is not wired.

- [ ] **Step 3: Implement coordinator wiring**

  Initialize the scenario array from the selected route’s representative path. When the route changes, reset the scenario array to that route’s current path and clear only renderer-local downstream results. Keep generated result files and MOTIS logic unchanged. Use the selected scenario definition’s saved route/label only when it matches the active route.

- [ ] **Step 4: Run focused renderer and generation tests**

  Run: `npx vitest run tests/renderer/SyntheticGtfsBuilder.test.tsx tests/renderer/synthetic-gtfs-workflow.test.ts tests/renderer/SyntheticGenerationStep.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

  Expected: PASS, including existing generation snapshot and stale behavior.

- [ ] **Step 5: Commit**

  ```bash
  git add src/renderer/SyntheticGtfsBuilder.tsx src/renderer/SyntheticGenerationStep.tsx src/renderer/SyntheticScenarioStep.tsx tests/renderer/SyntheticGtfsBuilder.test.tsx tests/renderer/synthetic-gtfs-workflow.test.ts
  git commit -m "refactor: connect Synthetic GTFS to route scenario edits"
  ```

### Task 6: 현행/개편안 비교 언어와 결과 흐름을 정리한다

**Files:**
- Modify: `src/renderer/SyntheticGenerationStep.tsx`
- Modify: `src/renderer/SyntheticMotisStep.tsx`
- Modify: `src/renderer/SyntheticBatchStep.tsx`
- Modify: `src/renderer/SyntheticScenarioTools.tsx`
- Modify: `tests/renderer/SyntheticGtfsBuilder.test.tsx`
- Modify: `tests/renderer/SyntheticScenarioTools.test.tsx`

**Interfaces:**
- Generation step copy must use `현행 GTFS` and `개편안 GTFS` instead of treating Before/After as unexplained technical labels. The result summary must show the route change diff before technical file details.
- MOTIS step must label the two package imports as `현행 패키지` and `개편안 패키지`, retain the same OD/date-time inputs, and render the comparison as `현행 → 개편안`.
- Batch step must explain that the same OD is sampled across a time window for both versions. `SyntheticScenarioTools` remains collapsed and is described as advanced multi-route/legacy execution tooling.
- No preload or core algorithm changes are allowed in this task.

- [ ] **Step 1: Write failing copy/flow tests**

  Assert the generation result includes `현행 GTFS`, `개편안 GTFS`, `정류장 변경 요약`; MOTIS includes `현행 패키지` and `개편안 패키지`; batch explains same OD. Assert advanced tools do not appear on the first scenario step.

- [ ] **Step 2: Run focused tests and confirm failure**

  Run: `npx vitest run tests/renderer/SyntheticGtfsBuilder.test.tsx tests/renderer/SyntheticScenarioTools.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

  Expected: FAIL until the copy and result hierarchy are updated.

- [ ] **Step 3: Implement copy and result hierarchy**

  Keep the existing generated files, comparison calculations, warnings, export button, OSM validation, progress, and batch statistics. Move raw technical content behind the existing technical disclosure.

- [ ] **Step 4: Run focused tests**

  Run: `npx vitest run tests/renderer/SyntheticGtfsBuilder.test.tsx tests/renderer/SyntheticScenarioTools.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/renderer/SyntheticGenerationStep.tsx src/renderer/SyntheticMotisStep.tsx src/renderer/SyntheticBatchStep.tsx src/renderer/SyntheticScenarioTools.tsx tests/renderer/SyntheticGtfsBuilder.test.tsx tests/renderer/SyntheticScenarioTools.test.tsx
  git commit -m "copy: clarify current and scenario comparison"
  ```

### Task 7: 계획/시나리오 화면의 시각 계층과 반응형 레이아웃을 완성한다

**Files:**
- Modify: `src/renderer/styles.css`
- Modify: `tests/renderer/ScenarioWorkspaceEntry.test.tsx`
- Modify: `tests/renderer/SyntheticRouteScenarioEditor.test.tsx`
- Modify: `tests/renderer/SyntheticGtfsStepper.test.tsx`

**Interfaces:**
- Add visual contracts for `report-domain-nav`, `planning-workspace`, `scenario-route-editor`, `scenario-stop-list`, `scenario-stop-row`, `scenario-stop-status`, `scenario-diff-summary`, `scenario-operation-disclosure`, and `scenario-save-actions`.
- Preserve existing colors, field sizing, focus outlines, and button tokens. Use one primary action per surface. Keep long technical details scrollable and all stop actions keyboard reachable.
- At `max-width: 760px`, current/scenario lists stack, row actions remain full-width or icon-label buttons, and domain navigation remains readable without horizontal clipping.

- [ ] **Step 1: Write visual contract tests**

  Assert new class names and that operation/technical disclosures do not contain `open` in initial markup. Assert status labels are present for unchanged/added/removed/moved rows.

- [ ] **Step 2: Run focused tests and confirm failure**

  Run: `npx vitest run tests/renderer/ScenarioWorkspaceEntry.test.tsx tests/renderer/SyntheticRouteScenarioEditor.test.tsx tests/renderer/SyntheticGtfsStepper.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

  Expected: FAIL until the new class names and editor hierarchy are styled/emitted.

- [ ] **Step 3: Implement styles**

  Add compact plan card hierarchy, vertical stop lists, status colors with accessible contrast, diff summary emphasis, closed disclosure styling, and one-column responsive rules. Remove or leave unused legacy CSS only after confirming no other screen consumes it.

- [ ] **Step 4: Run focused UI tests**

  Run: `npx vitest run tests/renderer/ScenarioWorkspaceEntry.test.tsx tests/renderer/SyntheticRouteScenarioEditor.test.tsx tests/renderer/SyntheticGtfsBuilder.test.tsx tests/renderer/SyntheticGtfsStepper.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/renderer/styles.css tests/renderer/ScenarioWorkspaceEntry.test.tsx tests/renderer/SyntheticRouteScenarioEditor.test.tsx tests/renderer/SyntheticGtfsStepper.test.tsx
  git commit -m "style: make route scenario editing task-oriented"
  ```

### Task 8: 0.8.0 문서와 사용자 용어를 갱신한다

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-09-21-synthetic-gtfs-ux-design.md`
- Modify: `tests/release-version.test.ts`

**Interfaces:**
- Keep package version and package-lock at `0.8.0`.
- Replace documentation that describes `분석 결과 → GTFS 구축` with `분석 결과 → 계획·시나리오 → 노선 개편 시나리오`.
- Document that GTFS is the generated artifact of the current/scenario comparison, not the primary user task.
- Changelog must describe the expanded 0.8.0 scope without creating a 0.8.1 or 0.9.0 heading.

- [ ] **Step 1: Write failing documentation assertions**

  Extend `tests/release-version.test.ts`:

  ```ts
  expect(readme).toContain('계획·시나리오');
  expect(readme).toContain('노선 개편 시나리오');
  expect(changelog).toContain('현행');
  expect(changelog).toContain('개편안');
  expect(changelog).not.toContain('## 0.8.1');
  ```

- [ ] **Step 2: Run release-surface test and confirm failure**

  Run: `npx vitest run tests/release-version.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

  Expected: FAIL because current documentation still presents GTFS as the entry task.

- [ ] **Step 3: Update user-facing documents**

  Keep historical 0.7.x entries unchanged. Update only current 0.8.0 wording and the new changelog bullets.

- [ ] **Step 4: Run release test**

  Run: `npx vitest run tests/release-version.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add README.md CHANGELOG.md docs/superpowers/specs/2026-09-21-synthetic-gtfs-ux-design.md tests/release-version.test.ts
  git commit -m "docs: explain route scenario planning in 0.8.0"
  ```

### Task 9: 전체 회귀와 네이티브 빌드를 검증한다

**Files:**
- Test: all renderer/core/main tests
- Review: `src/renderer/App.tsx`, `src/renderer/ScenarioWorkspaceEntry.tsx`, `src/renderer/SyntheticRouteScenarioEditor.tsx`, `src/renderer/SyntheticGtfsBuilder.tsx`, `src/renderer/styles.css`
- Verify: `package.json`, `package-lock.json`, README, CHANGELOG

**Interfaces:**
- Final behavior must satisfy the expansion spec without changing version `0.8.0`.
- The packaged/native build must contain the updated renderer bundle and the existing MOTIS/main/preload bundles.

- [ ] **Step 1: Run targeted renderer regressions**

  Run: `npx vitest run tests/renderer/AppNavigation.test.tsx tests/renderer/ScenarioWorkspaceEntry.test.tsx tests/renderer/SyntheticRouteScenarioEditor.test.tsx tests/renderer/synthetic-route-scenario.test.ts tests/renderer/synthetic-scenario-definition.test.ts tests/renderer/SyntheticGtfsBuilder.test.tsx tests/renderer/SyntheticGtfsStepper.test.tsx tests/renderer/SyntheticScenarioTools.test.tsx tests/renderer/ScenarioDefinitionEditor.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1`

  Expected: PASS for all listed files.

- [ ] **Step 2: Run all tests**

  Run: `npm test`

  Expected: all test files and tests pass, including release-surface and existing MOTIS/core tests.

- [ ] **Step 3: Run typecheck and production build**

  Run: `npm run typecheck` and `npm run build`

  Expected: both exit 0; `out/main`, `out/preload`, and `out/renderer` are produced.

- [ ] **Step 4: Perform native acceptance flow**

  Start with `npm run dev` and verify manually:

  1. Open a project with route master data.
  2. Confirm the report header contains only report utilities and no GTFS button.
  3. Select `계획·시나리오`, open `노선 개편 시나리오`, and confirm the current route/stops are immediately understandable.
  4. Add, remove, and reorder a stop; confirm diff statuses and automatic label update.
  5. Save, generate current/scenario GTFS, run the same OD comparison, and confirm all results say `현행`/`개편안`.
  6. Change the route or stop order after generating; confirm stale gating requires regeneration.
  7. Reopen the project and confirm the saved scenario remains available without losing existing definitions.

- [ ] **Step 5: Run final diff hygiene and record completion**

  Run: `git diff --check` and `git status --short`. Append the targeted/full test counts, typecheck/build results, and native acceptance observations to the plan ledger.

- [ ] **Step 6: Record final verification**

  Do not create a version bump commit. Append the final test counts, build result, and native acceptance observations to the plan ledger, then report the expected worktree state.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { analyzeRecords } from '../core/analysis';
import { classifyDataQuality } from '../core/data-quality';
import { buildStationCatalog } from '../core/station-catalog';
import { exactDuplicateIndexes, normalizeRows, parseFileBytes } from '../core/parser';
import type {
  AnalysisConfig,
  ColumnMapping,
  NormalizedRecord,
  ParseOptions,
  ProjectManifest,
  RouteCongestionConfig,
  RouteServiceConfig,
  RouteStopMasterRecord,
  StationMasterRecord
} from '../shared/types';
import type { JobManager } from './job-manager';
import type { createProjectStore } from './project-store';

type ProjectStore = ReturnType<typeof createProjectStore>;
type ImportManifestMetadata = Pick<ProjectManifest, 'schemaVersion' | 'id' | 'name' | 'createdAt' | 'updatedAt'>;

export interface ImportSourceFile {
  path: string;
  name: string;
  options: ParseOptions;
}

export interface PrepareImportRequest {
  jobId: string;
  files: ImportSourceFile[];
  mapping: ColumnMapping;
  analysisConfig: AnalysisConfig;
  routeAnalysisConfig?: RouteCongestionConfig;
  stationMaster?: StationMasterRecord[];
  routeStopMaster?: RouteStopMasterRecord[];
  routeServiceConfigs?: RouteServiceConfig[];
  projectFields?: Partial<Omit<ProjectManifest, 'id' | 'name' | 'createdAt' | 'updatedAt' | 'records' | 'sourceFiles' | 'mapping' | 'parseOptions' | 'analysisConfig' | 'routeAnalysisConfig' | 'lastResult'>>;
}

export interface PreparedImport {
  stagingToken: string;
  sourceFiles: string[];
  recordCount: number;
  duplicateCount: number;
  excludedRows: number;
  warnings: string[];
  from: string;
  to: string;
}

export interface CommitImportRequest {
  jobId: string;
  stagingToken: string;
  keepDuplicates: boolean;
  manifestMetadata: ImportManifestMetadata;
}

interface StagedImport {
  sourceFiles: string[];
  records: NormalizedRecord[];
  duplicateIndexes: number[];
  excludedRows: number;
  warnings: string[];
  mapping: ColumnMapping;
  parseOptions: ParseOptions;
  analysisConfig: AnalysisConfig;
  routeAnalysisConfig: RouteCongestionConfig;
  stationMaster?: StationMasterRecord[];
  routeStopMaster?: RouteStopMasterRecord[];
  routeServiceConfigs?: RouteServiceConfig[];
  projectFields?: PrepareImportRequest['projectFields'];
}

interface Dependencies {
  jobs: JobManager;
  store: ProjectStore;
  readBytes?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
  yieldControl?: () => Promise<void>;
}

function toArrayBuffer(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function defaultYield(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function createImportJobHandlers({
  jobs,
  store,
  readBytes = readFile,
  yieldControl = defaultYield
}: Dependencies) {
  const stagedImports = new Map<string, StagedImport>();

  return {
    prepare(request: PrepareImportRequest): Promise<PreparedImport> {
      return jobs.start({ jobId: request.jobId, operation: 'import' }, async (context) => {
        if (!request.files.length) throw new Error('가져올 파일이 없습니다.');
        if (!request.mapping.dateColumn) throw new Error('날짜 필드 매핑이 필요합니다.');
        const records: NormalizedRecord[] = [];
        const warnings: string[] = [];
        let excludedRows = 0;

        for (let fileIndex = 0; fileIndex < request.files.length; fileIndex += 1) {
          const file = request.files[fileIndex];
          context.throwIfCancelled();
          context.report({
            phase: 'parse-file',
            completed: fileIndex,
            total: request.files.length,
            message: `${file.name} 파일을 읽는 중입니다.`
          });
          const parsed = await parseFileBytes(toArrayBuffer(await readBytes(file.path)), file.name, file.options);
          context.throwIfCancelled();

          const batchSize = 10_000;
          for (let offset = 0; offset < parsed.rows.length; offset += batchSize) {
            const normalized = normalizeRows(parsed.rows.slice(offset, offset + batchSize), request.mapping, file.name);
            for (const record of normalized.records) {
              records.push({ ...record, sourceRow: (record.sourceRow ?? 0) + offset });
            }
            excludedRows += normalized.excludedRows;
            warnings.push(...normalized.warnings);
            await yieldControl();
            context.throwIfCancelled();
          }
        }

        if (!records.length) throw new Error('분석할 수 있는 행이 없습니다. 필드 매핑과 원본 날짜 형식을 확인하세요.');
        const duplicateIndexes = exactDuplicateIndexes(records);
        const dates = records.map(({ serviceDate }) => serviceDate).sort();
        const analysisConfig: AnalysisConfig = {
          ...request.analysisConfig,
          filter: { ...request.analysisConfig.filter, from: dates[0], to: dates.at(-1)! },
          alightingMode: 'observed'
        };
        const routeAnalysisConfig: RouteCongestionConfig = request.routeAnalysisConfig
          ? { ...request.routeAnalysisConfig, filter: analysisConfig.filter, alightingMode: 'observed' }
          : { filter: analysisConfig.filter, denominator: analysisConfig.denominator, hour: 'all', alightingMode: 'observed' };

        context.report({ phase: 'classify', message: '데이터 품질을 분류하는 중입니다.' });
        await yieldControl();
        context.throwIfCancelled();
        const classified = classifyDataQuality(records, request.stationMaster ?? [], request.routeStopMaster ?? []);
        const initialResult = analyzeRecords(classified, analysisConfig);
        initialResult.excludedRows = excludedRows;
        initialResult.warnings = warnings;
        context.throwIfCancelled();

        const stagingToken = randomUUID();
        stagedImports.set(stagingToken, {
          sourceFiles: request.files.map(({ name }) => name),
          records: classified,
          duplicateIndexes,
          excludedRows,
          warnings,
          mapping: request.mapping,
          parseOptions: request.files[0].options,
          analysisConfig,
          routeAnalysisConfig,
          stationMaster: request.stationMaster,
          routeStopMaster: request.routeStopMaster,
          routeServiceConfigs: request.routeServiceConfigs,
          projectFields: request.projectFields
        });
        return {
          stagingToken,
          sourceFiles: request.files.map(({ name }) => name),
          recordCount: classified.length,
          duplicateCount: duplicateIndexes.length,
          excludedRows,
          warnings,
          from: dates[0],
          to: dates.at(-1)!
        };
      });
    },

    commit(request: CommitImportRequest): Promise<ProjectManifest> {
      return jobs.start({ jobId: request.jobId, operation: 'import' }, async (context) => {
        const staged = stagedImports.get(request.stagingToken);
        stagedImports.delete(request.stagingToken);
        if (!staged) throw new Error('가져오기 스테이징 토큰이 유효하지 않거나 이미 사용되었습니다.');
        context.throwIfCancelled();

        const duplicateSet = new Set(staged.duplicateIndexes);
        const records = request.keepDuplicates
          ? staged.records
          : staged.records.filter((_record, index) => !duplicateSet.has(index));
        if (!records.length) throw new Error('중복 행을 제외한 뒤 분석할 수 있는 행이 없습니다.');
        const warnings = [...staged.warnings];
        if (staged.duplicateIndexes.length) {
          warnings.push(`완전 중복 행 ${staged.duplicateIndexes.length}개를 ${request.keepDuplicates ? '합산' : '제외'}했습니다.`);
        }
        const lastResult = analyzeRecords(records, staged.analysisConfig);
        lastResult.excludedRows = staged.excludedRows;
        lastResult.warnings = warnings;
        const stationCatalog = buildStationCatalog(staged.stationMaster ?? [], staged.routeStopMaster ?? []);
        const project: ProjectManifest = {
          ...request.manifestMetadata,
          ...staged.projectFields,
          sourceFiles: staged.sourceFiles,
          records,
          mapping: staged.mapping,
          parseOptions: staged.parseOptions,
          stationMaster: staged.stationMaster?.length ? staged.stationMaster : undefined,
          routeStopMaster: staged.routeStopMaster?.length ? staged.routeStopMaster : undefined,
          stationCatalog,
          routeServiceConfigs: staged.routeServiceConfigs,
          analysisConfig: staged.analysisConfig,
          routeAnalysisConfig: staged.routeAnalysisConfig,
          analysisMode: 'weekday',
          lastResult
        };
        context.report({ phase: 'commit', message: '프로젝트를 저장하는 중입니다.' });
        await yieldControl();
        context.throwIfCancelled();
        context.beginCommit();
        return store.save(project);
      });
    }
  };
}

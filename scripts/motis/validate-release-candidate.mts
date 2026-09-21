import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import extract from 'extract-zip';

import { verifyPatchedBuild } from './verify-patched-build.mjs';

const execFileAsync = promisify(execFile);
const sha256Pattern = /^[0-9a-f]{64}$/i;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface ReleaseInputOptions {
  archivePath: string;
  pbfPath: string;
  expectedArchiveSha256?: string;
  expectedPbfSha256?: string;
}

export interface WalkingCheck {
  status: 'passed' | 'failed';
  accessWalkSeconds: number;
  egressWalkSeconds: number;
  error?: string;
}

export interface CandidateEvidence {
  import: 'passed' | 'failed';
  health: 'passed' | 'failed';
  bus: 'passed' | 'failed';
  footAtProblemNode: WalkingCheck;
  coordinateTransit: WalkingCheck;
  overflowDiagnostic?: {
    nodeOsmId: string;
    observedWays: number;
    maxWays: number;
  };
}

export interface ValidationAttestation {
  schemaVersion: 1;
  buildRunId: string;
  archiveSha256: string;
  binarySha256: string;
  pbfSha256: string;
  scenarioReportSha256: string;
  officialControl: {
    maxWays: 16;
    failedNodeOsmId: string;
    observedWays: 18;
  };
  candidate: {
    import: 'passed';
    health: 'passed';
    bus: 'passed';
    footAtProblemNode: 'passed';
    coordinateTransit: 'passed';
  };
  evidence: CandidateEvidence;
}

interface ValidationScenarioReport {
  officialControlDiagnostic: string;
  evidence: CandidateEvidence;
}

interface CandidateValidationOptions extends ReleaseInputOptions {
  buildRunId: string;
  scenarioReportPath: string;
  outputPath?: string;
  expectedBinarySha256?: string;
  lockPath?: string;
}

function fail(message: string): never {
  throw new Error(message);
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

function requireHash(value: string | undefined, description: string): string {
  if (!value || !sha256Pattern.test(value)) fail(`${description} must be a SHA-256 hex string.`);
  return value.toLowerCase();
}

export async function assertReleaseInputFiles(options: ReleaseInputOptions) {
  if (!options.archivePath || !existsSync(options.archivePath) || !(await stat(options.archivePath)).isFile()) {
    fail(`Candidate archive not found: ${options.archivePath}`);
  }
  if (!options.pbfPath || !existsSync(options.pbfPath) || !(await stat(options.pbfPath)).isFile()) {
    fail(`South Korea PBF not found: ${options.pbfPath}`);
  }

  const archiveSha256 = await sha256File(options.archivePath);
  const pbfSha256 = await sha256File(options.pbfPath);
  if (options.expectedArchiveSha256 && archiveSha256 !== requireHash(options.expectedArchiveSha256, 'Expected archive SHA-256')) {
    fail(`Candidate archive SHA-256 differs: expected=${options.expectedArchiveSha256}, actual=${archiveSha256}`);
  }
  if (options.expectedPbfSha256 && pbfSha256 !== requireHash(options.expectedPbfSha256, 'Expected PBF SHA-256')) {
    fail(`PBF SHA-256 differs: expected=${options.expectedPbfSha256}, actual=${pbfSha256}`);
  }
  return { archiveSha256, pbfSha256 };
}

export function assertOfficialControlDiagnostic(output: string): void {
  const normalized = String(output).replace(/\s+/g, ' ').trim();
  if (!/node\s+(?:(?:\d+)\s+\(osm=)?10729381152\)?\s+has\s+18\s+ways,\s+maximum\s+is\s+16/i.test(normalized)) {
    fail('Official 16-way control did not record node 10729381152 with 18 ways, maximum is 16.');
  }
}

function assertWalkingCheck(check: WalkingCheck, description: string): void {
  if (!check || check.status !== 'passed') fail(`${description} failed: ${check?.error ?? 'no passing result recorded'}`);
  if (!Number.isFinite(check.accessWalkSeconds) || check.accessWalkSeconds <= 0) {
    fail(`${description} must record positive access walking seconds.`);
  }
  if (!Number.isFinite(check.egressWalkSeconds) || check.egressWalkSeconds <= 0) {
    fail(`${description} must record positive egress walking seconds.`);
  }
}

export function assertCandidateEvidence(evidence: CandidateEvidence): void {
  if (!evidence || evidence.import !== 'passed') fail('Candidate OSM/GTFS import did not pass.');
  if (evidence.health !== 'passed') fail('Candidate health check did not pass.');
  if (evidence.bus !== 'passed') fail('Candidate BUS routing check did not pass.');
  assertWalkingCheck(evidence.footAtProblemNode, 'Problem-node FOOT walking check');
  assertWalkingCheck(evidence.coordinateTransit, 'Coordinate transit walking check');
  if (!evidence.overflowDiagnostic || evidence.overflowDiagnostic.nodeOsmId !== '10729381152' || evidence.overflowDiagnostic.observedWays <= 32 || evidence.overflowDiagnostic.maxWays !== 32) {
    fail('Candidate evidence must include a 32-way overflow diagnostic for node 10729381152.');
  }
}

export function createValidationAttestation(input: {
  buildRunId: string;
  archiveSha256: string;
  binarySha256: string;
  pbfSha256: string;
  scenarioReportSha256: string;
  evidence: CandidateEvidence;
}): ValidationAttestation {
  if (!input.buildRunId.trim()) fail('Validation build run ID is required.');
  const archiveSha256 = requireHash(input.archiveSha256, 'Archive SHA-256');
  const binarySha256 = requireHash(input.binarySha256, 'Binary SHA-256');
  const pbfSha256 = requireHash(input.pbfSha256, 'PBF SHA-256');
  const scenarioReportSha256 = requireHash(input.scenarioReportSha256, 'Scenario report SHA-256');
  assertCandidateEvidence(input.evidence);
  return {
    schemaVersion: 1,
    buildRunId: input.buildRunId,
    archiveSha256,
    binarySha256,
    pbfSha256,
    scenarioReportSha256,
    officialControl: { maxWays: 16, failedNodeOsmId: '10729381152', observedWays: 18 },
    candidate: {
      import: 'passed',
      health: 'passed',
      bus: 'passed',
      footAtProblemNode: 'passed',
      coordinateTransit: 'passed'
    },
    evidence: input.evidence
  };
}

async function findDistributionRoot(directory: string): Promise<string> {
  if (existsSync(path.join(directory, 'motis-manifest.json'))) return directory;
  const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name !== '__MACOSX');
  if (entries.length === 1 && existsSync(path.join(directory, entries[0].name, 'motis-manifest.json'))) {
    return path.join(directory, entries[0].name);
  }
  fail('Candidate archive does not contain a Custom MOTIS manifest at its root.');
}

async function readScenarioReport(filePath: string): Promise<ValidationScenarioReport> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    fail(`Scenario validation report cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('Scenario validation report must be an object.');
  const report = parsed as Partial<ValidationScenarioReport>;
  if (typeof report.officialControlDiagnostic !== 'string') fail('Scenario validation report is missing officialControlDiagnostic.');
  assertOfficialControlDiagnostic(report.officialControlDiagnostic);
  assertCandidateEvidence(report.evidence as CandidateEvidence);
  return report as ValidationScenarioReport;
}

export async function validateReleaseCandidate(options: CandidateValidationOptions): Promise<ValidationAttestation> {
  const { archiveSha256, pbfSha256 } = await assertReleaseInputFiles(options);
  if (!options.buildRunId.trim()) fail('Validation build run ID is required.');
  if (!options.scenarioReportPath || !existsSync(options.scenarioReportPath)) fail(`Scenario validation report not found: ${options.scenarioReportPath}`);

  const workDirectory = await mkdtemp(path.join(tmpdir(), 'tap-motis-validation-'));
  try {
    const extractedDirectory = path.join(workDirectory, 'candidate');
    await mkdir(extractedDirectory, { recursive: true });
    await extract(options.archivePath, { dir: extractedDirectory });
    const candidateRoot = await findDistributionRoot(extractedDirectory);
    const verified = await verifyPatchedBuild(path.join(candidateRoot, 'motis-manifest.json'), {
      mode: 'candidate',
      lockPath: options.lockPath
    });
    if (options.expectedBinarySha256 && verified.actualSha256.toLowerCase() !== requireHash(options.expectedBinarySha256, 'Expected binary SHA-256')) {
      fail(`Candidate binary SHA-256 differs: expected=${options.expectedBinarySha256}, actual=${verified.actualSha256}`);
    }
    const scenarioReport = await readScenarioReport(options.scenarioReportPath);
    const attestation = createValidationAttestation({
      buildRunId: options.buildRunId,
      archiveSha256,
      binarySha256: verified.actualSha256,
      pbfSha256,
      scenarioReportSha256: await sha256File(options.scenarioReportPath),
      evidence: scenarioReport.evidence
    });
    if (options.outputPath) {
      await mkdir(path.dirname(options.outputPath), { recursive: true });
      await writeFile(options.outputPath, `${JSON.stringify(attestation, null, 2)}\n`, 'utf8');
    }
    return attestation;
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

function parseArguments(argv: string[]): CandidateValidationOptions {
  const options: Partial<CandidateValidationOptions> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[++index];
    if (argument === '--archive') options.archivePath = value;
    else if (argument === '--pbf') options.pbfPath = value;
    else if (argument === '--archive-sha256') options.expectedArchiveSha256 = value;
    else if (argument === '--pbf-sha256') options.expectedPbfSha256 = value;
    else if (argument === '--binary-sha256') options.expectedBinarySha256 = value;
    else if (argument === '--build-run-id') options.buildRunId = value;
    else if (argument === '--scenario-report') options.scenarioReportPath = value;
    else if (argument === '--output') options.outputPath = value;
    else if (argument === '--lock') options.lockPath = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.archivePath || !options.pbfPath || !options.buildRunId || !options.scenarioReportPath) {
    throw new Error('Usage: vite-node --script scripts/motis/validate-release-candidate.mts --archive <zip> --pbf <south-korea.pbf> --build-run-id <id> --scenario-report <report.json> [--output <attestation.json>]');
  }
  return options as CandidateValidationOptions;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  validateReleaseCandidate(parseArguments(process.argv.slice(2)))
    .then((attestation) => console.log(JSON.stringify(attestation, null, 2)))
    .catch((error) => {
      console.error(`MOTIS nationwide validation failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}

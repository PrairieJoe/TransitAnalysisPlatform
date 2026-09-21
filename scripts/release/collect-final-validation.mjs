import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readBuilderLock } from '../motis/builder-lock.mjs';

const sha256Pattern = /^[a-f0-9]{64}$/i;
const gitObjectPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const componentTagPattern = /^motis-v2\.11\.3-osr32\.[1-9][0-9]*$/;
const requiredFeatureChecks = [
  'packagedMotisSmoke',
  'scenarioSaveRunCompare',
  'coordinateAccessEgress',
  'cancellationCleanup',
  'savedResultReopen',
  'demandEstimationIdentity'
];
const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function fail(message) {
  throw new Error(message);
}

function required(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${label} is required.`);
  return value.trim();
}

function requireGitObject(value, label) {
  const normalized = required(value, label).toLowerCase();
  if (!gitObjectPattern.test(normalized)) fail(`${label} must be a Git object SHA.`);
  return normalized;
}

function requireHash(value, label) {
  const normalized = required(value, label).toLowerCase();
  if (!sha256Pattern.test(normalized)) fail(`${label} must be a SHA-256 hash.`);
  return normalized;
}

async function sha256File(filePath, label) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) fail(`${label} is not a file: ${filePath}`);
    return createHash('sha256').update(await readFile(filePath)).digest('hex');
  } catch (error) {
    fail(`Unable to read ${label}: ${error.message}`);
  }
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    fail(`Unable to read ${label}: ${error.message}`);
  }
}

function validateFeatureReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) fail('Feature validation report must be an object.');
  if (!report.checks || typeof report.checks !== 'object' || Array.isArray(report.checks)) fail('Feature validation report checks are required.');
  for (const check of requiredFeatureChecks) {
    if (report.checks[check] !== 'passed') fail(`Feature validation check is not passed: ${check}`);
  }
  if (!Array.isArray(report.rawResultHashes) || report.rawResultHashes.length === 0) fail('Feature validation raw result hashes are required.');
  for (const [index, value] of report.rawResultHashes.entries()) requireHash(value, `Feature validation raw result hash ${index + 1}`);
  return report;
}

export const FINAL_FEATURE_CHECKS = Object.freeze([...requiredFeatureChecks]);

export async function collectFinalValidation(options) {
  const appCandidateSha = requireGitObject(options.appCandidateSha, 'App candidate SHA');
  const appVersion = required(options.appVersion, 'App version');
  if (appVersion !== '0.7.0') fail('Final validation can only collect an exact 0.7.0 candidate.');
  const componentTag = required(options.componentTag, 'Component tag');
  if (!componentTagPattern.test(componentTag)) fail('Component tag does not match the canonical Custom MOTIS tag pattern.');
  const componentSourceSha = requireGitObject(options.componentSourceSha, 'Component source SHA');

  const lock = await readBuilderLock(path.resolve(options.lockPath ?? path.join(defaultRoot, 'scripts/motis/motis-builder-lock.json')));
  if (lock.state !== 'locked' || !lock.release) fail('Builder lock must be locked before collecting final validation.');

  const archiveSha256 = await sha256File(path.resolve(required(options.archivePath, 'Candidate archive')), 'candidate archive');
  const binarySha256 = await sha256File(path.resolve(required(options.binaryPath, 'Candidate binary')), 'candidate binary');
  const pbfSha256 = await sha256File(path.resolve(required(options.pbfPath, 'South Korea PBF')), 'South Korea PBF');
  const scenarioReportPath = path.resolve(required(options.scenarioReportPath, 'Scenario report'));
  const scenarioReportSha256 = await sha256File(scenarioReportPath, 'scenario report');
  const installerPath = path.resolve(required(options.installerPath, 'Windows installer'));
  const installerSha256 = await sha256File(installerPath, 'Windows installer');
  const featureReport = validateFeatureReport(await readJson(path.resolve(required(options.featureReportPath, 'feature validation report')), 'feature validation report'));
  const release = lock.release;

  for (const [field, actual] of Object.entries({ archiveSha256, binarySha256, pbfSha256, scenarioReportSha256 })) {
    if (release[field] !== actual) fail(`${field} differs from the locked builder release.`);
  }
  if (featureReport.appCandidateSha !== undefined && featureReport.appCandidateSha !== appCandidateSha) fail('Feature validation app candidate SHA differs from the requested candidate.');

  const evidence = {
    schemaVersion: 1,
    appCandidateSha,
    appVersion,
    component: { tag: componentTag, sourceSha: componentSourceSha, archiveSha256, binarySha256, pbfSha256 },
    deployment: { installerFileName: path.basename(installerPath), installerSha256 },
    validation: {
      scenarioReportSha256,
      featureReportSha256: await sha256File(path.resolve(options.featureReportPath), 'feature validation report'),
      checks: Object.fromEntries(requiredFeatureChecks.map((check) => [check, 'passed'])),
      rawResultHashes: featureReport.rawResultHashes
    }
  };
  if (options.outputPath) await writeFile(path.resolve(options.outputPath), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidence;
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) values[argv[index]] = argv[index + 1];
  return {
    lockPath: values['--lock'], appCandidateSha: values['--app-candidate-sha'], appVersion: values['--app-version'],
    componentTag: values['--component-tag'], componentSourceSha: values['--component-source-sha'],
    archivePath: values['--archive'], binaryPath: values['--binary'], pbfPath: values['--pbf'],
    scenarioReportPath: values['--scenario-report'], installerPath: values['--installer'], featureReportPath: values['--feature-report'], outputPath: values['--output']
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  collectFinalValidation(parseArguments(process.argv.slice(2)))
    .then((evidence) => console.log(JSON.stringify(evidence, null, 2)))
    .catch((error) => {
      console.error(`Final validation collection failed: ${error.message}`);
      process.exitCode = 1;
    });
}

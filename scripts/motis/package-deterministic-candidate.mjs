import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';

const fixedZipDate = new Date('1980-01-01T00:00:00.000Z');

function fail(message) {
  throw new Error(message);
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function listPayloadFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
    if (entry.isSymbolicLink()) fail(`Candidate payload must not contain symbolic links: ${relativePath}`);
    if (entry.isDirectory()) files.push(...await listPayloadFiles(root, absolutePath));
    else if (entry.isFile()) files.push(relativePath);
    else fail(`Candidate payload contains an unsupported filesystem entry: ${relativePath}`);
  }
  return files;
}

export async function packageDeterministicCandidate(sourceDirectory, archivePath, options = {}) {
  const root = path.resolve(sourceDirectory);
  if (!(await lstat(root).catch(() => undefined))?.isDirectory()) fail(`Candidate payload directory does not exist: ${root}`);
  const output = path.resolve(archivePath);
  if (output === root || output.startsWith(`${root}${path.sep}`)) fail('Deterministic archive must be written outside the candidate payload directory.');

  const relativePaths = (await listPayloadFiles(root)).sort();
  if (!relativePaths.includes('motis.exe')) fail('Candidate payload is missing motis.exe.');
  const zip = new JSZip();
  const inventory = [];
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(root, ...relativePath.split('/'));
    const bytes = await readFile(absolutePath);
    const info = await stat(absolutePath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    inventory.push({ path: relativePath, sizeBytes: info.size, sha256 });
    zip.file(relativePath, bytes, {
      binary: true,
      createFolders: false,
      date: fixedZipDate,
      unixPermissions: relativePath === 'motis.exe' ? 0o100755 : 0o100644
    });
  }

  const payloadTreeSha256 = createHash('sha256')
    .update(inventory.map((file) => `${file.sha256} ${file.sizeBytes} ${file.path}\n`).join(''))
    .digest('hex');
  const archive = await zip.generateAsync({
    type: 'nodebuffer',
    platform: 'UNIX',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    streamFiles: false
  });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, archive);
  const metadata = {
    schemaVersion: 1,
    format: 'zip',
    compression: 'deflate-9',
    fixedTimestamp: fixedZipDate.toISOString(),
    fileCount: inventory.length,
    binarySha256: inventory.find((file) => file.path === 'motis.exe').sha256,
    payloadTreeSha256,
    archiveSha256: await sha256File(output),
    files: inventory
  };
  if (options.metadataPath) await writeFile(path.resolve(options.metadataPath), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return metadata;
}

function parseArguments(argv) {
  const [sourceDirectory, archivePath, ...rest] = argv;
  if (!sourceDirectory || !archivePath) throw new Error('Usage: node scripts/motis/package-deterministic-candidate.mjs <source-directory> <archive.zip> [--metadata <metadata.json>]');
  let metadataPath;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--metadata') metadataPath = rest[++index];
    else throw new Error(`Unknown argument: ${rest[index]}`);
  }
  return { sourceDirectory, archivePath, metadataPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const options = parseArguments(process.argv.slice(2));
  packageDeterministicCandidate(options.sourceDirectory, options.archivePath, options)
    .then((metadata) => console.log(`Deterministic Custom MOTIS candidate: ${metadata.archiveSha256}`))
    .catch((error) => {
      console.error(`Deterministic candidate packaging failed: ${error.message}`);
      process.exitCode = 1;
    });
}

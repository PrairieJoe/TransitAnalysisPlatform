import { fileURLToPath } from 'node:url';

export const requiredMsvcCrtDlls = Object.freeze([
  'concrt140.dll',
  'msvcp140.dll',
  'msvcp140_1.dll',
  'msvcp140_2.dll',
  'msvcp140_atomic_wait.dll',
  'msvcp140_codecvt_ids.dll',
  'vccorlib140.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll',
  'vcruntime140_threads.dll'
]);

export function missingRequiredMsvcCrtDlls(runtimeDlls) {
  const present = new Set(runtimeDlls.map((name) => name.toLowerCase()));
  return requiredMsvcCrtDlls.filter((name) => !present.has(name));
}

function main(args) {
  if (args.length !== 1 || args[0] !== '--list-required') {
    throw new Error('Usage: node scripts/motis/msvc-runtime.mjs --list-required');
  }
  process.stdout.write(`${requiredMsvcCrtDlls.join('\n')}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

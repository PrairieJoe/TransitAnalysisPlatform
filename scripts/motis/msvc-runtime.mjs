export const requiredMsvcCrtDlls = Object.freeze([
  'concrt140.dll',
  'msvcp140.dll',
  'msvcp140_1.dll',
  'msvcp140_2.dll',
  'msvcp140_atomic_wait.dll',
  'msvcp140_codecvt_ids.dll',
  'vccorlib140.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll'
]);

export function missingRequiredMsvcCrtDlls(runtimeDlls) {
  const present = new Set(runtimeDlls.map((name) => name.toLowerCase()));
  return requiredMsvcCrtDlls.filter((name) => !present.has(name));
}

# Reproducible custom MOTIS build

Transit Analysis Platform 0.6.2 uses a locally reproducible Windows MOTIS
build for nationwide OpenStreetMap imports. This is a TAP-custom build, not an
official MOTIS release and does not imply official MOTIS support.

## Pinned inputs

- MOTIS version: official `v2.11.3`
- MOTIS source commit: `b228a4519d196d9dd01b5ce80be46e642abc953e`
- OSR source commit: `a7b2ec2728544304ef1d8397b3042abc8d10f7e7`
- Patch id: `osr-max-ways-per-node-32`
- Patch file: `scripts/motis/osr-max-ways-per-node-32.patch`
- Source change: `kMaxWaysPerNode` changes from `way_pos_t{16U}` to
  `way_pos_t{32U}` in `include/osr/types.h`.

No other OSR limit, verification in `src/ways.cc`, data structure, MOTIS API,
GTFS behavior, routing algorithm, or PBF parser behavior is changed. The value
`32` remains a hard maximum; this build does not provide unlimited ways per
node or support a claim above 32 connected ways.

## Build

Run from the repository root in a Windows PowerShell with Git, CMake, an x64
C/C++ compiler, pnpm, and Windows symbolic-link privilege available:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\motis\build-patched-windows.ps1 `
  -SourceRoot .\deps `
  -OutputDirectory .\vendor\motis\patched-windows
node .\scripts\motis\verify-patched-build.mjs `
  .\vendor\motis\patched-windows\motis-manifest.json
```

`SourceRoot` is a dependency cache directory. The script clones or reuses
`motis-v2.11.3`, verifies the exact MOTIS tag/commit, lets the official
MOTIS/pkg CMake workflow resolve its `.pkg` lock, verifies OSR at the pinned
commit, and runs `git apply --check` before applying the tracked one-line
patch. It then runs the documented Windows x64 CMake targets:

```powershell
cmake -G "Visual Studio 17 2022" -A x64 `
  -S .\deps\motis-v2.11.3 `
  -B .\deps\motis-v2.11.3\build\patched-windows `
  -DMOTIS_MIMALLOC=ON -DCMAKE_BUILD_TYPE=Release
cmake --build .\deps\motis-v2.11.3\build\patched-windows `
  --target motis motis-web-ui --config Release
```

When Ninja is available, the script uses the equivalent Ninja generator; when
only MinGW is available it uses `MinGW Makefiles`; neither passes
`--config Release`. MOTIS/pkg may bootstrap its `pkg` helper from
the MOTIS repository's CMake workflow when no `pkg` executable is on `PATH`.
The script checks required tools before changing source or output files and
refuses to reuse a source checkout with unrelated uncommitted changes. MOTIS's
documented CMakeLists creates symbolic links for `tiles-profiles` and `ui`; the
script does not change Windows security settings, so a host without that
privilege stops during CMake configuration.

## Generated output and verification

Generated files remain under the existing ignored directory
`vendor/motis/patched-windows`. The distribution contains `motis.exe`,
`tiles-profiles`, the runtime DLL/UI files produced by the build, and
`licenses/MOTIS-MIT.txt` plus `licenses/OSR-MIT.txt`. It must not be committed
or copied into the Electron installer until the manifest verifier succeeds.

`motis-manifest.json` is the build record. Its `binary.sha256` field is the
lowercase SHA-256 of the copied `motis.exe`; the verifier also checks:

- MOTIS `v2.11.3` and source commit;
- the pinned OSR commit;
- patch id `osr-max-ways-per-node-32`;
- `baseMaxWaysPerNode: 16` and `maxWaysPerNode: 32`;
- the existence of `motis.exe` and `tiles-profiles`; and
- the binary hash.

The tracked patch, build script, verifier, documentation, and license notices
are the reproducibility record. The ignored binary is an output of that
record, not an official MOTIS distribution.

## Runtime constraints and notices

For the patched Windows/MinGW validation path, tiles remain disabled and
`TBB_NUM_THREADS=1` remains explicit because parallel tile processing has been
observed to be unstable. The Korea OSM PBF is user-provided and is not bundled
with the application; its source and data license are managed separately from
these executable notices.

The full MIT texts and copyright notices for MOTIS and OSR are tracked in
`docs/licenses/MOTIS-MIT.txt` and `docs/licenses/OSR-MIT.txt` and are copied
into every generated distribution.

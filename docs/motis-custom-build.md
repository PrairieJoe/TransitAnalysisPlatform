# Reproducible custom MOTIS build

Transit Analysis Platform 0.6.2 bundles a locally reproducible Windows MOTIS
build for large OpenStreetMap imports. It is based on the official MOTIS
`v2.11.3` source and is a TAP-specific build; it is not an official MOTIS
release and does not imply official MOTIS support.

## Pinned inputs and functional change

- MOTIS tag: `v2.11.3`
- MOTIS commit: `b228a4519d196d9dd01b5ce80be46e642abc953e`
- OSR commit: `a7b2ec2728544304ef1d8397b3042abc8d10f7e7`
- Functional patch: `osr-max-ways-per-node-32`
- OSR `kMaxWaysPerNode`: `16` -> `32`

Only that OSR capacity value is changed. This build does not change the PBF
format, routing algorithm, MOTIS API, GTFS behavior, or other OSR limits. `32`
remains a hard maximum; it is not an unlimited-way implementation.

The remaining tracked patches are Windows/MinGW portability fixes required to
build and package the pinned upstream source. They cover resource generation,
Windows time APIs, thread naming, Boost stacktrace/thread linking, TBB's
assembler probe, Winsock linking, and Windows UI/resource directory handling.
They do not change routing or import semantics.

## Build

Run from the repository root in a Windows PowerShell with Git, CMake, an x64
C/C++ compiler, Node.js, pnpm, and network access to GitHub:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\motis\build-patched-windows.ps1 `
  -SourceRoot .\deps `
  -OutputDirectory .\vendor\motis\patched-windows

node .\scripts\motis\verify-patched-build.mjs `
  .\vendor\motis\patched-windows\motis-manifest.json
```

The script clones or reuses `deps\motis-v2.11.3`, verifies the exact tag and
commit, uses the official `.pkg` lock to download dependencies, applies the
tracked OSR and Windows compatibility patches, builds the API client and UI,
and produces a Windows x64 Release binary. MinGW builds use the pinned
Windows compatibility flags and `HOME=/tmp` during CMake/package execution.

The first CMake configure hydrates the `.pkg` dependency cache. A second
configure runs after all dependency patches are applied so those changes are
part of the final build graph. The script accepts a cache whose expected
patches are already applied, but fails if a pinned source file has an
unrelated or partially applied change.

## Generated distribution and verification

Generated files remain under the ignored directory
`vendor/motis/patched-windows`. The distribution contains:

- `motis.exe`
- `mimalloc.dll` and `mimalloc-redirect.dll`
- `tiles-profiles`
- the built `ui` directory
- `licenses/MOTIS-MIT.txt` and `licenses/OSR-MIT.txt`
- `motis-manifest.json`

The manifest records the exact source commits, the `16 -> 32` change, the
binary SHA-256 and size, compiler/CMake settings, and all compatibility patch
IDs. The verifier checks the source/version metadata, patch values, required
runtime files, and the actual binary hash. Do not package the distribution
until the verifier succeeds.

## Runtime and license notices

For the patched Windows/MinGW validation path, tiles remain disabled and
`TBB_NUM_THREADS=1` remains explicit because parallel tile processing has been
observed to be unstable. Korea OSM PBF data is user-provided and is not
bundled with the application.

The full MIT texts and copyright notices for MOTIS and OSR are tracked in
`docs/licenses/MOTIS-MIT.txt` and `docs/licenses/OSR-MIT.txt` and copied into
every generated distribution.

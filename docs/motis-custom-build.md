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

The build script first downloads the pinned MOTIS `pkg` v0.23 Windows tool and
checks its SHA-256, then hydrates the `.pkg` dependency cache before CMake is
run. This is required on a clean Windows runner because oneTBB is itself
created during dependency hydration. Immediately after hydration, the script
rechecks every Windows patch-target repository against the commits recorded in
`.pkg.lock`; GitHub Actions explicitly resets only those patch-target dependency
repositories to those exact commits. The script applies the OSR and Windows
compatibility patches from each dependency's own Git root after that
normalization and only then configures CMake. It accepts a cache whose expected
patches are already applied, but fails if a pinned source file has an unrelated
or partially applied change.

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

## Release asset bootstrap

The Custom MOTIS binary is intentionally not committed to the TAP source
repository. The pinned release contract is stored in
`scripts/motis/motis-release-config.mjs`, and
`scripts/motis/prepare-patched-windows.mjs` does the following:

1. Reuses and verifies `vendor/motis/patched-windows` when it is already
   present.
2. Otherwise downloads the pinned GitHub Release asset
   `motis-windows-x64-v2.11.3-osr32.zip` over HTTPS.
3. Extracts it into a staging directory, rejects unsafe archive paths, and
   verifies the manifest, binary hash, runtime DLLs, UI, tiles profiles, and
   license directory before replacing the local distribution.

Run the normal online preparation with:

```powershell
npm run motis:prepare
```

For an offline build, a previously verified local distribution is sufficient:

```powershell
npm run motis:prepare -- --offline
```

An explicitly supplied local archive can be prepared without changing the
release configuration:

```powershell
node .\scripts\motis\prepare-patched-windows.mjs `
  --archive .\path\to\motis-windows-x64-v2.11.3-osr32.zip
```

`node scripts/package-win.mjs` invokes the preparation step automatically.
The package script still accepts `TRANSIT_MOTIS_DIST_DIR` for controlled local
testing and never silently falls back to the official unpatched Windows
binary.

The GitHub Actions workflow `.github/workflows/motis-release.yml` builds the
same pinned source and patches on a Windows runner. It is manual by design:
the workflow always uploads a workflow artifact, and only publishes a GitHub
Release asset when `publish_release=true` is explicitly enabled. The release
asset must include the Custom MOTIS distribution and all license notices; it
is not an official MOTIS release.

코드 `main` 병합과 Release asset 발행은 서로 다른 완료 조건입니다. 버전별
workflow 입력값, build·publish job 확인, fresh clone 다운로드 검증은
[`docs/release-process.md`](release-process.md)의 체크리스트를 따릅니다.

## Runtime and license notices

For the patched Windows/MinGW validation path, tiles remain disabled and
`TBB_NUM_THREADS=1` remains explicit because parallel tile processing has been
observed to be unstable. Korea OSM PBF data is user-provided and is not
bundled with the application.

The full MIT texts and copyright notices for MOTIS and OSR are tracked in
`docs/licenses/MOTIS-MIT.txt` and `docs/licenses/OSR-MIT.txt` and copied into
every generated distribution.

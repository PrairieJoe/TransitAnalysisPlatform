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

The active builder is the upstream-compatible MSVC `cl.exe` + Ninja path.
Older MinGW compatibility patches remain only as historical failure evidence
and are not active inputs to the release workflow.

## Build

Run from the repository root in a Windows PowerShell with Git, CMake, Ninja,
MSVC `cl.exe`, Node.js, and network access to GitHub:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\motis\build-patched-windows-msvc.ps1 `
  -SourceRoot .\deps `
  -OutputDirectory .\vendor\motis\patched-windows

node .\scripts\motis\verify-patched-build.mjs `
  .\vendor\motis\patched-windows\motis-manifest.json
```

The script resolves the pinned source, applies only the OSR `16 -> 32` patch,
captures the MSVC/Ninja toolchain observation, configures CMake with `cl.exe`,
builds the MOTIS executable/tests/UI, stages the complete VC143 runtime set,
profiles, UI, and licenses, and verifies manifest v2 in explicit `candidate`
mode. It never publishes a Release and never promotes the tracked lock from
`probe` to `locked`.

Candidate validation is separate:

```powershell
npm run motis:validate-release-candidate -- `
  --archive .\path\to\candidate.zip `
  --pbf .\data\osm\south-korea-latest.osm.pbf `
  --build-run-id <build-run-id> `
  --scenario-report .\validation\scenario-report.json `
  --output .\validation\motis-validation-attestation.json
```

The validator uses a temporary extraction directory, binds archive/binary/PBF
and scenario-report SHA-256 values, requires the official 16-way control
diagnostic, and rejects zero access/egress walking. It fails if the exact
candidate archive or nationwide PBF is absent; it does not invent a pass.

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
binary SHA-256 and size, MSVC/CMake/Ninja settings, the complete VC143 runtime
inventory, and the required license files. The verifier checks source/version
metadata, patch values, toolchain identity, paths, hashes, and payload
completeness. Do not package the distribution until the verifier succeeds.

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

The active workflow `.github/workflows/motis-build.yml` is build-only. It
produces a run-specific candidate artifact using MSVC/Ninja and never writes a
Release. After two matching proof runs and a successful nationwide attestation,
`scripts/motis/lock-release-candidate.mjs` promotes the candidate to `locked`.
Only then may `.github/workflows/motis-publish.yml` be manually dispatched with
`build_run_id` and an existing canonical component tag; it downloads that exact artifact, verifies its
hashes and attestation, and publishes without rebuilding.

코드 `main` 병합과 Release asset 발행은 서로 다른 완료 조건입니다. 버전별
workflow 입력값, build·publish job 확인, fresh clone 다운로드 검증은
[`docs/release-process.md`](release-process.md)의 체크리스트를 따릅니다.

## Runtime and license notices

For nationwide validation, tiles remain disabled and `TBB_NUM_THREADS=1` is
explicit. Korea OSM PBF data is user-provided and is not bundled with the
application.

The full MIT texts and copyright notices for MOTIS and OSR are tracked in
`docs/licenses/MOTIS-MIT.txt` and `docs/licenses/OSR-MIT.txt` and copied into
every generated distribution.

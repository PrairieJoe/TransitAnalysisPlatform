# Scenario A–B walking validation — 2026-09-21

## Scope

This report records the first integrated coordinate A–B run after the
`codex/0.6.2-main-integration` handoff. It exercises the v2 endpoint contract,
the full-OSM MOTIS path, and identical Before/After synthetic networks.

The run used the locally available 32-way custom MOTIS binary. It is evidence
for the integrated scenario flow, not a Release attestation for an MSVC/Ninja
candidate.

## Command and inputs

```powershell
npm run test:motis-scenario -- --full-osm `
  --origin-lat 34.7437 --origin-lng 127.7348 `
  --destination-lat 34.7616 --destination-lng 127.6680
```

| Item | Value |
| --- | --- |
| Run artifact | `test-artifacts/motis-scenario/2026-09-21T00-35-22-172Z` |
| Mode | `full-osm` |
| Route fixture | `325000002` |
| Origin | `34.7437,127.7348` (A) |
| Destination | `34.7616,127.6680` (B) |
| Departure | `2026-09-21T08:00` |
| South Korea PBF SHA-256 | `78a5efd96b5e69798797346380f015f86237de754aa0b70d780296ed9a112540` |
| Custom binary SHA-256 | `CFBF19B51AB1EBC89A720EE731AF6BC566311D4D53A83D3919CFE4A56CCDD719` |

The exact serialized endpoint, routing options, network summaries, and raw
response paths are in `scenario-input.json` and `report.json` under the run
artifact directory. The PBF and executable remain local ignored inputs.

## Results

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Route found | yes | yes | — |
| Total time | 2,100 s | 1,980 s | -120 s |
| Access walking | 300 s / 277 m | 300 s / 277 m | 0 s / 0 m |
| Transfer walking | 0 s / 0 m | 0 s / 0 m | 0 s / 0 m |
| Egress walking | 240 s / 205 m | 120 s / 104 m | -120 s / -101 m |
| In-vehicle time | 1,560 s | 1,560 s | 0 s |
| Transfers | 0 | 0 | 0 |

The 37-sample departure window found a route for all 37 Before queries and all
37 After queries. There were no MOTIS warnings or fallback warnings in the
report.

## Related topology evidence

The same PBF's official 16-way failure and the existing custom 32-way
problem-node evidence are recorded in
[`2026-09-21-geofabrik-south-korea-pbf-validation.md`](2026-09-21-geofabrik-south-korea-pbf-validation.md).
That report identifies OSM node `10729381152` with 18 connected ways. The
current run confirms coordinate transit walking; it does not promote the
locally available binary to an MSVC Release candidate.

## Remaining release gate

- Produce and independently repeat the MSVC/Ninja candidate build.
- Run the release validation/attestation flow binding candidate, PBF, and
  scenario report hashes.
- Re-run packaged-app progress, cancellation, and reopen checks with the
  validated candidate before finalizing 0.6.2 Release notes.

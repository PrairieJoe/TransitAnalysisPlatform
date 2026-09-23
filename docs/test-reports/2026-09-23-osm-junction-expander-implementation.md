# OSM junction expander implementation and MOTIS validation — 2026-09-23

## Result

The converter PoC is implemented. It rewrites the single overfull node in the
current South Korea PBF, brings every output candidate node under the 16-way
occurrence bound, and produces a PBF accepted by the official MOTIS v2.11.3
OSR importer. Three real CAR restriction samples below the limit produced
identical route responses on the original-data 32-way candidate and the
converted-data official release.

This is bounded PoC evidence, not certification for all OSM restrictions. The
unmodified official importer cannot load the unconverted nationwide PBF, so
the route comparison uses different MOTIS binaries on its two sides. The
endpoint-to-endpoint queries also do not prove equality of every turn at each
junction.

## Inputs and binary identity

| Asset | Size | SHA-256 / identity |
| --- | ---: | --- |
| `data/osm/south-korea-latest.osm.pbf` | 287,629,706 bytes | `68ed4bbb72e41b73421e28d8282d82e5fc6f4a2cb78a0913b6812d32aa910252` |
| Converted PBF in `test-artifacts/motis-junction-expander/` | 287,629,763 bytes | `f02e80827567e249e0ba1dedacf5f1457d9926f9ae2aa1a1baeb6a04b06dc28e` |
| Official GitHub archive `motis-windows.zip`, release `v2.11.3` | 51,661,516 bytes | `34655045ee02b45f32a7f99f86be3195cb5fa44e1b791ca84ba2eb284a67e3` |
| Extracted official `motis.exe` | 23,229,440 bytes | `42b3520e526a47ca3fb03fedc1a4813dc2c0207e154994d578bc4b565b98318d`; `--version`: `v2.11.3` |
| Local 32-way candidate `motis.exe` | — | `d91627ab9f74959fb97dd2996c5df610059b565d29f95a1358056a4b7b458bff`; `--version`: `v2.11.3-dirty` |

Official source: [MOTIS v2.11.3 GitHub release](https://github.com/motis-project/motis/releases/tag/v2.11.3). General routing coordinate conventions are in the [official v2.11.3 OpenAPI file](https://github.com/motis-project/motis/blob/v2.11.3/openapi.yaml); the one-to-many request format used here was confirmed with live requests to the downloaded release. Download and executable hashes were computed locally; all large binaries, PBFs, and imported data remain in ignored `test-artifacts/`.

The OSR foot-profile source treats `kNoLevel` and numeric level zero as the
same routing level ([`foot.h`](https://github.com/motis-project/osr/blob/master/include/osr/routing/profiles/foot.h#L1062-L1069)). The converter and fixture now follow that rule.

## Conversion result

| Check | Result |
| --- | --- |
| Candidate highway occurrences before conversion | 18 at OSM node `10729381152` |
| Official MOTIS raw-PBF import | Failed with `node 1642860 (osm=10729381152) has 18 ways, maximum is 16` |
| Expanded source node count | 1 |
| Synthetic nodes / connector ways | 5 / 0 |
| Maximum occurrence count after conversion | 3 |
| Converter peak working set observed | 206,114,816 bytes (about 197 MiB) |
| Converter elapsed time | 466.3 seconds |

The 18 occurrences are six separate three-way groups: effective level `0`
(untagged ways), then `level=-1`, `level=1`, `level=2`, `level=3`, and
`level=4`. OSR treats untagged and numeric level zero as the same foot-routing
level; the converter now normalizes them into one group. Each distinct level
has its own node ID, and no connector is added between levels. This matches
the actual PBF shape and is covered by a fixture mixing untagged and `level=0`
ways.

## Official import performance

Both benchmark imports used `--filter osr` and one thread on the same machine.
The official release imported the converted PBF; the local 32-way candidate
imported the original PBF.

| Import | Exit | Elapsed | Peak working set |
| --- | ---: | ---: | ---: |
| Official v2.11.3 + converted PBF | 0 | 5,734 ms | 4,956,459,008 bytes (4.62 GiB) |
| Local 32-way candidate + original PBF | 0 | 6,249 ms | 4,737,331,200 bytes (4.41 GiB) |
| Official v2.11.3 + original PBF | 1 | 3,351 ms | Not measured |

The successful imports are close in elapsed time in this one-run sample. The
official converted import used about 209 MiB more peak working set. Different
binaries and a single sample mean these figures are indicative, not a
statistically controlled performance claim. The raw official import fails at
the 18-way node, as expected.

Detailed import measurements and logs are under
`test-artifacts/motis-junction-expander/import-benchmarks/20260923T002251425Z/`.

## Real restricted-road route comparison

Each relation has at most four highway-way occurrences at its via node. For
each sample we queried both directions with CAR, `arriveBy=false`,
`maxMatchingDistance=30`, and `max=30` / `max=3600`. The one-to-many coordinate
strings use `latitude;longitude` in the v2.11.3 endpoint. Both servers returned
HTTP 200 for all 12 requests. The response bodies match exactly.

| Relation / restriction | Occurrences | Forward (`max=30` / `3600`) | Reverse (`max=30` / `3600`) | Result |
| --- | ---: | --- | --- | --- |
| `370748` / `no_left_turn` | 4 | no duration / 64 s | 9 s / 9 s | Identical |
| `2869314` / `only_straight_on` | 4 | no duration / 43 s | no duration / 79 s | Identical |
| `3217282` / `no_u_turn` | 3 | 60 s / 60 s | 60 s / 60 s | Identical |

The third sample returns 60 seconds despite `max=30`; therefore that request
limit is not treated as a strict response cutoff in this observation. These
are full-network shortest-route queries between nearby points. They validate
that the selected real-road responses did not change, but they cannot rule out
all alternate-path or snap effects and are not a substitute for an exact
turn-transition comparison.

Raw route responses are saved in
`test-artifacts/motis-junction-expander/route-comparison/{patched-32-original,official-16-expanded}/routes.json`.

## Code and automated checks

- Added the streaming PyOsmium converter in `scripts/motis/osm_junction_expander.py`. It uses a SQLite-backed occurrence index, deterministic synthetic IDs, separate output, and a post-write count check. It leaves nodes with 16 or fewer candidate occurrences unchanged and fails closed for unsupported restrictions, access signatures, repeated node references, or ambiguous level semantics.
- Added nine compact PBF fixture tests covering 15/16/17/18/32/33 boundaries, unrestricted connectivity, mixed untagged/zero/indoor levels, preserved static restriction relations below the limit, deterministic output, and rejection of unsupported cases.
- Added a reproducible official-vs-candidate OSR import benchmark script at `scripts/motis/benchmark-junction-expander.ps1`.
- Focused Python suite: **9 tests passed**.
- Project suite: **98 test files / 515 tests passed**.
- `npm run typecheck`: passed.
- `npm run build`: passed; Vite emitted its existing non-blocking Leaflet dynamic/static import chunk warning.
- `git diff --check`: passed.

The latest full-map conversion log is `test-artifacts/motis-junction-expander/expand.log`; process samples and import measurements remain alongside it in the same ignored artifact directory.

## Remaining verification

Before treating this as a general-purpose vehicle-network transformer, add
exact directed-transition comparisons for `oneway=-1`, overlapping and
vehicle-specific restrictions, `except`, conditional restrictions, via-way
relations, and barrier/tagged junctions. These cases remain unsupported or
unverified; the converter currently rejects ambiguous affected inputs instead
of rewriting them. Product packaging has not been switched to the official
MOTIS binary.

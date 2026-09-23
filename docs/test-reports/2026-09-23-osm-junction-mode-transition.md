# Mode-specific directed junction transition validation

Generated fixtures: **41**
PBF writer: `scripts/motis/osm_junction_fixture_generator.py`
Expander: `scripts/motis/osm_junction_expander.py`

This run uses synthetic OSM/PBF fixtures. The independent observed-graph reader does not apply oracle-only level/layer expectations while calculating actual transitions.
The expander derives CAR/BIKE/FOOT directed transition sets, then compiles those sets into bounded one-way fan-out/fan-in paths.

## Semantic classification change

The retained 41-fixture baseline was GREEN 23 / YELLOW 5 / RED 13. This run is GREEN 35 / YELLOW 3 / RED 3: 12 fixtures moved into GREEN, 2 moved from YELLOW to GREEN, and 10 moved from RED to GREEN. The two mixed-level pairs moved from YELLOW to GREEN. Ten over-limit static no/only, oneway/access, and multiple-restriction fixtures moved from RED to GREEN. The three 12-way conditional, via-way, and malformed fixtures remain YELLOW; their 20-way counterparts remain fail-closed RED.

All normal fixture families in scope have zero independent transition-matrix mismatch after transformation across CAR, BIKE, and FOOT. The original input and transformed PBF are generated only from the declarative synthetic catalog.

## Test verification

- 22 unit and synthetic PBF tests passed.
- Force-expanded 12-way pairs compare against the same official MOTIS binary on original and transformed PBFs. For over-limit pairs, the existing patched/custom MOTIS binary is used only on the original PBF; official MOTIS reads the transformed PBF. No MOTIS binary was rebuilt.
- Each transformed output checks every touched node, including retained exterior endpoints, against the 16-way occurrence limit.

## MOTIS route reference

| Result | Fixture count |
| --- | ---: |
| GREEN | 13 |
| YELLOW | 18 |
| SKIPPED | 3 |

## Aggregated directed route cost matrices

The full row-major cost matrices for every directed off-diagonal approach pair are in [`2026-09-23-osm-junction-mode-transition-cost-matrices.json`](2026-09-23-osm-junction-mode-transition-cost-matrices.json). `null` means unreachable; diagonal cells are excluded. Query points use fixture exterior endpoint node coordinates with `maxMatchingDistance=5m`. Route reachability is separate evidence from the independent PBF semantic verifier.

| Measure | Result |
| --- | ---: |
| Route comparisons | 31 (GREEN 13 / YELLOW 18 / SKIPPED 3) |
| Expected / before / after transition count | 22436 / 22854 / 22936 |
| Reachability mismatch count | 82 |
| Forbidden transition mismatch count | 500 (before 418; after 500) |
| Cost samples | 22854 |
| Max / mean / p95 absolute cost delta | 1028.000 / 40.552 / 168.000 seconds |

The YELLOW route comparisons show differences in the router reference matrices even where the independent PBF graph verifier reports exact transition equivalence. The fixture table keeps these two results separate.

Endpoint route matrices are reference evidence and can be affected by coordinate snapping at co-located nodes.

## Classification

| Fixture | Ways | Max touched-node occurrences | Production result | Force-expand probe | Route result | Transitions expected / before / after | Reachability mismatch | Forbidden mismatch | Max / mean / p95 cost delta (s) |
| --- | ---: | ---: | --- | --- | --- | ---: | ---: | ---: | --- |
| `unrestricted-15` | 15 | — | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | not run | — | — | — | — |
| `unrestricted-16` | 16 | — | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | not run | — | — | — | — |
| `unrestricted-17` | 17 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | not run | — | — | — | — |
| `unrestricted-18` | 18 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | not run | — | — | — | — |
| `unrestricted-32` | 32 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | not run | — | — | — | — |
| `unrestricted-33` | 33 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | not run | — | — | — | — |
| `unrestricted-64` | 64 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | not run | — | — | — | — |
| `unrestricted-carrier-12` | 12 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | GREEN: transition matrix, occurrence bound, and untouched elements verified | GREEN | 396 / 396 / 396 | 0 | 0 | 170.000 / 35.707 / 169.000 |
| `unrestricted-carrier-20` | 20 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | GREEN | 1140 / 1140 / 1140 | 0 | 0 | 169.000 / 42.014 / 167.000 |
| `no_left_turn-12` | 12 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | GREEN: transition matrix, occurrence bound, and untouched elements verified | YELLOW | 395 / 395 / 396 | 1 | 1 | 170.000 / 35.797 / 169.000 |
| `no_left_turn-20` | 20 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | YELLOW | 1139 / 1139 / 1140 | 1 | 1 | 170.000 / 44.982 / 168.000 |
| `no_right_turn-12` | 12 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | GREEN: transition matrix, occurrence bound, and untouched elements verified | YELLOW | 395 / 395 / 396 | 1 | 1 | 170.000 / 35.797 / 169.000 |
| `no_right_turn-20` | 20 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | YELLOW | 1139 / 1139 / 1140 | 1 | 1 | 170.000 / 44.982 / 168.000 |
| `no_straight_on-12` | 12 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | GREEN: transition matrix, occurrence bound, and untouched elements verified | YELLOW | 395 / 395 / 396 | 1 | 1 | 170.000 / 35.797 / 169.000 |
| `no_straight_on-20` | 20 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | YELLOW | 1139 / 1139 / 1140 | 1 | 1 | 170.000 / 44.982 / 168.000 |
| `no_u_turn-12` | 12 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | GREEN: transition matrix, occurrence bound, and untouched elements verified | GREEN | 396 / 396 / 396 | 0 | 0 | 170.000 / 35.707 / 169.000 |
| `no_u_turn-20` | 20 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | GREEN | 1140 / 1140 / 1140 | 0 | 0 | 170.000 / 44.942 / 168.000 |
| `only_left_turn-12` | 12 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | GREEN: transition matrix, occurrence bound, and untouched elements verified | YELLOW | 386 / 386 / 396 | 10 | 10 | 170.000 / 36.715 / 169.000 |
| `only_left_turn-20` | 20 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | YELLOW | 1122 / 1126 / 1140 | 14 | 18 | 169.000 / 45.496 / 168.000 |
| `only_right_turn-12` | 12 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | GREEN: transition matrix, occurrence bound, and untouched elements verified | YELLOW | 386 / 386 / 396 | 10 | 10 | 170.000 / 36.715 / 169.000 |
| `only_right_turn-20` | 20 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | YELLOW | 1122 / 1126 / 1140 | 14 | 18 | 169.000 / 45.496 / 168.000 |
| `only_straight_on-12` | 12 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | GREEN: transition matrix, occurrence bound, and untouched elements verified | YELLOW | 386 / 386 / 396 | 10 | 10 | 170.000 / 36.715 / 169.000 |
| `only_straight_on-20` | 20 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | YELLOW | 1122 / 1126 / 1140 | 14 | 18 | 169.000 / 45.496 / 168.000 |
| `mixed_oneway-12` | 12 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | GREEN: transition matrix, occurrence bound, and untouched elements verified | YELLOW | 375 / 396 / 396 | 0 | 21 | 170.000 / 36.063 / 168.000 |
| `mixed_oneway-20` | 20 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | YELLOW | 1103 / 1140 / 1140 | 0 | 37 | 168.000 / 42.336 / 168.000 |
| `mixed_mode_access-12` | 12 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | GREEN: transition matrix, occurrence bound, and untouched elements verified | YELLOW | 270 / 396 / 396 | 0 | 126 | 888.000 / 61.727 / 708.000 |
| `mixed_mode_access-20` | 20 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | YELLOW | 918 / 1140 / 1140 | 0 | 222 | 1028.000 / 66.267 / 173.000 |
| `mixed_level-12` | 12 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | GREEN: transition matrix, occurrence bound, and untouched elements verified | GREEN | 324 / 324 / 324 | 0 | 0 | 170.000 / 24.191 / 167.000 |
| `mixed_level-20` | 20 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | GREEN | 940 / 940 / 940 | 0 | 0 | 170.000 / 27.637 / 167.000 |
| `mixed_layer-12` | 12 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | GREEN: transition matrix, occurrence bound, and untouched elements verified | GREEN | 396 / 396 / 396 | 0 | 0 | 170.000 / 35.707 / 169.000 |
| `mixed_layer-20` | 20 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | GREEN | 1140 / 1140 / 1140 | 0 | 0 | 169.000 / 42.014 / 167.000 |
| `bridge_tunnel_crossing-12` | 12 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | GREEN: transition matrix, occurrence bound, and untouched elements verified | GREEN | 396 / 396 / 396 | 0 | 0 | 170.000 / 36.030 / 169.000 |
| `bridge_tunnel_crossing-20` | 20 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | GREEN | 1140 / 1140 / 1140 | 0 | 0 | 169.000 / 41.658 / 167.000 |
| `restriction_conditional-12` | 12 | — | **YELLOW**: relation 9000 has conditional restriction semantics | — | GREEN | 396 / 396 / 396 | 0 | 0 | 0.000 / 0.000 / 0.000 |
| `restriction_conditional-20` | 20 | — | **RED**: fail-closed with object ID: relation 9000 has unsupported conditional restriction semantics | — | SKIPPED | — | — | — | — |
| `via_way_restriction-12` | 12 | — | **YELLOW**: relation 9000 is a via-way or non-via-node restriction | — | GREEN | 396 / 396 / 396 | 0 | 0 | 0.000 / 0.000 / 0.000 |
| `via_way_restriction-20` | 20 | — | **RED**: fail-closed with object ID: relation 9000 is not a static via-node restriction | — | SKIPPED | — | — | — | — |
| `malformed_restriction-12` | 12 | — | **YELLOW**: relation 9000 has malformed restriction member roles | — | GREEN | 396 / 396 / 396 | 0 | 0 | 0.000 / 0.000 / 0.000 |
| `malformed_restriction-20` | 20 | — | **RED**: fail-closed with object ID: relation 9000 has malformed restriction member roles | — | SKIPPED | — | — | — | — |
| `multiple_static_restrictions-12` | 12 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | GREEN: transition matrix, occurrence bound, and untouched elements verified | YELLOW | 394 / 394 / 396 | 2 | 2 | 170.000 / 31.609 / 168.000 |
| `multiple_static_restrictions-24` | 24 | 6 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | YELLOW | 1654 / 1654 / 1656 | 2 | 2 | 172.000 / 45.005 / 170.000 |

## Totals

- **GREEN:** 35
- **YELLOW:** 3
- **RED:** 3

## Run limits

Baseline held from the previous run: GREEN 23 / YELLOW 5 / RED 13 across 41 fixtures. GREEN/YELLOW/RED classify the independent local PBF transition matrix, retained occurrence bound, structural checks, and fail-closed boundaries. RED means the current converter rejected the fixture before publishing output and named the affected OSM object. YELLOW means an observed transition mismatch, semantics that this static graph checker cannot certify, or a MOTIS route-matrix discrepancy. Optional official/patched MOTIS route comparisons run only when both existing binary paths are supplied. MOTIS route-reference mismatches and cost deltas are kept in route_comparison and do not change the semantic classification. MOTIS endpoint routing uses snapped coordinates and is reference evidence, not proof of every exact turn.

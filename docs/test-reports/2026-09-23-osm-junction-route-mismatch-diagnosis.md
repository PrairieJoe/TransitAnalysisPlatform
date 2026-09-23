# Junction route mismatch diagnosis — 2026-09-23

## Controlled 12-way comparison

All 17 paired 12-way fixtures were compared with the same official MOTIS v2.11.3 binary (`42b3520e…`). The original and force-expanded/transformed PBFs were imported independently into that same binary. There are 132 off-diagonal directed pairs per mode, 6,732 pair cells across all 17 fixtures and three modes. The independent transition verifier still reports equal transition sets; the route engine does not.

| Mode | Pairs | Before reachable | After reachable | Mismatches | Newly reachable | Newly unreachable | Common reachable | Endpoint cost Δ max / mean / p95 (s) | 35m cost Δ max / mean / p95 (s) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| motorcar | 2,244 | 2,209 | 2,244 | 35 | 35 | 0 | 2,209 | 66 / 5.70 / 32 | 66 / 24.70 / 52 |
| bicycle | 2,244 | 2,244 | 2,244 | 0 | 0 | 0 | 2,244 | 35 / 3.31 / 4 | 65 / 22.57 / 60 |
| foot | 2,244 | 2,172 | 2,172 | 0 | 0 | 0 | 2,172 | 888 / 83.16 / 169 | 990 / 181.41 / 387 |

All 35 reachability mismatches are newly reachable CAR pairs. There are no newly unreachable pairs. The deterministic interior-query matrix produced exactly the same before/after reachability sets as endpoint queries in all 51 fixture-mode matrices. No cost correction was attempted while these forbidden-transition mismatches remain.

## Per-fixture, per-mode matrices

`Δ max / mean / p95` is the absolute duration delta on common-reachable pairs. Each cell has 132 directed pairs. Endpoint and 35m-interior results are shown side by side.

| Fixture | Mode | Before → after reachable | Endpoint mismatch (new/lost) | Endpoint common | Endpoint Δ max / mean / p95 | 35m mismatch (new/lost) | 35m common | 35m Δ max / mean / p95 | Newly reachable source ways |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| `bridge_tunnel_crossing-12` | motorcar | 132 → 132 | 0 (0/0) | 132 | 32 / 7.03 / 32 | 0 (0/0) | 132 | 56 / 29.82 / 52 | — |
| `bridge_tunnel_crossing-12` | bicycle | 132 → 132 | 0 (0/0) | 132 | 4 / 4.00 / 4 | 0 (0/0) | 132 | 62 / 27.42 / 60 | — |
| `bridge_tunnel_crossing-12` | foot | 132 → 132 | 0 (0/0) | 132 | 170 / 97.06 / 169 | 0 (0/0) | 132 | 405 / 217.47 / 387 | — |
| `malformed_restriction-12` | motorcar | 132 → 132 | 0 (0/0) | 132 | 0 / 0.00 / 0 | 0 (0/0) | 132 | 0 / 0.00 / 0 | — |
| `malformed_restriction-12` | bicycle | 132 → 132 | 0 (0/0) | 132 | 0 / 0.00 / 0 | 0 (0/0) | 132 | 0 / 0.00 / 0 | — |
| `malformed_restriction-12` | foot | 132 → 132 | 0 (0/0) | 132 | 0 / 0.00 / 0 | 0 (0/0) | 132 | 0 / 0.00 / 0 | — |
| `mixed_layer-12` | motorcar | 132 → 132 | 0 (0/0) | 132 | 32 / 6.06 / 32 | 0 (0/0) | 132 | 56 / 29.82 / 52 | — |
| `mixed_layer-12` | bicycle | 132 → 132 | 0 (0/0) | 132 | 4 / 4.00 / 4 | 0 (0/0) | 132 | 62 / 27.42 / 60 | — |
| `mixed_layer-12` | foot | 132 → 132 | 0 (0/0) | 132 | 170 / 97.06 / 169 | 0 (0/0) | 132 | 405 / 217.47 / 387 | — |
| `mixed_level-12` | motorcar | 132 → 132 | 0 (0/0) | 132 | 66 / 11.39 / 34 | 0 (0/0) | 132 | 66 / 33.24 / 60 | — |
| `mixed_level-12` | bicycle | 132 → 132 | 0 (0/0) | 132 | 4 / 4.00 / 4 | 0 (0/0) | 132 | 64 / 27.30 / 60 | — |
| `mixed_level-12` | foot | 60 → 60 | 0 (0/0) | 60 | 170 / 96.77 / 169 | 0 (0/0) | 60 | 398 / 213.37 / 370 | — |
| `mixed_mode_access-12` | motorcar | 132 → 132 | 0 (0/0) | 132 | 32 / 7.68 / 32 | 0 (0/0) | 132 | 58 / 28.77 / 54 | — |
| `mixed_mode_access-12` | bicycle | 132 → 132 | 0 (0/0) | 132 | 35 / 4.17 / 5 | 0 (0/0) | 132 | 65 / 27.50 / 62 | — |
| `mixed_mode_access-12` | foot | 132 → 132 | 0 (0/0) | 132 | 888 / 173.33 / 804 | 0 (0/0) | 132 | 990 / 312.74 / 900 | — |
| `mixed_oneway-12` | motorcar | 132 → 132 | 0 (0/0) | 132 | 32 / 7.42 / 32 | 0 (0/0) | 132 | 54 / 29.98 / 52 | — |
| `mixed_oneway-12` | bicycle | 132 → 132 | 0 (0/0) | 132 | 5 / 4.08 / 5 | 0 (0/0) | 132 | 64 / 27.39 / 60 | — |
| `mixed_oneway-12` | foot | 132 → 132 | 0 (0/0) | 132 | 170 / 96.68 / 169 | 0 (0/0) | 132 | 404 / 184.35 / 380 | — |
| `multiple_static_restrictions-12` | motorcar | 130 → 132 | 2 (2/0) | 130 | 32 / 6.65 / 32 | 2 (2/0) | 130 | 56 / 29.83 / 52 | 2000→2007, 2002→2007 |
| `multiple_static_restrictions-12` | bicycle | 132 → 132 | 0 (0/0) | 132 | 4 / 4.00 / 4 | 0 (0/0) | 132 | 64 / 27.39 / 60 | — |
| `multiple_static_restrictions-12` | foot | 132 → 132 | 0 (0/0) | 132 | 170 / 83.80 / 169 | 0 (0/0) | 132 | 398 / 216.18 / 379 | — |
| `no_left_turn-12` | motorcar | 131 → 132 | 1 (1/0) | 131 | 32 / 6.11 / 32 | 1 (1/0) | 131 | 54 / 29.80 / 52 | 2000→2007 |
| `no_left_turn-12` | bicycle | 132 → 132 | 0 (0/0) | 132 | 4 / 4.00 / 4 | 0 (0/0) | 132 | 64 / 27.39 / 60 | — |
| `no_left_turn-12` | foot | 132 → 132 | 0 (0/0) | 132 | 170 / 97.06 / 169 | 0 (0/0) | 132 | 405 / 217.47 / 387 | — |
| `no_right_turn-12` | motorcar | 131 → 132 | 1 (1/0) | 131 | 32 / 6.11 / 32 | 1 (1/0) | 131 | 54 / 29.80 / 52 | 2000→2005 |
| `no_right_turn-12` | bicycle | 132 → 132 | 0 (0/0) | 132 | 4 / 4.00 / 4 | 0 (0/0) | 132 | 64 / 27.39 / 60 | — |
| `no_right_turn-12` | foot | 132 → 132 | 0 (0/0) | 132 | 170 / 97.06 / 169 | 0 (0/0) | 132 | 405 / 217.47 / 387 | — |
| `no_straight_on-12` | motorcar | 131 → 132 | 1 (1/0) | 131 | 32 / 6.11 / 32 | 1 (1/0) | 131 | 54 / 29.89 / 52 | 2000→2006 |
| `no_straight_on-12` | bicycle | 132 → 132 | 0 (0/0) | 132 | 4 / 4.00 / 4 | 0 (0/0) | 132 | 64 / 27.39 / 60 | — |
| `no_straight_on-12` | foot | 132 → 132 | 0 (0/0) | 132 | 170 / 97.06 / 169 | 0 (0/0) | 132 | 405 / 217.47 / 387 | — |
| `no_u_turn-12` | motorcar | 132 → 132 | 0 (0/0) | 132 | 32 / 6.06 / 32 | 0 (0/0) | 132 | 54 / 29.82 / 52 | — |
| `no_u_turn-12` | bicycle | 132 → 132 | 0 (0/0) | 132 | 4 / 4.00 / 4 | 0 (0/0) | 132 | 64 / 27.39 / 60 | — |
| `no_u_turn-12` | foot | 132 → 132 | 0 (0/0) | 132 | 170 / 97.06 / 169 | 0 (0/0) | 132 | 405 / 217.47 / 387 | — |
| `only_left_turn-12` | motorcar | 122 → 132 | 10 (10/0) | 122 | 32 / 6.82 / 32 | 10 (10/0) | 122 | 54 / 30.31 / 52 | 2000→2001, 2000→2002, 2000→2003, 2000→2004, 2000→2005, 2000→2006, 2000→2008, 2000→2009, 2000→2010, 2000→2011 |
| `only_left_turn-12` | bicycle | 132 → 132 | 0 (0/0) | 132 | 4 / 4.00 / 4 | 0 (0/0) | 132 | 64 / 27.42 / 60 | — |
| `only_left_turn-12` | foot | 132 → 132 | 0 (0/0) | 132 | 170 / 97.06 / 169 | 0 (0/0) | 132 | 405 / 217.47 / 387 | — |
| `only_right_turn-12` | motorcar | 122 → 132 | 10 (10/0) | 122 | 32 / 6.82 / 32 | 10 (10/0) | 122 | 54 / 30.23 / 52 | 2000→2001, 2000→2002, 2000→2003, 2000→2004, 2000→2006, 2000→2007, 2000→2008, 2000→2009, 2000→2010, 2000→2011 |
| `only_right_turn-12` | bicycle | 132 → 132 | 0 (0/0) | 132 | 4 / 4.00 / 4 | 0 (0/0) | 132 | 64 / 27.42 / 60 | — |
| `only_right_turn-12` | foot | 132 → 132 | 0 (0/0) | 132 | 170 / 97.06 / 169 | 0 (0/0) | 132 | 405 / 217.47 / 387 | — |
| `only_straight_on-12` | motorcar | 122 → 132 | 10 (10/0) | 122 | 32 / 6.82 / 32 | 10 (10/0) | 122 | 54 / 30.21 / 52 | 2000→2001, 2000→2002, 2000→2003, 2000→2004, 2000→2005, 2000→2007, 2000→2008, 2000→2009, 2000→2010, 2000→2011 |
| `only_straight_on-12` | bicycle | 132 → 132 | 0 (0/0) | 132 | 4 / 4.00 / 4 | 0 (0/0) | 132 | 64 / 27.42 / 60 | — |
| `only_straight_on-12` | foot | 132 → 132 | 0 (0/0) | 132 | 170 / 97.06 / 169 | 0 (0/0) | 132 | 405 / 217.47 / 387 | — |
| `restriction_conditional-12` | motorcar | 132 → 132 | 0 (0/0) | 132 | 0 / 0.00 / 0 | 0 (0/0) | 132 | 0 / 0.00 / 0 | — |
| `restriction_conditional-12` | bicycle | 132 → 132 | 0 (0/0) | 132 | 0 / 0.00 / 0 | 0 (0/0) | 132 | 0 / 0.00 / 0 | — |
| `restriction_conditional-12` | foot | 132 → 132 | 0 (0/0) | 132 | 0 / 0.00 / 0 | 0 (0/0) | 132 | 0 / 0.00 / 0 | — |
| `unrestricted-carrier-12` | motorcar | 132 → 132 | 0 (0/0) | 132 | 32 / 6.06 / 32 | 0 (0/0) | 132 | 56 / 29.82 / 52 | — |
| `unrestricted-carrier-12` | bicycle | 132 → 132 | 0 (0/0) | 132 | 4 / 4.00 / 4 | 0 (0/0) | 132 | 62 / 27.42 / 60 | — |
| `unrestricted-carrier-12` | foot | 132 → 132 | 0 (0/0) | 132 | 170 / 97.06 / 169 | 0 (0/0) | 132 | 405 / 217.47 / 387 | — |
| `via_way_restriction-12` | motorcar | 132 → 132 | 0 (0/0) | 132 | 0 / 0.00 / 0 | 0 (0/0) | 132 | 0 / 0.00 / 0 | — |
| `via_way_restriction-12` | bicycle | 132 → 132 | 0 (0/0) | 132 | 0 / 0.00 / 0 | 0 (0/0) | 132 | 0 / 0.00 / 0 | — |
| `via_way_restriction-12` | foot | 132 → 132 | 0 (0/0) | 132 | 0 / 0.00 / 0 | 0 (0/0) | 132 | 0 / 0.00 / 0 | — |

## Mismatch fixture concentration

| Fixture | Mode | New directed pairs | Endpoint after duration (s) | 35m interior after duration (s) |
|---|---|---|---|---|
| `multiple_static_restrictions-12` | CAR | way 2000 → 2007 | 33 | 44 |
| `multiple_static_restrictions-12` | CAR | way 2002 → 2007 | 36 | 38 |
| `no_left_turn-12` | CAR | way 2000 → 2007 | 33 | 44 |
| `no_right_turn-12` | CAR | way 2000 → 2005 | 33 | 44 |
| `no_straight_on-12` | CAR | way 2000 → 2006 | 32 | 32 |
| `only_left_turn-12` | CAR | way 2000 → 2001 | 65 | 34 |
| `only_left_turn-12` | CAR | way 2000 → 2002 | 67 | 38 |
| `only_left_turn-12` | CAR | way 2000 → 2003 | 68 | 44 |
| `only_left_turn-12` | CAR | way 2000 → 2004 | 67 | 12 |
| `only_left_turn-12` | CAR | way 2000 → 2005 | 33 | 34 |
| `only_left_turn-12` | CAR | way 2000 → 2006 | 32 | 32 |
| `only_left_turn-12` | CAR | way 2000 → 2008 | 35 | 38 |
| `only_left_turn-12` | CAR | way 2000 → 2009 | 36 | 12 |
| `only_left_turn-12` | CAR | way 2000 → 2010 | 35 | 38 |
| `only_left_turn-12` | CAR | way 2000 → 2011 | 65 | 12 |
| `only_right_turn-12` | CAR | way 2000 → 2001 | 65 | 34 |
| `only_right_turn-12` | CAR | way 2000 → 2002 | 67 | 38 |
| `only_right_turn-12` | CAR | way 2000 → 2003 | 68 | 44 |
| `only_right_turn-12` | CAR | way 2000 → 2004 | 67 | 12 |
| `only_right_turn-12` | CAR | way 2000 → 2006 | 32 | 32 |
| `only_right_turn-12` | CAR | way 2000 → 2007 | 33 | 44 |
| `only_right_turn-12` | CAR | way 2000 → 2008 | 35 | 38 |
| `only_right_turn-12` | CAR | way 2000 → 2009 | 36 | 12 |
| `only_right_turn-12` | CAR | way 2000 → 2010 | 35 | 38 |
| `only_right_turn-12` | CAR | way 2000 → 2011 | 65 | 12 |
| `only_straight_on-12` | CAR | way 2000 → 2001 | 65 | 34 |
| `only_straight_on-12` | CAR | way 2000 → 2002 | 67 | 38 |
| `only_straight_on-12` | CAR | way 2000 → 2003 | 68 | 44 |
| `only_straight_on-12` | CAR | way 2000 → 2004 | 67 | 12 |
| `only_straight_on-12` | CAR | way 2000 → 2005 | 33 | 34 |
| `only_straight_on-12` | CAR | way 2000 → 2007 | 33 | 44 |
| `only_straight_on-12` | CAR | way 2000 → 2008 | 35 | 38 |
| `only_straight_on-12` | CAR | way 2000 → 2009 | 36 | 12 |
| `only_straight_on-12` | CAR | way 2000 → 2010 | 35 | 38 |
| `only_straight_on-12` | CAR | way 2000 → 2011 | 65 | 12 |

Counts: `no_left_turn` 1, `no_right_turn` 1, `no_straight_on` 1, the three `only_*` fixtures 10 each, and `multiple_static_restrictions` 2. `no_u_turn`, unrestricted, access, oneway, level/layer, and bridge/tunnel had zero reachability mismatches in this controlled 12-way comparison.

## Minimum route traces

### `no_left_turn-12`, CAR, way 2000 → way 2007

- Original relation 9000 says `no_left_turn` via node 100 for from-way 2000 to to-way 2007. The transformed PBF has no relation 9000; its synthetic graph is meant to encode the same allowed transitions.
- At the original endpoint coordinates `(37.0000000,127.0010000) → (36.9995000,126.9991340)`, before is no-path and after is 33s.
- At deterministic points 35m from the junction `(37.0000000,127.0003937) → (36.9998158,126.9996810)`, before is no-path and after is 44s.
- The exact endpoint after path contains synthetic way IDs `10652, 10654, 10665, 10668, 10669, 10682, 10542, 10540, 10538`. Those PBF ways are foot-only (`motorcar=no`, `motor_vehicle=no`, `bicycle=no`, `foot=yes`).
- The 35m path starts through bicycle-only ways `9957, 9959, 9961, 9979, 9685, 9683, 9681, 9680`, then uses the foot-only ways above. Way 9680 and foot way 10652 both include original endpoint node 1000, so the mode-clone switch is at shared OSM topology.
- Before route snap/path is unavailable on this forbidden pair because MOTIS returns no route. After route feature 0 from the stable start ends at `(126.9999955,37.0000000)` before the bicycle-clone path.

An allowed control pair on the same fixture, way 2000 → 2001, stays reachable both sides (endpoint cost 33s→33s) but its 35m query shifts from 12s before to 34s after and its after route uses bicycle-only clones.

Other minimized examples are in the JSON artifact: `only_left_turn-12` way 2000→2001 is forbidden before but after is 65s at endpoints / 34s at 35m; `multiple_static_restrictions-12` way 2002→2007 is forbidden before but after is 36s / 38s.

## Hypothesis results

| Hypothesis | Result | Evidence |
|---|---|---|
| A. Endpoint snapping | Contributes; not sufficient to explain the mismatch | All 35 pairs remain with points 35m from the junction. The selected after-path clones differ between endpoint and interior points. |
| B. Synthetic geometry/approach selection | Confirmed exposure path | Parallel mode clones share physical approach geometry and exterior OSM endpoints. The traced stable path changes from bicycle clone to foot clone at shared node 1000. |
| C. Connector routing cost | Cost effect, not reachability cause | Reachability remains wrong after moving queries. Cost deltas rise on some common pairs, but cost tuning was deferred. |
| D. Restriction relation rewrite | Not the immediate bypass | Relation 9000 is removed and directed topology is intended to encode it; the violating path bypasses that CAR topology by using other mode clones. |
| E. Mode/profile OSR semantics | Primary observed cause | An official MOTIS `profile=car` route traverses generated way features whose PBF tags explicitly deny motorcar/motor_vehicle and allow only bicycle or foot. Exact internal tag-precedence behavior remains unproven. |

Observed failure mechanism: static restriction equivalence in the independent graph verifier does not imply route equivalence after import. The transformed PBF contains CAR/BIKE/FOOT copies attached to shared exterior OSM nodes; the official CAR route can travel through copies tagged for BIKE/FOOT. Removing the source restriction then leaves that alternate cross-clone path available.

## Existing total of 82 mismatches

| Comparison slice | Fixture concentration | Mode | Count | Reference |
|---|---|---|---:|---|
| 12-way | 3 `no_*` (1 each), 3 `only_*` (10 each), multiple static (2) | CAR | 35 | Official vs official |
| 20-way | 3 `no_*` (1 each), 3 `only_*` (14 each) | CAR | 45 | Patched/custom original vs official transformed |
| 24-way | multiple static restrictions (2) | CAR | 2 | Patched/custom original vs official transformed |
| **Total** |  | **CAR** | **82** |  |

The 20/24-way rows above come from already saved route-matrix artifacts and were not path-traced in this turn. They are binary-confounded and cannot be assigned the confirmed 12-way root cause yet. All 82 saved mismatches are newly reachable; BIKE and FOOT contribute zero.

## Remaining mismatch

35 controlled 12-way CAR transitions remain reachable when they should be forbidden, before and after query stabilization. The 20/24-way 47 mismatches remain untraced. The next diagnostic step should isolate how the official OSR CAR profile interprets the generated mode access tags and shared exterior nodes; the expander was not changed.

## Machine-readable data

- Full per-fixture/mode metrics and mismatch pairs: `docs/test-reports/2026-09-23-osm-junction-route-mismatch-diagnosis.json`
- Endpoint matrices: `C:/Users/User/Desktop/Study/TransitAnalysisPlatform/.tmp-osm-junction-transition-run-compliant-20260923/route-comparisons`
- 35m matrices: `C:/Users/User/Desktop/Study/TransitAnalysisPlatform/.tmp-osm-junction-route-diagnosis-20260923/route-comparisons`

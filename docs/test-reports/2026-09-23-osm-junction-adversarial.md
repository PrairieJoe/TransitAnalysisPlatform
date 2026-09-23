# Synthetic OSM junction adversarial run

Generated fixtures: **41**
PBF writer: `scripts/motis/osm_junction_fixture_generator.py`
Expander: `scripts/motis/osm_junction_expander.py`

This run uses synthetic OSM/PBF fixtures. The independent observed-graph reader does not apply oracle-only level/layer expectations while calculating actual transitions.

All inputs in this run were generated from the declarative synthetic catalog.
The South Korea PBF was not read or written. Generated PBFs and route imports
were temporary and are not checked in.

## Observed support boundary

The direct graph verifier uses OSM node references, direction, access, and
static restriction relations to calculate actual transitions independently
of its hand-authored oracle. It found that a shared-node mixed-`level`
junction is connected in the original graph, while the current expander splits
its levels. The 12-way force-expand test loses 72 off-diagonal CAR/BIKE
transitions; the 20-way test loses 200. Foot routing remains equal. Both cases
are YELLOW, so the converter should not be treated as preserving these vehicle
semantics.

The existing official and custom MOTIS executables were used for all eight
available 12/20-way route comparisons: six matched and both mixed-`level`
comparisons differed. At 12 ways, official MOTIS was used on both the original
and force-expanded PBF. At 20 ways, the custom executable used the original
and official MOTIS used the transformed PBF. Other relation/access fixtures
have no transformed PBF because forced or production expansion correctly
failed closed. Route checks use snapped endpoint coordinates and can miss a
turn mismatch at co-located nodes; the independent graph transition matrix is
the primary check.

Static no/only turn relations at 12 ways are copied unchanged and pass the
matrix verifier. Forcing expansion at a lower test threshold fails closed
with the relation ID; 20-way versions also fail closed. Mixed oneway and
mode-access cases follow the same pattern, with affected way IDs in the
reason. Conditional, via-way, and malformed relations at 12 ways are copied
but marked YELLOW as unverified; their over-limit versions fail closed.
Bridge/tunnel crossings remain disconnected, and mixed-`layer` cases pass.

The synthetic-node occurrence column shows every successful expansion at or
below the 16-occurrence limit. A dash means no transformed synthetic node was
produced.

## MOTIS route reference

| Result | Fixture count |
| --- | ---: |
| GREEN | 6 |
| YELLOW | 2 |
| SKIPPED | 26 |

Endpoint route matrices are reference evidence and can be affected by coordinate snapping at co-located nodes.

## Classification

| Fixture | Ways | Max synthetic-node occurrences | Production result | Force-expand probe | MOTIS route comparison | Evidence |
| --- | ---: | ---: | --- | --- | --- | --- |
| `unrestricted-15` | 15 | — | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | not run | `80ef789ad7ee` |
| `unrestricted-16` | 16 | — | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | not run | `ba6c13876ddc` |
| `unrestricted-17` | 17 | 9 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | not run | `7a2fe6d66f00` |
| `unrestricted-18` | 18 | 10 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | not run | `724f3c9374cf` |
| `unrestricted-32` | 32 | 13 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | not run | `67c326445f9b` |
| `unrestricted-33` | 33 | 13 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | not run | `937ee7f6ab2b` |
| `unrestricted-64` | 64 | 15 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | not run | `86ed3b44d510` |
| `unrestricted-carrier-12` | 12 | 7 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | GREEN: transition matrix, occurrence bound, and untouched elements verified | GREEN | `4e403ad12b14` |
| `unrestricted-carrier-20` | 20 | 11 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | GREEN | `e8ae59bd91ce` |
| `no_left_turn-12` | 12 | — | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | RED: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | SKIPPED | `3fa948413ce8` |
| `no_left_turn-20` | 20 | — | **RED**: fail-closed with object ID: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | — | SKIPPED | `6230cea7b79f` |
| `no_right_turn-12` | 12 | — | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | RED: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | SKIPPED | `676612deeece` |
| `no_right_turn-20` | 20 | — | **RED**: fail-closed with object ID: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | — | SKIPPED | `4664ba4db09a` |
| `no_straight_on-12` | 12 | — | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | RED: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | SKIPPED | `4bfda0cd0c8d` |
| `no_straight_on-20` | 20 | — | **RED**: fail-closed with object ID: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | — | SKIPPED | `0ec0e8c1c682` |
| `no_u_turn-12` | 12 | — | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | RED: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | SKIPPED | `673d1d4f2171` |
| `no_u_turn-20` | 20 | — | **RED**: fail-closed with object ID: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | — | SKIPPED | `35c59fed3d2c` |
| `only_left_turn-12` | 12 | — | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | RED: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | SKIPPED | `545e316f7b5a` |
| `only_left_turn-20` | 20 | — | **RED**: fail-closed with object ID: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | — | SKIPPED | `3b069f2db889` |
| `only_right_turn-12` | 12 | — | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | RED: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | SKIPPED | `5437ee4a0894` |
| `only_right_turn-20` | 20 | — | **RED**: fail-closed with object ID: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | — | SKIPPED | `9dd8bb3ceddc` |
| `only_straight_on-12` | 12 | — | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | RED: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | SKIPPED | `6f4373b39ea6` |
| `only_straight_on-20` | 20 | — | **RED**: fail-closed with object ID: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | — | SKIPPED | `27e7d03f0322` |
| `mixed_oneway-12` | 12 | — | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | RED: node has incompatible highway/access/oneway tags on level '0'; affected way IDs: 2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011 | SKIPPED | `6d66bf7d252f` |
| `mixed_oneway-20` | 20 | — | **RED**: fail-closed with object ID: node has incompatible highway/access/oneway tags on level '0'; affected way IDs: 2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011 | — | SKIPPED | `690130d6c272` |
| `mixed_mode_access-12` | 12 | — | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | RED: node has incompatible highway/access/oneway tags on level '0'; affected way IDs: 2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011 | SKIPPED | `aae3cec82c63` |
| `mixed_mode_access-20` | 20 | — | **RED**: fail-closed with object ID: node has incompatible highway/access/oneway tags on level '0'; affected way IDs: 2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011 | — | SKIPPED | `a5c60e3d2ecc` |
| `mixed_level-12` | 12 | 6 | **YELLOW**: transition matrix, occurrence bound, and untouched elements verified; MOTIS route matrix differs: motorcar (72 removed, 0 added), bicycle (72 removed, 0 added) | YELLOW: transition matrix changed | YELLOW | `b0e520411ebb` |
| `mixed_level-20` | 20 | 10 | **YELLOW**: transition matrix changed; MOTIS route matrix differs: motorcar (200 removed, 0 added), bicycle (200 removed, 0 added) | — | YELLOW | `f4ed84a65d47` |
| `mixed_layer-12` | 12 | 7 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | GREEN: transition matrix, occurrence bound, and untouched elements verified | GREEN | `77a3c52f1e71` |
| `mixed_layer-20` | 20 | 11 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | GREEN | `644f8f28a233` |
| `bridge_tunnel_crossing-12` | 12 | 7 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | GREEN: transition matrix, occurrence bound, and untouched elements verified | GREEN | `277299882809` |
| `bridge_tunnel_crossing-20` | 20 | 11 | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | — | GREEN | `dd882b115551` |
| `restriction_conditional-12` | 12 | — | **YELLOW**: relation 9000 has conditional restriction semantics | — | SKIPPED | `8e83b7582d77` |
| `restriction_conditional-20` | 20 | — | **RED**: fail-closed with object ID: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | — | SKIPPED | `656e18ea6d69` |
| `via_way_restriction-12` | 12 | — | **YELLOW**: relation 9000 is a via-way or non-via-node restriction | — | SKIPPED | `db92cd7f6367` |
| `via_way_restriction-20` | 20 | — | **RED**: fail-closed with object ID: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | — | SKIPPED | `e60353ba25b4` |
| `malformed_restriction-12` | 12 | — | **YELLOW**: relation 9000 has malformed restriction member roles | — | SKIPPED | `46ba2def33a5` |
| `malformed_restriction-20` | 20 | — | **RED**: fail-closed with object ID: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | — | SKIPPED | `6dfb9dd076b0` |
| `multiple_static_restrictions-12` | 12 | — | **GREEN**: transition matrix, occurrence bound, and untouched elements verified | RED: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | SKIPPED | `0f1dd30b8259` |
| `multiple_static_restrictions-24` | 24 | — | **RED**: fail-closed with object ID: relation 9000 (type=restriction) references an overfull junction/node way; relation rewriting is unsupported | — | SKIPPED | `4f42f07a8872` |

## Totals

- **GREEN:** 23
- **YELLOW:** 5
- **RED:** 13

## Run limits

GREEN means the independent local PBF transition matrix, retained occurrence bound, and structural checks pass. RED means the current converter rejected the fixture before publishing output and named the affected OSM object. YELLOW means an observed transition mismatch, semantics that this static graph checker cannot certify, or a MOTIS route-matrix discrepancy. The JSON report keeps `local_semantics_status` separate when route evidence changes the overall group. MOTIS endpoint routing uses snapped coordinates and is reference evidence, not proof of every exact turn.

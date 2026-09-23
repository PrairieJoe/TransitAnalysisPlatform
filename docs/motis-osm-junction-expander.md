# MOTIS OSM junction expander

The converter writes a separate PBF and keeps the source file untouched. It is
intended for MOTIS/OSR's 16 retained-way-node occurrence limit.

## Run

Install the pinned helper dependency in the Python environment used for the
conversion:

```powershell
py -3 -m pip install -r requirements-osm-converter.txt
```

Then run:

```powershell
py -3 scripts/motis/osm_junction_expander.py `
  data/osm/south-korea-latest.osm.pbf `
  data/osm/south-korea-latest.expanded.osm.pbf
```

The JSON report includes source/output SHA-256, affected OSM node IDs, added
element counts, each affected node's level groups, and a post-write scan of all
candidate `highway=*` occurrences. The temporary output is renamed into place
only after the post-write scan passes.

Run the focused fixture suite with:

```powershell
npm run test:osm-junction-expander
```

To compare OSR import time and peak process memory, use the same 1-thread import
configuration for an official release and the local 32-way candidate:

```powershell
./scripts/motis/benchmark-junction-expander.ps1 `
  -SourcePbf data/osm/south-korea-latest.osm.pbf `
  -ExpandedPbf test-artifacts/motis-junction-expander/south-korea-latest.expanded.osm.pbf `
  -OfficialExecutable test-artifacts/motis-official-v2.11.3-github/motis.exe `
  -Patched32Executable vendor/motis/patched-windows-msvc-candidate/motis.exe
```

The official Windows archive is downloaded from the [MOTIS v2.11.3 GitHub
release](https://github.com/motis-project/motis/releases/tag/v2.11.3). Keep the
download, imported OSR data, and route evidence under ignored
`test-artifacts/`; do not commit those large binaries or PBFs.

## Supported semantics

- Candidate occurrences are counted per node reference in `highway=*` ways,
  excluding `construction`, `proposed`, `abandoned`, `razed`, `disused`, and
  `planned`. This is a conservative local candidate filter and must be checked
  against the pinned OSR version with the official MOTIS import gate.
- A node with more than 16 occurrences is divided by its numeric OSR routing
  level. An absent `level`, `level=0`, and numeric spellings such as `0.0` share
  level zero, matching OSR's foot profile; other levels receive distinct node
  IDs and stay disconnected.
- If one level still exceeds the limit, its ways are distributed across
  synthetic nodes joined by a bidirectional connector chain. This is supported
  only when the ways share one static highway/access/oneway signature and are
  not one-way.
- Nodes with tags, repeated occurrences of the node in a way, multi-level ways,
  conditional access tags, one-way connectors, and relations that reference an
  affected node or way are rejected before publishing output. The converter
  does not rewrite turn-restriction relations at an expanded node.
- Nodes at or below 16 occurrences are passed through. Their way and relation
  semantics are checked unchanged by the fixture suite.

This first PoC is not a general OSM normalizer. It does not claim support for
vehicle-specific restrictions, conditional restrictions, via-way restrictions,
barriers, tagged traffic-control nodes, or mixed access profiles at an expanded
junction. Such inputs fail closed when they touch a candidate node.

## Verification

Fixtures cover 15/16/17/18/32/33 occurrences, OSR's level-zero equivalence
plus the `-1`, `1`, `2`, `3`, and `4` levels, all-pairs reachability at an
unrestricted junction, stable repeated output, a preserved static restriction
below the limit, and rejection of ambiguous cases. Full-map evidence and
current limitations are recorded in
[`docs/test-reports/2026-09-23-osm-junction-expander-implementation.md`](test-reports/2026-09-23-osm-junction-expander-implementation.md).
The successful official import and selected route comparisons establish a
bounded PoC result; they do not certify conditional, via-way, barrier, or
vehicle-specific restriction behavior.

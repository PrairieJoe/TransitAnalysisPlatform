"""Run the Official-MOTIS/single-topology synthetic compatibility decision gate."""

from __future__ import annotations

import argparse
import copy
import json
import math
import sys
import urllib.parse
from pathlib import Path
from typing import Any

try:
    from .compare_osm_junction_motis import (
        API_MODE,
        _request_json,
        _run_import,
        _start_server,
        _stop_server,
        compare_route_matrices,
    )
    from .osm_junction_fixture_generator import write_fixture
    from .osm_junction_semantic_verifier import (
        read_osm_pbf,
        verify_expansion_semantics,
        verify_fixture_semantics,
    )
    from .single_topology_poc import expand_single_topology_fixture
except ImportError:  # Direct execution from scripts/motis.
    from compare_osm_junction_motis import (
        API_MODE,
        _request_json,
        _run_import,
        _start_server,
        _stop_server,
        compare_route_matrices,
    )
    from osm_junction_fixture_generator import write_fixture
    from osm_junction_semantic_verifier import (
        read_osm_pbf,
        verify_expansion_semantics,
        verify_fixture_semantics,
    )
    from single_topology_poc import expand_single_topology_fixture


BASE_FIELDS = {
    "center_node_id": 100,
    "endpoint_node_id_base": 1000,
    "way_id_base": 2000,
    "relation_id_base": 9000,
    "default_way_tags": {"highway": "service"},
    "modes": ["motorcar", "bicycle", "foot"],
}


def expand_gate_fixtures(catalog: dict[str, Any]) -> list[dict[str, Any]]:
    """Expand the declarative family matrix into PBF-writer/verifier inputs."""
    output: list[dict[str, Any]] = []
    for family in catalog["families"]:
        for count_value in catalog["spoke_counts"]:
            count = int(count_value)
            key = str(count)
            fixture: dict[str, Any] = {
                **copy.deepcopy(BASE_FIELDS),
                "id": f"{family['id']}-{count}",
                "pair_id": family["id"],
                "spokes": count,
                "fixture_kind": "star",
                "relations": [],
                "way_tag_overrides": {},
                "oracle": {"all_modes": "all_directed_pairs"},
                # Matrix cells represent distinct physical approaches. U-turns
                # are tested by a separate two-coordinate route probe below.
                "exclude_diagonal_transitions": True,
            }
            kind = family["kind"]
            if kind in {"no", "only"}:
                target = int(family["to_by_spokes"][key])
                fixture["relation_kind"] = "static_via_node"
                fixture["relations"] = [{
                    "relation_id": 9000,
                    "restriction": family["restriction"],
                    "from": int(family["from"]),
                    "to": target,
                    "except": "bicycle;foot",
                }]
                oracle_rule = (
                    "forbidden_by_spokes" if kind == "no" else "only_by_spokes"
                )
                fixture["oracle"] = {
                    "all_modes": "all_directed_pairs",
                    "motorcar": {oracle_rule: {key: [[int(family["from"]), target]]}},
                }
            elif kind == "multiple_no":
                fixture["relation_kind"] = "multiple_static_via_node"
                expected: list[list[int]] = []
                for index, declared in enumerate(family["relations"]):
                    source = int(declared["from"])
                    target = int(declared["to_by_spokes"][key])
                    fixture["relations"].append({
                        "relation_id": 9000 + index,
                        "restriction": declared["restriction"],
                        "from": source,
                        "to": target,
                        "except": "bicycle;foot",
                    })
                    expected.append([source, target])
                fixture["oracle"] = {
                    "all_modes": "all_directed_pairs",
                    "motorcar": {"forbidden_by_spokes": {key: expected}},
                }
            elif kind == "oneway":
                fixture["way_tag_overrides"] = {
                    "0": {"oneway": "yes", "oneway:bicycle": "no"},
                    "1": {"oneway": "-1", "oneway:bicycle": "no"},
                }
                fixture["oracle"] = {
                    "all_modes": "all_directed_pairs",
                    "motorcar": {"entry_forbidden": [0], "exit_forbidden": [1]},
                }
            elif kind == "access":
                fixture["way_tag_overrides"] = {
                    "0": {"access": "no"},
                    "1": {"motor_vehicle": "no"},
                    "2": {"bicycle": "no"},
                    "3": {"foot": "no"},
                }
                fixture["oracle"] = {
                    "motorcar": {"denied_spokes": [0, 1]},
                    "bicycle": {"denied_spokes": [0, 2]},
                    "foot": {"denied_spokes": [0, 3]},
                }
            elif kind in {"alternating_level", "alternating_layer"}:
                tag = "level" if kind == "alternating_level" else "layer"
                values = ["0", "1"]
                fixture["way_tag_overrides"] = {
                    str(index): {tag: values[index % 2]}
                    for index in range(count)
                }
                if kind == "alternating_level":
                    fixture["oracle"] = {
                        "all_modes": "all_directed_pairs",
                        "foot": {
                            "same_level_groups_by_spokes": {
                                key: [
                                    [index for index in range(count) if index % 2 == parity]
                                    for parity in (0, 1)
                                ]
                            }
                        },
                    }
            elif kind != "unrestricted":
                raise ValueError(f"unknown fixture family kind: {kind}")
            fixture["expected_outcome"] = "force_expand" if count <= 16 else "expand"
            output.append(fixture)
    return output


def _interpolate(center: dict[str, Any], endpoint: dict[str, Any], fraction: float) -> tuple[float, float]:
    return (
        float(center["lat"]) + (float(endpoint["lat"]) - float(center["lat"])) * fraction,
        float(center["lon"]) + (float(endpoint["lon"]) - float(center["lon"])) * fraction,
    )


def _direct_probe(
    official_motis: Path,
    source: Path,
    transformed: Path,
    fixture: dict[str, Any],
    output_dir: Path,
    probe_spec: dict[str, Any],
    import_timeout: float,
) -> dict[str, Any]:
    document = read_osm_pbf(source)
    center_id = int(fixture["center_node_id"])
    base = int(fixture["endpoint_node_id_base"])
    start = _interpolate(
        document["nodes"][center_id],
        document["nodes"][base + int(probe_spec["from_way_index"])],
        float(probe_spec["query_fraction_from_junction"]),
    )
    end = _interpolate(
        document["nodes"][center_id],
        document["nodes"][base + int(probe_spec["to_way_index"])],
        float(probe_spec["query_fraction_from_junction"]),
    )
    reports: dict[str, Any] = {}
    for side, pbf in (("original", source), ("transformed", transformed)):
        imported = _run_import(official_motis, pbf, output_dir / side, import_timeout)
        server, stream, server_log = _start_server(official_motis, imported, 60.0)
        mode_results: dict[str, Any] = {}
        try:
            for mode in ("motorcar", "bicycle", "foot"):
                params = urllib.parse.urlencode({
                    "one": f"{start[0]:.7f};{start[1]:.7f}",
                    "many": f"{end[0]:.7f};{end[1]:.7f}",
                    "mode": API_MODE[mode],
                    "max": "3600",
                    "maxMatchingDistance": str(probe_spec["max_matching_distance_meters"]),
                    "arriveBy": "false",
                })
                response = _request_json(
                    f"http://127.0.0.1:{imported['port']}/api/v1/one-to-many?{params}",
                    timeout=30.0,
                )
                if not isinstance(response, list) or len(response) != 1:
                    raise ValueError(f"unexpected direct U-turn route response: {response!r}")
                duration = response[0].get("duration") if isinstance(response[0], dict) else None
                mode_results[mode] = {
                    "reachable": duration is not None,
                    "duration_seconds": duration,
                }
        finally:
            _stop_server(server, stream)
        reports[side] = {"modes": mode_results, "server_log": str(server_log)}

    expected = {"motorcar": False, "bicycle": True, "foot": True}
    match = all(
        reports["original"]["modes"][mode]["reachable"]
        == reports["transformed"]["modes"][mode]["reachable"]
        == expected[mode]
        for mode in expected
    )
    return {
        "probe_id": probe_spec["id"],
        "query_coordinates_lat_lon": {"from": start, "to": end},
        "expected_reachability_by_mode": expected,
        "original": reports["original"],
        "transformed": reports["transformed"],
        "reachability_mismatch_count": sum(
            reports["original"]["modes"][mode]["reachable"]
            != reports["transformed"]["modes"][mode]["reachable"]
            for mode in expected
        ),
        "expectation_mismatch_count": sum(
            reports["transformed"]["modes"][mode]["reachable"] != expected[mode]
            for mode in expected
        ),
        "status": "GREEN" if match else "YELLOW",
    }


def run_gate(
    catalog_path: Path,
    output_dir: Path,
    official_motis: Path,
    *,
    approach_offset_meters: float = 35.0,
    import_timeout: float = 180.0,
) -> dict[str, Any]:
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    fixtures = expand_gate_fixtures(catalog)
    output_dir.mkdir(parents=True, exist_ok=False)
    degree_gate = {int(value) for value in catalog["degrees_official_behavioral_gate"]}
    semantic_gate = {int(value) for value in catalog["degrees_semantic_and_import_gate"]}
    rows: list[dict[str, Any]] = []

    for fixture in fixtures:
        count = int(fixture["spokes"])
        case_dir = output_dir / fixture["id"]
        case_dir.mkdir()
        source = write_fixture(fixture, case_dir / "original.osm.pbf")
        transformed = case_dir / "single-topology.osm.pbf"
        original_semantic = verify_fixture_semantics(source, fixture)
        row: dict[str, Any] = {
            "fixture_id": fixture["id"],
            "family": fixture["pair_id"],
            "spokes": count,
            "source_semantic_mismatch_count": sum(
                len(item["missing"]) + len(item["unexpected"])
                for item in original_semantic["transition_mismatches"]
            ),
        }
        try:
            conversion = expand_single_topology_fixture(
                source,
                transformed,
                force_expand=count in degree_gate,
            )
            semantic = verify_expansion_semantics(source, transformed, fixture)
            row["independent_semantic"] = {
                "exact": semantic["exact_semantics"],
                "transition_changes": semantic["transition_changes"],
                "transition_mismatches_before": semantic["transition_mismatches_before"],
                "transition_mismatches_after": semantic["transition_mismatches_after"],
                "occurrence_overflow": semantic["occurrence_overflow"],
                "structure_violations": semantic["structure_violations"],
                "unsupported_semantics": semantic["unsupported_semantics"],
            }
            row["max_retained_occurrence_after"] = conversion["max_retained_occurrences_after"]
            row["transformed_pbf_bytes"] = transformed.stat().st_size
            if count in degree_gate:
                route = compare_route_matrices(
                    official_motis,
                    source,
                    official_motis,
                    transformed,
                    fixture,
                    case_dir / "official-route-matrix",
                    matching_distance=5.0,
                    max_seconds=3600,
                    approach_offset_meters=approach_offset_meters,
                    import_timeout=import_timeout,
                )
                row["official_route_matrix"] = {
                    "status": route.get("status", "YELLOW"),
                    "comparison": route.get("comparison"),
                    "approach_offset_meters": route.get("approach_offset_meters"),
                    "transition_count_expected": route.get("transition_count_expected"),
                    "transition_count_before": route.get("transition_count_before"),
                    "transition_count_after": route.get("transition_count_after"),
                    "reachability_mismatch_count": route.get("reachability_mismatch_count"),
                    "newly_reachable": sum(len(delta["added"]) for delta in route.get("deltas", [])),
                    "newly_unreachable": sum(len(delta["removed"]) for delta in route.get("deltas", [])),
                    "forbidden_transition_mismatch_count": route.get("forbidden_transition_mismatch_count"),
                    "forbidden_reachable_before_count": route.get("forbidden_reachable_before_count"),
                    "forbidden_reachable_after_count": route.get("forbidden_reachable_after_count"),
                    "mode_summaries": route.get("mode_summaries", []),
                    "report_path": str(case_dir / "official-route-matrix" / "route-comparison.json"),
                }
                (case_dir / "official-route-matrix" / "route-comparison.json").write_text(
                    json.dumps(route, indent=2), encoding="utf-8"
                )
            elif count in semantic_gate:
                imported = _run_import(
                    official_motis,
                    transformed,
                    case_dir / "official-transformed-import",
                    import_timeout,
                )
                row["official_transformed_import"] = {
                    "status": "PASS",
                    "import_log": str(imported["log"]),
                    "data_dir": str(imported["data"]),
                }
            row["status"] = "GREEN" if (
                original_semantic["transition_mismatches"] == []
                and not original_semantic["unsupported_semantics"]
                and semantic["exact_semantics"]
                and not semantic["occurrence_overflow"]
                and not any(semantic["structure_violations"].values())
                and (count not in degree_gate or row["official_route_matrix"]["status"] == "GREEN")
            ) else "YELLOW"
        except Exception as exc:
            row["status"] = "YELLOW"
            row["error"] = f"{type(exc).__name__}: {exc}"
        rows.append(row)
        partial = {
            "schema_version": 1,
            "catalog": str(catalog_path.resolve()),
            "official_motis": str(official_motis.resolve()),
            "official_behavioral_degrees": sorted(degree_gate),
            "semantic_and_import_degrees": sorted(semantic_gate),
            "completed_cases": len(rows),
            "total_cases": len(fixtures),
            "cases": rows,
        }
        (output_dir / "gate-report.partial.json").write_text(
            json.dumps(partial, indent=2), encoding="utf-8"
        )
        print(json.dumps({"fixture": fixture["id"], "status": row["status"]}), flush=True)

    selected = next(
        fixture for fixture in fixtures
        if fixture["id"] == catalog["direct_uturn_probe"]["id"].replace("direct-uturn-no-u-turn-12", "no_u_turn-12")
    )
    uturn_spec = catalog["direct_uturn_probe"]
    uturn_fixture = copy.deepcopy(selected)
    uturn_fixture["id"] = str(uturn_spec["id"])
    uturn_fixture["endpoint_offsets_meters"] = {
        str(uturn_spec["to_way_index"]): list(uturn_spec["target_endpoint_offset_meters"])
    }
    uturn_fixture["way_tag_overrides"] = {
        str(index): {"oneway": "yes", "oneway:bicycle": "no"}
        for index in range(int(uturn_spec["spokes"]))
    }
    uturn_fixture["way_tag_overrides"][str(uturn_spec["from_way_index"])] = {
        "oneway": str(uturn_spec["oneway_from"]),
        "oneway:bicycle": str(uturn_spec["bicycle_oneway_override"]),
    }
    uturn_fixture["way_tag_overrides"][str(uturn_spec["to_way_index"])] = {
        "oneway": str(uturn_spec["oneway_to"]),
        "oneway:bicycle": str(uturn_spec["bicycle_oneway_override"]),
    }
    uturn_fixture["relations"] = [{
        "relation_id": 9000,
        "restriction": str(uturn_spec["restriction"]),
        "from": int(uturn_spec["from_way_index"]),
        "to": int(uturn_spec["to_way_index"]),
        "except": str(uturn_spec["except"]),
    }]
    uturn_fixture["oracle"] = {
        "all_modes": "all_directed_pairs",
        "motorcar": {
            "entry_forbidden": [
                index for index in range(int(uturn_fixture["spokes"]))
                if index != int(uturn_spec["from_way_index"])
            ],
            "exit_forbidden": [
                index for index in range(int(uturn_fixture["spokes"]))
                if index in {int(uturn_spec["from_way_index"]), int(uturn_spec["to_way_index"])}
            ],
            "forbidden_by_spokes": {
                str(uturn_fixture["spokes"]): [[
                    int(uturn_spec["from_way_index"]),
                    int(uturn_spec["to_way_index"]),
                ]]
            }
        },
    }
    uturn_root = output_dir / "direct-uturn-probe"
    uturn_root.mkdir()
    uturn_source = write_fixture(uturn_fixture, uturn_root / "original.osm.pbf")
    uturn_transformed = uturn_root / "single-topology.osm.pbf"
    expand_single_topology_fixture(uturn_source, uturn_transformed, force_expand=True)
    uturn_semantic = verify_expansion_semantics(uturn_source, uturn_transformed, uturn_fixture)
    uturn_result = _direct_probe(
        official_motis,
        uturn_source,
        uturn_transformed,
        uturn_fixture,
        uturn_root / "official-route-probe",
        uturn_spec,
        import_timeout,
    )
    uturn_result["independent_semantic_exact"] = uturn_semantic["exact_semantics"]
    uturn_result["occurrence_overflow"] = uturn_semantic["occurrence_overflow"]
    uturn_result["structure_violations"] = uturn_semantic["structure_violations"]
    if (
        not uturn_semantic["exact_semantics"]
        or uturn_semantic["occurrence_overflow"]
        or any(uturn_semantic["structure_violations"].values())
    ):
        uturn_result["status"] = "YELLOW"

    report = {
        "schema_version": 1,
        "catalog": str(catalog_path.resolve()),
        "official_motis": str(official_motis.resolve()),
        "official_behavioral_degrees": sorted(degree_gate),
        "semantic_and_import_degrees": sorted(semantic_gate),
        "cases": rows,
        "direct_uturn_probe": uturn_result,
        "summary": {
            "case_count": len(rows),
            "green": sum(row["status"] == "GREEN" for row in rows),
            "yellow": sum(row["status"] != "GREEN" for row in rows),
            "official_behavioral_matrix_failures": sum(
                row.get("official_route_matrix", {}).get("status") != "GREEN"
                for row in rows if int(row["spokes"]) in degree_gate
            ),
            "semantic_or_import_failures": sum(
                not row.get("independent_semantic", {}).get("exact", False)
                or row.get("max_retained_occurrence_after", 17) > 16
                or row.get("official_transformed_import", {}).get("status") != "PASS"
                for row in rows if int(row["spokes"]) in semantic_gate
            ),
            "direct_uturn_status": uturn_result["status"],
        },
    }
    (output_dir / "gate-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--catalog",
        type=Path,
        default=Path("fixtures/osm-junctions/single-topology-decision-gate.json"),
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--official-motis", type=Path, required=True)
    parser.add_argument("--approach-offset-meters", type=float, default=35.0)
    parser.add_argument("--import-timeout", type=float, default=180.0)
    args = parser.parse_args(argv)
    report = run_gate(
        args.catalog,
        args.output_dir,
        args.official_motis,
        approach_offset_meters=args.approach_offset_meters,
        import_timeout=args.import_timeout,
    )
    print(json.dumps(report["summary"], indent=2))
    return 0 if report["summary"]["yellow"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

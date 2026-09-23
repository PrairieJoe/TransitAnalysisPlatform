"""Generate, expand, and report the synthetic adversarial junction matrix."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

from osm_junction_fixture_generator import expand_fixture_definitions, write_fixture
from osm_junction_semantic_verifier import verify_expansion_semantics, verify_fixture_semantics
try:
    from .compare_osm_junction_motis import compare_route_matrices, select_reference_binaries
except ImportError:  # Direct execution from scripts/motis.
    from compare_osm_junction_motis import compare_route_matrices, select_reference_binaries


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _expected_failure_ids(fixture: dict[str, Any]) -> list[str]:
    relation_ids = [str(relation["relation_id"]) for relation in fixture.get("relations", [])]
    if relation_ids:
        return relation_ids
    return [str(fixture["way_id_base"] + index) for index in range(min(2, fixture["spokes"]))]


def _all_empty(value: Any) -> bool:
    if isinstance(value, dict):
        return all(_all_empty(item) for item in value.values())
    if isinstance(value, (list, tuple, set)):
        return len(value) == 0
    return not bool(value)


def _classify_semantic_report(report: dict[str, Any]) -> tuple[str, str]:
    if report["transition_mismatches_after"] or report["transition_changes"]:
        return "YELLOW", "transition matrix changed"
    if report["occurrence_overflow"]:
        return "YELLOW", "retained occurrence limit still exceeded"
    if not _all_empty(report["structure_violations"]):
        return "YELLOW", "non-target OSM structure changed"
    if report["connectivity_violations"]:
        return "YELLOW", "new connection crosses an isolated grade-separated way"
    if report["unsupported_semantics"]:
        return "YELLOW", "; ".join(report["unsupported_semantics"])
    return "GREEN", "transition matrix, occurrence bound, and untouched elements verified"


def _write_markdown(path: Path, report: dict[str, Any]) -> None:
    lines = [
        "# Synthetic OSM junction adversarial run",
        "",
        f"Generated fixtures: **{len(report['cases'])}**",
        f"PBF writer: `{report['generator']}`",
        f"Expander: `{report['expander']}`",
        "",
        "This run uses synthetic OSM/PBF fixtures. The independent observed-graph reader does not apply oracle-only level/layer expectations while calculating actual transitions.",
        "The expander derives CAR/BIKE/FOOT directed transition sets, then compiles those sets into bounded one-way fan-out/fan-in paths.",
        "",
        "## MOTIS route reference",
        "",
    ]
    if any(report.get("route_comparison_groups", {}).values()):
        lines.extend(["| Result | Fixture count |", "| --- | ---: |"])
        for status, count in report["route_comparison_groups"].items():
            lines.append(f"| {status} | {count} |")
    else:
        lines.append("Route comparisons were not run; supply existing official and custom MOTIS binaries to enable them.")
    lines.extend([
        "",
        "Endpoint route matrices are reference evidence and can be affected by coordinate snapping at co-located nodes.",
        "",
        "## Classification",
        "",
        "| Fixture | Ways | Max synthetic-node occurrences | Production result | Force-expand probe | Route result | Transitions expected / before / after | Reachability mismatch | Forbidden mismatch | Max / mean / p95 cost delta (s) |",
        "| --- | ---: | ---: | --- | --- | --- | ---: | ---: | ---: | --- |",
    ])
    for case in report["cases"]:
        forced = case.get("force_expand")
        forced_label = f"{forced['status']}: {forced['reason']}" if forced else "—"
        route = case.get("route_comparison")
        route_label = route["status"] if route else "not run"
        if route and "transition_count_expected" in route:
            transition_label = f"{route['transition_count_expected']} / {route['transition_count_before']} / {route['transition_count_after']}"
            cost_label = " / ".join(
                "—" if route.get(key) is None else f"{route[key]:.3f}"
                for key in ("max_cost_delta_seconds", "mean_cost_delta_seconds", "p95_cost_delta_seconds")
            )
            reachability_label = str(route["reachability_mismatch_count"])
            forbidden_label = str(route["forbidden_transition_mismatch_count"])
        else:
            transition_label = reachability_label = forbidden_label = cost_label = "—"
        retained = case.get("retained_occurrences_after")
        if not retained:
            retained = forced.get("max_retained_occurrences_after") if forced else None
        retained_label = str(retained) if retained else "—"
        lines.append(
            f"| `{case['id']}` | {case['spokes']} | {retained_label} | **{case['status']}**: {case['reason']} | {forced_label} | {route_label} | {transition_label} | {reachability_label} | {forbidden_label} | {cost_label} |"
        )
    lines.extend(["", "## Totals", ""])
    for status in ("GREEN", "YELLOW", "RED"):
        lines.append(f"- **{status}:** {len(report['groups'][status])}")
    lines.extend(["", "## Run limits", "", report["notes"], ""])
    path.write_text("\n".join(lines), encoding="utf-8")


def run_matrix(
    catalog_path: Path,
    output_dir: Path,
    *,
    official_motis: Path | None = None,
    patched_motis: Path | None = None,
    route_comparison_dir: Path | None = None,
) -> dict[str, Any]:
    """Execute the current expander against every PBF and retain a compact report."""
    try:
        from osm_junction_expander import ExpansionError, expand_osm_file
    except (ImportError, SystemExit) as exc:
        raise RuntimeError(
            "PyOsmium is required for expander integration. Install the pinned dependency with "
            "`py -3 -m pip install -r requirements-osm-converter.txt`. "
            "The portable generator and verifier tests can run without it."
        ) from exc

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    fixtures = expand_fixture_definitions(catalog)
    output_dir.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []
    for fixture in fixtures:
        source = output_dir / f"{fixture['id']}.osm.pbf"
        destination = output_dir / f"{fixture['id']}.expanded.osm.pbf"
        fixture_json = output_dir / f"{fixture['id']}.fixture.json"
        expected_paths = [source, destination, fixture_json, output_dir / f"{fixture['id']}.force-expanded.osm.pbf"]
        already_present = [str(path) for path in expected_paths if path.exists()]
        if already_present:
            raise FileExistsError(f"refusing to overwrite existing fixture output(s): {already_present}")
        fixture_json.write_text(json.dumps(fixture, indent=2), encoding="utf-8")
        write_fixture(fixture, source)
        input_hash = _sha256(source)
        row: dict[str, Any] = {
            "id": fixture["id"],
            "pair_id": fixture.get("pair_id"),
            "spokes": fixture["spokes"],
            "expected_outcome": fixture["expected_outcome"],
            "source": str(source),
            "fixture_json": str(fixture_json),
            "source_sha256": input_hash,
        }
        product_conversion_succeeded = False
        try:
            conversion = expand_osm_file(source, destination)
        except ExpansionError as exc:
            reason = str(exc)
            expected_ids = _expected_failure_ids(fixture)
            named_ids = [identifier for identifier in expected_ids if identifier in reason]
            if fixture["expected_outcome"] == "fail_closed" and not destination.exists() and named_ids:
                row.update({"status": "RED", "reason": f"fail-closed with object ID: {reason}", "expanded": False})
            elif fixture["expected_outcome"] == "fail_closed" and not destination.exists():
                row.update({"status": "YELLOW", "reason": f"fail-closed reason omitted any expected object ID {expected_ids}: {reason}", "expanded": False})
            else:
                row.update({"status": "YELLOW", "reason": f"unexpected conversion failure: {reason}", "expanded": False})
            row["partial_output_left"] = destination.exists()
        else:
            product_conversion_succeeded = True
            semantic = verify_expansion_semantics(source, destination, fixture)
            status, reason = _classify_semantic_report(semantic)
            if fixture["expected_outcome"] == "semantic_mismatch_expected" and status == "GREEN":
                status, reason = "YELLOW", "layer fixture did not exercise the expected connector mismatch"
            row.update({
                "status": status,
                "reason": reason,
                "expanded": conversion["expanded_nodes"] > 0,
                "expanded_nodes": conversion["expanded_nodes"],
                "retained_occurrences_after": conversion["max_retained_occurrences_after"],
                "transitions_by_mode": semantic["transition_counts_by_mode_after"],
                "transition_changes": semantic["transition_changes"],
                "structure_violations": semantic["structure_violations"],
                "unsupported_semantics": semantic["unsupported_semantics"],
            })
        row["input_unchanged"] = _sha256(source) == input_hash
        if not row["input_unchanged"]:
            row["status"] = "YELLOW"
            row["reason"] = "fixture source PBF changed during conversion"

        if fixture["expected_outcome"].startswith("force_expand"):
            forced_path = output_dir / f"{fixture['id']}.force-expanded.osm.pbf"
            probe: dict[str, Any]
            try:
                forced_conversion = expand_osm_file(source, forced_path, max_occurrences=11)
            except ExpansionError as exc:
                expected_close = fixture["expected_outcome"] == "force_expand_expected_fail_closed"
                ids = _expected_failure_ids(fixture)
                named_ids = [identifier for identifier in ids if identifier in str(exc)]
                probe = {
                    "status": "RED" if expected_close and not forced_path.exists() and named_ids else "YELLOW",
                    "reason": str(exc) if named_ids else f"failure omitted any expected object ID {ids}: {exc}",
                    "named_object_ids": named_ids,
                    "partial_output_left": forced_path.exists(),
                }
            else:
                forced_semantic = verify_expansion_semantics(source, forced_path, fixture)
                forced_status, forced_reason = _classify_semantic_report(forced_semantic)
                if fixture["expected_outcome"] == "force_expand_expected_fail_closed":
                    forced_status, forced_reason = "YELLOW", "forced conversion unexpectedly succeeded"
                elif fixture["expected_outcome"] == "force_expand_semantic_mismatch" and forced_status == "GREEN":
                    forced_status, forced_reason = "YELLOW", "forced layer conversion did not expose the expected mismatch"
                probe = {
                    "status": forced_status,
                    "reason": forced_reason,
                    "expanded_nodes": forced_conversion["expanded_nodes"],
                    "max_retained_occurrences_after": forced_conversion["max_retained_occurrences_after"],
                    "transition_changes": forced_semantic["transition_changes"],
                }
            row["force_expand"] = probe

        if fixture.get("pair_id") and official_motis and patched_motis:
            before_binary, after_binary, comparison = select_reference_binaries(
                fixture["spokes"], official_motis, patched_motis
            )
            if fixture["spokes"] <= 16:
                forced_pbf = output_dir / f"{fixture['id']}.force-expanded.osm.pbf"
                probe = row.get("force_expand", {})
                if forced_pbf.is_file() and not probe.get("partial_output_left", False):
                    comparison_pbf = forced_pbf
                    transformed_fixture_ready = probe.get("status") in {"GREEN", "YELLOW"}
                else:
                    # Unsupported 12-way cases are still route-comparable as
                    # canonical expander copies, without force-expanding them.
                    comparison_pbf = destination
                    transformed_fixture_ready = product_conversion_succeeded and destination.is_file()
            else:
                comparison_pbf = destination
                transformed_fixture_ready = product_conversion_succeeded and comparison_pbf.is_file()
            if not transformed_fixture_ready:
                row["route_comparison"] = {
                    "status": "SKIPPED",
                    "comparison": comparison,
                    "reason": "no transformed PBF: current expander failed closed",
                }
            else:
                route_root = (route_comparison_dir or output_dir / "route-comparisons") / fixture["id"]
                route_result = compare_route_matrices(
                    before_binary,
                    source,
                    after_binary,
                    comparison_pbf,
                    fixture,
                    route_root,
                )
                route_result["comparison"] = comparison
                route_root.mkdir(parents=True, exist_ok=True)
                (route_root / "route-comparison.json").write_text(json.dumps(route_result, indent=2), encoding="utf-8")
                row["route_comparison"] = route_result
        rows.append(row)

    groups = {status: [row["id"] for row in rows if row["status"] == status] for status in ("GREEN", "YELLOW", "RED")}
    route_comparison_groups = {
        status: sum(1 for row in rows if row.get("route_comparison", {}).get("status") == status)
        for status in ("GREEN", "YELLOW", "SKIPPED")
    }
    return {
        "schema_version": 1,
        "catalog": str(catalog_path),
        "generator": "scripts/motis/osm_junction_fixture_generator.py",
        "verifier": "scripts/motis/osm_junction_semantic_verifier.py",
        "expander": "scripts/motis/osm_junction_expander.py",
        "output_dir": str(output_dir),
        "cases": rows,
        "groups": groups,
        "route_comparison_groups": route_comparison_groups,
        "notes": (
            "Baseline held from the previous run: GREEN 23 / YELLOW 5 / RED 13 across 41 fixtures. "
            "GREEN/YELLOW/RED classify the independent local PBF transition matrix, retained occurrence bound, structural checks, and fail-closed boundaries. "
            "RED means the current converter rejected the fixture before publishing output and named the affected OSM object. "
            "YELLOW means an observed transition mismatch, semantics that this static graph checker cannot certify, or a MOTIS route-matrix discrepancy. "
            "Optional official/patched MOTIS route comparisons run only when both existing binary paths are supplied. "
            "MOTIS route-reference mismatches and cost deltas are kept in route_comparison and do not change the semantic classification. "
            "MOTIS endpoint routing uses snapped coordinates and is reference evidence, not proof of every exact turn."
        ),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=Path("fixtures/osm-junctions/adversarial.json"))
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--official-motis", type=Path, help="existing official MOTIS executable; no download/build is performed")
    parser.add_argument("--patched-motis", type=Path, help="existing patched/custom MOTIS executable; no build is performed")
    parser.add_argument("--route-comparison-dir", type=Path, help="optional root for MOTIS imports and route evidence")
    args = parser.parse_args(argv)
    if bool(args.official_motis) != bool(args.patched_motis):
        parser.error("--official-motis and --patched-motis must be supplied together")
    report_paths = [args.output_dir / "adversarial-report.json", args.output_dir / "adversarial-report.md"]
    if any(path.exists() for path in report_paths):
        parser.error(f"refusing to overwrite existing report(s): {[str(path) for path in report_paths if path.exists()]}")
    try:
        report = run_matrix(
            args.catalog,
            args.output_dir,
            official_motis=args.official_motis,
            patched_motis=args.patched_motis,
            route_comparison_dir=args.route_comparison_dir,
        )
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"adversarial junction run failed: {exc}", file=sys.stderr)
        return 2
    json_path = args.output_dir / "adversarial-report.json"
    markdown_path = args.output_dir / "adversarial-report.md"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    _write_markdown(markdown_path, report)
    print(json.dumps({"groups": report["groups"], "report": str(markdown_path)}, indent=2))
    return 0 if not report["groups"]["YELLOW"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

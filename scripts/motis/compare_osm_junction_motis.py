"""Compare local MOTIS route reachability matrices for paired synthetic PBFs.

Use official MOTIS on both sides for an at-most-16 baseline. For an over-limit
fixture, pass the existing patched/custom MOTIS binary on the original PBF and
official MOTIS on the transformed PBF. This script only consumes the supplied
binaries; it never builds or downloads one.
"""

from __future__ import annotations

import argparse
import math
import hashlib
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

try:
    from .osm_junction_semantic_verifier import _pairs_for_oracle, read_osm_pbf
except ImportError:  # Direct execution from scripts/motis.
    from osm_junction_semantic_verifier import _pairs_for_oracle, read_osm_pbf


API_MODE = {"motorcar": "CAR", "bicycle": "BIKE", "foot": "WALK"}


def select_reference_binaries(
    spokes: int, official_motis: Path, patched_motis: Path
) -> tuple[Path, Path, str]:
    """Use the same router for <=16 pairs; use the custom build only as the 20-way oracle."""
    if spokes <= 16:
        return (
            official_motis,
            official_motis,
            "official MOTIS + original vs official MOTIS + transformed",
        )
    return (
        patched_motis,
        official_motis,
        "patched/custom MOTIS + original vs official MOTIS + transformed",
    )


def reachable_pairs_for_one_to_many(entry_index: int, results: list[dict[str, Any]]) -> set[tuple[int, int]]:
    """Project one MOTIS one-to-many response to local directed pair evidence."""
    return {
        (entry_index, exit_index)
        for exit_index, result in enumerate(results)
        if exit_index != entry_index and isinstance(result, dict) and result.get("duration") is not None
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _new_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _request_json(url: str, timeout: float = 15.0) -> Any:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _yaml_string(value: str) -> str:
    return json.dumps(value.replace("\\", "/"), ensure_ascii=False)


def _write_config(path: Path, pbf: Path, port: int) -> None:
    path.write_text(
        "\n".join([
            f"osm: {_yaml_string(str(pbf.resolve()))}",
            "street_routing: true",
            "server:",
            '  host: "127.0.0.1"',
            f"  port: {port}",
            "  n_threads: 1",
            "",
        ]),
        encoding="utf-8",
    )


def _run_import(binary: Path, pbf: Path, side_dir: Path, timeout: float) -> dict[str, Any]:
    side_dir = side_dir.resolve()
    side_dir.mkdir(parents=True, exist_ok=False)
    port = _new_port()
    config = side_dir / "config.yml"
    data = side_dir / "data"
    log = side_dir / "import.log"
    _write_config(config, pbf, port)
    command = [str(binary), "import", "-c", str(config), "-d", str(data), "--filter", "osr"]
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    with log.open("wb") as output:
        completed = subprocess.run(
            command,
            cwd=side_dir,
            stdout=output,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            check=False,
            creationflags=flags,
        )
    if completed.returncode != 0:
        raise RuntimeError(f"MOTIS import exited {completed.returncode}; log: {log}")
    return {"side_dir": side_dir, "config": config, "data": data, "log": log, "port": port}


def _start_server(binary: Path, imported: dict[str, Any], timeout: float) -> tuple[subprocess.Popen, Any, Path]:
    server_log = Path(imported["side_dir"]) / "server.log"
    log_stream = server_log.open("wb", buffering=0)
    command = [str(binary), "server", "-d", str(imported["data"])]
    process = subprocess.Popen(
        command,
        cwd=imported["side_dir"],
        stdout=log_stream,
        stderr=subprocess.STDOUT,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    health_url = f"http://127.0.0.1:{imported['port']}/api/v1/health"
    deadline = time.monotonic() + timeout
    last_error = "server has not answered yet"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            log_stream.close()
            raise RuntimeError(f"MOTIS server exited {process.returncode}; log: {server_log}")
        try:
            _request_json(health_url, timeout=2.0)
            return process, log_stream, server_log
        except (OSError, urllib.error.URLError, ValueError) as exc:
            last_error = str(exc)
            time.sleep(0.25)
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
    log_stream.close()
    raise TimeoutError(f"MOTIS health did not become available: {last_error}; log: {server_log}")


def _stop_server(process: subprocess.Popen, log_stream: Any) -> None:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    log_stream.close()


def stable_approach_query_coordinates(
    document: dict[str, Any], fixture: dict[str, Any], distance_from_junction_m: float
) -> list[tuple[float, float]]:
    """Choose the same deterministic physical point on each approach before/after expansion."""
    if not math.isfinite(distance_from_junction_m) or distance_from_junction_m < 0:
        raise ValueError("approach query offset must be a finite non-negative distance")
    center = document["nodes"][int(fixture["center_node_id"])]
    endpoint_base = int(fixture["endpoint_node_id_base"])
    count = int(fixture["spokes"])
    points: list[tuple[float, float]] = []
    for index in range(count):
        node = document["nodes"][endpoint_base + index]
        if distance_from_junction_m == 0:
            points.append((float(node["lat"]), float(node["lon"])))
            continue
        east_m = (float(node["lon"]) - float(center["lon"])) * 111_320 * math.cos(math.radians(float(center["lat"])))
        north_m = (float(node["lat"]) - float(center["lat"])) * 111_320
        length_m = math.hypot(east_m, north_m)
        if length_m <= distance_from_junction_m:
            raise ValueError(
                f"approach {index} is only {length_m:.2f}m long; cannot place query "
                f"{distance_from_junction_m:.2f}m from junction"
            )
        fraction = distance_from_junction_m / length_m
        points.append((
            float(center["lat"]) + (float(node["lat"]) - float(center["lat"])) * fraction,
            float(center["lon"]) + (float(node["lon"]) - float(center["lon"])) * fraction,
        ))
    return points


def _route_matrix(
    fixture: dict[str, Any],
    base_url: str,
    mode: str,
    matching_distance: float,
    max_seconds: int,
    query_points: list[tuple[float, float]],
) -> dict[tuple[int, int], float]:
    count = int(fixture["spokes"])
    coords = [f"{latitude:.7f};{longitude:.7f}" for latitude, longitude in query_points]
    reachable: dict[tuple[int, int], float] = {}
    for entry_index, one in enumerate(coords):
        params = urllib.parse.urlencode({
            "one": one,
            "many": ",".join(coords),
            "mode": API_MODE[mode],
            "max": str(max_seconds),
            "maxMatchingDistance": str(matching_distance),
            "arriveBy": "false",
        })
        response = _request_json(f"{base_url}/api/v1/one-to-many?{params}", timeout=30.0)
        if not isinstance(response, list) or len(response) != count:
            raise ValueError(f"unexpected MOTIS one-to-many response for entry {entry_index}: {response!r}")
        for exit_index, result in enumerate(response):
            if exit_index == entry_index or not isinstance(result, dict) or result.get("duration") is None:
                continue
            reachable[(entry_index, exit_index)] = float(result["duration"])
    return reachable


def _cost_summary(before: dict[tuple[int, int], float], after: dict[tuple[int, int], float]) -> dict[str, Any]:
    deltas = sorted(abs(after[pair] - before[pair]) for pair in before.keys() & after.keys())
    if not deltas:
        return {
            "cost_sample_count": 0,
            "max_cost_delta_seconds": None,
            "mean_cost_delta_seconds": None,
            "p95_cost_delta_seconds": None,
        }
    p95_index = max(0, math.ceil(0.95 * len(deltas)) - 1)
    return {
        "cost_sample_count": len(deltas),
        "max_cost_delta_seconds": deltas[-1],
        "mean_cost_delta_seconds": sum(deltas) / len(deltas),
        "p95_cost_delta_seconds": deltas[p95_index],
    }


def compare_route_matrices(
    before_binary: Path,
    before_pbf: Path,
    after_binary: Path,
    after_pbf: Path,
    fixture: dict[str, Any],
    output_dir: Path,
    *,
    matching_distance: float = 5.0,
    max_seconds: int = 3600,
    approach_offset_meters: float = 0.0,
    startup_timeout: float = 60.0,
    import_timeout: float = 180.0,
) -> dict[str, Any]:
    before_binary = before_binary.resolve(strict=True)
    after_binary = after_binary.resolve(strict=True)
    before_pbf = before_pbf.resolve(strict=True)
    after_pbf = after_pbf.resolve(strict=True)
    if output_dir.exists() and any(output_dir.iterdir()):
        raise FileExistsError(f"route comparison output directory must be empty: {output_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)
    query_points = stable_approach_query_coordinates(
        read_osm_pbf(before_pbf), fixture, approach_offset_meters
    )
    cases: list[dict[str, Any]] = []
    sides = [
        ("before", before_binary, before_pbf),
        ("after", after_binary, after_pbf),
    ]
    summaries = []
    try:
        for label, binary, pbf in sides:
            imported = _run_import(binary, pbf, output_dir / label, import_timeout)
            server, log_stream, server_log = _start_server(binary, imported, startup_timeout)
            try:
                for mode in fixture.get("modes", ["motorcar", "bicycle", "foot"]):
                    costs = _route_matrix(
                        fixture,
                        f"http://127.0.0.1:{imported['port']}",
                        mode,
                        matching_distance,
                        max_seconds,
                        query_points,
                    )
                    cases.append({
                        "side": label,
                        "mode": mode,
                        "reachable": sorted([list(pair) for pair in costs]),
                        "cost_matrix_seconds": [
                            {
                                "from": entry,
                                "to": exit_,
                                "duration": costs.get((entry, exit_)),
                            }
                            for entry in range(int(fixture["spokes"]))
                            for exit_ in range(int(fixture["spokes"]))
                            if entry != exit_
                        ],
                    })
            finally:
                _stop_server(server, log_stream)
                imported["server_log"] = server_log
            summaries.append({
                "side": label,
                "binary": str(binary),
                "binary_sha256": _sha256(binary),
                "pbf": str(pbf),
                "pbf_sha256": _sha256(pbf),
                "import_log": str(imported["log"]),
                "server_log": str(server_log),
            })

        deltas = []
        mode_summaries = []
        expected_transition_count = 0
        before_transition_count = 0
        after_transition_count = 0
        reachability_mismatch_count = 0
        forbidden_transition_mismatch_count = 0
        forbidden_reachable_before_count = 0
        forbidden_reachable_after_count = 0
        all_cost_deltas: list[float] = []
        for mode in fixture.get("modes", ["motorcar", "bicycle", "foot"]):
            before_row = next(row for row in cases if row["side"] == "before" and row["mode"] == mode)
            after_row = next(row for row in cases if row["side"] == "after" and row["mode"] == mode)
            before_pairs = {tuple(pair) for pair in before_row["reachable"]}
            after_pairs = {tuple(pair) for pair in after_row["reachable"]}
            expected = _pairs_for_oracle(fixture, mode) - {(index, index) for index in range(int(fixture["spokes"]))}
            removed, added = before_pairs - after_pairs, after_pairs - before_pairs
            forbidden = after_pairs - expected
            forbidden_before = before_pairs - expected
            common_costs_before = {
                (item["from"], item["to"]): item["duration"]
                for item in before_row["cost_matrix_seconds"] if item["duration"] is not None
            }
            common_costs_after = {
                (item["from"], item["to"]): item["duration"]
                for item in after_row["cost_matrix_seconds"] if item["duration"] is not None
            }
            costs = _cost_summary(common_costs_before, common_costs_after)
            cost_deltas = [
                abs(common_costs_after[pair] - common_costs_before[pair])
                for pair in common_costs_before.keys() & common_costs_after.keys()
            ]
            all_cost_deltas.extend(cost_deltas)
            expected_transition_count += len(expected)
            before_transition_count += len(before_pairs)
            after_transition_count += len(after_pairs)
            reachability_mismatch_count += len(removed) + len(added)
            forbidden_transition_mismatch_count += len(forbidden)
            forbidden_reachable_before_count += len(forbidden_before)
            forbidden_reachable_after_count += len(forbidden)
            mode_summaries.append({
                "mode": mode,
                "approach_pair_count": int(fixture["spokes"]) * (int(fixture["spokes"]) - 1),
                "transition_count_expected": len(expected),
                "transition_count_before": len(before_pairs),
                "transition_count_after": len(after_pairs),
                "reachability_mismatch_count": len(removed) + len(added),
                "forbidden_transition_mismatch_count": len(forbidden),
                "forbidden_reachable_before_count": len(forbidden_before),
                "forbidden_reachable_after_count": len(forbidden),
                **costs,
            })
            if removed or added:
                deltas.append({
                    "mode": mode,
                    "removed": [list(pair) for pair in sorted(removed)],
                    "added": [list(pair) for pair in sorted(added)],
                })
        aggregate_costs = _cost_summary(
            {(index, 0): 0.0 for index, _ in enumerate(all_cost_deltas)},
            {(index, 0): delta for index, delta in enumerate(all_cost_deltas)},
        )
        status = "GREEN" if not deltas and forbidden_transition_mismatch_count == 0 else "YELLOW"
        return {
            "fixture_id": fixture["id"],
            "status": status,
            "comparison": "patched/custom original vs official transformed" if before_binary != after_binary else "official original vs official transformed",
            "matching_distance_m": matching_distance,
            "max_route_seconds": max_seconds,
            "query_point_strategy": (
                "OSM approach endpoints"
                if approach_offset_meters == 0
                else "fixed distance from junction toward each approach endpoint"
            ),
            "approach_offset_meters": approach_offset_meters,
            "query_points_by_approach": [
                {"approach": index, "latitude": latitude, "longitude": longitude}
                for index, (latitude, longitude) in enumerate(query_points)
            ],
            "diagonal_pairs": "excluded because identical start/destination coordinates do not exercise a junction turn",
            "sides": summaries,
            "transition_count_expected": expected_transition_count,
            "transition_count_before": before_transition_count,
            "transition_count_after": after_transition_count,
            "reachability_mismatch_count": reachability_mismatch_count,
            "forbidden_transition_mismatch_count": forbidden_transition_mismatch_count,
            "forbidden_reachable_before_count": forbidden_reachable_before_count,
            "forbidden_reachable_after_count": forbidden_reachable_after_count,
            **aggregate_costs,
            "mode_summaries": mode_summaries,
            "deltas": deltas,
            "route_matrices": cases,
        }
    except Exception as exc:
        return {
            "fixture_id": fixture.get("id", "unknown"),
            "status": "YELLOW",
            "error": str(exc),
            "sides": summaries,
            "route_matrices": cases,
        }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before-motis", type=Path, required=True)
    parser.add_argument("--before-pbf", type=Path, required=True)
    parser.add_argument("--after-motis", type=Path, required=True)
    parser.add_argument("--after-pbf", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, required=True, help="expanded fixture JSON file emitted by the matrix generator")
    parser.add_argument("--output-dir", type=Path, required=True, help="new/empty directory for imports and route evidence")
    parser.add_argument("--matching-distance", type=float, default=5.0)
    parser.add_argument("--max-seconds", type=int, default=3600)
    parser.add_argument(
        "--approach-offset-meters",
        type=float,
        default=0.0,
        help="use the same point this far from the junction on each approach; 0 keeps endpoint queries",
    )
    args = parser.parse_args(argv)
    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    report = compare_route_matrices(
        args.before_motis,
        args.before_pbf,
        args.after_motis,
        args.after_pbf,
        fixture,
        args.output_dir,
        matching_distance=args.matching_distance,
        max_seconds=args.max_seconds,
        approach_offset_meters=args.approach_offset_meters,
    )
    report_path = args.output_dir / "route-comparison.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"status": report["status"], "report": str(report_path), "deltas": report.get("deltas", [])}, indent=2))
    return 0 if report["status"] == "GREEN" else 1


if __name__ == "__main__":
    raise SystemExit(main())

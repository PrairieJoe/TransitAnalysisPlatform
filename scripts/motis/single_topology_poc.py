"""Fixture-only single-topology proof of concept for 8..64-way star junctions.

This module is deliberately not wired into the production expander. It uses
one shared ingress/egress connector graph with mode access tags and exists to
measure whether that representation can preserve MOTIS reachability.
"""

from __future__ import annotations

import os
import math
import tempfile
import argparse
import json
from pathlib import Path
from typing import Any

try:
    from . import osm_junction_expander as expander
except ImportError:  # Direct execution from scripts/motis.
    import osm_junction_expander as expander


MODES = ("motorcar", "bicycle", "foot")


def _transition_access_tags(allowed_modes: set[str]) -> dict[str, str]:
    """Encode a connector's mode set using the pinned OSR tag precedence."""
    if "motorcar" in allowed_modes:
        tags = {"motor_vehicle": "yes", "motorcar": "yes"}
    else:
        # car_profile rejects the general access blacklist before checking
        # motor_vehicle/motorcar; bike and foot can explicitly override it.
        tags = {
            "access": "no",
            "motor_vehicle": "no",
            "motorcar": "no",
            "vehicle": "no",
        }

    tags["bicycle"] = "yes" if "bicycle" in allowed_modes else "no"
    tags["foot"] = "yes" if "foot" in allowed_modes else "no"
    return tags


def build_single_topology_plan(
    node_id: int,
    node_tags: dict[str, str],
    incident_ways: list[expander.WayAtJunction],
    restrictions: list[expander.StaticRestriction],
    *,
    first_new_node_id: int,
    first_new_way_id: int,
    center_lon: float,
    center_lat: float,
) -> expander.ExpansionPlan:
    """Build one shared transition graph for the existing paired star fixtures."""
    if not 8 <= len(incident_ways) <= 64:
        raise expander.ExpansionError("single-topology PoC supports 8 through 64 incident ways")
    if node_tags:
        raise expander.ExpansionError("single-topology PoC does not support tagged junction nodes")

    transitions = expander.derive_allowed_transitions(node_id, incident_ways, restrictions)
    union = set().union(*(transitions[mode] for mode in MODES))
    if not union:
        raise expander.ExpansionError(f"node {node_id} has no supported transitions")

    replacement_nodes: list[int] = []
    replacement_ways: list[expander.WaySpec] = []
    locations: dict[int, tuple[float, float]] = {}
    next_node = first_new_node_id
    next_way = first_new_way_id
    inbound_ports: list[int] = []
    outbound_ports: list[int] = []
    used_way_ids: set[int] = set()
    core_node_index = 0

    def add_node(lon: float, lat: float) -> int:
        nonlocal next_node
        value = next_node
        next_node += 1
        replacement_nodes.append(value)
        locations[value] = (lon, lat)
        return value

    def add_way(
        way_id: int,
        node_ids: tuple[int, ...],
        tags: dict[str, str],
        node_locations: tuple[tuple[float, float], ...],
    ) -> None:
        nonlocal next_way
        if way_id in used_way_ids:
            while next_way in used_way_ids:
                next_way += 1
            way_id = next_way
            next_way += 1
        used_way_ids.add(way_id)
        replacement_ways.append(expander.WaySpec(way_id, node_ids, tags, node_locations))

    def add_core_node() -> int:
        """Place bounded-degree routing-gadget nodes in a tiny central area."""
        nonlocal core_node_index
        index = core_node_index
        core_node_index += 1
        angle = index * 2.399963229728653  # golden angle avoids coincident geometry
        radius = 0.05 + 0.012 * math.sqrt(index + 1)
        longitude_scale = 111_320 * math.cos(math.radians(center_lat))
        return add_node(
            center_lon + radius * math.cos(angle) / longitude_scale,
            center_lat + radius * math.sin(angle) / 111_320,
        )

    def transition_tags(approach_index: int, allowed_modes: set[str]) -> dict[str, str]:
        tags = {
            "highway": "service",
            "oneway": "yes",
            "level": expander._normalized_level(
                incident_ways[approach_index].tags, incident_ways[approach_index].way_id
            ),
            **_transition_access_tags(allowed_modes),
        }
        layer = incident_ways[approach_index].tags.get("layer")
        if layer is not None:
            tags["layer"] = layer
        return tags

    def add_connector(start: int, end: int, tags: dict[str, str]) -> None:
        nonlocal next_way
        add_way(
            next_way,
            (start, end),
            tags,
            (locations[start], locations[end]),
        )
        next_way += 1

    # Place the two direction roles around the original junction. The road
    # approaches keep their original tags; mode separation applies only to the
    # single set of transition connectors.
    for index, way in enumerate(incident_ways):
        if not way.node_ids or len(way.node_ids) != way.node_count:
            raise expander.ExpansionError(f"way {way.way_id} has unsupported geometry")
        if way.position not in {0, len(way.node_ids) - 1}:
            raise expander.ExpansionError(f"way {way.way_id} has an interior via-node")
        if len(way.node_locations) != len(way.node_ids):
            raise expander.ExpansionError(f"way {way.way_id} has incomplete coordinates")

        angle = 2.0 * 3.141592653589793 * index / len(incident_ways)
        offset = 0.025
        longitude_scale = 111_320 * math.cos(math.radians(center_lat))
        in_lon = center_lon + offset * math.cos(angle) / longitude_scale
        in_lat = center_lat + offset * math.sin(angle) / 111_320
        out_lon = center_lon - offset * math.cos(angle) / longitude_scale
        out_lat = center_lat - offset * math.sin(angle) / 111_320
        inbound = add_node(in_lon, in_lat)
        outbound = add_node(out_lon, out_lat)
        inbound_ports.append(inbound)
        outbound_ports.append(outbound)

        inbound_nodes = list(way.node_ids)
        inbound_nodes[way.position] = inbound
        inbound_locs = list(way.node_locations)
        inbound_locs[way.position] = (in_lon, in_lat)
        add_way(way.way_id, tuple(inbound_nodes), dict(way.tags), tuple(inbound_locs))

        # Keep the opposite directed endpoint spatially coincident but
        # topologically separate, so the ingress and egress roles cannot join
        # outside the central junction.
        exterior_position = len(way.node_ids) - 1 if way.position == 0 else 0
        old_exterior = way.node_locations[exterior_position]
        egress_exterior = add_node(*old_exterior)
        outbound_nodes = list(way.node_ids)
        outbound_nodes[way.position] = outbound
        outbound_nodes[exterior_position] = egress_exterior
        outbound_locs = list(way.node_locations)
        outbound_locs[way.position] = (out_lon, out_lat)
        add_way(next_way, tuple(outbound_nodes), dict(way.tags), tuple(outbound_locs))
        next_way += 1

    # A direct connector star is compact through 15 approaches. Above that,
    # compile the same pair matrix through per-approach binary fan-out/fan-in
    # trees. The trees are shared by every mode; only their edges carry the
    # union of modes that can use a descendant pair. Pair edges retain the
    # exact mode mask for their (from, to) transition.
    if len(incident_ways) <= 15:
        for entry, exit_ in sorted(union):
            allowed = {mode for mode in MODES if (entry, exit_) in transitions[mode]}
            add_connector(
                inbound_ports[entry],
                outbound_ports[exit_],
                transition_tags(entry, allowed),
            )
    else:
        source_leaves: dict[tuple[int, int], int] = {}
        target_leaves: dict[tuple[int, int], int] = {}

        def build_source_tree(entry: int, parent: int, exits: list[int]) -> None:
            if len(exits) == 1:
                source_leaves[(entry, exits[0])] = parent
                return
            middle = len(exits) // 2
            for subset in (exits[:middle], exits[middle:]):
                child = add_core_node()
                allowed = {
                    mode
                    for mode in MODES
                    if any((entry, exit_) in transitions[mode] for exit_ in subset)
                }
                add_connector(parent, child, transition_tags(entry, allowed))
                build_source_tree(entry, child, subset)

        def build_target_tree(exit_: int, parent: int, entries: list[int]) -> None:
            if len(entries) == 1:
                target_leaves[(entries[0], exit_)] = parent
                return
            middle = len(entries) // 2
            for subset in (entries[:middle], entries[middle:]):
                child = add_core_node()
                allowed = {
                    mode
                    for mode in MODES
                    if any((entry, exit_) in transitions[mode] for entry in subset)
                }
                add_connector(child, parent, transition_tags(exit_, allowed))
                build_target_tree(exit_, child, subset)

        for entry in range(len(incident_ways)):
            exits = [exit_ for exit_ in range(len(incident_ways)) if (entry, exit_) in union]
            if exits:
                build_source_tree(entry, inbound_ports[entry], exits)

        for exit_ in range(len(incident_ways)):
            entries = [entry for entry in range(len(incident_ways)) if (entry, exit_) in union]
            if entries:
                build_target_tree(exit_, outbound_ports[exit_], entries)

        for entry, exit_ in sorted(union):
            allowed = {mode for mode in MODES if (entry, exit_) in transitions[mode]}
            add_connector(
                source_leaves[(entry, exit_)],
                target_leaves[(entry, exit_)],
                transition_tags(entry, allowed),
            )

    return expander.ExpansionPlan(
        node_id=node_id,
        original_occurrences=len(incident_ways),
        replacement_nodes=tuple(replacement_nodes),
        replacement_node_locations=locations,
        replacement_ways=tuple(replacement_ways),
        removed_relation_ids=tuple(sorted({r.relation_id for r in restrictions})),
        group_summary=tuple(
            {"mode": mode, "transition_count": len(transitions[mode])}
            for mode in MODES
        ),
    )


def expand_single_topology_fixture(
    source_path: str | os.PathLike[str],
    output_path: str | os.PathLike[str],
    *,
    max_occurrences: int = expander.OSR_DEFAULT_MAX_WAYS_PER_NODE,
    force_expand: bool = False,
) -> dict[str, Any]:
    """Write one temporary PoC PBF and validate it before publishing output."""
    source = Path(source_path).resolve(strict=True)
    destination = Path(output_path).resolve()
    if source == destination:
        raise expander.ExpansionError("input and output paths must differ")
    if max_occurrences < 3 or max_occurrences > expander.OSR_DEFAULT_MAX_WAYS_PER_NODE:
        raise expander.ExpansionError("max occurrences must be between 3 and 16")
    if destination.exists():
        raise FileExistsError(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.stem}.tmp{destination.suffix}")
    target_nodes: dict[int, Any]
    target_ways: dict[int, list[expander.WayAtJunction]]
    target_way_ids: set[int]
    target_restrictions: list[expander.StaticRestriction]

    with tempfile.TemporaryDirectory(prefix="junction-single-topology-poc-") as work:
        db, maximum_id = expander._occurrence_database(source, Path(work) / "occurrences.sqlite")
        try:
            if force_expand:
                overfull = [int(node_id) for node_id, _count in db.execute(
                    "SELECT node_id, n FROM occurrence WHERE n > 2 ORDER BY node_id"
                )]
            else:
                overfull = [int(node_id) for node_id, _count in db.execute(
                    "SELECT node_id, n FROM occurrence WHERE n > ? ORDER BY node_id",
                    (max_occurrences,),
                )]
        finally:
            db.close()
        if len(overfull) != 1:
            raise expander.ExpansionError(f"expected one over-limit junction node, found {overfull}")

        node_id = overfull[0]
        target_nodes, target_ways, target_way_ids, target_restrictions = expander._load_target_metadata(
            source, {node_id}
        )
        plan = build_single_topology_plan(
            node_id,
            target_nodes[node_id].tags,
            target_ways[node_id],
            [r for r in target_restrictions if r.via_node_id == node_id],
            first_new_node_id=maximum_id + 1,
            first_new_way_id=maximum_id + 1,
            center_lon=target_nodes[node_id].lon,
            center_lat=target_nodes[node_id].lat,
        )
        try:
            expander._write_output(
                source,
                temporary,
                expander._header_for(source),
                target_nodes,
                {node_id: plan},
                target_way_ids,
            )
            validation = expander._validate_output(
                temporary,
                max_occurrences,
                set(plan.replacement_nodes),
                set(plan.replacement_nodes),
            )
            os.replace(temporary, destination)
        except Exception:
            if temporary.exists():
                temporary.unlink()
            raise

    return {
        "input": str(source),
        "output": str(destination),
        "strategy": "one shared ingress/egress topology; mode tags on one transition connector per allowed pair",
        "transition_counts": list(plan.group_summary),
        **validation,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="one synthetic 8..64-way star fixture PBF")
    parser.add_argument("output", type=Path, help="separate output PBF for the PoC")
    args = parser.parse_args(argv)
    print(json.dumps(expand_single_topology_fixture(args.input, args.output), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

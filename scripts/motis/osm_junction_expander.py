"""Compile overfull OSM junctions into mode-specific directed transition graphs.

The converter derives CAR, BIKE and FOOT turn-pair sets first, then compiles
those sets into a bounded directed topology. Unsupported relation semantics
fail closed before an output PBF is published.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sqlite3
import sys
import tempfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import osmium
    from osmium.osm.mutable import Node, Way
    from osmium.osm import NodeRef
except ImportError as exc:  # pragma: no cover - exercised by CLI installation errors
    raise SystemExit(
        "PyOsmium is required. Install the pinned helper dependency with: "
        "py -3 -m pip install -r requirements-osm-converter.txt"
    ) from exc


OSR_DEFAULT_MAX_WAYS_PER_NODE = 16
NON_ROUTING_HIGHWAY_VALUES = {
    "abandoned",
    "construction",
    "disused",
    "planned",
    "proposed",
    "razed",
}
ACCESS_TAGS = {
    "access",
    "bicycle",
    "bus",
    "foot",
    "hgv",
    "motor_vehicle",
    "motorcar",
    "oneway",
    "oneway:bicycle",
    "oneway:foot",
    "oneway:motor_vehicle",
    "vehicle",
    "wheelchair",
}
UNSUPPORTED_CONDITIONAL_TAGS = {
    "access:conditional",
    "bicycle:conditional",
    "bus:conditional",
    "foot:conditional",
    "hgv:conditional",
    "motor_vehicle:conditional",
    "motorcar:conditional",
    "oneway:conditional",
    "restriction:conditional",
    "vehicle:conditional",
    "wheelchair:conditional",
}
NON_RESTRICTING_ONEWAY_VALUES = {"no", "0", "false"}


class ExpansionError(ValueError):
    """Raised when the input cannot be transformed without guessing semantics."""


@dataclass(frozen=True)
class WayAtJunction:
    way_id: int
    position: int
    tags: dict[str, str]
    node_count: int = 2
    node_ids: tuple[int, ...] = ()
    node_locations: tuple[tuple[float, float], ...] = ()

    @property
    def level(self) -> str | None:
        return self.tags.get("level")

    @property
    def osr_level(self) -> str:
        if self.level is None:
            return "0"
        try:
            value = float(self.level)
        except ValueError as exc:
            raise ExpansionError(
                f"way {self.way_id} has a non-numeric level tag {self.level!r}"
            ) from exc
        if not math.isfinite(value):
            raise ExpansionError(
                f"way {self.way_id} has a non-finite level tag {self.level!r}"
            )
        return "0" if value == 0 else str(value)


@dataclass(frozen=True)
class NodeInfo:
    node_id: int
    lon: float
    lat: float
    tags: dict[str, str]

    @property
    def location(self) -> Any:
        return osmium.osm.Location(self.lon, self.lat)


@dataclass(frozen=True)
class ExpansionPlan:
    node_id: int
    original_occurrences: int
    replacement_nodes: tuple[int, ...]
    replacement_node_locations: dict[int, tuple[float, float]]
    replacement_ways: tuple["WaySpec", ...]
    removed_relation_ids: tuple[int, ...]
    group_summary: tuple[dict[str, Any], ...]


@dataclass(frozen=True)
class StaticRestriction:
    relation_id: int
    from_way_id: int
    to_way_id: int
    via_node_id: int
    restriction: str
    modes: tuple[str, ...]


@dataclass(frozen=True)
class WaySpec:
    way_id: int
    node_ids: tuple[int, ...]
    tags: dict[str, str]
    node_locations: tuple[tuple[float, float], ...] = ()


def is_retained_highway(tags: dict[str, str]) -> bool:
    """Use highway ways as a conservative candidate superset for OSR ways."""
    highway = tags.get("highway")
    return highway is not None and highway not in NON_ROUTING_HIGHWAY_VALUES


def _tag_map(tags: Any) -> dict[str, str]:
    return {tag.k: tag.v for tag in tags}


MODE_ACCESS_KEYS = {
    "motorcar": ("motorcar", "motor_vehicle", "vehicle", "access"),
    "bicycle": ("bicycle", "vehicle", "access"),
    "foot": ("foot", "access"),
}
MODE_ONEWAY_KEYS = {
    "motorcar": ("oneway:motor_vehicle", "oneway:motorcar", "oneway"),
    "bicycle": ("oneway:bicycle", "oneway"),
    "foot": ("oneway:foot",),
}
MODE_RESTRICTION_KEYS = {
    "motorcar": ("restriction:motorcar", "restriction:motor_vehicle", "restriction:vehicle", "restriction"),
    "bicycle": ("restriction:bicycle", "restriction:vehicle", "restriction"),
    "foot": ("restriction:foot", "restriction"),
}
MODE_EXCEPTIONS = {
    "motorcar": {"motorcar", "motor_vehicle", "vehicle"},
    "bicycle": {"bicycle", "vehicle"},
    "foot": {"foot", "pedestrian"},
}
MODE_TAG = {"motorcar": "motor_vehicle", "bicycle": "bicycle", "foot": "foot"}
MODE_ONEWAY_TAG = {"motorcar": "oneway:motor_vehicle", "bicycle": "oneway:bicycle", "foot": "oneway:foot"}
ACCESS_AND_DIRECTION_KEYS = {
    "access", "vehicle", "motor_vehicle", "motorcar", "bicycle", "foot", "bus", "hgv",
    "wheelchair", "oneway", "oneway:motor_vehicle", "oneway:motorcar", "oneway:bicycle", "oneway:foot",
}


def _effective_access(tags: dict[str, str], mode: str) -> str | None:
    for key in MODE_ACCESS_KEYS[mode]:
        value = tags.get(key)
        if value is not None:
            return value.strip().lower()
    return "yes"


def _access_allowed(tags: dict[str, str], mode: str) -> bool:
    value = _effective_access(tags, mode)
    return value not in {"no", "private"}


def _effective_oneway(tags: dict[str, str], mode: str) -> str:
    for key in MODE_ONEWAY_KEYS[mode]:
        value = tags.get(key)
        if value is not None:
            normalized = value.strip().lower()
            if normalized in {"yes", "1", "true", "-1", "no", "0", "false"}:
                return "yes" if normalized in {"1", "true"} else "no" if normalized in {"0", "false"} else normalized
            raise ExpansionError(f"unsupported {key}={value!r}")
    return "no"


def _normalized_level(tags: dict[str, str], way_id: int) -> str:
    raw = tags.get("level", "0")
    if ";" in raw or "," in raw:
        raise ExpansionError(f"way {way_id} has unsupported multi-level value level={raw!r}")
    try:
        number = float(raw)
    except ValueError as exc:
        raise ExpansionError(f"way {way_id} has non-numeric level={raw!r}") from exc
    if not math.isfinite(number):
        raise ExpansionError(f"way {way_id} has non-finite level={raw!r}")
    return "0" if number == 0 else str(number)


def _isolated_mode_access_tags(mode: str, value: str = "yes") -> dict[str, str]:
    tags = {
        "access": "yes",
        "vehicle": "no",
        "motorcar": "no",
        "motor_vehicle": "no",
        "bicycle": "no",
        "foot": "no",
    }
    tags[MODE_TAG[mode]] = value
    if mode == "motorcar":
        tags["motorcar"] = value
    return tags


def _is_inbound(way: WayAtJunction, mode: str) -> bool:
    if not _access_allowed(way.tags, mode):
        return False
    direction = _effective_oneway(way.tags, mode)
    # OSM star fixtures store the via node first; support the opposite endpoint
    # too. Interior via nodes require splitting the approach geometry and fail closed.
    if way.position not in {0, way.node_count - 1}:
        raise ExpansionError(f"way {way.way_id} has an interior via-node occurrence")
    forward_to_via = way.position == way.node_count - 1
    if direction == "yes":
        return forward_to_via
    if direction == "-1":
        return not forward_to_via
    return True


def _is_outbound(way: WayAtJunction, mode: str) -> bool:
    if not _access_allowed(way.tags, mode):
        return False
    direction = _effective_oneway(way.tags, mode)
    if way.position not in {0, way.node_count - 1}:
        raise ExpansionError(f"way {way.way_id} has an interior via-node occurrence")
    forward_from_via = way.position == 0
    if direction == "yes":
        return forward_from_via
    if direction == "-1":
        return not forward_from_via
    return True


def derive_allowed_transitions(
    node_id: int,
    incident_ways: list[WayAtJunction],
    restrictions: list[StaticRestriction],
) -> dict[str, set[tuple[int, int]]]:
    """Derive mode-specific (incoming way index, outgoing way index) sets."""
    for way in incident_ways:
        conditional = next(
            (key for key in UNSUPPORTED_CONDITIONAL_TAGS if key in way.tags), None
        )
        if conditional:
            raise ExpansionError(
                f"way {way.way_id} has unsupported conditional tag {conditional!r}"
            )
    indexes = {way.way_id: index for index, way in enumerate(incident_ways)}
    result: dict[str, set[tuple[int, int]]] = {}
    for mode in ("motorcar", "bicycle", "foot"):
        inbound = {index for index, way in enumerate(incident_ways) if _is_inbound(way, mode)}
        outbound = {index for index, way in enumerate(incident_ways) if _is_outbound(way, mode)}
        pairs = {(entry, exit_) for entry in inbound for exit_ in outbound}
        if mode == "foot":
            levels = [_normalized_level(way.tags, way.way_id) for way in incident_ways]
            pairs = {(entry, exit_) for entry, exit_ in pairs if levels[entry] == levels[exit_]}

        only_by_entry: dict[int, set[int]] = defaultdict(set)
        no_pairs: set[tuple[int, int]] = set()
        for restriction in restrictions:
            if restriction.via_node_id != node_id or mode not in restriction.modes:
                continue
            entry = indexes.get(restriction.from_way_id)
            exit_ = indexes.get(restriction.to_way_id)
            if entry is None or exit_ is None:
                raise ExpansionError(
                    f"relation {restriction.relation_id} references a from/to way outside via node {node_id}"
                )
            if restriction.restriction.startswith("only_"):
                only_by_entry[entry].add(exit_)
            elif restriction.restriction.startswith("no_"):
                no_pairs.add((entry, exit_))
            else:
                raise ExpansionError(f"relation {restriction.relation_id} has unsupported restriction={restriction.restriction!r}")
        pairs = {
            pair for pair in pairs
            if pair[0] not in only_by_entry or pair[1] in only_by_entry[pair[0]]
        }
        result[mode] = pairs - no_pairs
    return result


def build_expansion_plan(
    node_id: int,
    node_tags: dict[str, str],
    incident_ways: list[WayAtJunction],
    max_occurrences: int = OSR_DEFAULT_MAX_WAYS_PER_NODE,
    first_new_node_id: int = 1,
    first_new_way_id: int = 1,
    restrictions: list[StaticRestriction] | None = None,
    center_lon: float = 0.0,
    center_lat: float = 0.0,
) -> ExpansionPlan:
    if max_occurrences < 3:
        raise ExpansionError("max occurrence limit must be at least 3")
    if len(incident_ways) <= max_occurrences:
        return ExpansionPlan(node_id, len(incident_ways), (), {}, (), (), ())
    if node_tags:
        raise ExpansionError(
            f"overfull node {node_id} has node tags; signal/barrier/level behavior is unsupported"
        )

    per_way_occurrences: dict[int, int] = defaultdict(int)
    for way in incident_ways:
        per_way_occurrences[way.way_id] += 1
        _normalized_level(way.tags, way.way_id)
    repeated = sorted(way_id for way_id, count in per_way_occurrences.items() if count != 1)
    if repeated:
        raise ExpansionError(
            f"node {node_id} is repeated within affected way(s): {repeated[:12]}"
        )

    transitions = derive_allowed_transitions(node_id, incident_ways, restrictions or [])
    if not any(transitions.values()):
        raise ExpansionError(f"node {node_id} has no supported directed transitions to compile")

    replacement_nodes: list[int] = []
    replacement_node_locations: dict[int, tuple[float, float]] = {}
    replacement_ways: list[WaySpec] = []
    next_node_id, next_way_id = first_new_node_id, first_new_way_id
    summaries: list[dict[str, Any]] = []
    used_original_way_ids: set[int] = set()
    destination_roots: dict[tuple[str, int], int] = {}

    def new_node() -> int:
        nonlocal next_node_id
        value = next_node_id
        next_node_id += 1
        replacement_nodes.append(value)
        return value

    def add_way(
        node_ids: tuple[int, ...],
        tags: dict[str, str],
        preferred_id: int | None = None,
        locations: tuple[tuple[float, float], ...] = (),
    ) -> int:
        nonlocal next_way_id
        if preferred_id is not None and preferred_id not in used_original_way_ids:
            way_id = preferred_id
            used_original_way_ids.add(preferred_id)
        else:
            way_id = next_way_id
            next_way_id += 1
        replacement_ways.append(WaySpec(way_id, node_ids, tags, locations))
        return way_id

    def connector_tags(mode: str, level: str, layer: str | None) -> dict[str, str]:
        tags = {
            "highway": "service",
            "oneway": "yes",
            MODE_ONEWAY_TAG[mode]: "yes",
            "level": level,
        }
        tags.update(_isolated_mode_access_tags(mode))
        if layer is not None:
            tags["layer"] = layer
        return tags

    def add_connector(start: int, end: int, mode: str, level: str, layer: str | None) -> None:
        add_way((start, end), connector_tags(mode, level, layer))

    def add_approach(way: WayAtJunction, mode: str, direction: str, port: int) -> None:
        original_nodes = way.node_ids
        if not original_nodes:
            # Pure planner callers may provide only the local two-node shape.
            original_nodes = (node_id, -way.way_id) if way.position == 0 else (-way.way_id, node_id)
        if way.node_count != len(original_nodes) or way.position not in {0, way.node_count - 1}:
            raise ExpansionError(f"way {way.way_id} has unsupported via-node geometry")
        if way.node_count != 2:
            raise ExpansionError(
                f"way {way.way_id} needs unsupported non-star geometry at overfull node {node_id}"
            )
        if direction == "in":
            follows_refs = way.position == way.node_count - 1
        else:
            follows_refs = way.position == 0
        oneway = "yes" if follows_refs else "-1"
        effective_access = _effective_access(way.tags, mode) or "no"
        tags = {key: value for key, value in way.tags.items() if key not in ACCESS_AND_DIRECTION_KEYS and not key.startswith("oneway:")}
        tags.update(_isolated_mode_access_tags(mode, effective_access))
        tags.update({"oneway": oneway, MODE_ONEWAY_TAG[mode]: oneway})
        changed_nodes = list(original_nodes)
        changed_nodes[way.position] = port
        # Keep the original exterior endpoint shared by mode/direction clones.
        # It is outside the compiled junction topology; cloning it into several
        # nearby coordinates made coordinate-snapped routers select a parallel
        # copy and report phantom turn reachability.
        add_way(tuple(changed_nodes), tags, way.way_id, way.node_locations)

    def make_binary_tree(
        root: int, leaf_labels: list[int], *, forward: bool, mode: str, level: str, layer: str | None
    ) -> dict[int, int]:
        """Make a bounded binary tree; return leaf-label to node ID."""
        if not leaf_labels:
            return {}
        if len(leaf_labels) == 1:
            return {leaf_labels[0]: root}

        def build(parent: int, labels: list[int]) -> dict[int, int]:
            if len(labels) == 1:
                return {labels[0]: parent}
            midpoint = len(labels) // 2
            children = (new_node(), new_node())
            for child in children:
                if forward:
                    add_connector(parent, child, mode, level, layer)
                else:
                    add_connector(child, parent, mode, level, layer)
            return build(children[0], labels[:midpoint]) | build(children[1], labels[midpoint:])

        return build(root, leaf_labels)

    for mode in ("motorcar", "bicycle", "foot"):
        pairs = sorted(transitions[mode])
        entries_by_way: dict[int, list[int]] = defaultdict(list)
        exits_by_way: dict[int, list[int]] = defaultdict(list)
        for entry, exit_ in pairs:
            entries_by_way[entry].append(exit_)
            exits_by_way[exit_].append(entry)
        destination_leaf_nodes: dict[tuple[int, int], int] = {}
        for exit_ in sorted(exits_by_way):
            destination = incident_ways[exit_]
            target_root = new_node()
            destination_roots[(mode, exit_)] = target_root
            add_approach(destination, mode, "out", target_root)
            leaves = make_binary_tree(
                target_root, sorted(exits_by_way[exit_]), forward=False, mode=mode,
                level=_normalized_level(destination.tags, destination.way_id), layer=destination.tags.get("layer"),
            )
            for entry, leaf in leaves.items():
                destination_leaf_nodes[(entry, exit_)] = leaf
        for entry in sorted(entries_by_way):
            way = incident_ways[entry]
            root = new_node()
            add_approach(way, mode, "in", root)
            leaves = make_binary_tree(
                root, entries_by_way[entry], forward=True, mode=mode,
                level=_normalized_level(way.tags, way.way_id), layer=way.tags.get("layer"),
            )
            for exit_ in entries_by_way[entry]:
                add_connector(
                    leaves[exit_], destination_leaf_nodes[(entry, exit_)], mode,
                    _normalized_level(way.tags, way.way_id), way.tags.get("layer"),
                )
        summaries.append({"mode": mode, "transition_count": len(pairs)})

    topology_nodes = replacement_nodes
    if topology_nodes:
        grid_width = math.ceil(math.sqrt(len(topology_nodes)))
        spacing_m = min(0.025, 6.4 / grid_width)
        longitude_scale = 111_320 * math.cos(math.radians(center_lat))
        for index, synthetic_id in enumerate(topology_nodes):
            column, row = index % grid_width, index // grid_width
            east_m = (column - (grid_width - 1) / 2) * spacing_m
            north_m = (row - (grid_width - 1) / 2) * spacing_m
            replacement_node_locations[synthetic_id] = (
                center_lon + east_m / longitude_scale,
                center_lat + north_m / 111_320,
            )

    return ExpansionPlan(
        node_id=node_id,
        original_occurrences=len(incident_ways),
        replacement_nodes=tuple(replacement_nodes),
        replacement_node_locations=replacement_node_locations,
        replacement_ways=tuple(replacement_ways),
        removed_relation_ids=tuple(sorted({item.relation_id for item in restrictions or []})),
        group_summary=tuple(summaries),
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _entity_max_id(entity: Any, current: int) -> int:
    return max(current, int(entity.id))


def _new_reference(ref: int, location: Any) -> NodeRef:
    return NodeRef(ref=ref, location=location)


def _occurrence_database(
    osm_path: Path, database_path: Path, retained_only: bool = True
) -> tuple[sqlite3.Connection, int]:
    db = sqlite3.connect(database_path)
    db.execute("PRAGMA journal_mode=OFF")
    db.execute("PRAGMA synchronous=OFF")
    db.execute("PRAGMA temp_store=FILE")
    db.execute("PRAGMA cache_size=-65536")
    db.execute("CREATE TABLE occurrence (node_id INTEGER PRIMARY KEY, n INTEGER NOT NULL)")
    maximum_id = 0

    class Counter(osmium.SimpleHandler):
        def __init__(self) -> None:
            super().__init__()
            self.pending: list[tuple[int]] = []

        def node(self, node: Any) -> None:
            nonlocal maximum_id
            maximum_id = _entity_max_id(node, maximum_id)

        def way(self, way: Any) -> None:
            nonlocal maximum_id
            maximum_id = _entity_max_id(way, maximum_id)
            tags = _tag_map(way.tags)
            if retained_only and not is_retained_highway(tags):
                return
            self.pending.extend((int(node.ref),) for node in way.nodes)
            if len(self.pending) >= 50_000:
                self.flush()

        def relation(self, relation: Any) -> None:
            nonlocal maximum_id
            maximum_id = _entity_max_id(relation, maximum_id)

        def flush(self) -> None:
            if self.pending:
                db.executemany(
                    "INSERT INTO occurrence(node_id, n) VALUES (?, 1) "
                    "ON CONFLICT(node_id) DO UPDATE SET n=n+1",
                    self.pending,
                )
                self.pending.clear()
                db.commit()

    counter = Counter()
    try:
        counter.apply_file(str(osm_path), locations=False)
        counter.flush()
        db.commit()
    except Exception:
        db.close()
        raise
    return db, maximum_id


def _load_target_metadata(
    path: Path, target_ids: set[int]
) -> tuple[dict[int, NodeInfo], dict[int, list[WayAtJunction]], set[int], list[StaticRestriction]]:
    target_nodes: dict[int, NodeInfo] = {}
    target_ways: dict[int, list[WayAtJunction]] = defaultdict(list)
    target_way_ids: set[int] = set()

    class EntityLoader(osmium.SimpleHandler):
        def node(self, node: Any) -> None:
            if node.id in target_ids:
                target_nodes[int(node.id)] = NodeInfo(
                    node_id=int(node.id),
                    lon=float(node.location.lon),
                    lat=float(node.location.lat),
                    tags=_tag_map(node.tags),
                )

        def way(self, way: Any) -> None:
            tags = _tag_map(way.tags)
            if not is_retained_highway(tags):
                return
            refs = tuple(int(node.ref) for node in way.nodes)
            locations = tuple((float(node.lon), float(node.lat)) for node in way.nodes)
            matches = [(position, ref) for position, ref in enumerate(refs) if ref in target_ids]
            for position, node_id in matches:
                target_ways[node_id].append(
                    WayAtJunction(int(way.id), position, tags, len(refs), refs, locations)
                )
                target_way_ids.add(int(way.id))

    EntityLoader().apply_file(str(path), locations=True)
    missing = target_ids - target_nodes.keys()
    if missing:
        raise ExpansionError(f"overfull node(s) missing coordinate records: {sorted(missing)[:12]}")

    restrictions: list[StaticRestriction] = []
    way_to_nodes = {
        way_id: {node_id for node_id, ways in target_ways.items() for way in ways if way.way_id == way_id}
        for way_id in target_way_ids
    }

    class RelationLoader(osmium.SimpleHandler):
        def relation(self, relation: Any) -> None:
            tags = _tag_map(relation.tags)
            members = [(member.type, int(member.ref), member.role) for member in relation.members]
            relevant_node = any(kind == "n" and ref in target_ids for kind, ref, _ in members)
            relevant_way = any(kind == "w" and ref in target_way_ids for kind, ref, _ in members)
            if not relevant_node and not relevant_way:
                return
            relation_id = int(relation.id)
            if tags.get("type") != "restriction":
                raise ExpansionError(
                    f"relation {relation_id} (type={tags.get('type', 'unknown')}) references a transformed junction or way"
                )
            if any(key.startswith("restriction") and key.endswith(":conditional") for key in tags):
                raise ExpansionError(f"relation {relation_id} has unsupported conditional restriction semantics")
            by_role: dict[str, list[tuple[str, int]]] = defaultdict(list)
            for kind, ref, role in members:
                by_role[role].append((kind, ref))
            if any(len(by_role[role]) != 1 for role in ("from", "to", "via")) or set(by_role) != {"from", "to", "via"}:
                raise ExpansionError(f"relation {relation_id} has malformed restriction member roles")
            (from_type, from_way), = by_role["from"]
            (to_type, to_way), = by_role["to"]
            (via_type, via_node), = by_role["via"]
            if (from_type, to_type, via_type) != ("w", "w", "n"):
                raise ExpansionError(f"relation {relation_id} is not a static via-node restriction")
            if via_node not in target_ids or from_way not in target_way_ids or to_way not in target_way_ids:
                raise ExpansionError(f"relation {relation_id} references a transformed way outside its via-node")
            if via_node not in way_to_nodes.get(from_way, set()) or via_node not in way_to_nodes.get(to_way, set()):
                raise ExpansionError(f"relation {relation_id} has from/to way members that do not meet via node {via_node}")
            except_values = {
                value.strip().lower()
                for value in tags.get("except", "").replace(",", ";").split(";")
                if value.strip()
            }
            relation_supported = False
            for mode in ("motorcar", "bicycle", "foot"):
                if MODE_EXCEPTIONS[mode] & except_values:
                    continue
                restriction_value = next(
                    (tags[key] for key in MODE_RESTRICTION_KEYS[mode] if key in tags), None
                )
                if restriction_value is None:
                    continue
                restriction_value = restriction_value.strip().lower()
                if not (restriction_value.startswith("no_") or restriction_value.startswith("only_")):
                    raise ExpansionError(
                        f"relation {relation_id} has unsupported restriction={restriction_value!r}"
                    )
                restrictions.append(
                    StaticRestriction(relation_id, from_way, to_way, via_node, restriction_value, (mode,))
                )
                relation_supported = True
            if not relation_supported:
                restrictions.append(
                    StaticRestriction(relation_id, from_way, to_way, via_node, "no_ignored", ())
                )

    RelationLoader().apply_file(str(path), locations=False)
    return target_nodes, target_ways, target_way_ids, restrictions


def _header_for(path: Path) -> Any:
    reader = osmium.io.Reader(str(path))
    try:
        return reader.header()
    finally:
        reader.close()


def _write_output(
    source: Path,
    temporary_output: Path,
    header: Any,
    target_nodes: dict[int, NodeInfo],
    plans: dict[int, ExpansionPlan],
    target_way_ids: set[int],
) -> None:
    synthetic_nodes = [node_id for plan in plans.values() for node_id in plan.replacement_nodes]
    replacement_ways = [way for plan in plans.values() for way in plan.replacement_ways]
    removed_relations = {relation_id for plan in plans.values() for relation_id in plan.removed_relation_ids}
    writer = osmium.SimpleWriter(str(temporary_output), header=header, overwrite=True)
    node_locations: dict[int, Any] = {}
    for node_id, info in target_nodes.items():
        node_locations[node_id] = info.location
    replacement_locations = {
        node_id: coordinates
        for plan in plans.values()
        for node_id, coordinates in plan.replacement_node_locations.items()
    }
    for node_id, coordinates in replacement_locations.items():
        node_locations[node_id] = osmium.osm.Location(*coordinates)

    try:
        for node in osmium.FileProcessor(str(source), osmium.osm.osm_entity_bits.NODE):
            writer.add_node(node)
        for node_id in sorted(synthetic_nodes):
            writer.add_node(
                Node(
                    id=node_id,
                    version=1,
                    location=node_locations[node_id],
                    tags={},
                )
            )
        for way in osmium.FileProcessor(str(source), osmium.osm.osm_entity_bits.WAY):
            if way.id not in target_way_ids:
                writer.add_way(way)
        for relation in osmium.FileProcessor(str(source), osmium.osm.osm_entity_bits.RELATION):
            if relation.id not in removed_relations:
                writer.add_relation(relation)
        for replacement in replacement_ways:
            try:
                refs = [
                    _new_reference(
                        ref,
                        node_locations[ref]
                        if ref in node_locations
                        else osmium.osm.Location(*replacement.node_locations[position]),
                    )
                    for position, ref in enumerate(replacement.node_ids)
                ]
            except (KeyError, IndexError) as exc:
                raise ExpansionError(f"synthetic way {replacement.way_id} has no coordinate for node reference") from exc
            writer.add_way(Way(id=replacement.way_id, version=1, nodes=refs, tags=replacement.tags))
    except Exception:
        writer.close()
        raise
    writer.close()


def _validate_output(
    path: Path,
    max_occurrences: int,
    synthetic_nodes: set[int],
    touched_nodes: set[int],
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="osm-junction-validate-") as directory:
        db_path = Path(directory) / "occurrences.sqlite"
        db, _ = _occurrence_database(path, db_path, retained_only=True)
        try:
            overflow = list(
                db.execute(
                    "SELECT node_id, n FROM occurrence WHERE n > ? ORDER BY node_id LIMIT 20",
                    (max_occurrences,),
                )
            )
            synthetic_counts: dict[int, int] = {}
            sorted_synthetic = sorted(synthetic_nodes)
            for offset in range(0, len(sorted_synthetic), 500):
                batch = sorted_synthetic[offset : offset + 500]
                synthetic_counts.update(
                    {
                        int(node_id): int(count)
                        for node_id, count in db.execute(
                            "SELECT node_id, n FROM occurrence WHERE node_id IN "
                            f"({','.join('?' for _ in batch)})",
                            tuple(batch),
                        )
                    }
                )
            touched_counts: dict[int, int] = {}
            sorted_touched = sorted(touched_nodes)
            for offset in range(0, len(sorted_touched), 500):
                batch = sorted_touched[offset : offset + 500]
                touched_counts.update(
                    {
                        int(node_id): int(count)
                        for node_id, count in db.execute(
                            "SELECT node_id, n FROM occurrence WHERE node_id IN "
                            f"({','.join('?' for _ in batch)})",
                            tuple(batch),
                        )
                    }
                )
        finally:
            db.close()
    if overflow:
        details = ", ".join(f"{node_id}:{count}" for node_id, count in overflow)
        raise ExpansionError(f"output still exceeds {max_occurrences} occurrences ({details})")
    if set(synthetic_counts) != synthetic_nodes:
        missing = sorted(synthetic_nodes - synthetic_counts.keys())
        raise ExpansionError(f"synthetic node(s) have no retained way occurrence: {missing[:12]}")
    return {
        "max_retained_occurrences_after": max(touched_counts.values(), default=0),
        "synthetic_node_occurrences": synthetic_counts,
        "touched_node_occurrences": touched_counts,
    }


def expand_osm_file(
    input_path: str | os.PathLike[str],
    output_path: str | os.PathLike[str],
    *,
    max_occurrences: int = OSR_DEFAULT_MAX_WAYS_PER_NODE,
) -> dict[str, Any]:
    source = Path(input_path).resolve()
    destination = Path(output_path).resolve()
    if source == destination:
        raise ExpansionError("input and output paths must be different")
    if not source.is_file():
        raise FileNotFoundError(source)
    if max_occurrences < 3:
        raise ExpansionError("max occurrence limit must be at least 3")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_output = destination.with_name(f".{destination.stem}.tmp{destination.suffix}")
    if temporary_output.exists():
        temporary_output.unlink()

    with tempfile.TemporaryDirectory(prefix="osm-junction-expander-") as directory:
        db, maximum_id = _occurrence_database(source, Path(directory) / "occurrences.sqlite")
        try:
            target_counts = {
                int(node_id): int(count)
                for node_id, count in db.execute(
                    "SELECT node_id, n FROM occurrence WHERE n > ? ORDER BY node_id",
                    (max_occurrences,),
                )
            }
        finally:
            db.close()

        if not target_counts:
            # Still produce a canonical PBF copy so downstream callers can use
            # a single output path. Existing entities are copied without edits.
            target_nodes: dict[int, Any] = {}
            target_ways: dict[int, list[WayAtJunction]] = {}
            target_way_ids: set[int] = set()
            target_restrictions: list[StaticRestriction] = []
            plans: dict[int, ExpansionPlan] = {}
        else:
            target_ids = set(target_counts)
            target_nodes, target_ways, target_way_ids, target_restrictions = _load_target_metadata(source, target_ids)
            owners: dict[int, set[int]] = defaultdict(set)
            for node_id, ways in target_ways.items():
                for way in ways:
                    owners[way.way_id].add(node_id)
            shared_ways = {way_id: ids for way_id, ids in owners.items() if len(ids) > 1}
            if shared_ways:
                way_id = min(shared_ways)
                raise ExpansionError(
                    f"way {way_id} connects multiple transformed junction nodes {sorted(shared_ways[way_id])[:8]}"
                )
            next_node_id = maximum_id + 1
            next_way_id = maximum_id + 1
            if next_node_id > (2**63 - 1) - sum(target_counts.values()):
                raise ExpansionError("no safe positive OSM IDs remain for synthetic elements")
            plans = {}
            for node_id in sorted(target_counts):
                actual = len(target_ways.get(node_id, []))
                if actual != target_counts[node_id]:
                    raise ExpansionError(
                        f"candidate count disagrees with collected highway ways at node {node_id}: "
                        f"count={target_counts[node_id]}, ways={actual}"
                    )
                plan = build_expansion_plan(
                    node_id,
                    target_nodes[node_id].tags,
                    target_ways.get(node_id, []),
                    max_occurrences,
                    next_node_id,
                    next_way_id,
                    [item for item in target_restrictions if item.via_node_id == node_id],
                    target_nodes[node_id].lon,
                    target_nodes[node_id].lat,
                )
                plans[node_id] = plan
                next_node_id += len(plan.replacement_nodes)
                next_way_id += len(plan.replacement_ways)

        header = _header_for(source)
        try:
            _write_output(source, temporary_output, header, target_nodes, plans, target_way_ids)
            synthetic_ids = {
                node_id for plan in plans.values() for node_id in plan.replacement_nodes
            }
            touched_ids = set(synthetic_ids)
            for plan in plans.values():
                for replacement in plan.replacement_ways:
                    touched_ids.update(replacement.node_ids)
            validation = _validate_output(
                temporary_output, max_occurrences, synthetic_ids, touched_ids
            )
            os.replace(temporary_output, destination)
        except Exception:
            if temporary_output.exists():
                temporary_output.unlink()
            raise

    before_max = max(target_counts.values(), default=0)
    changed = [
        plan for plan in plans.values() if plan.original_occurrences > max_occurrences
    ]
    return {
        "input": str(source),
        "output": str(destination),
        "input_sha256": _sha256(source),
        "output_sha256": _sha256(destination),
        "max_occurrences": max_occurrences,
        "candidate_highway_occurrences_before": before_max,
        "expanded_nodes": len(changed),
        "synthetic_nodes": sum(len(plan.replacement_nodes) for plan in plans.values()),
        "connector_ways": sum(len(plan.replacement_ways) for plan in plans.values()),
        "node_plans": [
            {
                "osm_node_id": plan.node_id,
                "original_occurrences": plan.original_occurrences,
                "mode_transitions": list(plan.group_summary),
            }
            for plan in changed
        ],
        **validation,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="source OSM PBF file")
    parser.add_argument("output", type=Path, help="separate destination OSM PBF file")
    parser.add_argument(
        "--max-occurrences",
        type=int,
        default=OSR_DEFAULT_MAX_WAYS_PER_NODE,
        help="maximum retained highway way-node occurrences at each node (default: 16)",
    )
    args = parser.parse_args(argv)
    try:
        print(json.dumps(expand_osm_file(args.input, args.output, max_occurrences=args.max_occurrences), indent=2))
    except (ExpansionError, OSError, RuntimeError) as exc:
        print(f"junction expansion failed: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

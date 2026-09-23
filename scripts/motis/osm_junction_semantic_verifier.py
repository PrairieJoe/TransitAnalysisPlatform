"""Independently read fixture PBFs and compare directed mode transition sets.

This module has its own small OSM PBF reader and routing interpretation. It
does not import the fixture writer, the expander, or the expander's helpers.
The expected transition matrix comes only from the hand-authored ``oracle``
section of the JSON fixture; the actual matrix comes from the PBF bytes.
"""

from __future__ import annotations

import json
import math
import struct
import zlib
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Iterable


def _read_varint(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while offset < len(data):
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, offset
        shift += 7
        if shift >= 70:
            raise ValueError("invalid protobuf varint")
    raise ValueError("truncated protobuf varint")


def _unzigzag(value: int) -> int:
    return -(value // 2) - 1 if value & 1 else value // 2


def _fields(data: bytes) -> Iterable[tuple[int, int, int | bytes]]:
    offset = 0
    while offset < len(data):
        tag, offset = _read_varint(data, offset)
        number, wire = tag >> 3, tag & 7
        if wire == 0:
            value, offset = _read_varint(data, offset)
            yield number, wire, value
        elif wire == 1:
            if offset + 8 > len(data):
                raise ValueError("truncated fixed64 protobuf field")
            yield number, wire, data[offset : offset + 8]
            offset += 8
        elif wire == 2:
            size, offset = _read_varint(data, offset)
            if offset + size > len(data):
                raise ValueError("truncated length-delimited protobuf field")
            yield number, wire, data[offset : offset + size]
            offset += size
        elif wire == 5:
            if offset + 4 > len(data):
                raise ValueError("truncated fixed32 protobuf field")
            yield number, wire, data[offset : offset + 4]
            offset += 4
        else:
            raise ValueError(f"unsupported protobuf wire type {wire}")


def _packed_varints(data: bytes) -> list[int]:
    values: list[int] = []
    offset = 0
    while offset < len(data):
        value, offset = _read_varint(data, offset)
        values.append(value)
    return values


def _tag_map(keys: list[int], values: list[int], strings: list[str]) -> dict[str, str]:
    if len(keys) != len(values):
        raise ValueError("OSM tag key/value count differs")
    return {strings[key]: strings[value] for key, value in zip(keys, values)}


def _parse_node(data: bytes, strings: list[str], granularity: int, lat_offset: int, lon_offset: int) -> dict:
    values = {number: value for number, wire, value in _fields(data) if wire == 0}
    packed = {number: value for number, wire, value in _fields(data) if wire == 2}
    node_id = _unzigzag(int(values[1]))
    lat = lat_offset + granularity * _unzigzag(int(values[8]))
    lon = lon_offset + granularity * _unzigzag(int(values[9]))
    keys = _packed_varints(bytes(packed.get(2, b"")))
    tags = _packed_varints(bytes(packed.get(3, b"")))
    return {"id": node_id, "lon": lon / 1_000_000_000, "lat": lat / 1_000_000_000, "tags": _tag_map(keys, tags, strings)}


def _parse_dense(data: bytes, strings: list[str], granularity: int, lat_offset: int, lon_offset: int) -> list[dict]:
    packed = {number: value for number, wire, value in _fields(data) if wire == 2}
    ids = [_unzigzag(value) for value in _packed_varints(bytes(packed.get(1, b"")))]
    lats = [_unzigzag(value) for value in _packed_varints(bytes(packed.get(8, b"")))]
    lons = [_unzigzag(value) for value in _packed_varints(bytes(packed.get(9, b"")))]
    kv = _packed_varints(bytes(packed.get(10, b"")))
    if not (len(ids) == len(lats) == len(lons)):
        raise ValueError("dense node id/coordinate count differs")
    nodes: list[dict] = []
    current_id = current_lat = current_lon = 0
    cursor = 0
    for index in range(len(ids)):
        current_id += ids[index]
        current_lat += lats[index]
        current_lon += lons[index]
        tags: dict[str, str] = {}
        while cursor < len(kv) and kv[cursor] != 0:
            if cursor + 1 >= len(kv):
                raise ValueError("dense node tags end mid-pair")
            tags[strings[kv[cursor]]] = strings[kv[cursor + 1]]
            cursor += 2
        cursor += 1
        nodes.append({
            "id": current_id,
            "lon": (lon_offset + granularity * current_lon) / 1_000_000_000,
            "lat": (lat_offset + granularity * current_lat) / 1_000_000_000,
            "tags": tags,
        })
    return nodes


def _parse_way(data: bytes, strings: list[str]) -> dict:
    scalars: dict[int, int] = {}
    packed: dict[int, bytes] = {}
    for number, wire, value in _fields(data):
        if wire == 0:
            scalars[number] = int(value)
        elif wire == 2:
            packed[number] = bytes(value)
    refs: list[int] = []
    current = 0
    for delta in _packed_varints(packed.get(8, b"")):
        current += _unzigzag(delta)
        refs.append(current)
    return {
        "id": int(scalars[1]),
        "nodes": refs,
        "tags": _tag_map(_packed_varints(packed.get(2, b"")), _packed_varints(packed.get(3, b"")), strings),
    }


def _parse_relation(data: bytes, strings: list[str]) -> dict:
    scalars: dict[int, int] = {}
    packed: dict[int, bytes] = {}
    for number, wire, value in _fields(data):
        if wire == 0:
            scalars[number] = int(value)
        elif wire == 2:
            packed[number] = bytes(value)
    roles = _packed_varints(packed.get(8, b""))
    deltas = [_unzigzag(value) for value in _packed_varints(packed.get(9, b""))]
    types = _packed_varints(packed.get(10, b""))
    if not (len(roles) == len(deltas) == len(types)):
        raise ValueError("OSM relation member arrays differ in length")
    members: list[dict] = []
    current = 0
    member_types = {0: "node", 1: "way", 2: "relation"}
    for role, delta, member_type in zip(roles, deltas, types):
        current += delta
        members.append({"type": member_types[member_type], "ref": current, "role": strings[role]})
    return {
        "id": int(scalars[1]),
        "members": members,
        "tags": _tag_map(_packed_varints(packed.get(2, b"")), _packed_varints(packed.get(3, b"")), strings),
    }


def _parse_primitive_block(data: bytes, output: dict[str, dict[int, dict]]) -> None:
    strings: list[str] = []
    groups: list[bytes] = []
    scalars: dict[int, int] = {}
    for number, wire, value in _fields(data):
        if number == 1 and wire == 2:
            strings = [bytes(item).decode("utf-8") for field, item_wire, item in _fields(bytes(value)) if field == 1 and item_wire == 2]
        elif number == 2 and wire == 2:
            groups.append(bytes(value))
        elif wire == 0:
            scalars[number] = int(value)
    granularity = scalars.get(17, 100)
    lat_offset = scalars.get(19, 0)
    lon_offset = scalars.get(20, 0)
    if not strings or strings[0] != "":
        raise ValueError("OSM PBF string table must start with the empty string")
    for group in groups:
        for number, wire, value in _fields(group):
            if wire != 2:
                continue
            raw = bytes(value)
            if number == 1:
                node = _parse_node(raw, strings, granularity, lat_offset, lon_offset)
                output["nodes"][node["id"]] = node
            elif number == 2:
                for node in _parse_dense(raw, strings, granularity, lat_offset, lon_offset):
                    output["nodes"][node["id"]] = node
            elif number == 3:
                way = _parse_way(raw, strings)
                output["ways"][way["id"]] = way
            elif number == 4:
                relation = _parse_relation(raw, strings)
                output["relations"][relation["id"]] = relation


def read_osm_pbf(path: str | Path) -> dict[str, dict[int, dict]]:
    """Read the OSM entities needed for routing from an unindexed PBF file."""
    source = Path(path)
    output: dict[str, dict[int, dict]] = {"nodes": {}, "ways": {}, "relations": {}}
    with source.open("rb") as stream:
        while True:
            size_bytes = stream.read(4)
            if not size_bytes:
                break
            if len(size_bytes) != 4:
                raise ValueError("truncated OSM PBF blob header length")
            header_size = struct.unpack(">I", size_bytes)[0]
            header = stream.read(header_size)
            if len(header) != header_size:
                raise ValueError("truncated OSM PBF blob header")
            header_values = {number: value for number, wire, value in _fields(header) if wire == 2}
            blob_type = bytes(header_values[1]).decode("utf-8")
            blob_size = next(int(value) for number, wire, value in _fields(header) if number == 3 and wire == 0)
            blob_data = stream.read(blob_size)
            if len(blob_data) != blob_size:
                raise ValueError(f"truncated {blob_type} PBF blob")
            blob = {number: value for number, wire, value in _fields(blob_data) if wire == 2}
            if 1 in blob:
                raw = bytes(blob[1])
            elif 3 in blob:
                raw = zlib.decompress(bytes(blob[3]))
            else:
                raise ValueError(f"unsupported compression in {blob_type} PBF blob")
            if blob_type == "OSMData":
                _parse_primitive_block(raw, output)
    return output


def _pairs_for_oracle(fixture: dict[str, Any], mode: str) -> set[tuple[int, int]]:
    count = int(fixture["spokes"])
    oracle = fixture.get("oracle", {})
    mode_rule = dict(oracle.get("all_modes_rule", {}))
    if oracle.get("all_modes") == "all_directed_pairs":
        mode_rule = {}
    mode_rule.update(oracle.get(mode, {}))
    entries = set(range(count)) - {int(index) for index in mode_rule.get("entry_forbidden", [])}
    exits = set(range(count)) - {int(index) for index in mode_rule.get("exit_forbidden", [])}
    denied = {int(index) for index in mode_rule.get("denied_spokes", [])}
    entries -= denied
    exits -= denied
    pairs = {(entry, exit_) for entry in entries for exit_ in exits}

    count_key = str(count)
    if oracle.get("all_modes") == "same_level_only":
        levels = {int(index): str(level) for index, level in oracle["levels_by_spokes"][count_key].items()}
        pairs = {(entry, exit_) for entry, exit_ in pairs if levels[entry] == levels[exit_]}
    if oracle.get("all_modes") == "same_layer_only":
        layers = {int(index): str(layer) for index, layer in oracle["layers_by_spokes"][count_key].items()}
        pairs = {(entry, exit_) for entry, exit_ in pairs if layers[entry] == layers[exit_]}
    level_groups = mode_rule.get("same_level_groups_by_spokes", {}).get(count_key)
    if level_groups:
        pairs = {
            (int(entry), int(exit_))
            for group in level_groups
            for entry in group
            for exit_ in group
        }

    for entry, exit_ in mode_rule.get("forbidden_by_spokes", {}).get(count_key, []):
        pairs.discard((int(entry), int(exit_)))
    for entry, exit_ in mode_rule.get("conditional_forbidden_by_spokes", {}).get(count_key, []):
        # The unconditional oracle describes the outside-of-window state.
        if fixture.get("relation_kind") != "conditional":
            pairs.discard((int(entry), int(exit_)))
    only = mode_rule.get("only_by_spokes", {}).get(count_key, [])
    if only:
        restrictions_by_entry: dict[int, set[int]] = defaultdict(set)
        for entry, exit_ in only:
            restrictions_by_entry[int(entry)].add(int(exit_))
        pairs = {
            pair for pair in pairs
            if pair[0] not in restrictions_by_entry or pair[1] in restrictions_by_entry[pair[0]]
        }
    return pairs


def _access_allowed(tags: dict[str, str], mode: str) -> bool:
    keys = {
        "motorcar": ("motorcar", "motor_vehicle", "vehicle", "access"),
        "bicycle": ("bicycle", "vehicle", "access"),
        "foot": ("foot", "access"),
    }[mode]
    for key in keys:
        value = tags.get(key, "").lower()
        if value:
            return value not in {"no", "private"}
    return True


def _oneway_directions(tags: dict[str, str], mode: str) -> tuple[bool, bool]:
    """Return (forward, reverse) for node refs in their stored order."""
    if mode == "foot":
        value = tags.get("oneway:foot", "no").lower()
    elif mode == "bicycle":
        value = tags.get("oneway:bicycle", tags.get("oneway", "no")).lower()
    else:
        value = tags.get("oneway:motor_vehicle", tags.get("oneway:motorcar", tags.get("oneway", "no"))).lower()
    if value in {"yes", "1", "true"}:
        return True, False
    if value == "-1":
        return False, True
    return True, True


def _normalized_numeric_tag(tags: dict[str, str], key: str, default: str = "0") -> str:
    value = tags.get(key, default)
    try:
        numeric = float(value)
        if math.isfinite(numeric):
            return str(numeric)
    except ValueError:
        pass
    return value


def _valid_restriction_relation(relation: dict) -> tuple[dict | None, str | None]:
    if relation["tags"].get("type") != "restriction":
        return None, None
    roles = {member["role"]: member for member in relation["members"]}
    if len(roles) != len(relation["members"]) or not {"from", "to", "via"}.issubset(roles):
        return None, f"relation {relation['id']} has malformed restriction member roles"
    return roles, None


def _restriction_applies(relation: dict, mode: str) -> tuple[str | None, str | None]:
    tags = relation["tags"]
    if any(key.endswith(":conditional") for key in tags if key.startswith("restriction")):
        return None, f"relation {relation['id']} has conditional restriction semantics"
    restriction = tags.get(f"restriction:{mode}", tags.get("restriction"))
    if not restriction:
        return None, None
    if not (restriction.startswith("no_") or restriction.startswith("only_")):
        return None, f"relation {relation['id']} has unsupported restriction={restriction!r}"
    exceptions = {value.strip().lower() for value in tags.get("except", "").replace(",", ";").split(";") if value.strip()}
    aliases = {"motorcar": {"motorcar", "motor_vehicle", "vehicle", "motor_vehicle"}, "bicycle": {"bicycle", "vehicle"}, "foot": {"foot", "pedestrian"}}
    if exceptions.intersection(aliases[mode]):
        return None, None
    return restriction, None


def _actual_transition_matrix(document: dict[str, dict[int, dict]], fixture: dict[str, Any], mode: str) -> tuple[set[tuple[int, int]], list[str]]:
    endpoint_base = int(fixture["endpoint_node_id_base"])
    count = int(fixture["spokes"])
    canonical_endpoints = {
        index: document["nodes"][endpoint_base + index]
        for index in range(count)
        if endpoint_base + index in document["nodes"]
    }
    endpoint_ids: dict[int, int] = {}
    for node_id, node in document["nodes"].items():
        closest: tuple[float, int] | None = None
        for index, endpoint in canonical_endpoints.items():
            dx = (node["lon"] - endpoint["lon"]) * 111_320 * math.cos(math.radians(endpoint["lat"]))
            dy = (node["lat"] - endpoint["lat"]) * 111_320
            distance = math.hypot(dx, dy)
            if closest is None or distance < closest[0]:
                closest = (distance, index)
        if closest is not None and closest[0] <= 2.0:
            endpoint_ids[node_id] = closest[1]
    entry_nodes = {
        index: [node_id for node_id, found_index in endpoint_ids.items() if found_index == index]
        for index in range(count)
    }
    outgoing: dict[int, list[tuple[int, int]]] = defaultdict(list)
    only_targets: dict[tuple[int, int], set[int]] = defaultdict(set)
    no_pairs: set[tuple[int, int, int]] = set()
    unsupported: list[str] = []

    for relation in document["relations"].values():
        roles, malformed = _valid_restriction_relation(relation)
        if malformed:
            unsupported.append(malformed)
            continue
        if roles is None:
            continue
        restriction, issue = _restriction_applies(relation, mode)
        if issue:
            unsupported.append(issue)
            continue
        if restriction is None:
            continue
        if roles["via"]["type"] != "node" or roles["from"]["type"] != "way" or roles["to"]["type"] != "way":
            unsupported.append(f"relation {relation['id']} is a via-way or non-via-node restriction")
            continue
        if int(roles["via"]["ref"]) not in document["nodes"]:
            unsupported.append(f"relation {relation['id']} references missing via node {roles['via']['ref']}")
            continue
        if int(roles["from"]["ref"]) not in document["ways"] or int(roles["to"]["ref"]) not in document["ways"]:
            unsupported.append(f"relation {relation['id']} references missing from/to way")
            continue
        via = int(roles["via"]["ref"])
        from_way = int(roles["from"]["ref"])
        to_way = int(roles["to"]["ref"])
        if restriction.startswith("only_"):
            only_targets[(via, from_way)].add(to_way)
        elif restriction.startswith("no_"):
            no_pairs.add((via, from_way, to_way))

    for way in document["ways"].values():
        tags = way["tags"]
        if "highway" not in tags or not _access_allowed(tags, mode):
            continue
        forward, reverse = _oneway_directions(tags, mode)
        refs = way["nodes"]
        for left, right in zip(refs, refs[1:]):
            if forward:
                outgoing[left].append((right, way["id"]))
            if reverse:
                outgoing[right].append((left, way["id"]))

    matrix: set[tuple[int, int]] = set()
    for entry_index in range(count):
        queue = deque(
            (next_node, way_id)
            for entry_endpoint in entry_nodes[entry_index]
            for next_node, way_id in outgoing.get(entry_endpoint, [])
        )
        visited: set[tuple[int, int]] = set()
        while queue:
            node_id, incoming_way = queue.popleft()
            state = (node_id, incoming_way)
            if state in visited:
                continue
            visited.add(state)
            for next_node, next_way in outgoing.get(node_id, []):
                if next_way == incoming_way:
                    # A single-way continuation through an intermediate node
                    # is valid; the junction turn rules below still apply.
                    pass
                only = only_targets.get((node_id, incoming_way))
                if only and next_way not in only:
                    continue
                if (node_id, incoming_way, next_way) in no_pairs:
                    continue
                if mode == "foot":
                    first_tags = document["ways"][incoming_way]["tags"]
                    next_tags = document["ways"][next_way]["tags"]
                    if _normalized_numeric_tag(first_tags, "level") != _normalized_numeric_tag(next_tags, "level"):
                        continue
                if next_node in endpoint_ids:
                    matrix.add((entry_index, endpoint_ids[next_node]))
                    continue
                next_state = (next_node, next_way)
                if next_state not in visited:
                    queue.append(next_state)
    return matrix, unsupported


def _retained_occurrences(document: dict[str, dict[int, dict]]) -> dict[int, int]:
    excluded = {"abandoned", "construction", "disused", "planned", "proposed", "razed"}
    counts: dict[int, int] = defaultdict(int)
    for way in document["ways"].values():
        highway = way["tags"].get("highway")
        if highway is None or highway in excluded:
            continue
        for node_id in way["nodes"]:
            counts[node_id] += 1
    return dict(counts)


def _isolated_crossing_violations(document: dict[str, dict[int, dict]], fixture: dict[str, Any]) -> list[str]:
    violations: list[str] = []
    if not fixture.get("grade_separated_crossings"):
        return violations
    adjacency: dict[int, set[int]] = defaultdict(set)
    for way in document["ways"].values():
        for left, right in zip(way["nodes"], way["nodes"][1:]):
            adjacency[left].add(right)
            adjacency[right].add(left)
    crossing_nodes = set()
    for index, crossing in enumerate(fixture["grade_separated_crossings"]):
        crossing_nodes.update({80_000 + index * 10, 80_001 + index * 10, 80_002 + index * 10})
    star_endpoints = {int(fixture["endpoint_node_id_base"]) + index for index in range(int(fixture["spokes"]))}
    for endpoint in star_endpoints:
        reached = {endpoint}
        pending = [endpoint]
        for node in pending:
            for neighbor in adjacency.get(node, ()):
                if neighbor not in reached:
                    reached.add(neighbor)
                    pending.append(neighbor)
        shared = sorted(reached & crossing_nodes)
        if shared:
            violations.append(f"junction endpoint {endpoint} became connected to grade-separated crossing node {shared[0]}")
    return violations


def verify_fixture_semantics(path: str | Path, fixture: dict[str, Any]) -> dict[str, Any]:
    """Compare the PBF's observed transition sets with the independent oracle."""
    document = read_osm_pbf(path)
    matrices: dict[str, dict[str, list[list[int]]]] = {}
    mismatches: list[dict[str, Any]] = []
    unsupported: list[str] = []
    for mode in fixture.get("modes", ["motorcar", "bicycle", "foot"]):
        expected = _pairs_for_oracle(fixture, mode)
        actual, errors = _actual_transition_matrix(document, fixture, mode)
        if fixture.get("exclude_diagonal_transitions"):
            expected = {pair for pair in expected if pair[0] != pair[1]}
            actual = {pair for pair in actual if pair[0] != pair[1]}
        unsupported.extend(errors)
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        matrices[mode] = {
            "expected": [list(pair) for pair in sorted(expected)],
            "actual": [list(pair) for pair in sorted(actual)],
        }
        if missing or unexpected:
            mismatches.append({"mode": mode, "missing": [list(pair) for pair in missing], "unexpected": [list(pair) for pair in unexpected]})
    return {
        "fixture_id": fixture["id"],
        "transition_mismatches": mismatches,
        "unsupported_semantics": sorted(set(unsupported)),
        "transitions": matrices,
        "transition_counts_by_mode": {
            mode: len(values["actual"]) for mode, values in matrices.items()
        },
        "retained_occurrences": _retained_occurrences(document),
        "connectivity_violations": _isolated_crossing_violations(document, fixture),
        "entity_counts": {kind: len(entities) for kind, entities in document.items()},
    }


def verify_expansion_semantics(original_path: str | Path, transformed_path: str | Path, fixture: dict[str, Any]) -> dict[str, Any]:
    """Check transition equivalence, occurrence limits, and untouched entities."""
    original = read_osm_pbf(original_path)
    transformed = read_osm_pbf(transformed_path)
    before = verify_fixture_semantics(original_path, fixture)
    after = verify_fixture_semantics(transformed_path, fixture)
    count = int(fixture["spokes"])
    center_id = int(fixture["center_node_id"])
    way_base = int(fixture["way_id_base"])
    target_way_ids = {way_base + index for index in range(count)}
    original_way_ids = set(original["ways"])
    original_node_ids = set(original["nodes"])

    transition_changes: list[dict[str, Any]] = []
    for mode in fixture.get("modes", ["motorcar", "bicycle", "foot"]):
        before_pairs = {tuple(pair) for pair in before["transitions"][mode]["actual"]}
        after_pairs = {tuple(pair) for pair in after["transitions"][mode]["actual"]}
        if before_pairs != after_pairs:
            transition_changes.append({
                "mode": mode,
                "removed": [list(pair) for pair in sorted(before_pairs - after_pairs)],
                "added": [list(pair) for pair in sorted(after_pairs - before_pairs)],
            })

    center_location = original["nodes"][center_id]
    center_position = (center_location["lon"], center_location["lat"])

    def is_junction_offset(node: dict) -> bool:
        delta_lon = (node["lon"] - center_position[0]) * 111_320 * math.cos(math.radians(center_position[1]))
        delta_lat = (node["lat"] - center_position[1]) * 111_320
        return math.hypot(delta_lon, delta_lat) <= 5.0

    replacement_ids = {
        node_id for node_id in set(transformed["nodes"]) - original_node_ids
        if is_junction_offset(transformed["nodes"][node_id])
    }
    allowed_center_refs = replacement_ids | {center_id}
    endpoint_base = int(fixture["endpoint_node_id_base"])

    def endpoint_clone_index(node: dict) -> int | None:
        for index in range(count):
            endpoint = original["nodes"].get(endpoint_base + index)
            if endpoint is None:
                continue
            dx = (node["lon"] - endpoint["lon"]) * 111_320 * math.cos(math.radians(endpoint["lat"]))
            dy = (node["lat"] - endpoint["lat"]) * 111_320
            if math.hypot(dx, dy) <= 2.0:
                return index
        return None

    endpoint_clones = {
        node_id: index
        for node_id in set(transformed["nodes"]) - original_node_ids
        if (index := endpoint_clone_index(transformed["nodes"][node_id])) is not None
    }
    non_target_way_changes: list[int] = []
    malformed_target_geometry: list[int] = []
    for way_id in sorted(original_way_ids):
        source_way = original["ways"][way_id]
        output_way = transformed["ways"].get(way_id)
        if way_id not in target_way_ids:
            if output_way is None or source_way != output_way:
                non_target_way_changes.append(way_id)
            continue
        # Target ways are compiled into mode-specific directed legs. Their tags
        # and center reference may change, but the source geometry stays intact.
        if output_way is None:
            continue  # A way denied to all three modes has no compiled leg.
        if len(source_way["nodes"]) != len(output_way["nodes"]):
            malformed_target_geometry.append(way_id)
            continue
        for before_ref, after_ref in zip(source_way["nodes"], output_way["nodes"]):
            if before_ref == center_id:
                if after_ref not in allowed_center_refs:
                    malformed_target_geometry.append(way_id)
                    break
            elif endpoint_base <= before_ref < endpoint_base + count:
                if after_ref != before_ref and endpoint_clones.get(after_ref) != before_ref - endpoint_base:
                    malformed_target_geometry.append(way_id)
                    break
            elif before_ref != after_ref:
                malformed_target_geometry.append(way_id)
                break

    unchanged_non_target_nodes = [
        node_id for node_id in original_node_ids
        if transformed["nodes"].get(node_id) != original["nodes"][node_id]
    ]
    static_relation_ids = set()
    for relation_id, relation in original["relations"].items():
        tags = relation["tags"]
        members = relation["members"]
        if tags.get("type") == "restriction" and any(
            member["type"] == "node" and int(member["ref"]) == center_id and member["role"] == "via"
            for member in members
        ) and any(member["type"] == "way" and int(member["ref"]) in target_way_ids for member in members):
            static_relation_ids.add(relation_id)
    relation_changes = [
        relation_id for relation_id in original["relations"]
        if transformed["relations"].get(relation_id) != original["relations"][relation_id]
        and relation_id not in static_relation_ids
    ]
    removed_static_relations = sorted(
        relation_id for relation_id in static_relation_ids if relation_id not in transformed["relations"]
    )
    added_nodes = sorted(set(transformed["nodes"]) - original_node_ids)
    misplaced_added_nodes = [
        node_id for node_id in added_nodes
        if (not is_junction_offset(transformed["nodes"][node_id]) and node_id not in endpoint_clones)
        or transformed["nodes"][node_id]["tags"]
    ]
    added_ways = sorted(set(transformed["ways"]) - original_way_ids)

    def is_target_approach_clone(candidate: dict) -> bool:
        """Accept an added physical approach copy only when it mirrors a target way."""
        for target_way_id in target_way_ids:
            source_way = original["ways"].get(target_way_id)
            if source_way is None or candidate["tags"] != source_way["tags"]:
                continue
            if len(candidate["nodes"]) != len(source_way["nodes"]):
                continue
            valid = True
            changed = False
            for before_ref, after_ref in zip(source_way["nodes"], candidate["nodes"]):
                if after_ref not in transformed["nodes"]:
                    valid = False
                    break
                if before_ref == center_id:
                    valid &= after_ref in allowed_center_refs
                elif endpoint_base <= before_ref < endpoint_base + count:
                    valid &= after_ref == before_ref or endpoint_clones.get(after_ref) == before_ref - endpoint_base
                else:
                    valid &= after_ref == before_ref
                changed |= before_ref != after_ref
                if not valid:
                    break
            if valid and changed:
                return True
        return False

    unexpected_added_ways = []
    for way_id in added_ways:
        way = transformed["ways"][way_id]
        connector = (
            len(way["nodes"]) >= 2
            and way["tags"].get("highway") is not None
            and way["tags"].get("oneway") in {"yes", "-1"}
            and all(ref in transformed["nodes"] for ref in way["nodes"])
        )
        if not connector and not is_target_approach_clone(way):
            unexpected_added_ways.append(way_id)
    center_after = transformed["nodes"].get(center_id)
    center_changed = center_after != center_location
    counts = _retained_occurrences(transformed)
    overflow = {node_id: n for node_id, n in counts.items() if n > 16}
    synthetic_counts = {node_id: counts.get(node_id, 0) for node_id in sorted(replacement_ids)}
    structure_violations = {
        "missing_non_target_ways": sorted(way_id for way_id in original_way_ids - set(transformed["ways"]) if way_id not in target_way_ids),
        "non_target_way_changes": non_target_way_changes,
        "target_way_geometry_changes": sorted(set(malformed_target_geometry)),
        "missing_nodes": sorted(original_node_ids - set(transformed["nodes"])),
        "non_target_node_changes": unchanged_non_target_nodes,
        "original_center_node_changed": center_changed,
        "unexpected_relation_changes": relation_changes,
        "added_nodes_off_approach": misplaced_added_nodes,
        "unexpected_added_ways": unexpected_added_ways,
    }
    return {
        "fixture_id": fixture["id"],
        "transition_mismatches_before": before["transition_mismatches"],
        "transition_mismatches_after": after["transition_mismatches"],
        "transition_changes": transition_changes,
        "transitions_after": after["transitions"],
        "transition_counts_by_mode_after": after["transition_counts_by_mode"],
        "unsupported_semantics": sorted(set(before["unsupported_semantics"] + after["unsupported_semantics"])),
        "occurrence_overflow": overflow,
        "synthetic_node_occurrences": synthetic_counts,
        "added_connector_way_ids": added_ways,
        "compiled_away_static_relation_ids": removed_static_relations,
        "structure_violations": structure_violations,
        "connectivity_violations": after["connectivity_violations"],
        "exact_semantics": not transition_changes and not after["transition_mismatches"] and not after["unsupported_semantics"],
    }


def main(argv: list[str] | None = None) -> int:
    parser = __import__("argparse").ArgumentParser(description=__doc__)
    parser.add_argument("pbf", type=Path)
    parser.add_argument("fixture", type=Path, help="one expanded fixture definition as JSON")
    args = parser.parse_args(argv)
    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    print(json.dumps(verify_fixture_semantics(args.pbf, fixture), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

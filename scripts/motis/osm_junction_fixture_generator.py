"""Generate tiny adversarial OSM PBF files from a reviewable JSON catalog.

This writer implements the small OSM PBF subset used by the catalog with only
the Python standard library. It deliberately does not import or share logic
with the junction expander or semantic verifier.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import struct
import zlib
from pathlib import Path
from typing import Any


def _varint(value: int) -> bytes:
    if value < 0:
        raise ValueError("varint must be unsigned")
    output = bytearray()
    while value > 0x7F:
        output.append((value & 0x7F) | 0x80)
        value >>= 7
    output.append(value)
    return bytes(output)


def _zigzag(value: int) -> int:
    return value * 2 if value >= 0 else (-value * 2) - 1


def _field_varint(field: int, value: int) -> bytes:
    return _varint(field << 3) + _varint(value)


def _field_bytes(field: int, value: bytes) -> bytes:
    return _varint((field << 3) | 2) + _varint(len(value)) + value


def _packed(field: int, values: list[int]) -> bytes:
    payload = b"".join(_varint(value) for value in values)
    return _field_bytes(field, payload)


def expand_fixture_definitions(catalog: dict[str, Any]) -> list[dict[str, Any]]:
    """Expand compact declarative boundary and paired-fixture definitions."""
    fixtures: list[dict[str, Any]] = []
    defaults = {
        "center_node_id": int(catalog["center_node_id"]),
        "endpoint_node_id_base": int(catalog["endpoint_node_id_base"]),
        "way_id_base": int(catalog["way_id_base"]),
        "relation_id_base": int(catalog["relation_id_base"]),
        "default_way_tags": dict(catalog.get("default_way_tags", {})),
        "modes": list(catalog.get("modes", [])),
    }
    for count in catalog["boundaries"]:
        fixtures.append(
            {
                **defaults,
                "id": f"unrestricted-{count}",
                "pair_id": None,
                "spokes": int(count),
                "fixture_kind": "star",
                "oracle": {"all_modes": "all_directed_pairs"},
                "expected_outcome": "copy" if count <= 16 else "expand",
            }
        )

    for template in catalog["paired_fixtures"]:
        for count in template["spokes"]:
            fixture = {**defaults, **template, "spokes": int(count)}
            fixture["id"] = f"{template['pair_id']}-{count}"
            fixture["expected_outcome"] = template["expected_by_spokes"][str(count)]
            fixture["way_tag_overrides"] = dict(template.get("way_tag_overrides", {}))
            fixture["way_tag_overrides"].update(
                template.get("way_tag_overrides_by_spokes", {}).get(str(count), {})
            )
            fixture["relations"] = []
            if "relation" in template:
                fixture["relations"].append(template["relation"])
            fixture["relations"].extend(template.get("relations", []))
            for relation_index, relation in enumerate(fixture["relations"]):
                resolved = dict(relation)
                if "to_by_spokes" in relation:
                    resolved["to"] = int(relation["to_by_spokes"][str(count)])
                resolved["relation_id"] = defaults["relation_id_base"] + relation_index
                fixture["relations"][relation_index] = resolved
            fixture.pop("expected_by_spokes", None)
            fixture.pop("way_tag_overrides_by_spokes", None)
            fixtures.append(fixture)
    return fixtures


def _entity_tags(tags: dict[str, str], intern: Any) -> tuple[list[int], list[int]]:
    keys: list[int] = []
    values: list[int] = []
    for key, value in sorted(tags.items()):
        keys.append(intern(key))
        values.append(intern(value))
    return keys, values


def _write_blob(stream: Any, blob_type: str, data: bytes) -> None:
    compressed = zlib.compress(data, level=9)
    blob = _field_varint(2, len(data)) + _field_bytes(3, compressed)
    blob_header = _field_bytes(1, blob_type.encode("utf-8")) + _field_varint(3, len(blob))
    stream.write(struct.pack(">I", len(blob_header)))
    stream.write(blob_header)
    stream.write(blob)


def _coordinate_degrees(value: float) -> int:
    return int(round(value * 10_000_000))


def _position(center_lon: float, center_lat: float, angle_degrees: float, radius: float) -> tuple[float, float]:
    angle = math.radians(angle_degrees)
    return center_lon + radius * math.cos(angle), center_lat + radius * math.sin(angle)


def _build_entities(fixture: dict[str, Any]) -> tuple[list[dict], list[dict], list[dict]]:
    count = int(fixture["spokes"])
    center_id = int(fixture["center_node_id"])
    endpoint_base = int(fixture["endpoint_node_id_base"])
    way_base = int(fixture["way_id_base"])
    center_lon, center_lat = 127.0, 37.0
    nodes = [{"id": center_id, "lon": center_lon, "lat": center_lat, "tags": {}}]
    ways: list[dict] = []

    via_way_last_index = count - 1 if fixture.get("fixture_kind") == "via_way" else None
    for index in range(count):
        angle = (index * 360.0) / count
        endpoint_lon, endpoint_lat = _position(center_lon, center_lat, angle, 0.001)
        endpoint_offset = fixture.get("endpoint_offsets_meters", {}).get(str(index))
        if endpoint_offset is not None:
            if len(endpoint_offset) != 2:
                raise ValueError(f"endpoint offset for spoke {index} must be [east_m, north_m]")
            endpoint_lon = center_lon + float(endpoint_offset[0]) / (
                111_320 * math.cos(math.radians(center_lat))
            )
            endpoint_lat = center_lat + float(endpoint_offset[1]) / 111_320
        endpoint_id = endpoint_base + index
        nodes.append({"id": endpoint_id, "lon": endpoint_lon, "lat": endpoint_lat, "tags": {}})
        tags = dict(fixture.get("default_way_tags", {}))
        tags.update(fixture.get("way_tag_overrides", {}).get(str(index), {}))
        ways.append({"id": way_base + index, "nodes": [center_id, endpoint_id], "tags": tags})

    if via_way_last_index is not None:
        via_way_id = way_base + via_way_last_index
        via_endpoint_id = endpoint_base + via_way_last_index
        continuation_id = int(fixture["relation"].get("to_way_id", 40000))
        continuation_endpoint_id = 40001
        continuation_lon, continuation_lat = _position(center_lon, center_lat, 41.0, 0.002)
        nodes.append({"id": continuation_endpoint_id, "lon": continuation_lon, "lat": continuation_lat, "tags": {}})
        ways.append({
            "id": continuation_id,
            "nodes": [via_endpoint_id, continuation_endpoint_id],
            "tags": dict(fixture.get("default_way_tags", {})),
        })
    for crossing_index, crossing in enumerate(fixture.get("grade_separated_crossings", [])):
        middle = 80_000 + crossing_index * 10
        angle = 0.0 if crossing_index == 0 else 90.0
        outer_a = _position(center_lon, center_lat, angle, 0.002)
        outer_b = _position(center_lon, center_lat, angle + 180.0, 0.002)
        crossing_nodes = [middle, middle + 1, middle + 2]
        nodes.extend([
            {"id": crossing_nodes[0], "lon": outer_a[0], "lat": outer_a[1], "tags": {}},
            {"id": crossing_nodes[1], "lon": center_lon, "lat": center_lat, "tags": {"junction": "level_crossing"}},
            {"id": crossing_nodes[2], "lon": outer_b[0], "lat": outer_b[1], "tags": {}},
        ])
        crossing_way_id = 81_000 + crossing_index
        ways.append({"id": crossing_way_id, "nodes": crossing_nodes, "tags": dict(crossing["tags"])})

    relations: list[dict] = []
    for index, relation in enumerate(fixture.get("relations", [])):
        relation_id = int(relation["relation_id"])
        if fixture.get("relation_kind") == "via_way":
            members = [
                {"type": "way", "ref": way_base + int(relation["from"]), "role": "from"},
                {"type": "way", "ref": way_base + count - 1, "role": "via"},
                {"type": "way", "ref": int(relation.get("to_way_id", 40000)), "role": "to"},
            ]
            tags = {"type": "restriction", "restriction": "no_left_turn"}
        elif fixture.get("relation_kind") == "malformed":
            members = [
                {"type": "way", "ref": way_base + int(relation["from"]), "role": "from"},
                {"type": "node", "ref": center_id, "role": "via"},
            ]
            tags = {"type": "restriction", "restriction": "no_left_turn"}
        else:
            members = [
                {"type": "way", "ref": way_base + int(relation["from"]), "role": "from"},
                {"type": "node", "ref": center_id, "role": "via"},
                {"type": "way", "ref": way_base + int(relation["to"]), "role": "to"},
            ]
            if fixture.get("relation_kind") == "conditional":
                tags = {"type": "restriction", "restriction:conditional": str(relation["conditional"])}
            else:
                tags = {"type": "restriction", "restriction": str(relation.get("restriction", "no_left_turn"))}
                if relation.get("except"):
                    tags["except"] = str(relation["except"])
        relations.append({"id": relation_id, "members": members, "tags": tags})

    return nodes, ways, relations


def _encode_primitive_block(nodes: list[dict], ways: list[dict], relations: list[dict]) -> bytes:
    strings = [""]
    indexes = {"": 0}

    def intern(value: str) -> int:
        if value not in indexes:
            indexes[value] = len(strings)
            strings.append(value)
        return indexes[value]

    for entity in (*nodes, *ways, *relations):
        for key, value in sorted(entity.get("tags", {}).items()):
            intern(key)
            intern(str(value))
    for relation in relations:
        for member in relation["members"]:
            intern(str(member["role"]))

    group = bytearray()
    for node in nodes:
        keys, values = _entity_tags(node.get("tags", {}), intern)
        payload = (
            _field_varint(1, _zigzag(int(node["id"])))
            + _packed(2, keys)
            + _packed(3, values)
            + _field_varint(8, _zigzag(_coordinate_degrees(float(node["lat"]))))
            + _field_varint(9, _zigzag(_coordinate_degrees(float(node["lon"]))))
        )
        group.extend(_field_bytes(1, payload))

    for way in ways:
        keys, values = _entity_tags(way.get("tags", {}), intern)
        refs: list[int] = []
        previous = 0
        for ref in way["nodes"]:
            current = int(ref)
            refs.append(_zigzag(current - previous))
            previous = current
        payload = _field_varint(1, int(way["id"])) + _packed(2, keys) + _packed(3, values) + _packed(8, refs)
        group.extend(_field_bytes(3, payload))

    member_types = {"node": 0, "way": 1, "relation": 2}
    for relation in relations:
        keys, values = _entity_tags(relation.get("tags", {}), intern)
        roles: list[int] = []
        member_deltas: list[int] = []
        types: list[int] = []
        previous = 0
        for member in relation["members"]:
            current = int(member["ref"])
            # Relation.roles_sid is packed int32 (plain non-negative string
            # table indexes), while memids is packed sint64.
            roles.append(intern(str(member["role"])))
            member_deltas.append(_zigzag(current - previous))
            previous = current
            types.append(member_types[member["type"]])
        payload = (
            _field_varint(1, int(relation["id"]))
            + _packed(2, keys)
            + _packed(3, values)
            + _packed(8, roles)
            + _packed(9, member_deltas)
            + _packed(10, types)
        )
        group.extend(_field_bytes(4, payload))

    string_table = b"".join(_field_bytes(1, value.encode("utf-8")) for value in strings)
    primitive_group = _field_bytes(2, bytes(group))
    return _field_bytes(1, string_table) + primitive_group + _field_varint(17, 100)


def write_fixture(fixture: dict[str, Any], destination: str | os.PathLike[str]) -> Path:
    """Write one fixture as an OSM PBF, replacing the destination atomically."""
    target = Path(destination).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    nodes, ways, relations = _build_entities(fixture)
    nodes.sort(key=lambda entity: entity["id"])
    ways.sort(key=lambda entity: entity["id"])
    relations.sort(key=lambda entity: entity["id"])
    header = _field_bytes(4, b"OsmSchema-V0.6") + _field_bytes(16, b"synthetic-junction-fixture-generator")
    data = _encode_primitive_block(nodes, ways, relations)
    temporary_path = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    try:
        with temporary_path.open("xb") as stream:
            _write_blob(stream, "OSMHeader", header)
            _write_blob(stream, "OSMData", data)
        os.replace(temporary_path, target)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise
    return target


def generate_fixture_set(catalog_path: Path, output_dir: Path) -> list[dict[str, Any]]:
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    fixtures = expand_fixture_definitions(catalog)
    results = []
    for fixture in fixtures:
        path = write_fixture(fixture, output_dir / f"{fixture['id']}.osm.pbf")
        results.append({"id": fixture["id"], "path": str(path), "spokes": fixture["spokes"]})
    return results


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=Path("fixtures/osm-junctions/adversarial.json"))
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    results = generate_fixture_set(args.catalog, args.output_dir)
    print(json.dumps({"fixtures": results, "count": len(results)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

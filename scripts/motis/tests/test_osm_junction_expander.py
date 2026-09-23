from __future__ import annotations

import hashlib
import json
import math
import tempfile
import unittest
from pathlib import Path

import osmium
from osmium.osm.mutable import Node, Relation, Way

from scripts.motis.osm_junction_expander import (
    StaticRestriction,
    WayAtJunction,
    derive_allowed_transitions,
    expand_osm_file,
)
from scripts.motis.osm_junction_semantic_verifier import verify_expansion_semantics, verify_fixture_semantics
from scripts.motis.osm_junction_fixture_generator import expand_fixture_definitions, write_fixture
from scripts.motis.single_topology_poc import build_single_topology_plan, expand_single_topology_fixture


class OsmJunctionExpanderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="osm-junction-expander-")
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_single_topology_poc_keeps_requested_degrees_within_osr_limit(self) -> None:
        for count in (8, 12, 16, 17, 20, 24, 32, 64):
            with self.subTest(spokes=count):
                center = (127.0, 37.0)
                ways = []
                for index in range(count):
                    angle = index * math.tau / count
                    endpoint = (
                        center[0] + 0.001 * math.cos(angle),
                        center[1] + 0.001 * math.sin(angle),
                    )
                    ways.append(
                        WayAtJunction(
                            2000 + index,
                            0,
                            {"highway": "service"},
                            2,
                            (100, 1000 + index),
                            (center, endpoint),
                        )
                    )

                plan = build_single_topology_plan(
                    100,
                    {},
                    ways,
                    [],
                    first_new_node_id=10_000,
                    first_new_way_id=20_000,
                    center_lon=center[0],
                    center_lat=center[1],
                )
                occurrences: dict[int, int] = {}
                for way in plan.replacement_ways:
                    for node_id in way.node_ids:
                        occurrences[node_id] = occurrences.get(node_id, 0) + 1
                self.assertLessEqual(max(occurrences.values()), 16)

    def test_single_topology_poc_can_force_expand_an_eight_way_official_control(self) -> None:
        catalog_path = Path(__file__).resolve().parents[3] / "fixtures" / "osm-junctions" / "adversarial.json"
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        fixture = next(
            item for item in expand_fixture_definitions(catalog)
            if item["id"] == "unrestricted-carrier-12"
        )
        fixture["id"] = "unrestricted-carrier-8-force"
        fixture["spokes"] = 8
        source = self.root / "unrestricted-8.osm.pbf"
        transformed = self.root / "unrestricted-8.transformed.osm.pbf"
        write_fixture(fixture, source)

        expand_single_topology_fixture(source, transformed, force_expand=True)

        report = verify_expansion_semantics(source, transformed, fixture)
        self.assertTrue(report["exact_semantics"])
        self.assertFalse(report["occurrence_overflow"])

    def test_mode_transition_model_combines_direction_access_and_static_restrictions(self) -> None:
        ways = [
            WayAtJunction(10, 0, {"highway": "service", "oneway": "yes", "oneway:bicycle": "no"}),
            WayAtJunction(11, 0, {"highway": "service", "oneway": "-1", "oneway:bicycle": "no", "foot": "no"}),
            WayAtJunction(12, 0, {"highway": "service", "motor_vehicle": "no"}),
            WayAtJunction(13, 0, {"highway": "service", "level": "1"}),
        ]
        restrictions = [
            StaticRestriction(900, 11, 13, 100, "only_left_turn", ("motorcar",)),
            StaticRestriction(901, 13, 10, 100, "no_straight_on", ("motorcar",)),
        ]

        transitions = derive_allowed_transitions(100, ways, restrictions)

        # CAR: way 10 only exits; only_* and no_* both apply through the same
        # pair-set operation. BIKE overrides the global oneway; FOOT denies way 11.
        self.assertEqual(transitions["motorcar"], {(1, 3), (3, 3)})
        self.assertIn((0, 1), transitions["bicycle"])
        self.assertIn((1, 2), transitions["bicycle"])
        self.assertNotIn((1, 1), transitions["foot"])

    def test_foot_transitions_respect_level_while_car_and_bike_keep_shared_node_turns(self) -> None:
        ways = [
            WayAtJunction(20, 0, {"highway": "service", "level": "0"}),
            WayAtJunction(21, 0, {"highway": "service", "level": "1"}),
        ]

        transitions = derive_allowed_transitions(100, ways, [])

        self.assertEqual(transitions["motorcar"], {(0, 0), (0, 1), (1, 0), (1, 1)})
        self.assertEqual(transitions["bicycle"], transitions["motorcar"])
        self.assertEqual(transitions["foot"], {(0, 0), (1, 1)})

    def write_star(
        self,
        path: Path,
        spokes: int,
        *,
        levels: list[str | None] | None = None,
        access_by_spoke: dict[int, str] | None = None,
        oneway_by_spoke: dict[int, str] | None = None,
        restriction: bool = False,
        repeat_first_way: bool = False,
    ) -> None:
        center_id = 100
        center = (127.0, 37.0)
        locations = {center_id: center}
        writer = osmium.SimpleWriter(str(path), overwrite=True)
        writer.add_node(Node(id=center_id, version=1, location=center))

        for index in range(spokes):
            endpoint_id = 1000 + index
            endpoint = (
                center[0] + 0.001 * math.cos(index * math.tau / spokes),
                center[1] + 0.001 * math.sin(index * math.tau / spokes),
            )
            locations[endpoint_id] = endpoint
            writer.add_node(Node(id=endpoint_id, version=1, location=endpoint))
            tags = {"highway": "footway"}
            if levels is not None and levels[index] is not None:
                tags["level"] = levels[index]
            if access_by_spoke and index in access_by_spoke:
                tags["foot"] = access_by_spoke[index]
            if oneway_by_spoke and index in oneway_by_spoke:
                tags["oneway"] = oneway_by_spoke[index]
            refs = [endpoint_id, center_id]
            if repeat_first_way and index == 0:
                refs = [center_id, endpoint_id, center_id]
            writer.add_way(
                Way(
                    id=2000 + index,
                    version=1,
                    nodes=[
                        osmium.osm.NodeRef(
                            ref=ref,
                            location=osmium.osm.Location(*locations[ref]),
                        )
                        for ref in refs
                    ],
                    tags=tags,
                )
            )

        if restriction:
            writer.add_relation(
                Relation(
                    id=3000,
                    version=1,
                    members=[
                        osmium.osm.RelationMember(
                            ref=2000, mtype="w", role="from"
                        ),
                        osmium.osm.RelationMember(
                            ref=center_id, mtype="n", role="via"
                        ),
                        osmium.osm.RelationMember(
                            ref=2001, mtype="w", role="to"
                        ),
                    ],
                    tags={"type": "restriction", "restriction": "no_left_turn"},
                )
            )
        writer.close()

    def read_graph(self, path: Path) -> tuple[dict[int, tuple[float, float]], list[dict]]:
        graph = {"nodes": {}, "ways": [], "relations": []}

        class Handler(osmium.SimpleHandler):
            def node(self, node) -> None:
                graph["nodes"][node.id] = (node.location.lon, node.location.lat)

            def way(self, way) -> None:
                graph["ways"].append(
                    {
                        "id": way.id,
                        "nodes": [node.ref for node in way.nodes],
                        "tags": dict(way.tags),
                    }
                )

            def relation(self, relation) -> None:
                graph["relations"].append(
                    {
                        "id": relation.id,
                        "members": [
                            (member.type, member.ref, member.role)
                            for member in relation.members
                        ],
                        "tags": dict(relation.tags),
                    }
                )

        Handler().apply_file(str(path), locations=False)
        return graph["nodes"], graph["ways"]

    @staticmethod
    def read_relations(path: Path) -> list[dict]:
        rows: list[dict] = []

        class Handler(osmium.SimpleHandler):
            def relation(self, relation) -> None:
                rows.append(
                    {
                        "id": relation.id,
                        "members": [
                            (member.type, member.ref, member.role)
                            for member in relation.members
                        ],
                        "tags": dict(relation.tags),
                    }
                )

        Handler().apply_file(str(path), locations=False)
        return rows

    @staticmethod
    def occurrence_counts(ways: list[dict]) -> dict[int, int]:
        counts: dict[int, int] = {}
        for way in ways:
            if "highway" not in way["tags"]:
                continue
            for node_id in way["nodes"]:
                counts[node_id] = counts.get(node_id, 0) + 1
        return counts

    @staticmethod
    def near_center(point: tuple[float, float]) -> bool:
        dx = (point[0] - 127.0) * 111_320 * math.cos(math.radians(37.0))
        dy = (point[1] - 37.0) * 111_320
        return math.hypot(dx, dy) <= 5.0

    @staticmethod
    def endpoints_connected(ways: list[dict], left: int, right: int) -> bool:
        adjacency: dict[int, set[int]] = {}
        for way in ways:
            if way["tags"].get("oneway") in {"yes", "1", "true"}:
                edges = zip(way["nodes"], way["nodes"][1:])
                for start, end in edges:
                    adjacency.setdefault(start, set()).add(end)
            else:
                for start, end in zip(way["nodes"], way["nodes"][1:]):
                    adjacency.setdefault(start, set()).add(end)
                    adjacency.setdefault(end, set()).add(start)

        reached = {left}
        queue = [left]
        for node in queue:
            for neighbor in adjacency.get(node, ()):
                if neighbor not in reached:
                    reached.add(neighbor)
                    queue.append(neighbor)
        return right in reached

    def test_preserves_mode_specific_levels_at_a_mixed_level_junction(self) -> None:
        source = self.root / "levels.osm.pbf"
        output = self.root / "levels-expanded.osm.pbf"
        levels = [None for _ in range(3)] + ["0", "0", "0.0"] + [
            level for level in ("-1", "1", "2", "3", "4") for _ in range(3)
        ]
        self.write_star(source, 21, levels=levels)

        fixture = {
            "id": "unit-levels",
            "spokes": 21,
            "center_node_id": 100,
            "endpoint_node_id_base": 1000,
            "way_id_base": 2000,
            "oracle": {
                "all_modes": "all_directed_pairs",
                "foot": {
                    "same_level_groups_by_spokes": {
                        "21": [[0, 1, 2, 3, 4, 5], [6, 7, 8], [9, 10, 11], [12, 13, 14], [15, 16, 17], [18, 19, 20]]
                    }
                },
            },
        }
        report = expand_osm_file(source, output)

        nodes, ways = self.read_graph(output)
        counts = self.occurrence_counts(ways)
        junction_nodes = {node_id for way in ways for node_id in way["nodes"] if self.near_center(nodes[node_id])}
        self.assertEqual(report["expanded_nodes"], 1)
        self.assertGreater(len(junction_nodes), 6)
        self.assertTrue(all(count <= 16 for count in counts.values()))
        semantic = verify_expansion_semantics(source, output, fixture)
        self.assertEqual(semantic["transition_changes"], [])
        self.assertEqual(semantic["transition_mismatches_after"], [])

    def test_splits_a_17_way_unrestricted_junction_and_keeps_all_turns(self) -> None:
        source = self.root / "17-way.osm.pbf"
        output = self.root / "17-way-expanded.osm.pbf"
        self.write_star(source, 17)

        report = expand_osm_file(source, output)

        nodes, ways = self.read_graph(output)
        counts = self.occurrence_counts(ways)
        junction_nodes = {node_id for way in ways for node_id in way["nodes"] if self.near_center(nodes[node_id])}
        self.assertEqual(report["expanded_nodes"], 1)
        self.assertGreaterEqual(len(junction_nodes), 2)
        self.assertTrue(all(count <= 16 for count in counts.values()))
        fixture = {
            "id": "unit-17", "spokes": 17,
            "center_node_id": 100, "endpoint_node_id_base": 1000, "way_id_base": 2000,
            "oracle": {"all_modes": "all_directed_pairs"},
        }
        semantic = verify_expansion_semantics(source, output, fixture)
        self.assertEqual(semantic["transition_changes"], [])

    def test_leaves_16_occurrences_and_all_ways_unchanged(self) -> None:
        source = self.root / "16-way.osm.pbf"
        output = self.root / "16-way-output.osm.pbf"
        self.write_star(source, 16)

        report = expand_osm_file(source, output)

        self.assertEqual(report["expanded_nodes"], 0)
        _, source_ways = self.read_graph(source)
        _, output_ways = self.read_graph(output)
        self.assertEqual(source_ways, output_ways)

    def test_occurrence_boundaries_15_16_17_18_32_33(self) -> None:
        for spokes in (15, 16, 17, 18, 32, 33):
            with self.subTest(spokes=spokes):
                source = self.root / f"boundary-{spokes}.osm.pbf"
                output = self.root / f"boundary-{spokes}-expanded.osm.pbf"
                self.write_star(source, spokes)

                report = expand_osm_file(source, output)

                nodes, ways = self.read_graph(output)
                counts = self.occurrence_counts(ways)
                junction_nodes = {
                    node_id
                    for way in ways
                    for node_id in way["nodes"]
                    if self.near_center(nodes[node_id])
                }
                self.assertTrue(all(count <= 16 for count in counts.values()))
                self.assertEqual(report["expanded_nodes"], 1 if spokes > 16 else 0)
                if spokes <= 16:
                    self.assertEqual(junction_nodes, {100})
                else:
                    fixture = {
                        "id": f"unit-boundary-{spokes}", "spokes": spokes,
                        "center_node_id": 100, "endpoint_node_id_base": 1000, "way_id_base": 2000,
                        "oracle": {"all_modes": "all_directed_pairs"},
                    }
                    semantic = verify_expansion_semantics(source, output, fixture)
                    self.assertEqual(semantic["transition_changes"], [])

    def test_compiles_static_restrictions_at_an_overfull_node(self) -> None:
        source = self.root / "restricted.osm.pbf"
        output = self.root / "restricted-output.osm.pbf"
        self.write_star(source, 17, restriction=True)

        expand_osm_file(source, output)
        fixture = {
            "id": "unit-static-restriction", "spokes": 17,
            "center_node_id": 100, "endpoint_node_id_base": 1000, "way_id_base": 2000,
            "oracle": {
                "all_modes": "all_directed_pairs",
                "motorcar": {"forbidden_by_spokes": {"17": [[0, 1]]}},
                "bicycle": {"forbidden_by_spokes": {"17": [[0, 1]]}},
                "foot": {"forbidden_by_spokes": {"17": [[0, 1]]}},
            },
        }
        semantic = verify_expansion_semantics(source, output, fixture)
        self.assertEqual(semantic["transition_changes"], [])
        self.assertEqual(semantic["compiled_away_static_relation_ids"], [3000])
        self.assertEqual(self.read_relations(output), [])

    def test_preserves_a_static_turn_restriction_at_a_non_overfull_node(self) -> None:
        source = self.root / "restricted-under-limit.osm.pbf"
        output = self.root / "restricted-under-limit-copy.osm.pbf"
        self.write_star(source, 4, restriction=True)

        report = expand_osm_file(source, output)

        self.assertEqual(report["expanded_nodes"], 0)
        self.assertEqual(self.read_relations(source), self.read_relations(output))

    def test_preserves_mixed_access_and_oneway_by_mode(self) -> None:
        for label, kwargs, mode_rule in (
            ("access", {"access_by_spoke": {0: "no"}}, {"foot": {"denied_spokes": [0]}}),
            ("oneway", {"oneway_by_spoke": {0: "yes"}}, {
                "motorcar": {"entry_forbidden": [0]},
                "bicycle": {"entry_forbidden": [0]},
            }),
        ):
            with self.subTest(label=label):
                source = self.root / f"{label}.osm.pbf"
                output = self.root / f"{label}-output.osm.pbf"
                self.write_star(source, 17, **kwargs)
                expand_osm_file(source, output)
                fixture = {
                    "id": f"unit-{label}", "spokes": 17,
                    "center_node_id": 100, "endpoint_node_id_base": 1000, "way_id_base": 2000,
                    "oracle": {"all_modes": "all_directed_pairs", **mode_rule},
                }
                semantic = verify_expansion_semantics(source, output, fixture)
                self.assertEqual(semantic["transition_changes"], [])

    def test_rejects_a_way_that_repeats_the_overfull_node(self) -> None:
        source = self.root / "repeated.osm.pbf"
        output = self.root / "repeated-output.osm.pbf"
        self.write_star(source, 17, repeat_first_way=True)

        with self.assertRaisesRegex(ValueError, "repeated|multiple"):
            expand_osm_file(source, output)

        self.assertFalse(output.exists())

    def test_output_is_deterministic(self) -> None:
        source = self.root / "deterministic.osm.pbf"
        output_a = self.root / "deterministic-a.osm.pbf"
        output_b = self.root / "deterministic-b.osm.pbf"
        self.write_star(source, 17)

        expand_osm_file(source, output_a)
        expand_osm_file(source, output_b)

        digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
        self.assertEqual(digest(output_a), digest(output_b))


if __name__ == "__main__":
    unittest.main()

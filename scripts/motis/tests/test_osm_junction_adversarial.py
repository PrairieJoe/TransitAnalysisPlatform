from __future__ import annotations

import json
import importlib.util
import math
import os
import unittest
from pathlib import Path

from scripts.motis.osm_junction_fixture_generator import (
    expand_fixture_definitions,
    generate_fixture_set,
    write_fixture,
)
from scripts.motis.osm_junction_semantic_verifier import (
    read_osm_pbf,
    verify_expansion_semantics,
    verify_fixture_semantics,
)
from scripts.motis.compare_osm_junction_motis import (
    _cost_summary,
    reachable_pairs_for_one_to_many,
    select_reference_binaries,
)
import scripts.motis.compare_osm_junction_motis as motis_compare


ROOT = Path(__file__).resolve().parents[3]
CATALOG = ROOT / "fixtures" / "osm-junctions" / "adversarial.json"


class AdversarialJunctionFixtureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(__file__).resolve().parents[3] / f".tmp-osm-junction-adversarial-{os.getpid()}-{id(self)}"
        self.root.mkdir()
        self.catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
        self.fixtures = expand_fixture_definitions(self.catalog)

    def tearDown(self) -> None:
        for entry in self.root.iterdir():
            if entry.is_file():
                entry.unlink()
        self.root.rmdir()

    def test_declares_occurrence_boundaries_and_requested_vehicle_restrictions(self) -> None:
        ids = {fixture["id"] for fixture in self.fixtures}
        for occurrence in (15, 16, 17, 18, 32, 33, 64):
            self.assertIn(f"unrestricted-{occurrence}", ids)
        for restriction in (
            "no_left_turn",
            "no_right_turn",
            "no_straight_on",
            "no_u_turn",
            "only_left_turn",
            "only_right_turn",
            "only_straight_on",
        ):
            self.assertIn(f"{restriction}-20", ids)
            self.assertIn(f"{restriction}-12", ids)
        self.assertIn("multiple_static_restrictions-24", ids)
        for fixture_id in (
            "mixed_oneway-20",
            "mixed_mode_access-20",
            "mixed_level-20",
            "mixed_layer-20",
            "bridge_tunnel_crossing-20",
            "restriction_conditional-20",
            "via_way_restriction-20",
            "malformed_restriction-20",
        ):
            self.assertIn(fixture_id, ids)

    def test_catalog_generates_a_pbf_for_every_matrix_row(self) -> None:
        generated = generate_fixture_set(CATALOG, self.root)
        self.assertEqual(len(generated), len(self.fixtures))
        for row in generated:
            with self.subTest(fixture=row["id"]):
                path = Path(row["path"])
                self.assertTrue(path.is_file())
                self.assertGreater(path.stat().st_size, 0)
                document = read_osm_pbf(path)
                self.assertTrue(document["nodes"])
                self.assertGreaterEqual(len(document["ways"]), row["spokes"])

    def test_each_generated_original_pbf_matches_the_separate_transition_oracle(self) -> None:
        for fixture in self.fixtures:
            if fixture["expected_outcome"] == "fail_closed":
                continue
            with self.subTest(fixture=fixture["id"]):
                path = self.root / f"{fixture['id']}.osm.pbf"
                write_fixture(fixture, path)
                report = verify_fixture_semantics(path, fixture)
                self.assertEqual(report["transition_mismatches"], [])
                if fixture.get("relation_kind") in {"conditional", "via_way", "malformed"}:
                    self.assertTrue(report["unsupported_semantics"])
                if fixture.get("grade_separated_crossings"):
                    self.assertEqual(report["connectivity_violations"], [])

    def test_pbf_writer_and_independent_reader_cover_nodes_ways_and_relations(self) -> None:
        fixture = next(f for f in self.fixtures if f["id"] == "multiple_static_restrictions-24")
        path = self.root / "multiple-restrictions.osm.pbf"
        write_fixture(fixture, path)
        document = read_osm_pbf(path)
        self.assertEqual(len(document["ways"]), 24)
        self.assertEqual(len(document["relations"]), 2)
        self.assertEqual(len(document["nodes"]), 25)
        for way in document["ways"].values():
            self.assertTrue(all(node_id in document["nodes"] for node_id in way["nodes"]))

    def test_identity_copy_has_an_exact_transition_and_structure_report(self) -> None:
        fixture = next(f for f in self.fixtures if f["id"] == "no_left_turn-12")
        original = self.root / "original.osm.pbf"
        copy = self.root / "copy.osm.pbf"
        write_fixture(fixture, original)
        write_fixture(fixture, copy)
        report = verify_expansion_semantics(original, copy, fixture)
        self.assertTrue(report["exact_semantics"])
        self.assertEqual(report["transition_changes"], [])
        self.assertFalse(report["occurrence_overflow"])
        self.assertFalse(any(report["structure_violations"].values()))

    def test_observed_graph_matrix_applies_mode_specific_level_semantics(self) -> None:
        fixture = next(f for f in self.fixtures if f["id"] == "mixed_level-12")
        path = self.root / "mixed-level-original.osm.pbf"
        write_fixture(fixture, path)

        report = verify_fixture_semantics(path, fixture)

        self.assertEqual(len(report["transitions"]["motorcar"]["actual"]), 12 * 12)
        self.assertEqual(len(report["transitions"]["bicycle"]["actual"]), 12 * 12)
        self.assertEqual(len(report["transitions"]["foot"]["actual"]), 12 * 6)
        self.assertEqual(report["transition_mismatches"], [])

    def test_motis_route_response_becomes_a_directed_off_diagonal_matrix(self) -> None:
        results = [
            {"duration": 0},
            {"duration": 12.5},
            {},
            {"distance": 50},
        ]
        self.assertEqual(
            reachable_pairs_for_one_to_many(entry_index=2, results=results),
            {(2, 0), (2, 1)},
        )

    def test_stable_approach_queries_are_deterministically_offset_from_the_junction(self) -> None:
        fixture = next(f for f in self.fixtures if f["id"] == "no_left_turn-12")
        path = self.root / "stable-query-source.osm.pbf"
        write_fixture(fixture, path)
        document = read_osm_pbf(path)

        self.assertTrue(
            hasattr(motis_compare, "stable_approach_query_coordinates"),
            "the MOTIS comparator needs deterministic interior approach query points",
        )
        query_points = motis_compare.stable_approach_query_coordinates(document, fixture, 35.0)
        repeated_points = motis_compare.stable_approach_query_coordinates(document, fixture, 35.0)

        self.assertEqual(query_points, repeated_points)
        self.assertEqual(len(query_points), fixture["spokes"])
        center = document["nodes"][fixture["center_node_id"]]
        for index, (latitude, longitude) in enumerate(query_points):
            endpoint = document["nodes"][fixture["endpoint_node_id_base"] + index]
            dx = (longitude - center["lon"]) * 111_320 * math.cos(math.radians(center["lat"]))
            dy = (latitude - center["lat"]) * 111_320
            self.assertAlmostEqual(math.hypot(dx, dy), 35.0, delta=0.15)
            self.assertGreater(
                (longitude - center["lon"]) * (endpoint["lon"] - center["lon"])
                + (latitude - center["lat"]) * (endpoint["lat"] - center["lat"]),
                0.0,
            )

    def test_cost_matrix_summary_uses_absolute_delta_and_nearest_rank_p95(self) -> None:
        summary = _cost_summary(
            {(0, 1): 10.0, (0, 2): 12.0, (1, 0): 30.0},
            {(0, 1): 11.0, (0, 2): 15.0, (1, 0): 27.0},
        )

        self.assertEqual(summary["cost_sample_count"], 3)
        self.assertEqual(summary["max_cost_delta_seconds"], 3.0)
        self.assertAlmostEqual(summary["mean_cost_delta_seconds"], 7.0 / 3.0)
        self.assertEqual(summary["p95_cost_delta_seconds"], 3.0)

    def test_route_reference_uses_official_both_sides_for_at_most_16_and_custom_only_for_20(self) -> None:
        official = Path("official.exe")
        custom = Path("custom.exe")
        self.assertEqual(
            select_reference_binaries(12, official, custom),
            (official, official, "official MOTIS + original vs official MOTIS + transformed"),
        )
        self.assertEqual(
            select_reference_binaries(20, official, custom),
            (custom, official, "patched/custom MOTIS + original vs official MOTIS + transformed"),
        )

    def test_paired_fixtures_have_identical_semantic_oracles(self) -> None:
        groups: dict[str, list[dict]] = {}
        for fixture in self.fixtures:
            pair = fixture.get("pair_id")
            if pair:
                groups.setdefault(pair, []).append(fixture)
        self.assertTrue(groups)
        for pair, fixtures in groups.items():
            with self.subTest(pair=pair):
                self.assertTrue(all(f["oracle"] == fixtures[0]["oracle"] for f in fixtures))
                self.assertEqual(min(f["spokes"] for f in fixtures), 12)


if __name__ == "__main__":
    unittest.main()


@unittest.skipUnless(importlib.util.find_spec("osmium"), "PyOsmium is not installed in this Python runtime")
class ProductExpanderAdversarialTests(unittest.TestCase):
    """End-to-end expander checks, enabled in the documented converter runtime."""

    def setUp(self) -> None:
        self.root = Path(__file__).resolve().parents[3] / f".tmp-osm-expander-matrix-{os.getpid()}-{id(self)}"
        self.root.mkdir()
        self.catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
        self.fixtures = expand_fixture_definitions(self.catalog)

    def tearDown(self) -> None:
        for entry in self.root.iterdir():
            if entry.is_file():
                entry.unlink()
        self.root.rmdir()

    def test_current_expander_boundary_and_fail_closed_matrix(self) -> None:
        from scripts.motis.osm_junction_expander import ExpansionError, expand_osm_file

        for fixture in self.fixtures:
            with self.subTest(fixture=fixture["id"]):
                source = self.root / f"{fixture['id']}.osm.pbf"
                output = self.root / f"{fixture['id']}.expanded.osm.pbf"
                write_fixture(fixture, source)
                try:
                    expand_osm_file(source, output)
                except ExpansionError as exc:
                    reason = str(exc)
                    self.assertFalse(output.exists(), "failed conversion left a partial destination PBF")
                    if fixture["expected_outcome"] != "fail_closed":
                        self.fail(f"unexpected fail-closed result for {fixture['id']}: {reason}")
                    expected_relation_ids = [
                        str(relation["relation_id"])
                        for relation in fixture.get("relations", [])
                        if fixture.get("relation_kind") in {
                            "static_via_node", "conditional", "via_way", "malformed", "multiple_static_via_node"
                        }
                    ]
                    if expected_relation_ids:
                        self.assertTrue(
                            any(identifier in reason for identifier in expected_relation_ids),
                            f"failure should name an affected relation ID from {expected_relation_ids}: {reason}",
                        )
                    if fixture.get("pair_id") in {"mixed_oneway", "mixed_mode_access"}:
                        self.assertTrue(any(str(fixture["way_id_base"] + index) in reason for index in (0, 1)))
                    continue

                self.assertTrue(output.is_file())
                report = verify_expansion_semantics(source, output, fixture)
                outcome = fixture["expected_outcome"]
                if outcome == "fail_closed":
                    self.fail(f"unsupported fixture {fixture['id']} was converted without rejection")
                if outcome == "semantic_mismatch_expected":
                    self.assertTrue(report["transition_changes"] or report["transition_mismatches_after"])
                elif outcome.startswith("copy_unverified_"):
                    self.assertTrue(report["unsupported_semantics"], json.dumps(report, indent=2))
                    self.assertFalse(report["occurrence_overflow"], json.dumps(report, indent=2))
                else:
                    self.assertTrue(report["exact_semantics"], json.dumps(report, indent=2))
                    self.assertFalse(report["occurrence_overflow"], json.dumps(report, indent=2))
                    self.assertFalse(any(report["structure_violations"].values()), json.dumps(report, indent=2))

                if outcome == "force_expand":
                    forced_output = self.root / f"{fixture['id']}.force-expanded.osm.pbf"
                    forced = expand_osm_file(source, forced_output, max_occurrences=11)
                    self.assertGreater(forced["expanded_nodes"], 0)
                    forced_report = verify_expansion_semantics(source, forced_output, fixture)
                    self.assertTrue(forced_report["exact_semantics"], json.dumps(forced_report, indent=2))
                elif outcome == "force_expand_semantic_mismatch":
                    forced_output = self.root / f"{fixture['id']}.force-expanded.osm.pbf"
                    expand_osm_file(source, forced_output, max_occurrences=11)
                    forced_report = verify_expansion_semantics(source, forced_output, fixture)
                    self.assertTrue(forced_report["transition_changes"] or forced_report["transition_mismatches_after"])
                elif outcome == "force_expand_expected_fail_closed":
                    forced_output = self.root / f"{fixture['id']}.force-expanded.osm.pbf"
                    with self.assertRaises(ExpansionError) as raised:
                        expand_osm_file(source, forced_output, max_occurrences=11)
                    self.assertFalse(forced_output.exists())
                    expected_ids = [str(relation["relation_id"]) for relation in fixture.get("relations", [])]
                    if not expected_ids:
                        expected_ids = [str(fixture["way_id_base"] + index) for index in (0, 1)]
                    self.assertTrue(any(identifier in str(raised.exception) for identifier in expected_ids))

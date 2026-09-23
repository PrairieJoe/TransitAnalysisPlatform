from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.motis.osm_junction_fixture_generator import write_fixture
from scripts.motis.osm_junction_semantic_verifier import verify_expansion_semantics, verify_fixture_semantics
from scripts.motis.run_single_topology_compatibility_gate import expand_gate_fixtures
from scripts.motis.single_topology_poc import expand_single_topology_fixture


class SingleTopologyCompatibilityGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(__file__).resolve().parents[3]
        self.catalog_path = self.root / "fixtures" / "osm-junctions" / "single-topology-decision-gate.json"
        self.catalog = json.loads(self.catalog_path.read_text(encoding="utf-8"))

    def test_declarative_matrix_covers_every_family_at_each_requested_degree(self) -> None:
        fixtures = expand_gate_fixtures(self.catalog)
        expected_counts = set(self.catalog["spoke_counts"])
        self.assertEqual(len(fixtures), len(self.catalog["families"]) * len(expected_counts))
        for family in self.catalog["families"]:
            family_fixtures = [fixture for fixture in fixtures if fixture["pair_id"] == family["id"]]
            self.assertEqual({fixture["spokes"] for fixture in family_fixtures}, expected_counts)

    def test_hand_authored_transition_oracles_match_generated_source_pbfs(self) -> None:
        fixtures = expand_gate_fixtures(self.catalog)
        selected = [
            fixture for fixture in fixtures
            if fixture["spokes"] in {8, 12, 16, 17, 24, 64}
        ]
        with tempfile.TemporaryDirectory(prefix="single-topology-gate-oracle-") as temporary:
            for fixture in selected:
                with self.subTest(fixture=fixture["id"]):
                    path = write_fixture(fixture, Path(temporary) / f"{fixture['id']}.osm.pbf")
                    report = verify_fixture_semantics(path, fixture)
                    self.assertEqual(report["transition_mismatches"], [])
                    self.assertEqual(report["unsupported_semantics"], [])

    def test_fixture_writer_honors_explicit_meter_offset_for_uturn_probe(self) -> None:
        fixture = next(
            item for item in expand_gate_fixtures(self.catalog)
            if item["id"] == "no_u_turn-12"
        )
        fixture["endpoint_offsets_meters"] = {"11": [89.0, 16.7]}
        with tempfile.TemporaryDirectory(prefix="single-topology-gate-uturn-") as temporary:
            path = write_fixture(fixture, Path(temporary) / "uturn.osm.pbf")
            from scripts.motis.osm_junction_semantic_verifier import read_osm_pbf

            document = read_osm_pbf(path)
            center = document["nodes"][100]
            target = document["nodes"][1011]
            east_m = (target["lon"] - center["lon"]) * 111_320 * __import__("math").cos(
                __import__("math").radians(center["lat"])
            )
            north_m = (target["lat"] - center["lat"]) * 111_320
            self.assertAlmostEqual(east_m, 89.0, delta=0.02)
            self.assertAlmostEqual(north_m, 16.7, delta=0.02)

    def test_force_expansion_matches_offdiagonal_turn_matrix_and_allows_valid_approach_clones(self) -> None:
        fixtures = expand_gate_fixtures(self.catalog)
        selected = [
            next(item for item in fixtures if item["id"] == fixture_id)
            for fixture_id in ("no_u_turn-12", "only_left_turn-12", "mixed_mode_access-12")
        ]
        with tempfile.TemporaryDirectory(prefix="single-topology-gate-transform-") as temporary:
            root = Path(temporary)
            for fixture in selected:
                with self.subTest(fixture=fixture["id"]):
                    source = write_fixture(fixture, root / f"{fixture['id']}.osm.pbf")
                    transformed = root / f"{fixture['id']}.transformed.osm.pbf"
                    expand_single_topology_fixture(source, transformed, force_expand=True)
                    report = verify_expansion_semantics(source, transformed, fixture)
                    self.assertTrue(report["exact_semantics"])
                    self.assertEqual(report["occurrence_overflow"], {})
                    self.assertTrue(all(not rows for rows in report["structure_violations"].values()))


if __name__ == "__main__":
    unittest.main()

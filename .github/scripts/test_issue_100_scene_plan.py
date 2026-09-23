#!/usr/bin/env python3
from __future__ import annotations

import json
import unittest
from pathlib import Path

from faceless_scene_plan_contract import evaluate


ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / ".github" / "quality"
CONFIG = ROOT / ".github" / "config" / "faceless-quality-v2.json"
PLAN = QUALITY / "issue-100-scenario-1-scene-plan.json"
SCRIPT = QUALITY / "issue-100-scenario-1-script.txt"


class Issue100ScenePlanTests(unittest.TestCase):
    def test_issue_100_scenario_1_plan_passes_quality_contract(self):
        result = evaluate(
            json.loads(PLAN.read_text(encoding="utf-8")),
            SCRIPT.read_text(encoding="utf-8").strip(),
            json.loads(CONFIG.read_text(encoding="utf-8")),
        )
        self.assertEqual(result["scene_count"], 6)
        self.assertFalse(result["render_ready"])
        self.assertEqual(result["timing_source"], "pending_final_tts")
        self.assertFalse(result["sequential_stock_concat_allowed"])
        self.assertFalse(result["publication_allowed"])
        self.assertTrue(result["semantic_qc_required"])
        self.assertTrue(result["owner_editorial_approval_required"])


if __name__ == "__main__":
    unittest.main()

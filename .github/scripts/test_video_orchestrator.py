#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("video_orchestrator.py")
CONFIG = Path(__file__).parent.parent / "config" / "video-orchestrator.json"
spec = importlib.util.spec_from_file_location("video_orchestrator", SCRIPT)
if spec is None or spec.loader is None:
    raise RuntimeError("video_orchestrator yüklenemedi")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
config = json.loads(CONFIG.read_text(encoding="utf-8"))


class VideoOrchestratorTests(unittest.TestCase):
    def test_human_demonstration_routes_to_vibeframe(self):
        d = mod.decide("Bu akoru gitarda göster ve ritmi çal.", config)
        self.assertEqual(d["selected_mode"], "human")
        self.assertEqual(d["engine"], "vibeframe")
        self.assertTrue(d["requires_raw_video"])

    def test_human_plus_broll_routes_to_hybrid(self):
        d = mod.decide("Riffi gitarda göster, araya B-roll ve nota görseli ekle.", config)
        self.assertEqual(d["selected_mode"], "hybrid")
        self.assertEqual(d["engine"], "vibeframe")
        self.assertTrue(d["allows_ai_broll"])

    def test_fact_list_routes_to_faceless(self):
        d = mod.decide("Bas gitar hakkında 5 ilginç bilgi ve kısa bir tarihi.", config)
        self.assertEqual(d["selected_mode"], "faceless")
        self.assertEqual(d["engine"], "moneyprinterturbo")
        self.assertFalse(d["requires_raw_video"])

    def test_unknown_content_uses_safe_human_default(self):
        d = mod.decide("Bugünkü içerik fikrimiz hazır.", config)
        self.assertEqual(d["selected_mode"], "human")
        self.assertEqual(d["reason"], "safe_default")

    def test_premium_ai_is_never_auto_selected(self):
        d = mod.decide("Sinematik görsel destekli video", config, "auto")
        self.assertNotEqual(d["selected_mode"], "premium_ai")

    def test_premium_ai_can_only_be_manual_and_still_cannot_spend(self):
        d = mod.decide("Test", config, "premium_ai")
        self.assertEqual(d["selected_mode"], "premium_ai")
        self.assertFalse(d["paid_generation_allowed"])
        self.assertFalse(d["dispatch_enabled"])

    def test_manual_override_for_faceless(self):
        d = mod.decide("gitarda göster", config, "faceless")
        self.assertEqual(d["selected_mode"], "faceless")
        self.assertEqual(d["reason"], "manual_override")


if __name__ == "__main__":
    unittest.main(verbosity=2)

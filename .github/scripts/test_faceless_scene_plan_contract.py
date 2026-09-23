#!/usr/bin/env python3
from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from faceless_scene_plan_contract import (
    ScenePlanError,
    evaluate,
    script_sha256,
    validate_quality_config,
)


CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "faceless-quality-v2.json"
SCRIPT = (
    "Gitara yeni başlıyorsan üç küçük alışkanlık işini kolaylaştırır. "
    "Çalmadan önce akordu kontrol et. "
    "Her gün on dakika tek bir akor geçişini yavaşça tekrar et. "
    "Çalışmanı kısa bir ses kaydıyla dinle; ritmin nerede dağıldığını fark edersin."
)


def load_config() -> dict:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def valid_plan(*, render_ready: bool = False) -> dict:
    scenes = [
        {
            "scene_id": 1,
            "purpose": "hook",
            "narration": "Gitara yeni başlıyorsan üç küçük alışkanlık işini kolaylaştırır.",
            "visual_queries": ["beginner guitarist close-up", "guitar practice hands"],
            "must_show": ["gitar", "çalışma ortamı"],
            "must_not_show": ["yemek", "uyuyan kişi"],
            "approved_asset_ids": ["101"] if render_ready else [],
            "target_duration_seconds": 3.5,
            "timing": {"start_seconds": 0.0, "end_seconds": 3.4} if render_ready else None,
        },
        {
            "scene_id": 2,
            "purpose": "value",
            "narration": "Çalmadan önce akordu kontrol et.",
            "visual_queries": ["guitar tuner tuning strings", "clip-on tuner guitar"],
            "must_show": ["gitar", "akort cihazı veya tuner"],
            "must_not_show": ["piyano", "genel konser kalabalığı"],
            "approved_asset_ids": ["102"] if render_ready else [],
            "target_duration_seconds": 3.0,
            "timing": {"start_seconds": 3.4, "end_seconds": 6.1} if render_ready else None,
        },
        {
            "scene_id": 3,
            "purpose": "value",
            "narration": "Her gün on dakika tek bir akor geçişini yavaşça tekrar et.",
            "visual_queries": ["guitar chord change fingers close-up", "guitar fretting hand chord"],
            "must_show": ["gitar klavyesi", "akor değiştiren parmaklar"],
            "must_not_show": ["rastgele enstrüman", "sahne performansı"],
            "approved_asset_ids": ["103"] if render_ready else [],
            "target_duration_seconds": 4.5,
            "timing": {"start_seconds": 6.1, "end_seconds": 10.4} if render_ready else None,
        },
        {
            "scene_id": 4,
            "purpose": "value",
            "narration": "Çalışmanı kısa bir ses kaydıyla dinle; ritmin nerede dağıldığını fark edersin.",
            "visual_queries": ["guitarist recording phone voice memo", "phone recording guitar practice"],
            "must_show": ["gitar", "telefon veya ses kayıt ekranı"],
            "must_not_show": ["telefonla mesajlaşma", "alakasız masa görüntüsü"],
            "approved_asset_ids": ["104"] if render_ready else [],
            "target_duration_seconds": 5.0,
            "timing": {"start_seconds": 10.4, "end_seconds": 15.2} if render_ready else None,
        },
    ]
    return {
        "schema_version": 1,
        "event": "faceless_scene_plan_v2",
        "script_sha256": script_sha256(SCRIPT),
        "aspect_ratio": "9:16",
        "render_ready": render_ready,
        "timing_source": "final_tts_alignment" if render_ready else "pending_final_tts",
        "scenes": scenes,
    }


class ScenePlanContractTests(unittest.TestCase):
    def test_quality_config_is_fail_closed(self):
        validate_quality_config(load_config())

    def test_valid_draft_plan_passes_without_assets_or_timing(self):
        result = evaluate(valid_plan(), SCRIPT, load_config())
        self.assertFalse(result["render_ready"])
        self.assertFalse(result["sequential_stock_concat_allowed"])
        self.assertEqual(result["timing_source"], "pending_final_tts")
        self.assertTrue(result["semantic_qc_required"])
        self.assertFalse(result["publication_allowed"])

    def test_script_sha_mismatch_fails(self):
        plan = valid_plan()
        plan["script_sha256"] = "a" * 64
        with self.assertRaises(ScenePlanError):
            evaluate(plan, SCRIPT, load_config())

    def test_missing_visual_intent_fails(self):
        plan = valid_plan()
        plan["scenes"][1]["must_show"] = []
        with self.assertRaises(ScenePlanError):
            evaluate(plan, SCRIPT, load_config())

    def test_narration_must_cover_exact_script_in_order(self):
        plan = valid_plan()
        plan["scenes"][2]["narration"] = "Her gün hızlı çal."
        with self.assertRaises(ScenePlanError):
            evaluate(plan, SCRIPT, load_config())

    def test_sequential_stock_concat_cannot_be_reenabled(self):
        config = load_config()
        config["render"]["sequential_stock_concat_forbidden"] = False
        with self.assertRaises(ScenePlanError):
            validate_quality_config(config)

    def test_elevenlabs_stays_disabled_in_foundation(self):
        config = load_config()
        config["tts"]["final"]["enabled"] = True
        with self.assertRaises(ScenePlanError):
            validate_quality_config(config)

    def test_render_ready_requires_approved_asset_and_final_timing(self):
        plan = valid_plan(render_ready=True)
        result = evaluate(plan, SCRIPT, load_config())
        self.assertTrue(result["render_ready"])
        self.assertEqual(result["timing_source"], "final_tts_alignment")

        missing_asset = valid_plan(render_ready=True)
        missing_asset["scenes"][2]["approved_asset_ids"] = []
        with self.assertRaises(ScenePlanError):
            evaluate(missing_asset, SCRIPT, load_config())

    def test_render_ready_timing_cannot_overlap_backwards(self):
        plan = valid_plan(render_ready=True)
        plan["scenes"][2]["timing"] = {"start_seconds": 5.0, "end_seconds": 8.0}
        with self.assertRaises(ScenePlanError):
            evaluate(plan, SCRIPT, load_config())


if __name__ == "__main__":
    unittest.main()

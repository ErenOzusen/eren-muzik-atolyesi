#!/usr/bin/env python3
from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from faceless_scene_plan_contract import (
    ScenePlanError,
    evaluate,
    scene_plan_sha256,
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
    plan = {
        "schema_version": 1,
        "event": "faceless_scene_plan_v2",
        "script_sha256": script_sha256(SCRIPT),
        "aspect_ratio": "9:16",
        "render_ready": render_ready,
        "timing_source": "final_tts_alignment" if render_ready else "pending_final_tts",
        "scenes": scenes,
    }
    if render_ready:
        for scene in scenes:
            scene["semantic_qc"] = [{
                "asset_id": scene["approved_asset_ids"][0],
                "approved": True,
                "score": 0.9,
                "observed_must_show": scene["must_show"].copy(),
                "absent_must_not_show": scene["must_not_show"].copy(),
            }]
        approve_plan(plan)
    return plan


def approve_plan(plan: dict) -> None:
    plan["owner_editorial_approval"] = {
        "approved": True,
        "script_sha256": plan["script_sha256"],
        "scene_plan_sha256": scene_plan_sha256(plan),
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
        approve_plan(missing_asset)
        with self.assertRaises(ScenePlanError):
            evaluate(missing_asset, SCRIPT, load_config())

    def test_render_ready_timing_cannot_overlap_backwards(self):
        plan = valid_plan(render_ready=True)
        plan["scenes"][2]["timing"] = {"start_seconds": 5.0, "end_seconds": 8.0}
        approve_plan(plan)
        with self.assertRaises(ScenePlanError):
            evaluate(plan, SCRIPT, load_config())

    def test_valid_render_preserves_tts_timing(self):
        plan = valid_plan(render_ready=True)
        result = evaluate(plan, SCRIPT, load_config())
        self.assertEqual(result["scenes"][2]["timing"], plan["scenes"][2]["timing"])

    def test_render_flag_requires_boolean(self):
        for value in ("false", "true", 0, 1, None, []):
            with self.subTest(value=value):
                plan = valid_plan()
                plan["render_ready"] = value
                with self.assertRaises(ScenePlanError):
                    evaluate(plan, SCRIPT, load_config())

    def test_render_requires_current_editorial_approval(self):
        for approval in (None, {}, {"approved": "true"}, {"approved": True}):
            with self.subTest(approval=approval):
                plan = valid_plan(render_ready=True)
                plan["owner_editorial_approval"] = approval
                with self.assertRaises(ScenePlanError):
                    evaluate(plan, SCRIPT, load_config())

    def test_editorial_approval_invalidated_by_plan_changes(self):
        for key, value in (("approved_asset_ids", ["other"]),
                           ("must_show", ["other intent"]),
                           ("timing", {"start_seconds": 0, "end_seconds": 3.5})):
            with self.subTest(key=key):
                plan = valid_plan(render_ready=True)
                plan["scenes"][0][key] = value
                with self.assertRaises(ScenePlanError):
                    evaluate(plan, SCRIPT, load_config())

    def test_semantic_review_requires_every_asset_and_visual_constraint(self):
        mutations = (
            lambda scene: scene.pop("semantic_qc"),
            lambda scene: scene["semantic_qc"][0].update(asset_id="other"),
            lambda scene: scene["semantic_qc"][0].update(score=0.84),
            lambda scene: scene["semantic_qc"][0].update(score=1.01),
            lambda scene: scene["semantic_qc"][0].update(score=True),
            lambda scene: scene["semantic_qc"][0].update(approved=False),
            lambda scene: scene["semantic_qc"][0].update(observed_must_show=[]),
            lambda scene: scene["semantic_qc"][0].update(absent_must_not_show=[]),
            lambda scene: scene["approved_asset_ids"].append("second"),
        )
        for index, mutate in enumerate(mutations):
            with self.subTest(index=index):
                plan = valid_plan(render_ready=True)
                mutate(plan["scenes"][0])
                approve_plan(plan)
                with self.assertRaises(ScenePlanError):
                    evaluate(plan, SCRIPT, load_config())

    def test_duplicate_reviews_cannot_replace_review_of_another_asset(self):
        plan = valid_plan(render_ready=True)
        scene = plan["scenes"][0]
        scene["approved_asset_ids"].append("second")
        scene["semantic_qc"].append(copy.deepcopy(scene["semantic_qc"][0]))
        approve_plan(plan)
        with self.assertRaises(ScenePlanError):
            evaluate(plan, SCRIPT, load_config())

    def test_numeric_values_must_be_finite_and_not_boolean(self):
        for value in (float("nan"), float("inf"), float("-inf"), True):
            with self.subTest(value=value):
                plan = valid_plan()
                plan["scenes"][0]["target_duration_seconds"] = value
                with self.assertRaises(ScenePlanError):
                    evaluate(plan, SCRIPT, load_config())
                config = load_config()
                config["scene_planner"]["min_semantic_score"] = value
                with self.assertRaises(ScenePlanError):
                    validate_quality_config(config)

    def test_render_timing_rejects_boolean_and_nonfinite_values(self):
        for value in (True, False, float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value):
                plan = valid_plan(render_ready=True)
                plan["scenes"][0]["timing"]["end_seconds"] = value
                if isinstance(value, bool):
                    approve_plan(plan)
                with self.assertRaises(ScenePlanError):
                    evaluate(plan, SCRIPT, load_config())

    def test_asset_ids_cannot_be_coerced_or_duplicated(self):
        for ids in ([None], [True], [101], ["101", "101"]):
            with self.subTest(ids=ids):
                plan = valid_plan()
                plan["scenes"][0]["approved_asset_ids"] = ids
                with self.assertRaises(ScenePlanError):
                    evaluate(plan, SCRIPT, load_config())

    def test_plan_fingerprint_is_independent_of_key_order_and_approval(self):
        plan = valid_plan(render_ready=True)
        reordered = dict(reversed(list(plan.items())))
        reordered["owner_editorial_approval"] = {"approved": False}
        self.assertEqual(scene_plan_sha256(plan), scene_plan_sha256(reordered))


if __name__ == "__main__":
    unittest.main()

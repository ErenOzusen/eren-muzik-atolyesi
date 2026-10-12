#!/usr/bin/env python3
"""Zero-network regression tests using synthetic audio bytes and alignment."""
import copy
import hashlib
import unittest

from faceless_audio_timeline_contract import evaluate_timeline
from faceless_scene_plan_contract import ScenePlanError
from test_faceless_scene_plan_contract import SCRIPT, load_config, valid_plan


AUDIO = b"synthetic-test-audio-no-provider-call"


def valid_alignment(plan):
    return {"schema_version": 1, "event": "faceless_final_tts_alignment_v2",
            "provider": "elevenlabs", "script_sha256": plan["script_sha256"],
            "audio_sha256": hashlib.sha256(AUDIO).hexdigest(), "duration_seconds": 15.2,
            "segments": [{"scene_id": scene["scene_id"], "narration": scene["narration"],
                          **scene["timing"]} for scene in plan["scenes"]]}


class AudioTimelineTests(unittest.TestCase):
    def test_valid_timeline_preserves_narration_assets_and_blocks_dispatch(self):
        plan = valid_plan(render_ready=True)
        result = evaluate_timeline(plan, SCRIPT, load_config(), valid_alignment(plan), AUDIO)
        self.assertEqual(result["scenes"][1]["approved_asset_ids"], ["102"])
        self.assertEqual(result["scenes"][-1]["end_seconds"], 15.2)
        self.assertFalse(result["publication_allowed"])
        self.assertFalse(result["render_dispatch_allowed"])

    def test_changed_audio_is_rejected(self):
        plan = valid_plan(render_ready=True)
        with self.assertRaises(ScenePlanError):
            evaluate_timeline(plan, SCRIPT, load_config(), valid_alignment(plan), b"other-audio")

    def test_draft_cannot_be_used_as_final_timeline(self):
        with self.assertRaises(ScenePlanError):
            evaluate_timeline(valid_plan(), SCRIPT, load_config(), {}, AUDIO)

    def test_invalid_alignment_blocks_before_handoff(self):
        plan = valid_plan(render_ready=True)
        alignment = valid_alignment(plan)
        mutations = [
            ("provider", "edge"), ("script_sha256", "a" * 64),
            ("duration_seconds", float("nan")), ("duration_seconds", True),
            ("duration_seconds", 20), ("segments", alignment["segments"][:-1]),
        ]
        for field, value in mutations:
            with self.subTest(field=field, value=value):
                altered = copy.deepcopy(alignment)
                altered[field] = value
                with self.assertRaises(ScenePlanError):
                    evaluate_timeline(plan, SCRIPT, load_config(), altered, AUDIO)

    def test_scene_misalignment_gaps_overlaps_and_narration_are_rejected(self):
        plan = valid_plan(render_ready=True)
        for field, value in [("scene_id", True), ("scene_id", 3),
                             ("narration", "different words"), ("start_seconds", 3.6),
                             ("start_seconds", 3.2), ("end_seconds", 6.2),
                             ("end_seconds", float("inf"))]:
            with self.subTest(field=field, value=value):
                alignment = valid_alignment(plan)
                alignment["segments"][1][field] = value
                with self.assertRaises(ScenePlanError):
                    evaluate_timeline(plan, SCRIPT, load_config(), alignment, AUDIO)


if __name__ == "__main__":
    unittest.main()

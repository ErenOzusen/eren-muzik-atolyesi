#!/usr/bin/env python3
"""Offline synthetic character timestamps: no speech or provider requests."""
import base64
import copy
import hashlib
import unittest

from faceless_audio_timeline_contract import evaluate_timeline
from faceless_elevenlabs_alignment import adapt_alignment
from faceless_scene_plan_contract import ScenePlanError, evaluate, script_sha256
from test_faceless_scene_plan_contract import (
    SCRIPT, approve_plan, load_config, valid_plan,
)


AUDIO = b"synthetic-local-audio-no-generation"


def character_response(text=SCRIPT):
    return {"characters": list(text),
            "character_start_times_seconds": [index * 0.04 for index in range(len(text))],
            "character_end_times_seconds": [(index + 1) * 0.04 for index in range(len(text))]}


def adapt(response=None, plan=None, script=SCRIPT, duration=None, audio=AUDIO):
    response = character_response(script) if response is None else response
    return adapt_alignment(response, len(script) * 0.04 + 0.3 if duration is None else duration,
                           script, valid_plan() if plan is None else plan, load_config(), audio)


class ElevenLabsAlignmentTests(unittest.TestCase):
    def test_exact_scene_mapping_boundaries_and_sha(self):
        result = adapt()
        alignment = result["alignment"]
        segments = alignment["segments"]
        self.assertEqual(segments[0]["start_seconds"], 0)
        self.assertEqual(segments[-1]["end_seconds"], len(SCRIPT) * 0.04 + 0.3)
        length = len(valid_plan()["scenes"][0]["narration"])
        self.assertAlmostEqual(segments[0]["end_seconds"], (length + 0.5) * 0.04)
        for left, right in zip(segments, segments[1:]):
            self.assertEqual(left["end_seconds"], right["start_seconds"])
        self.assertEqual(alignment["script_sha256"], script_sha256(SCRIPT))
        self.assertEqual(alignment["audio_sha256"], hashlib.sha256(AUDIO).hexdigest())
        self.assertEqual([item["narration"] for item in segments],
                         [item["narration"] for item in valid_plan()["scenes"]])

    def test_unicode_whitespace_maps_to_original_character_indices(self):
        text = "\t\u2003" + SCRIPT.replace(" ", "\n\u00a0\t") + "\r\n"
        response = character_response(text)
        result = adapt(response, duration=len(text) * 0.04 + 1)
        first = valid_plan()["scenes"][0]["narration"]
        first_end = text.index(first.split()[-1]) + len(first.split()[-1])
        next_start = text.index("Çalmadan")
        expected = (response["character_end_times_seconds"][first_end - 1]
                    + response["character_start_times_seconds"][next_start]) / 2
        self.assertAlmostEqual(result["alignment"]["segments"][0]["end_seconds"], expected)

    def test_repeated_scene_narration_uses_sequential_offsets(self):
        script = "Tekrar et. Tekrar et. Tekrar et. Tekrar et."
        plan = valid_plan()
        plan["script_sha256"] = script_sha256(script)
        for scene in plan["scenes"]:
            scene["narration"] = "Tekrar et."
        segments = adapt(script=script, plan=plan)["alignment"]["segments"]
        self.assertTrue(all(left["end_seconds"] < right["end_seconds"]
                            for left, right in zip(segments, segments[1:])))

    def test_saved_raw_response_checks_audio_and_prefers_original_alignment(self):
        response = {"alignment": character_response(),
                    "normalized_alignment": character_response("changed normalization"),
                    "audio_base64": base64.b64encode(AUDIO).decode("ascii")}
        self.assertEqual(adapt(response)["alignment"]["provider"], "elevenlabs")
        response["alignment"] = None
        with self.assertRaises(ScenePlanError):
            adapt(response)
        response["normalized_alignment"] = character_response()
        self.assertEqual(adapt(response)["alignment"]["provider"], "elevenlabs")

    def test_invalid_audio_or_response_audio_mismatch_is_rejected(self):
        for audio in (b"", None, "audio"):
            with self.subTest(audio=audio), self.assertRaises(ScenePlanError):
                adapt(audio=audio)
        for encoded in (None, 123, "not-base64!", base64.b64encode(b"different").decode()):
            response = {"alignment": character_response(), "audio_base64": encoded}
            with self.subTest(encoded=encoded), self.assertRaises(ScenePlanError):
                adapt(response)

    def test_script_mismatch_never_fuzzy_matches_or_falls_back(self):
        for text in (SCRIPT.replace(";", ","), SCRIPT.lower(), SCRIPT + " Extra.",
                     SCRIPT[:-1], SCRIPT.replace("üç", "3")):
            with self.subTest(text=text), self.assertRaises(ScenePlanError):
                adapt(character_response(text), duration=100)
        with self.assertRaises(ScenePlanError):
            adapt({"alignment": character_response("Wrong."),
                   "normalized_alignment": character_response()})

    def test_scene_order_and_script_binding_are_validated(self):
        for mutate in (lambda plan: plan.update(script_sha256="a" * 64),
                       lambda plan: plan["scenes"].reverse(),
                       lambda plan: plan["scenes"][0].update(narration="Wrong."),
                       lambda plan: plan["scenes"][0].update(scene_id=True)):
            plan = valid_plan()
            mutate(plan)
            with self.assertRaises(ScenePlanError):
                adapt(plan=plan)

    def test_arrays_and_characters_fail_closed(self):
        mutations = [lambda item: item.update(characters=[]),
                     lambda item: item["characters"].__setitem__(0, "two"),
                     lambda item: item["characters"].__setitem__(0, None),
                     lambda item: item.update(characters=SCRIPT),
                     lambda item: item["character_start_times_seconds"].pop(),
                     lambda item: item.update(character_end_times_seconds=None)]
        for index, mutate in enumerate(mutations):
            response = character_response()
            mutate(response)
            with self.subTest(index=index), self.assertRaises(ScenePlanError):
                adapt(response)
        for response in (None, [], {}, {"alignment": None}, {"alignment": []}):
            with self.subTest(response=response), self.assertRaises(ScenePlanError):
                adapt_alignment(response, 20, SCRIPT, valid_plan(), load_config(), AUDIO)

    def test_timing_is_finite_nonnegative_ordered_and_bounded(self):
        for field in ("character_start_times_seconds", "character_end_times_seconds"):
            for value in (True, "0.1", None, -0.1, float("nan"), float("inf"), 100):
                response = character_response()
                response[field][1] = value
                with self.subTest(field=field, value=value), self.assertRaises(ScenePlanError):
                    adapt(response)
        for mutate in (
                lambda item: item["character_start_times_seconds"].__setitem__(1, 0),
                lambda item: item["character_end_times_seconds"].__setitem__(1, 0.03),
                lambda item: item["character_end_times_seconds"].__setitem__(1, 0.2)):
            response = character_response()
            mutate(response)
            with self.assertRaises(ScenePlanError):
                adapt(response)
        for duration in (True, -1, 0, float("nan"), float("inf"), 0.5):
            with self.subTest(duration=duration), self.assertRaises(ScenePlanError):
                adapt(duration=duration)

    def test_zero_length_scenes_are_rejected(self):
        response = character_response()
        response["character_start_times_seconds"] = [0] * len(SCRIPT)
        response["character_end_times_seconds"] = [0] * len(SCRIPT)
        with self.assertRaises(ScenePlanError):
            adapt(response)

    def test_reviewed_plan_is_demoted_and_evidence_preserved_without_input_mutation(self):
        plan = valid_plan(render_ready=True)
        before = copy.deepcopy(plan)
        result = adapt(plan=plan)
        updated = result["updated_plan"]
        self.assertEqual(plan, before)
        self.assertFalse(updated["render_ready"])
        self.assertNotIn("owner_editorial_approval", updated)
        self.assertEqual(updated["timing_source"], "pending_final_tts")
        self.assertEqual(updated["pending_final_tts_alignment"], result["alignment"])
        for old, scene in zip(plan["scenes"], updated["scenes"]):
            self.assertIsNone(scene["timing"])
            self.assertEqual(scene["approved_asset_ids"], old["approved_asset_ids"])
            self.assertEqual(scene["semantic_qc"], old["semantic_qc"])
        self.assertFalse(evaluate(updated, SCRIPT, load_config())["render_ready"])
        with self.assertRaises(ScenePlanError):
            evaluate_timeline(updated, SCRIPT, load_config(), result["alignment"], AUDIO)

    def test_draft_does_not_gain_assets_or_semantic_evidence(self):
        updated = adapt()["updated_plan"]
        for scene in updated["scenes"]:
            self.assertEqual(scene["approved_asset_ids"], [])
            self.assertNotIn("semantic_qc", scene)
        self.assertNotIn("owner_editorial_approval", updated)

    def test_manual_review_handoff_is_compatible_with_existing_timeline(self):
        result = adapt(plan=valid_plan(render_ready=True))
        reviewed = result["updated_plan"]
        # Test-only simulation of a separate human review; adapter cannot do this.
        reviewed.pop("pending_final_tts_alignment")
        reviewed["render_ready"] = True
        reviewed["timing_source"] = "final_tts_alignment"
        for scene, segment in zip(reviewed["scenes"], result["alignment"]["segments"]):
            scene["timing"] = {key: segment[key] for key in ("start_seconds", "end_seconds")}
        approve_plan(reviewed)
        timeline = evaluate_timeline(reviewed, SCRIPT, load_config(), result["alignment"], AUDIO)
        self.assertEqual(timeline["scenes"][-1]["end_seconds"], result["alignment"]["duration_seconds"])
        self.assertFalse(timeline["render_dispatch_allowed"])


if __name__ == "__main__":
    unittest.main()

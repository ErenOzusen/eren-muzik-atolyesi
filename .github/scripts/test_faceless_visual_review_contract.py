#!/usr/bin/env python3
"""Zero-network tests for the unapproved, frame-hash-bound vision review contract."""
from __future__ import annotations

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from faceless_visual_sampling import collect
from faceless_visual_review_contract import (
    VisionContractError, check_vision_claims, review_packets,
)

SCRIPT = "Başlangıç. Önce akordu kontrol et. Akorlar arasında geçiş yap. Kayıt al."


def plan_fixture():
    words = ["Başlangıç.", "Önce akordu kontrol et.", "Akorlar arasında geçiş yap.", "Kayıt al."]
    scenes = []
    for i, line in enumerate(words, 1):
        scenes.append({"scene_id": i, "purpose": "hook" if i == 1 else "value",
                       "narration": line, "visual_queries": ["guitar hands"],
                       "must_show": ["gitar", "akort cihazı"] if i == 2 else ["gitar"],
                       "must_not_show": ["uyuyan kişi", "yemek"], "approved_asset_ids": [],
                       "target_duration_seconds": 3.0, "timing": None})
    return {"schema_version": 1, "event": "faceless_scene_plan_v2", "source_issue": 100,
            "script_sha256": hashlib.sha256(SCRIPT.encode()).hexdigest(),
            "aspect_ratio": "9:16", "render_ready": False,
            "timing_source": "pending_final_tts", "scenes": scenes}


def config_fixture():
    return {"schema_version": 1, "enabled": False,
            "scene_planner": {"required": True, "min_scenes": 3, "max_scenes": 10,
                              "max_scene_seconds": 5.0,
                              "require_sentence_scene_alignment": True,
                              "require_asset_per_scene_before_render": True,
                              "require_semantic_qc": True, "min_semantic_score": 0.85,
                              "require_owner_editorial_approval": True},
            "tts": {"draft": {"provider": "edge", "enabled": True},
                    "final": {"provider": "elevenlabs", "enabled": False,
                              "secret_name": "ELEVENLABS_API_KEY",
                              "requires_owner_approval": True, "requires_budget_approval": True}},
            "render": {"aspect_ratio": "9:16", "timing_source": "final_tts_alignment",
                       "sequential_stock_concat_forbidden": True,
                       "subtitle_sync_required": True},
            "publication": {"instagram_enabled": False, "youtube_enabled": False,
                            "require_owner_publish_approval": True}}


class VisionReviewContractTests(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        self.root = Path(td.name)
        self.video = self.root / "video.mp4"
        self.video.write_bytes(b"synthetic clip" * 100)
        self.plan = plan_fixture()
        self.config = config_fixture()
        candidate = {"scene_id": 2, "asset_id": "7574545", "path": str(self.video),
                     "source_page": "https://www.pexels.com/video/tuning-7574545/"}
        def fake_frame(video, seconds, path):
            path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"mock frame pixels" * 30)
        with patch("faceless_visual_sampling.probe_video", return_value={
                     "duration_seconds": 6.0, "width": 1080, "height": 1920}), \
             patch("faceless_visual_sampling.extract_frame", side_effect=fake_frame):
            self.manifest = collect(self.plan, SCRIPT, self.config, [candidate], self.root / "samples")
        self.requests = review_packets(self.plan, SCRIPT, self.config,
                                       self.manifest, self.root / "samples")

    def good_response(self):
        packet = self.requests["packets"][0]
        return [{"scene_id": packet["scene_id"], "asset_id": packet["asset_id"],
                 "review_request_sha256": packet["review_request_sha256"],
                 "reviewer_model": "offline-mock-vision", "score": 0.94,
                 "must_show_evidence": {key: {"status": "observed",
                                              "frame_sha256": [packet["frames"][0]["sha256"]],
                                              "observation": f"Sampled frame shows {key} visually."}
                                        for key in packet["must_show"]},
                 "must_not_show_status": {key: "absent_in_samples" for key in packet["must_not_show"]},
                 "motion_verified": False}]

    def test_builds_exact_frame_bound_request_and_blocks_publication(self):
        p = self.requests
        self.assertEqual(p["script_sha256"], self.plan["script_sha256"])
        self.assertEqual(p["missing_candidate_scenes"], [1, 3, 4])
        self.assertEqual(len(p["packets"]), 1)
        self.assertEqual(len(p["packets"][0]["frames"]), 3)
        for key in ("semantic_qc_approved", "render_ready", "publication_allowed"):
            self.assertFalse(p[key])
        self.assertEqual(p["review_calls_attempted"], 0)

    def test_preliminary_review_is_never_an_approval(self):
        outcome = check_vision_claims(self.requests, self.good_response())
        self.assertEqual(outcome["preliminary_count"], 1)
        self.assertTrue(outcome["requires_temporal_video_review"])
        self.assertTrue(outcome["requires_owner_editorial_review"])
        self.assertFalse(outcome["semantic_qc_approved"])
        self.assertFalse(outcome["publication_allowed"])
        self.assertFalse(outcome["render_ready"])

    def test_absence_uncertainty_low_confidence_and_forbidden_object_reject(self):
        for variant in ("missing_observed", "uncertain", "forbidden_present", "low_score"):
            with self.subTest(variant=variant):
                r = self.good_response()
                if variant == "missing_observed":
                    r[0]["must_show_evidence"]["gitar"]["status"] = "absent"
                elif variant == "uncertain":
                    r[0]["must_show_evidence"]["akort cihazı"]["status"] = "uncertain"
                elif variant == "forbidden_present":
                    r[0]["must_not_show_status"]["yemek"] = "present"
                else:
                    r[0]["score"] = 0.7
                out = check_vision_claims(self.requests, r)
                self.assertEqual(out["preliminary_count"], 0)
                self.assertEqual(out["candidates"][0]["status"], "REJECTED_OR_UNCERTAIN")

    def test_stale_fingerprint_duplicated_claims_or_missing_items_fail_closed(self):
        cases = []
        r = self.good_response(); r[0]["review_request_sha256"] = "0" * 64; cases.append(r)
        cases.append([])
        r = self.good_response(); r.append(copy.deepcopy(r[0])); cases.append(r)
        r = self.good_response(); del r[0]["must_show_evidence"]["akort cihazı"]; cases.append(r)
        for claim in cases:
            with self.subTest(claim=claim), self.assertRaises(VisionContractError):
                check_vision_claims(self.requests, claim)

    def test_forged_motion_claim_and_bad_frame_anchors_fail_closed(self):
        r = self.good_response(); r[0]["motion_verified"] = True
        with self.assertRaisesRegex(VisionContractError, "cannot prove temporal"):
            check_vision_claims(self.requests, r)
        r = self.good_response(); r[0]["must_show_evidence"]["gitar"]["frame_sha256"] = ["f" * 64]
        with self.assertRaisesRegex(VisionContractError, "sampled frames"):
            check_vision_claims(self.requests, r)

    def test_bad_score_types_and_unanchored_positive_claims_fail_closed(self):
        for score in (float("nan"), True, -1.0, 1.1, "0.95"):
            r = self.good_response(); r[0]["score"] = score
            with self.subTest(score=score), self.assertRaises(VisionContractError):
                check_vision_claims(self.requests, r)
        r = self.good_response(); r[0]["must_show_evidence"]["gitar"]["frame_sha256"] = []
        with self.assertRaises(VisionContractError):
            check_vision_claims(self.requests, r)

    def test_missing_or_tampered_sample_is_rejected(self):
        frame = self.root / "samples" / self.requests["packets"][0]["frames"][0]["path"]
        original = frame.read_bytes()
        frame.write_bytes(original + b"tampering")
        with self.assertRaisesRegex(VisionContractError, "changed since"):
            review_packets(self.plan, SCRIPT, self.config, self.manifest, self.root / "samples")
        frame.write_bytes(original)
        frame.unlink()
        with self.assertRaises(VisionContractError):
            review_packets(self.plan, SCRIPT, self.config, self.manifest, self.root / "samples")

    def test_manifest_tampering_and_path_traversal_fail_closed(self):
        modified = copy.deepcopy(self.manifest)
        modified["candidates"][0]["frames"][0]["path"] = "../../etc/passwd"
        with self.assertRaises(VisionContractError):
            review_packets(self.plan, SCRIPT, self.config, modified, self.root / "samples")
        modified = copy.deepcopy(self.manifest)
        modified["missing_candidate_scenes"] = []
        with self.assertRaises(VisionContractError):
            review_packets(self.plan, SCRIPT, self.config, modified, self.root / "samples")
        modified = copy.deepcopy(self.manifest)
        modified["render_ready"] = True
        with self.assertRaises(VisionContractError):
            review_packets(self.plan, SCRIPT, self.config, modified, self.root / "samples")

    def test_mismatched_script_or_render_ready_plan_refused(self):
        with self.assertRaises((VisionContractError, ValueError)):
            review_packets(self.plan, "different text", self.config, self.manifest, self.root / "samples")
        plan = copy.deepcopy(self.plan)
        plan["render_ready"] = True
        with self.assertRaises((VisionContractError, ValueError)):
            review_packets(plan, SCRIPT, self.config, self.manifest, self.root / "samples")


if __name__ == "__main__":
    unittest.main()
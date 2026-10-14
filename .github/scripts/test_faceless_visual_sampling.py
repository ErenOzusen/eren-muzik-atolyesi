#!/usr/bin/env python3
"""Offline-only tests. No provider, API, or YouTube operations."""
from __future__ import annotations

import copy
import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from faceless_visual_sampling import SamplingError, collect, validate_candidates
from test_faceless_scene_plan_contract import SCRIPT, load_config, valid_plan


class VisualSamplingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.clip = self.root / "sample.mp4"
        self.clip.write_bytes(b"synthetic placeholder" * 100)
        self.plan = valid_plan(render_ready=False)
        self.candidate = {"scene_id": 1, "asset_id": "7574545", "path": str(self.clip),
                          "source_page": "https://www.pexels.com/video/guitar-practice-7574545/"}
        self.out = self.root / "evidence"

    @staticmethod
    def fake_probe(path):
        return {"duration_seconds": 6.0, "width": 1080, "height": 1920}

    @staticmethod
    def fake_frame(video, seconds, path):
        path.write_bytes(b"valid png-looking fake frame" * 8)

    def sample(self, candidates=None):
        return collect(self.plan, SCRIPT, load_config(),
                       [self.candidate] if candidates is None else candidates, self.out)

    @patch("faceless_visual_sampling.extract_frame")
    @patch("faceless_visual_sampling.probe_video")
    def test_deterministic_manifest_with_real_byte_hashes_and_no_approval(self, probe, frame):
        probe.side_effect, frame.side_effect = self.fake_probe, self.fake_frame
        result = self.sample()
        self.assertFalse(result["render_ready"])
        self.assertFalse(result["publication_allowed"])
        self.assertFalse(result["editorial_approved"])
        self.assertFalse(result["candidates"][0]["semantic_qc_approved"])
        self.assertTrue(result["missing_candidate_scenes"])
        self.assertEqual(result["network_calls"], 0)
        self.assertEqual(result["paid_calls"], 0)
        self.assertEqual(result["candidates"][0]["video_sha256"], hashlib.sha256(self.clip.read_bytes()).hexdigest())
        for item in result["candidates"][0]["frames"]:
            f = self.out / item["path"]
            self.assertEqual(hashlib.sha256(f.read_bytes()).hexdigest(), item["sha256"])
        self.assertEqual(result, json.loads((self.out / "candidate_frames_manifest.json").read_text()))
        with self.assertRaises(SamplingError):
            self.sample()

    def test_bad_source_duplicate_and_invalid_input_fail_closed(self):
        invalids = [
            [{**self.candidate, "source_page": "https://evil.test/video/7574545"}],
            [{**self.candidate, "source_page": "https://www.pexels.com/video/guitar-6/"}],
            [{**self.candidate, "path": "https://example.test/file.mp4"}],
            [{**self.candidate, "scene_id": True}],
            [{**self.candidate, "scene_id": 100}],
            [{**self.candidate, "asset_id": "001"}],
            [self.candidate, dict(self.candidate, scene_id=2)],
            [],
        ]
        for candidates in invalids:
            with self.subTest(candidates=candidates), self.assertRaises(SamplingError):
                self.sample(candidates)
        self.assertFalse(self.out.exists())

    def test_symlink_and_missing_video_fail_closed(self):
        link = self.root / "link.mp4"
        link.symlink_to(self.clip)
        for p in (link, self.root / "not-found.mp4"):
            with self.subTest(path=p), self.assertRaises(SamplingError):
                self.sample([{**self.candidate, "path": str(p)}])
        self.assertFalse(self.out.exists())

    def test_render_ready_plan_cannot_enter_sampling_stage(self):
        self.plan["render_ready"] = True
        with self.assertRaises(SamplingError):
            self.sample()

    @patch("faceless_visual_sampling.extract_frame")
    @patch("faceless_visual_sampling.probe_video")
    def test_failure_removes_unfinished_output(self, probe, frame):
        probe.side_effect = self.fake_probe
        frame.side_effect = [None, SamplingError("missing frame")]
        def make_frame(*args):
            raise SamplingError("interrupted")
        frame.side_effect = make_frame
        with self.assertRaises(SamplingError):
            self.sample()
        self.assertFalse(self.out.exists())
        self.assertFalse(list(self.root.glob(".visual-sampling-*")))

    @patch("faceless_visual_sampling.extract_frame")
    @patch("faceless_visual_sampling.probe_video")
    def test_manifest_is_stable_despite_candidate_input_order(self, probe, frame):
        probe.side_effect, frame.side_effect = self.fake_probe, self.fake_frame
        second = {**self.candidate, "scene_id": 2, "asset_id": "6670728",
                  "source_page": "https://www.pexels.com/video/6670728/"}
        a = self.sample([second, self.candidate]); self.assertEqual([x["scene_id"] for x in a["candidates"]], [1,2])

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg binaries unavailable")
    def test_real_ffmpeg_produces_three_frame_samples(self):
        subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                        "-f", "lavfi", "-i", "color=c=blue:s=1080x1920:r=2:d=5.2",
                        "-c:v", "libx264", "-preset", "ultrafast", "-threads", "1", str(self.clip)],
                       check=True, capture_output=True, timeout=40)
        result = self.sample()
        self.assertEqual(len(result["candidates"][0]["frames"]), 3)
        for sample in result["candidates"][0]["frames"]:
            data = (self.out / sample["path"]).read_bytes()
            self.assertTrue(data.startswith(b"\x89PNG"))
        self.assertFalse(result["frame_evidence_is_semantic_review"])

if __name__ == "__main__":
    unittest.main()
#!/usr/bin/env python3
import copy
import hashlib
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from faceless_reviewed_render_plan import prepare_render, probe_media
from faceless_scene_plan_contract import ScenePlanError
from test_faceless_audio_timeline_contract import valid_alignment
from test_faceless_scene_plan_contract import SCRIPT, approve_plan, load_config, valid_plan


class ReviewedRenderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.audio = self.root / "narration.mp3"
        self.clip = self.root / "clip.mp4"
        self.audio.write_bytes(b"synthetic audio")
        self.clip.write_bytes(b"synthetic clip")
        self.plan = valid_plan(render_ready=True)
        self.bindings = []
        for scene in self.plan["scenes"]:
            digest = hashlib.sha256(self.clip.read_bytes()).hexdigest()
            scene["semantic_qc"][0]["asset_sha256"] = digest
            self.bindings.append({"scene_id": scene["scene_id"], "asset_id": scene["approved_asset_ids"][0],
                                  "path": str(self.clip), "sha256": digest})
        approve_plan(self.plan)
        self.alignment = valid_alignment(self.plan)
        self.alignment["audio_sha256"] = hashlib.sha256(self.audio.read_bytes()).hexdigest()

    def measured(self, path):
        if path == self.audio:
            return {"format": {"duration": "15.2"}, "streams": [{"codec_type": "audio"}]}
        return {"format": {"duration": "30"}, "streams": [{"codec_type": "video", "width": 640, "height": 480}]}

    def prepare(self):
        return prepare_render(self.plan, SCRIPT, load_config(), self.alignment,
                              str(self.audio), self.bindings)

    @patch("faceless_reviewed_render_plan.probe_media")
    def test_preserves_explicit_selections_and_captions_without_execution(self, probe):
        probe.side_effect = self.measured
        result = self.prepare()
        self.assertEqual([s["asset_id"] for s in result["selected_clips"]], ["101", "102", "103", "104"])
        self.assertIn("00:00:03,400 --> 00:00:06,100", result["subtitle_text"])
        self.assertIn("akordu", result["subtitle_text"])
        self.assertFalse(result["publication_allowed"])
        self.assertFalse(result["live_worker_wired"])
        self.assertIn("-n", result["ffmpeg_arguments"])

    @patch("faceless_reviewed_render_plan.probe_media")
    def test_unreviewed_clip_bytes_or_ids_are_rejected(self, probe):
        probe.side_effect = self.measured
        for field, value in [("asset_id", "999"), ("sha256", "a" * 64),
                             ("trim_start_seconds", float("nan")), ("trim_start_seconds", 29.0),
                             ("path", "https://example.com/clip.mp4")]:
            with self.subTest(field=field):
                original = copy.deepcopy(self.bindings)
                self.bindings[0][field] = value
                with self.assertRaises(ScenePlanError):
                    self.prepare()
                self.bindings = original
        self.plan["scenes"][0]["semantic_qc"][0]["asset_sha256"] = "b" * 64
        approve_plan(self.plan)
        with self.assertRaises(ScenePlanError):
            self.prepare()

    @patch("faceless_reviewed_render_plan.probe_media")
    def test_measured_audio_mismatch_is_rejected(self, probe):
        probe.return_value = {"format": {"duration": "16.0"}, "streams": [{"codec_type": "audio"}]}
        with self.assertRaises(ScenePlanError):
            self.prepare()

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg binaries unavailable")
    def test_real_local_ffmpeg_pipeline_with_synthetic_test_media(self):
        def run(arguments):
            subprocess.run(arguments, check=True, capture_output=True, timeout=60, cwd=self.root)
        run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=2",
             "-c:v", "libx264", "-threads", "1", str(self.clip)])
        run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
             "-t", "4", "-c:a", "pcm_s16le", "narration.wav"])
        self.audio = self.root / "narration.wav"
        for i, scene in enumerate(self.plan["scenes"]):
            scene["timing"] = {"start_seconds": float(i), "end_seconds": float(i + 1)}
            digest = hashlib.sha256(self.clip.read_bytes()).hexdigest()
            scene["semantic_qc"][0]["asset_sha256"] = digest
            self.bindings[i]["sha256"] = digest
        approve_plan(self.plan)
        self.alignment = valid_alignment(self.plan)
        self.alignment["duration_seconds"] = 4.0
        self.alignment["audio_sha256"] = hashlib.sha256(self.audio.read_bytes()).hexdigest()
        result = self.prepare()
        (self.root / result["subtitle_filename"]).write_text(result["subtitle_text"], encoding="utf-8")
        run(result["ffmpeg_arguments"])
        measured = probe_media(self.root / result["output_filename"])
        video = next(s for s in measured["streams"] if s["codec_type"] == "video")
        self.assertEqual((video["width"], video["height"]), (1080, 1920))
        self.assertAlmostEqual(float(measured["format"]["duration"]), 4.0, delta=0.1)
        self.assertTrue(any(s["codec_type"] == "audio" for s in measured["streams"]))


if __name__ == "__main__":
    unittest.main()

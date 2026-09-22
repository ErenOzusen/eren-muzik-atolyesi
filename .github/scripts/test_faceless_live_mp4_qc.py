#!/usr/bin/env python3
from __future__ import annotations

import copy
import unittest

from faceless_live_mp4_qc import QCError, evaluate


SHA = "b" * 64


def fixture():
    result = {
        "status": "mp4_ready_for_qc",
        "cost_usd": 0,
        "youtube_publication_attempted": False,
        "paid_generation_allowed": False,
        "network_scope": ["pexels_stock_media", "edge_tts"],
        "video_sha256": SHA,
        "approved_asset_ids": ["123", "456", "789", "234", "567", "890"],
        "media_approval_sha256": SHA,
    }
    probe = {
        "streams": [
            {"codec_type": "video", "width": 1080, "height": 1920},
            {"codec_type": "audio"},
        ],
        "format": {"duration": "15.2"},
    }
    sources = {
        "material_sources": [
            {
                "provider": "pexels",
                "asset_id": "123",
                "source_page": "https://www.pexels.com/video/123/",
                "local_file": "123.mp4",
            },
            {"provider": "pexels", "asset_id": "456",
             "source_page": "https://www.pexels.com/video/456/", "local_file": "456.mp4"},
            {"provider": "pexels", "asset_id": "789",
             "source_page": "https://www.pexels.com/video/789/", "local_file": "789.mp4"},
            {"provider": "pexels", "asset_id": "234",
             "source_page": "https://www.pexels.com/video/234/", "local_file": "234.mp4"},
            {"provider": "pexels", "asset_id": "567",
             "source_page": "https://www.pexels.com/video/567/", "local_file": "567.mp4"},
            {"provider": "pexels", "asset_id": "890",
             "source_page": "https://www.pexels.com/video/890/", "local_file": "890.mp4"},
        ]
    }
    return result, probe, "1\n00:00:00,000 --> 00:00:02,000\nMerhaba\n", sources


class LiveMp4QCTests(unittest.TestCase):
    def test_valid_output_passes(self):
        result, probe, subtitle, sources = fixture()
        qc = evaluate(result, probe, subtitle, sources, SHA)
        self.assertEqual(qc["status"], "technical_qc_passed")
        self.assertTrue(qc["editorial_review_required"])
        self.assertFalse(qc["youtube_publication_attempted"])

    def test_missing_audio_fails(self):
        result, probe, subtitle, sources = fixture()
        probe["streams"] = [probe["streams"][0]]
        with self.assertRaises(QCError):
            evaluate(result, probe, subtitle, sources, SHA)

    def test_missing_subtitle_fails(self):
        result, probe, _, sources = fixture()
        with self.assertRaises(QCError):
            evaluate(result, probe, "", sources, SHA)

    def test_non_pexels_source_fails(self):
        result, probe, subtitle, sources = fixture()
        sources["material_sources"][0]["provider"] = "paid-ai"
        with self.assertRaises(QCError):
            evaluate(result, probe, subtitle, sources, SHA)

    def test_publication_or_cost_fails(self):
        for key, value in (("youtube_publication_attempted", True), ("cost_usd", 0.01)):
            with self.subTest(key=key):
                result, probe, subtitle, sources = fixture()
                result[key] = value
                with self.assertRaises(QCError):
                    evaluate(result, probe, subtitle, sources, SHA)

    def test_hash_mismatch_fails(self):
        result, probe, subtitle, sources = fixture()
        with self.assertRaises(QCError):
            evaluate(result, probe, subtitle, sources, "c" * 64)

    def test_unapproved_source_fails(self):
        result, probe, subtitle, sources = fixture()
        sources["material_sources"][1]["asset_id"] = "999"
        with self.assertRaises(QCError):
            evaluate(result, probe, subtitle, sources, SHA)


if __name__ == "__main__":
    unittest.main()

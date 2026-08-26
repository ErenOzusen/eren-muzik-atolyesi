#!/usr/bin/env python3
"""Zero-network tests for moneyprinter_payload_adapter.py."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("moneyprinter_payload_adapter.py")
spec = importlib.util.spec_from_file_location("moneyprinter_payload_adapter", SCRIPT)
if spec is None or spec.loader is None:
    raise RuntimeError("adapter yüklenemedi")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class MoneyPrinterAdapterTests(unittest.TestCase):
    def test_preserves_approved_script_and_safe_defaults(self) -> None:
        source = "## SENARYO 2: Test\nMerhaba dünya."
        payload = adapter.build_payload(source, "9:16", [])
        self.assertEqual(payload["video_script"], source)
        self.assertEqual(payload["video_aspect"], "9:16")
        self.assertEqual(payload["video_source"], "local")
        self.assertIsNone(payload["video_materials"])
        self.assertEqual(payload["voice_name"], "no-voice")
        self.assertEqual(payload["bgm_type"], "")
        self.assertEqual(payload["bgm_volume"], 0)
        self.assertFalse(payload["subtitle_enabled"])

    def test_local_media_maps_to_material_info_shape(self) -> None:
        payload = adapter.build_payload("Metin", "9:16", ["media/a.mp4", "media/b.jpg"])
        self.assertEqual(
            payload["video_materials"],
            [
                {"provider": "local", "url": "media/a.mp4", "duration": 0},
                {"provider": "local", "url": "media/b.jpg", "duration": 0},
            ],
        )

    def test_clean_script_removes_html_comments(self) -> None:
        self.assertEqual(adapter.clean_script("<!-- x -->\nMetin"), "Metin")


if __name__ == "__main__":
    unittest.main(verbosity=2)

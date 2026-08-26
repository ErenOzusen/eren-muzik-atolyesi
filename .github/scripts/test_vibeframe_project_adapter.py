#!/usr/bin/env python3
"""Zero-network tests for vibeframe_project_adapter.py."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("vibeframe_project_adapter.py")
spec = importlib.util.spec_from_file_location("vibeframe_project_adapter", SCRIPT)
if spec is None or spec.loader is None:
    raise RuntimeError("adapter yüklenemedi")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class AdapterTests(unittest.TestCase):
    def test_creates_minimal_project_without_mutating_script(self) -> None:
        source = "## SENARYO 2: Test\nMerhaba dünya.\nCTA burada."
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "vf"
            adapter.make_project(source, out, "Test", 10, "9:16")
            self.assertTrue((out / "STORYBOARD.md").exists())
            self.assertTrue((out / "DESIGN.md").exists())
            self.assertTrue((out / "scenes" / "01-approved-script.md").exists())
            self.assertTrue((out / "vibe.config.json").exists())
            self.assertEqual((out / "APPROVED_SCRIPT.md").read_text(encoding="utf-8"), source + "\n")
            scene = (out / "scenes" / "01-approved-script.md").read_text(encoding="utf-8")
            self.assertIn("type: Scene", scene)
            self.assertIn("> ## SENARYO 2: Test", scene)
            self.assertNotIn("\n## SENARYO 2: Test", scene)
            self.assertNotIn("narration:", scene)
            self.assertNotIn("video:", scene)
            self.assertNotIn("backdrop:", scene)
            config = json.loads((out / "vibe.config.json").read_text(encoding="utf-8"))
            self.assertEqual(config["schemaVersion"], "1")
            self.assertEqual(config["aspect"], "9:16")
            self.assertEqual(config["build"]["imageSize"], "1024x1536")

    def test_clean_script_removes_comments_only(self) -> None:
        raw = "<!-- test -->\nMetin\n\n\nDevam"
        self.assertEqual(adapter.clean_script(raw), "Metin\n\nDevam")

    def test_blockquote_keeps_markdown_headings_opaque(self) -> None:
        self.assertEqual(adapter.as_blockquote("## Başlık\nMetin"), "> ## Başlık\n> Metin")


if __name__ == "__main__":
    unittest.main(verbosity=2)

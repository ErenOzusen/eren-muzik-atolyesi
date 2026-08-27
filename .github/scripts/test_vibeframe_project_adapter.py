#!/usr/bin/env python3
"""Zero-network tests for vibeframe_project_adapter.py."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("vibeframe_project_adapter.py")
CURRENT_PROFILE = SCRIPT.parents[1] / "config" / "business-profile.json"
SECOND_PROFILE = SCRIPT.parent / "fixtures" / "second-business-profile.json"
spec = importlib.util.spec_from_file_location("vibeframe_project_adapter", SCRIPT)
if spec is None or spec.loader is None:
    raise RuntimeError("adapter yüklenemedi")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class AdapterTests(unittest.TestCase):
    def test_profiles_create_portable_project_without_mutating_script(self) -> None:
        source = "## SENARYO 2: Test\nMerhaba dünya.\n\nCTA burada.\n"
        cases = (
            (CURRENT_PROFILE, "Eren Müzik Atölyesi", "Eren Özüşen"),
            (SECOND_PROFILE, "Mavi Dis Klinigi", "Klinik Yoneticisi"),
        )
        for profile_path, brand, owner in cases:
            with self.subTest(profile=profile_path.name), tempfile.TemporaryDirectory() as tmp:
                profile = adapter.load_profile(profile_path)
                adapter.validate_aspect("9:16", profile)
                out = Path(tmp) / "vf"
                title = adapter.default_project_title(profile)
                adapter.make_project(source, out, title, 10, "9:16", profile)
                self.assertTrue((out / "STORYBOARD.md").exists())
                self.assertTrue((out / "DESIGN.md").exists())
                self.assertTrue((out / "scenes" / "01-approved-script.md").exists())
                self.assertTrue((out / "vibe.config.json").exists())
                self.assertEqual(
                    (out / "APPROVED_SCRIPT.md").read_bytes(), source.encode("utf-8")
                )
                storyboard = (out / "STORYBOARD.md").read_text(encoding="utf-8")
                self.assertIn(brand, storyboard)
                self.assertIn(owner, storyboard)
                self.assertIn(profile["business"]["category"], storyboard)
                if profile_path == SECOND_PROFILE:
                    self.assertNotIn("Eren Müzik Atölyesi", storyboard)
                    self.assertNotIn("Eren tarafından onaylanmış", storyboard)
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
                self.assertEqual(
                    config["providers"],
                    {"image": None, "video": None, "narration": None, "music": None, "composer": None},
                )

    def test_rejects_aspect_not_allowed_by_profile_or_adapter(self) -> None:
        profile = adapter.load_profile(CURRENT_PROFILE)
        with self.assertRaisesRegex(SystemExit, "profilinde izinli değil"):
            adapter.validate_aspect("1:1", profile)
        with self.assertRaisesRegex(SystemExit, "desteklemiyor"):
            adapter.validate_aspect("4:5", profile)

    def test_clean_script_removes_comments_only(self) -> None:
        raw = "<!-- test -->\nMetin\n\n\nDevam"
        self.assertEqual(adapter.clean_script(raw), "Metin\n\nDevam")

    def test_blockquote_keeps_markdown_headings_opaque(self) -> None:
        self.assertEqual(adapter.as_blockquote("## Başlık\nMetin"), "> ## Başlık\n> Metin")


if __name__ == "__main__":
    unittest.main(verbosity=2)

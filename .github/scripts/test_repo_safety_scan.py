#!/usr/bin/env python3
"""Zero-network tests for the CI-gate hardcoded-credential scanner."""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("repo_safety_scan.py")
spec = importlib.util.spec_from_file_location("repo_safety_scan", SCRIPT_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("repo_safety_scan.py yüklenemedi")
repo_safety_scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repo_safety_scan)


class RepoSafetyScanTests(unittest.TestCase):
    def test_real_repo_currently_has_zero_violations(self) -> None:
        # Runs the real scanner against the real repository -- must not
        # raise, and must report at least one file scanned (proving it
        # actually walked the tree rather than trivially passing on 0
        # files).
        import io
        import contextlib

        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            repo_safety_scan.main()  # raises SystemExit(1) on failure

        output = buffer.getvalue()
        self.assertIn("repo_safety_scan_ok", output)
        self.assertIn("violations_found=0", output)
        self.assertNotIn("files_scanned=0", output)

    def test_detects_a_real_hardcoded_default_outside_a_comment(self) -> None:
        # Built by concatenation rather than written as a literal here, on
        # purpose: this whole file is itself scanned by the real,
        # full-repo run of test_real_repo_currently_has_zero_violations
        # below, and a literal forbidden string in this fixture (even
        # though it's just test data) would trip the scanner's own
        # outside-a-comment check on itself.
        forbidden_literal = "eren" + "123"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "server").mkdir()
            # A generic var name is used here on purpose -- not
            # ADMIN_PASSWORD/ADMIN_TOKEN_SECRET, which would additionally
            # (and separately) trip check_admin_secret_defaults when this
            # very file is scanned by test_real_repo_currently_has_zero_violations
            # below; this fixture is only exercising the forbidden-literal
            # check, not that one.
            (root / "server" / "bad.js").write_text(
                f'const SOME_PASSWORD = "{forbidden_literal}";\n', encoding="utf-8"
            )
            original_root = repo_safety_scan.ROOT
            try:
                repo_safety_scan.ROOT = root
                with self.assertRaises(SystemExit) as ctx:
                    repo_safety_scan.main()
                self.assertEqual(ctx.exception.code, 1)
            finally:
                repo_safety_scan.ROOT = original_root

    def test_does_not_flag_a_forbidden_literal_mentioned_only_in_a_comment(self) -> None:
        forbidden_literal = "eren-admin" + "-token"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "server").mkdir()
            (root / "server" / "auth-like.js").write_text(
                f'// never use "{forbidden_literal}" as a real default\n'
                "function ok() { return true; }\n",
                encoding="utf-8",
            )
            original_root = repo_safety_scan.ROOT
            try:
                repo_safety_scan.ROOT = root
                repo_safety_scan.main()  # must not raise
            finally:
                repo_safety_scan.ROOT = original_root

    def test_does_not_scan_markdown_docs(self) -> None:
        forbidden_literal = "eren" + "123"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "SOME_DOC.md").write_text(
                f"Never hardcode a password like {forbidden_literal}.\n", encoding="utf-8"
            )
            original_root = repo_safety_scan.ROOT
            try:
                repo_safety_scan.ROOT = root
                repo_safety_scan.main()  # must not raise -- .md is out of scope
            finally:
                repo_safety_scan.ROOT = original_root

    def _run_against_fixture(self, files: dict[str, str]):
        """Writes each {relative_path: content} into a temp root, runs the
        real scanner against it, and returns (raised_system_exit_or_None,
        stdout). Restores repo_safety_scan.ROOT afterward regardless."""
        import io
        import contextlib

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel_path, content in files.items():
                full_path = root / rel_path
                full_path.parent.mkdir(parents=True, exist_ok=True)
                full_path.write_text(content, encoding="utf-8")

            original_root = repo_safety_scan.ROOT
            buffer = io.StringIO()
            try:
                repo_safety_scan.ROOT = root
                with contextlib.redirect_stdout(buffer):
                    try:
                        repo_safety_scan.main()
                        return None, buffer.getvalue()
                    except SystemExit as exc:
                        return exc, buffer.getvalue()
            finally:
                repo_safety_scan.ROOT = original_root

    # --- ADMIN_PASSWORD / ADMIN_TOKEN_SECRET literal-default check -------

    def test_detects_a_literal_admin_password_default(self) -> None:
        # Built by concatenation for the same self-referential reason as
        # the eren123 fixture above -- this file is itself scanned by
        # test_real_repo_currently_has_zero_violations.
        admin_password_var = "ADMIN" + "_PASSWORD"
        exc, _ = self._run_against_fixture(
            {"server/config.js": f'const {admin_password_var} = "hunter2";\n'}
        )
        self.assertIsNotNone(exc)
        self.assertEqual(exc.code, 1)

    def test_does_not_flag_admin_password_read_from_a_real_env_var(self) -> None:
        exc, _ = self._run_against_fixture(
            {
                "server/auth.js": "const password = process.env.ADMIN_PASSWORD;\n",
                "server/test/fixture.test.js": 'process.env.ADMIN_PASSWORD = "test-only-value";\n',
            }
        )
        self.assertIsNone(exc)

    # --- hardcoded production URL check -----------------------------------

    def test_detects_a_hardcoded_production_url_outside_the_allowlist(self) -> None:
        # Built by concatenation for the same self-referential reason as
        # the eren123 fixture above.
        prod_url = "eren-muzik-atolyesi" + "-backend.onrender.com"
        exc, _ = self._run_against_fixture(
            {"src/components/SomeComponent.jsx": f'fetch("https://{prod_url}/api/x");\n'}
        )
        self.assertIsNotNone(exc)
        self.assertEqual(exc.code, 1)

    def test_allows_the_production_url_in_its_canonical_source_file(self) -> None:
        prod_url = "eren-muzik-atolyesi" + "-backend.onrender.com"
        exc, _ = self._run_against_fixture(
            {"src/services/api.js": f'export const API_BASE_URL = "https://{prod_url}";\n'}
        )
        self.assertIsNone(exc)

    # --- generation_dispatch_enabled=true check ---------------------------

    def test_detects_generation_dispatch_enabled_true(self) -> None:
        exc, _ = self._run_against_fixture(
            {".github/config/video-orchestrator.json": '{"generation_dispatch_enabled": true}'}
        )
        self.assertIsNotNone(exc)
        self.assertEqual(exc.code, 1)

    def test_allows_generation_dispatch_enabled_false(self) -> None:
        exc, _ = self._run_against_fixture(
            {".github/config/video-orchestrator.json": '{"generation_dispatch_enabled": false}'}
        )
        self.assertIsNone(exc)

    # --- unsafe automatic publication command check -----------------------

    def test_detects_an_unsafe_publication_call_in_real_source(self) -> None:
        exc, _ = self._run_against_fixture(
            {".github/scripts/publish_video.py": 'requests.post("https://youtube.googleapis.com/upload/youtube/v3/videos")\n'}
        )
        self.assertIsNotNone(exc)
        self.assertEqual(exc.code, 1)

    def test_allows_the_publication_pattern_inside_a_test_file_asserting_its_absence(self) -> None:
        exc, _ = self._run_against_fixture(
            {".github/scripts/test_something_hardening.mjs": 'assert.ok(!workflow.includes("youtube.googleapis.com"));\n'}
        )
        self.assertIsNone(exc)

    def test_strip_line_comments_handles_python_and_js_prefixes(self) -> None:
        forbidden_literal = "eren" + "123"
        self.assertEqual(
            repo_safety_scan.strip_line_comments(f'token = "x"  # comment with {forbidden_literal}', ".py"),
            'token = "x"  ',
        )
        self.assertEqual(
            repo_safety_scan.strip_line_comments(f'const x = 1; // comment with {forbidden_literal}', ".js"),
            "const x = 1; ",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)

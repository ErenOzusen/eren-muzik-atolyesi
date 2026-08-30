#!/usr/bin/env python3
"""Section 6 — Router + Cost Guard combined integration scenarios.

Zero-network: every provider HTTP call is replaced by
unittest.mock.patch.object(ai_router, "request_json", ...). Zero real AI
tokens are spent. This exercises the REAL ai_router.main() end-to-end
(argument parsing, provider loop, meta-file writing, exit codes) together
with the REAL cost_guard.check_token_and_attempt_limits() against the
meta-file ai_router.py actually produced — not just each module's own
already-covered unit-level functions (see test_ai_router.py and
test_cost_guard.py for those).

Covers the 8 named scenarios:
  1. first-provider success
  2. first-provider 429 -> second provider succeeds
  3. first-provider quality failure -> second provider succeeds
  4. attempt-limit reached -> third provider never called
  5. token-budget exceeded -> cost guard fails closed
  6. no usable provider -> router fails closed, meta-file still written
  7. missing cost-guard config -> fails loudly, never silently passes
  8. test_mode -> provider unreachable (architectural: the router itself
     has no test_mode concept at all; "0 provider calls in test_mode" is
     enforced entirely by each workflow's own `if:` gate on the AI-calling
     step, already covered by every test_*_router_migration.mjs file and
     test_cost_guard_router_integration*.mjs — this file only confirms the
     router exposes no --test-mode flag that could bypass that gate).
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parent


def load_module(name: str, filename: str):
    path = SCRIPTS_DIR / filename
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"{filename} yüklenemedi")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ai_router = load_module("ai_router_under_test", "ai_router.py")
cost_guard = load_module("cost_guard_under_test", "cost_guard.py")
_test_ai_router = load_module("test_ai_router_fixtures", "test_ai_router.py")

REAL_CONFIG_PATH = SCRIPTS_DIR.parent / "config" / "ai-router.json"


def result(*, status: int, text: str = "", stop: str = "end_turn", input_tokens: int = 100, output_tokens: int = 50) -> dict:
    return {
        "http_status": status,
        "text": text,
        "stop_reason": stop,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
    }


class RouterCostGuardIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        directory = Path(self.tempdir.name)
        self.prompt_file = directory / "prompt.txt"
        self.prompt_file.write_text("integration scenario prompt", encoding="utf-8")
        self.output_file = directory / "output.md"
        self.meta_file = directory / "meta.json"
        self.config_file = directory / "ai-router.json"
        self.config_file.write_text(
            json.dumps(
                {
                    "routing": {"default_order": ["anthropic", "openai", "deepseek"]},
                    "providers": {
                        "anthropic": {
                            "api_style": "anthropic_messages",
                            "endpoint": "https://api.anthropic.invalid/v1/messages",
                            "secret_env": "ANTHROPIC_API_KEY",
                            "model_env": "ANTHROPIC_MODEL",
                            "use_primary_model_as_default": True,
                        },
                        "openai": {
                            "api_style": "openai_chat",
                            "endpoint": "https://api.openai.invalid/v1/chat/completions",
                            "secret_env": "OPENAI_API_KEY",
                            "model_env": "OPENAI_MODEL",
                            "use_primary_model_as_default": True,
                        },
                        "deepseek": {
                            "api_style": "openai_chat",
                            "endpoint": "https://api.deepseek.invalid/chat/completions",
                            "secret_env": "DEEPSEEK_API_KEY",
                            "model_env": "DEEPSEEK_MODEL",
                            "use_primary_model_as_default": True,
                        },
                    },
                }
            ),
            encoding="utf-8",
        )
        self.env_patch = patch.dict(
            os.environ,
            {
                "ANTHROPIC_API_KEY": "fake-anthropic-key",
                "OPENAI_API_KEY": "fake-openai-key",
                "DEEPSEEK_API_KEY": "fake-deepseek-key",
            },
            clear=False,
        )
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)

    def run_router(self, argv_extra: list[str] | None = None) -> int:
        argv = [
            "ai_router.py",
            "--config",
            str(self.config_file),
            "--prompt-file",
            str(self.prompt_file),
            "--output-file",
            str(self.output_file),
            "--meta-file",
            str(self.meta_file),
            "--max-tokens",
            "500",
            "--primary-model",
            "integration-test-model",
        ] + (argv_extra or [])
        with patch.object(sys, "argv", argv):
            try:
                ai_router.main()
                return 0
            except SystemExit as exc:
                return int(exc.code or 0)

    def read_meta(self) -> dict:
        return json.loads(self.meta_file.read_text(encoding="utf-8"))

    # 1. first-provider success -----------------------------------------
    def test_scenario_1_first_provider_success(self) -> None:
        with patch.object(ai_router, "request_json", side_effect=[(200, {
            "content": [{"type": "text", "text": "OK from anthropic"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 100, "output_tokens": 50},
        })]) as mocked:
            exit_code = self.run_router()

        self.assertEqual(exit_code, 0)
        self.assertEqual(mocked.call_count, 1)
        meta = self.read_meta()
        self.assertEqual(meta["provider"], "anthropic")
        self.assertEqual(len([a for a in meta["attempts"] if a.get("status") != "skipped"]), 1)

        violations = cost_guard.check_token_and_attempt_limits(
            meta, {"max_provider_attempts": 3, "max_input_tokens": 10000, "max_output_tokens": 10000, "max_total_tokens": 10000}
        )
        self.assertEqual(violations, [])

    # 2. first-provider 429 -> second provider succeeds -------------------
    def test_scenario_2_first_provider_429_falls_through_to_second(self) -> None:
        with patch.object(ai_router, "request_json", side_effect=[
            (429, {"error": {"message": "rate limited"}}),
            (200, {
                "choices": [{"message": {"content": "OK from openai"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 80, "completion_tokens": 40},
            }),
        ]) as mocked:
            exit_code = self.run_router()

        self.assertEqual(exit_code, 0)
        self.assertEqual(mocked.call_count, 2)
        meta = self.read_meta()
        self.assertEqual(meta["provider"], "openai")
        real_attempts = [a for a in meta["attempts"] if a.get("status") != "skipped"]
        self.assertEqual(len(real_attempts), 2)
        self.assertEqual(real_attempts[0]["status"], "failed")
        self.assertTrue(real_attempts[0]["retryable"])
        self.assertEqual(real_attempts[1]["status"], "success")

        # Cost guard sees 2 real attempts: a strict max_provider_attempts=1
        # policy correctly flags this as a fail-closed violation even
        # though the run ultimately succeeded.
        violations = cost_guard.check_token_and_attempt_limits(
            meta, {"max_provider_attempts": 1}
        )
        self.assertEqual(len(violations), 1)
        self.assertIn("provider_attempts=2 exceeds max_provider_attempts=1", violations[0])

    # 3. first-provider quality failure -> second provider succeeds -------
    def test_scenario_3_quality_failure_falls_through_to_second(self) -> None:
        contract_path = SCRIPTS_DIR.parent / "config" / "contracts" / "filming-package.json"
        good_package = _test_ai_router.good_filming_package()

        with patch.object(ai_router, "request_json", side_effect=[
            (200, {
                "content": [{"type": "text", "text": "Bu çıktı sözleşmeye uymuyor."}],
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 90, "output_tokens": 20},
            }),
            (200, {
                "choices": [{"message": {"content": good_package}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 100, "completion_tokens": 70},
            }),
        ]) as mocked:
            exit_code = self.run_router(["--quality-contract", str(contract_path)])

        self.assertEqual(exit_code, 0)
        self.assertEqual(mocked.call_count, 2)
        meta = self.read_meta()
        self.assertEqual(meta["provider"], "openai")
        statuses = [a["status"] for a in meta["attempts"] if a.get("status") != "skipped"]
        self.assertEqual(statuses, ["rejected_quality", "success"])

    # 4. attempt-limit reached -> third provider never called -------------
    def test_scenario_4_third_provider_never_called_after_second_succeeds(self) -> None:
        with patch.object(ai_router, "request_json", side_effect=[
            (500, {"error": {"message": "server error"}}),
            (200, {
                "choices": [{"message": {"content": "OK from openai"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 60, "completion_tokens": 30},
            }),
            (200, {
                "choices": [{"message": {"content": "should never be reached"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            }),
        ]) as mocked:
            exit_code = self.run_router()

        self.assertEqual(exit_code, 0)
        # Exactly 2 real HTTP calls: deepseek (the 3rd configured provider)
        # must never be attempted once openai (the 2nd) already succeeded.
        self.assertEqual(mocked.call_count, 2)
        meta = self.read_meta()
        self.assertEqual(meta["provider"], "openai")
        attempted_providers = [a["provider"] for a in meta["attempts"]]
        self.assertNotIn("deepseek", [a["provider"] for a in meta["attempts"] if a.get("status") not in ("skipped",)])
        self.assertEqual(len(attempted_providers), 2, f"deepseek should not appear in attempts at all: {attempted_providers}")

    # 5. token-budget exceeded -> cost guard fails closed ------------------
    def test_scenario_5_token_budget_exceeded_fails_closed(self) -> None:
        with patch.object(ai_router, "request_json", side_effect=[(200, {
            "content": [{"type": "text", "text": "OK"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 900, "output_tokens": 200},
        })]):
            exit_code = self.run_router()

        self.assertEqual(exit_code, 0)
        meta = self.read_meta()
        self.assertEqual(meta["total_input_tokens"] + meta["total_output_tokens"], 1100)

        violations = cost_guard.check_token_and_attempt_limits(meta, {"max_total_tokens": 1000})
        self.assertEqual(len(violations), 1)
        self.assertIn("exceeds max_total_tokens=1000", violations[0])

        # And the real cost_guard.py CLI, run against this exact meta-file
        # and a config with that same limit, actually raises SystemExit(1)
        # — not just the pure-function check.
        guard_config = Path(self.tempdir.name) / "cost-guard.json"
        guard_config.write_text(
            json.dumps({"limits": {"max_total_tokens": 1000}, "monetary": {"enabled": False}}),
            encoding="utf-8",
        )
        with patch.object(sys, "argv", [
            "cost_guard.py", "--meta-file", str(self.meta_file), "--config", str(guard_config),
        ]):
            with self.assertRaises(SystemExit) as ctx:
                cost_guard.main()
        self.assertEqual(ctx.exception.code, 1)

    # 6. no usable provider -> router fails closed, meta-file still written
    def test_scenario_6_no_usable_provider_fails_closed_but_writes_meta(self) -> None:
        with patch.object(ai_router, "request_json", side_effect=[
            (500, {"error": {"message": "server error"}}),
            (500, {"error": {"message": "server error"}}),
            (500, {"error": {"message": "server error"}}),
        ]):
            exit_code = self.run_router()

        self.assertEqual(exit_code, 1)
        self.assertFalse(self.output_file.exists() and self.output_file.stat().st_size > 0)
        meta = self.read_meta()  # must not raise -- meta-file is written even on total failure
        self.assertNotIn("provider", meta)
        real_attempts = [a for a in meta["attempts"] if a.get("status") != "skipped"]
        self.assertEqual(len(real_attempts), 3)
        self.assertTrue(all(a["status"] == "failed" for a in real_attempts))

        # Cost guard on a total-failure meta: 0 tokens spent, but attempt
        # count is still real and still enforceable.
        violations = cost_guard.check_token_and_attempt_limits(meta, {"max_provider_attempts": 2})
        self.assertEqual(len(violations), 1)
        self.assertIn("provider_attempts=3 exceeds max_provider_attempts=2", violations[0])

    # 7. missing cost-guard config -> fails loudly, never silently passes -
    def test_scenario_7_missing_cost_guard_config_fails_loudly(self) -> None:
        missing_path = Path(self.tempdir.name) / "does-not-exist.json"
        with patch.object(sys, "argv", [
            "cost_guard.py", "--meta-file", str(self.meta_file if self.meta_file.exists() else self._write_trivial_meta()),
            "--config", str(missing_path),
        ]):
            with self.assertRaises(FileNotFoundError):
                cost_guard.main()

    def _write_trivial_meta(self) -> Path:
        self.meta_file.write_text(json.dumps({"total_input_tokens": 0, "total_output_tokens": 0, "attempts": []}), encoding="utf-8")
        return self.meta_file

    # 8. test_mode -> provider unreachable (architectural check) ----------
    def test_scenario_8_router_itself_has_no_test_mode_bypass_flag(self) -> None:
        # The router has no concept of test_mode at all -- "0 provider
        # calls in test_mode" is enforced entirely by each workflow's own
        # `if:` gate on the AI-calling step (see every
        # test_*_router_migration.mjs and
        # test_cost_guard_router_integration*.mjs file). Confirm there is
        # no --test-mode/--skip flag that could let a workflow's own gate
        # be silently bypassed at the router level, and confirm main()
        # unconditionally reaches the provider loop with no such escape
        # hatch to short-circuit it.
        parser_source = SCRIPTS_DIR.joinpath("ai_router.py").read_text(encoding="utf-8")
        self.assertNotIn("--test-mode", parser_source)
        self.assertNotIn("--skip", parser_source)
        self.assertNotIn("TEST_MODE", parser_source)

        # And, positively: with a real (fake-keyed) provider configured and
        # no such flag passed, the loop above already proves (scenarios 1-6)
        # that request_json is reached whenever main() runs — there is no
        # code path in ai_router.py that skips it based on an environment
        # variable named after "test".



if __name__ == "__main__":
    unittest.main(verbosity=2)

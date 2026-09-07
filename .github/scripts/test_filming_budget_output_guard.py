#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


router = load_module("ai_router_filming_test", ROOT / ".github/scripts/ai_router.py")
guard = load_module("preflight_budget_guard_filming_test", ROOT / ".github/scripts/preflight_budget_guard.py")
transformer = load_module("filming_budget_guard_transform_test", ROOT / ".github/scripts/filming_budget_guard_transform.py")


class FilmingBudgetOutputGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.routing = json.loads((ROOT / ".github/config/ai-router.json").read_text(encoding="utf-8"))["routing"]
        self.budget = json.loads((ROOT / ".github/config/real-ai-budget.json").read_text(encoding="utf-8"))
        self.profile = json.loads((ROOT / ".github/config/business-profile.json").read_text(encoding="utf-8"))
        self.prices = json.loads((ROOT / ".github/config/cost-guard.json").read_text(encoding="utf-8"))

    def test_filming_router_hard_caps_requested_3000_to_1800(self) -> None:
        self.assertEqual(router.resolve_output_max_tokens(3000, "/tmp/filming-package.md", self.routing), 1800)
        self.assertEqual(router.resolve_output_max_tokens(1500, "/tmp/filming-package.md", self.routing), 1500)

    def test_filming_router_is_anthropic_only(self) -> None:
        self.assertEqual(router.resolve_output_provider_order("/tmp/filming-package.md", self.routing), ["anthropic"])

    def test_filming_stage_has_explicit_budgeted_output_ceiling(self) -> None:
        stage = self.budget["production_stages"]["filming_package"]
        self.assertEqual(stage["max_output_tokens"], 1800)
        result = guard.check_preflight_budget(
            stage="filming_package",
            provider="anthropic",
            model="claude-sonnet-4-6",
            web_search_max_uses=0,
            prompt_text="a" * (stage["assumed_max_input_tokens"] * 3),
            system_text="",
            profile=self.profile,
            budget_config=self.budget,
            price_config=self.prices,
        )
        self.assertTrue(result["ok"], result["violations"])
        self.assertLessEqual(result["report"]["worst_case_cost_usd"], stage["allocated_budget_usd"])

    def test_failed_run_six_spend_is_not_lost(self) -> None:
        self.assertAlmostEqual(self.budget["unreserved_realized_spend_usd"], 0.054003, places=6)

    def test_compact_transformer_is_zero_network_offline(self) -> None:
        old = {name: os.environ.get(name) for name in ("GITHUB_ACTIONS", "TEST_MODE", "SOURCE_ISSUE_NUMBER", "SOURCE_SCENARIO")}
        try:
            os.environ.pop("SOURCE_ISSUE_NUMBER", None)
            prepared = transformer.prepare_request(prompt="p", system_prompt="s")
        finally:
            for name, value in old.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value
        self.assertIn("550–700 kelime", prepared["system_prompt"])
        self.assertEqual(prepared["context"]["budget_preflight"], "offline")

    def test_unreserved_spend_is_applied_by_cli_before_provider(self) -> None:
        budget = dict(self.budget)
        budget["unreserved_realized_spend_usd"] = 0.20
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            budget_path = tmp_path / "budget.json"
            prompt_path = tmp_path / "prompt.txt"
            budget_path.write_text(json.dumps(budget), encoding="utf-8")
            prompt_path.write_text("short prompt", encoding="utf-8")
            env = os.environ.copy()
            env.pop("GITHUB_ACTIONS", None)
            env.pop("REAL_AI_BUDGET_CAP", None)
            result = subprocess.run(
                [
                    sys.executable, str(ROOT / ".github/scripts/preflight_budget_guard.py"),
                    "--stage", "research",
                    "--provider", "anthropic",
                    "--model", "claude-sonnet-4-6",
                    "--web-search-max-uses", "0",
                    "--prompt-file", str(prompt_path),
                    "--profile", str(ROOT / ".github/config/business-profile.json"),
                    "--budget-config", str(budget_path),
                    "--price-config", str(ROOT / ".github/config/cost-guard.json"),
                ],
                cwd=ROOT, env=env, capture_output=True, text=True,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("prior_chain_spend_usd=0.567095", result.stdout)
        self.assertIn("exceeds total_chain_budget_usd", result.stdout)


if __name__ == "__main__":
    unittest.main()

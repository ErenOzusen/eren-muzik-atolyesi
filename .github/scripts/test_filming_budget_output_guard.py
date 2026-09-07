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
        self.content_budget = json.loads((ROOT / ".github/config/real-ai-budget.json").read_text(encoding="utf-8"))
        self.production_budget = json.loads((ROOT / ".github/config/mvp-production-budget.json").read_text(encoding="utf-8"))
        self.profile = json.loads((ROOT / ".github/config/business-profile.json").read_text(encoding="utf-8"))
        self.prices = json.loads((ROOT / ".github/config/cost-guard.json").read_text(encoding="utf-8"))

    def test_filming_router_hard_caps_requested_3000_to_1800(self) -> None:
        self.assertEqual(router.resolve_output_max_tokens(3000, "/tmp/filming-package.md", self.routing), 1800)
        self.assertEqual(router.resolve_output_max_tokens(1500, "/tmp/filming-package.md", self.routing), 1500)

    def test_filming_router_is_anthropic_only(self) -> None:
        self.assertEqual(router.resolve_output_provider_order("/tmp/filming-package.md", self.routing), ["anthropic"])

    def test_content_and_production_budgets_are_isolated(self) -> None:
        self.assertEqual(self.content_budget["total_chain_budget_usd"], 0.5)
        self.assertNotIn("production_stages", self.content_budget)
        self.assertNotIn("unreserved_realized_spend_usd", self.content_budget)
        self.assertEqual(self.production_budget["total_chain_budget_usd"], 0.10)
        self.assertEqual(self.production_budget["ledger_title"], "SYSTEM MVP Production Budget Ledger")
        self.assertNotEqual(self.production_budget["ledger_title"], "SYSTEM Real AI Budget Ledger")

    def test_run_six_is_seed_of_production_budget_only(self) -> None:
        self.assertAlmostEqual(self.production_budget["realized_spend_floor_usd"], 0.054003, places=6)
        remaining = self.production_budget["total_chain_budget_usd"] - self.production_budget["realized_spend_floor_usd"]
        self.assertAlmostEqual(remaining, 0.045997, places=6)
        self.assertAlmostEqual(
            self.production_budget["stages"]["filming_package"]["allocated_budget_usd"],
            remaining,
            places=6,
        )

    def test_filming_worst_case_planning_ceiling_fits_remaining_production_budget(self) -> None:
        stage = self.production_budget["stages"]["filming_package"]
        self.assertEqual(stage["max_output_tokens"], 1800)
        result = guard.check_preflight_budget(
            stage="filming_package",
            provider="anthropic",
            model="claude-sonnet-4-6",
            web_search_max_uses=0,
            prompt_text="a" * (stage["assumed_max_input_tokens"] * 3),
            system_text="",
            profile=self.profile,
            budget_config=self.production_budget,
            price_config=self.prices,
            prior_chain_spend_usd=self.production_budget["realized_spend_floor_usd"],
        )
        self.assertTrue(result["ok"], result["violations"])
        self.assertLessEqual(result["report"]["worst_case_cost_usd"], stage["allocated_budget_usd"])
        self.assertLessEqual(result["report"]["projected_chain_total_usd"], 0.10)

    def test_compact_transformer_is_zero_network_offline_and_uses_production_pool(self) -> None:
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
        self.assertEqual(prepared["context"]["budget_pool"], "mvp-production")

    def test_production_guard_cli_uses_its_seed_without_touching_github_offline(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            prompt_path = Path(tmp) / "prompt.txt"
            prompt_path.write_text("short prompt", encoding="utf-8")
            env = os.environ.copy()
            env.pop("GITHUB_ACTIONS", None)
            env.pop("REAL_AI_BUDGET_CAP", None)
            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / ".github/scripts/mvp_production_budget_guard.py"),
                    "--stage", "filming_package",
                    "--provider", "anthropic",
                    "--model", "claude-sonnet-4-6",
                    "--web-search-max-uses", "0",
                    "--prompt-file", str(prompt_path),
                    "--profile", str(ROOT / ".github/config/business-profile.json"),
                    "--budget-config", str(ROOT / ".github/config/mvp-production-budget.json"),
                    "--price-config", str(ROOT / ".github/config/cost-guard.json"),
                ],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
            )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("prior_chain_spend_usd=0.054003", result.stdout)
        self.assertIn("total_chain_budget_usd=0.1", result.stdout)


if __name__ == "__main__":
    unittest.main()

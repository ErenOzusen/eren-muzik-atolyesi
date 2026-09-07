#!/usr/bin/env python3
"""Zero-network regression tests for realized_spend_floor_usd handling."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GUARD = ROOT / ".github/scripts/preflight_budget_guard.py"
PROFILE = ROOT / ".github/config/business-profile.json"
BUDGET = ROOT / ".github/config/real-ai-budget.json"
PRICE = ROOT / ".github/config/cost-guard.json"


class RealizedSpendFloorTests(unittest.TestCase):
    def run_guard(self, budget: dict, *, explicit_prior: float = 0.0) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            budget_path = tmp_path / "budget.json"
            prompt_path = tmp_path / "prompt.txt"
            budget_path.write_text(json.dumps(budget), encoding="utf-8")
            prompt_path.write_text("short prompt", encoding="utf-8")
            return subprocess.run(
                [
                    sys.executable,
                    str(GUARD),
                    "--stage", "research",
                    "--provider", "anthropic",
                    "--model", "claude-sonnet-4-6",
                    "--web-search-max-uses", "0",
                    "--prompt-file", str(prompt_path),
                    "--profile", str(PROFILE),
                    "--budget-config", str(budget_path),
                    "--price-config", str(PRICE),
                    "--prior-chain-spend-usd", str(explicit_prior),
                ],
                capture_output=True,
                text=True,
                env={"PATH": __import__("os").environ.get("PATH", "")},
            )

    def test_committed_floor_matches_observed_spend(self) -> None:
        budget = json.loads(BUDGET.read_text(encoding="utf-8"))
        self.assertAlmostEqual(budget["realized_spend_floor_usd"], 0.367095, places=6)

    def test_floor_is_applied_before_provider_call(self) -> None:
        budget = json.loads(BUDGET.read_text(encoding="utf-8"))
        budget["realized_spend_floor_usd"] = 0.49
        result = self.run_guard(budget)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("prior_chain_spend_usd=0.49", result.stdout)
        self.assertIn("exceeds total_chain_budget_usd", result.stdout)

    def test_explicit_prior_can_only_raise_not_lower_floor(self) -> None:
        budget = json.loads(BUDGET.read_text(encoding="utf-8"))
        budget["realized_spend_floor_usd"] = 0.20
        result = self.run_guard(budget, explicit_prior=0.30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("prior_chain_spend_usd=0.3", result.stdout)

    def test_negative_floor_fails_closed(self) -> None:
        budget = json.loads(BUDGET.read_text(encoding="utf-8"))
        budget["realized_spend_floor_usd"] = -0.01
        result = self.run_guard(budget)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("realized_spend_floor_usd must be a non-negative number", result.stderr)


if __name__ == "__main__":
    unittest.main()

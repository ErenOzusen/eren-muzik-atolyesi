#!/usr/bin/env python3
"""Zero-network tests for the standalone cost/attempt guard (Section H).

Exercises the pure limit-checking/cost-estimation functions directly and
the CLI end-to-end via subprocess against temp fixture files — no real AI
provider call, no network, no real cost incurred.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

GUARD_PATH = Path(__file__).with_name("cost_guard.py")
spec = importlib.util.spec_from_file_location("cost_guard", GUARD_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cost_guard.py yüklenemedi")
cost_guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cost_guard)

REAL_CONFIG_PATH = GUARD_PATH.parent.parent / "config" / "cost-guard.json"


class TokenAndAttemptLimitTests(unittest.TestCase):
    def test_passes_within_all_limits(self) -> None:
        meta = {
            "total_input_tokens": 100,
            "total_output_tokens": 50,
            "attempts": [{"status": "success"}],
        }
        limits = {"max_provider_attempts": 4, "max_input_tokens": 1000, "max_output_tokens": 500, "max_total_tokens": 1500}
        self.assertEqual(cost_guard.check_token_and_attempt_limits(meta, limits), [])

    def test_flags_too_many_provider_attempts(self) -> None:
        meta = {
            "attempts": [
                {"status": "failed"},
                {"status": "failed"},
                {"status": "skipped"},  # skipped attempts don't count
                {"status": "success"},
            ],
        }
        limits = {"max_provider_attempts": 2}
        violations = cost_guard.check_token_and_attempt_limits(meta, limits)
        self.assertEqual(len(violations), 1)
        self.assertIn("provider_attempts=3", violations[0])

    def test_flags_input_output_and_total_token_limits_independently(self) -> None:
        meta = {"total_input_tokens": 5000, "total_output_tokens": 5000, "attempts": []}
        limits = {"max_input_tokens": 100, "max_output_tokens": 100, "max_total_tokens": 100}
        violations = cost_guard.check_token_and_attempt_limits(meta, limits)
        self.assertEqual(len(violations), 3)

    def test_missing_limit_keys_are_not_enforced(self) -> None:
        meta = {"total_input_tokens": 999999, "attempts": []}
        self.assertEqual(cost_guard.check_token_and_attempt_limits(meta, {}), [])

    def test_zero_attempts_and_zero_tokens_never_violate_anything(self) -> None:
        meta = {"total_input_tokens": 0, "total_output_tokens": 0, "attempts": []}
        limits = {"max_provider_attempts": 1, "max_input_tokens": 1, "max_output_tokens": 1, "max_total_tokens": 1}
        self.assertEqual(cost_guard.check_token_and_attempt_limits(meta, limits), [])


class MonetaryEstimationTests(unittest.TestCase):
    def test_returns_none_when_a_used_model_has_no_price_entry(self) -> None:
        meta = {"attempts": [{"provider": "anthropic", "model": "unknown-model", "input_tokens": 100, "output_tokens": 50, "status": "success"}]}
        self.assertIsNone(cost_guard.estimate_monetary_cost(meta, {}))

    def test_computes_cost_when_price_registry_has_an_entry(self) -> None:
        meta = {
            "attempts": [
                {
                    "provider": "anthropic",
                    "model": "claude-test",
                    "input_tokens": 1000,
                    "output_tokens": 1000,
                    "status": "success",
                }
            ]
        }
        registry = {"anthropic:claude-test": {"input_per_1k_usd": 1.0, "output_per_1k_usd": 2.0}}
        self.assertEqual(cost_guard.estimate_monetary_cost(meta, registry), 3.0)

    def test_skipped_attempts_are_excluded_from_cost_estimation(self) -> None:
        meta = {
            "attempts": [
                {"provider": "anthropic", "model": "claude-test", "input_tokens": 1000, "output_tokens": 0, "status": "skipped"},
            ]
        }
        registry = {"anthropic:claude-test": {"input_per_1k_usd": 100.0, "output_per_1k_usd": 100.0}}
        self.assertEqual(cost_guard.estimate_monetary_cost(meta, registry), 0.0)

    def test_never_hard_codes_a_guessed_price_for_a_model_missing_from_the_registry(self) -> None:
        meta = {
            "attempts": [
                {"provider": "anthropic", "model": "known", "input_tokens": 100, "output_tokens": 100, "status": "success"},
                {"provider": "openai", "model": "unknown", "input_tokens": 100, "output_tokens": 100, "status": "success"},
            ]
        }
        registry = {"anthropic:known": {"input_per_1k_usd": 1.0, "output_per_1k_usd": 1.0}}
        # One of the two used models is unpriced -> the whole estimate is
        # None, never a partial/guessed total.
        self.assertIsNone(cost_guard.estimate_monetary_cost(meta, registry))


class RealConfigTests(unittest.TestCase):
    def test_real_cost_guard_config_defaults_monetary_enforcement_to_disabled(self) -> None:
        config = json.loads(REAL_CONFIG_PATH.read_text(encoding="utf-8"))
        # Monetary ENFORCEMENT staying off by default (for every workflow that
        # invokes cost_guard.py post-hoc) is the actual safety invariant here —
        # a populated price_registry is just data, inert until some caller
        # explicitly opts monetary.enabled on for itself. The real-AI-budget-cap
        # chain (preflight_budget_guard.py) reads this registry directly rather
        # than flipping this flag, so this stays False.
        self.assertEqual(config["monetary"]["enabled"], False)

    def test_real_cost_guard_config_price_registry_entries_are_explicit_and_real(self) -> None:
        # Every entry must be a deliberately-configured, real published rate —
        # never a guessed/placeholder price (mirrors
        # test_never_hard_codes_a_guessed_price_for_a_model_missing_from_the_registry
        # above, applied to the actual committed registry instead of a fixture).
        config = json.loads(REAL_CONFIG_PATH.read_text(encoding="utf-8"))
        registry = config["monetary"]["price_registry"]
        for key, pricing in registry.items():
            self.assertRegex(key, r"^[a-z0-9_-]+:[a-z0-9.-]+$", f"malformed provider:model key: {key}")
            self.assertIsInstance(pricing["input_per_1k_usd"], (int, float))
            self.assertIsInstance(pricing["output_per_1k_usd"], (int, float))
            self.assertGreater(pricing["input_per_1k_usd"], 0)
            self.assertGreater(pricing["output_per_1k_usd"], 0)

        # The specific entry the real-AI-budget-cap chain (research -> script ->
        # QC -> correction -> final technical check) depends on — Anthropic's
        # published claude-sonnet-4-6 rate: $3.00 / MTok input, $15.00 / MTok
        # output, i.e. $0.003 / $0.015 per 1K tokens.
        sonnet_pricing = registry["anthropic:claude-sonnet-4-6"]
        self.assertEqual(sonnet_pricing["input_per_1k_usd"], 0.003)
        self.assertEqual(sonnet_pricing["output_per_1k_usd"], 0.015)

    def test_real_cost_guard_config_has_positive_integer_token_and_attempt_limits(self) -> None:
        config = json.loads(REAL_CONFIG_PATH.read_text(encoding="utf-8"))
        limits = config["limits"]
        for key in ["max_provider_attempts", "max_input_tokens", "max_output_tokens", "max_total_tokens"]:
            self.assertIsInstance(limits[key], int)
            self.assertGreater(limits[key], 0)


class CliEndToEndTests(unittest.TestCase):
    def _run_cli(self, meta: dict, config: dict) -> subprocess.CompletedProcess:
        with tempfile.TemporaryDirectory() as tmpdir:
            meta_path = Path(tmpdir) / "meta.json"
            config_path = Path(tmpdir) / "cost-guard.json"
            meta_path.write_text(json.dumps(meta), encoding="utf-8")
            config_path.write_text(json.dumps(config), encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(GUARD_PATH), "--meta-file", str(meta_path), "--config", str(config_path)],
                capture_output=True,
                text=True,
                timeout=30,
            )

    def test_cli_exits_zero_when_within_limits(self) -> None:
        result = self._run_cli(
            {"total_input_tokens": 10, "total_output_tokens": 10, "attempts": [{"status": "success"}]},
            {"limits": {"max_provider_attempts": 5, "max_input_tokens": 100, "max_output_tokens": 100, "max_total_tokens": 200}, "monetary": {"enabled": False}},
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_cli_exits_nonzero_fail_closed_when_over_limit(self) -> None:
        result = self._run_cli(
            {"total_input_tokens": 999, "total_output_tokens": 0, "attempts": []},
            {"limits": {"max_input_tokens": 10}, "monetary": {"enabled": False}},
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exceeds max_input_tokens", result.stderr)

    def test_cli_skips_monetary_check_gracefully_when_disabled(self) -> None:
        result = self._run_cli(
            {"total_input_tokens": 10, "total_output_tokens": 10, "attempts": []},
            {"limits": {}, "monetary": {"enabled": False, "max_estimated_cost_usd": 0.01}},
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)

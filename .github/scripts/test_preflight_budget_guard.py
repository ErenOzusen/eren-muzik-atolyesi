#!/usr/bin/env python3
"""Deterministic, zero-network unit tests for preflight_budget_guard.py —
the real-AI-budget-cap chain's fail-CLOSED-before-the-provider-call guard.

None of these tests make a real Anthropic/OpenAI/etc. call, spend a real
token, or touch a real GitHub Issue — every check exercises the pure
check_preflight_budget() function (or the real, committed config files)
directly, in-process.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT / ".github/scripts/preflight_budget_guard.py"
REAL_BUDGET_CONFIG_PATH = ROOT / ".github/config/real-ai-budget.json"
REAL_COST_GUARD_CONFIG_PATH = ROOT / ".github/config/cost-guard.json"
REAL_PROFILE_PATH = ROOT / ".github/config/business-profile.json"


def load_module():
    spec = importlib.util.spec_from_file_location("preflight_budget_guard", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


guard = load_module()


def fixture_budget_config(**overrides) -> dict:
    config = {
        "schema_version": 1,
        "total_chain_budget_usd": 0.50,
        "allowed_provider": "anthropic",
        "allowed_model": "claude-sonnet-4-6",
        "input_estimation": {"chars_per_token": 3.0, "safety_margin": 1.15},
        "stages": {
            "research": {"profile_content_key": "research", "allocated_budget_usd": 0.06},
        },
    }
    config.update(overrides)
    return config


def fixture_price_config(**overrides) -> dict:
    config = {
        "monetary": {
            "enabled": False,
            "price_registry": {
                "anthropic:claude-sonnet-4-6": {"input_per_1k_usd": 0.003, "output_per_1k_usd": 0.015},
            },
        }
    }
    config.update(overrides)
    return config


def fixture_profile(**overrides) -> dict:
    profile = {"content": {"research": {"max_model_output": 2800}}}
    profile.update(overrides)
    return profile


class InputEstimationTests(unittest.TestCase):
    def test_estimate_scales_with_length_and_safety_margin(self) -> None:
        short = guard.estimate_input_tokens("a" * 300, chars_per_token=3.0, safety_margin=1.0)
        self.assertEqual(short, 100)
        with_margin = guard.estimate_input_tokens("a" * 300, chars_per_token=3.0, safety_margin=1.15)
        self.assertEqual(with_margin, 115)

    def test_estimate_rounds_up_never_down(self) -> None:
        # 301 chars / 3.0 = 100.333... -> must round UP to 101, never truncate
        # down — under-estimating input tokens is the unsafe direction.
        estimate = guard.estimate_input_tokens("a" * 301, chars_per_token=3.0, safety_margin=1.0)
        self.assertEqual(estimate, 101)

    def test_rejects_non_positive_chars_per_token(self) -> None:
        with self.assertRaises(ValueError):
            guard.estimate_input_tokens("hello", chars_per_token=0, safety_margin=1.0)


class WorstCaseCostReuseTests(unittest.TestCase):
    def test_reuses_cost_guard_pricing_function_directly(self) -> None:
        # Same registry, same token counts, fed through cost_guard.py's own
        # estimate_monetary_cost() and through worst_case_cost_usd() — must
        # agree exactly, because the latter is a thin wrapper over the former,
        # not a parallel reimplementation.
        registry = {"anthropic:claude-sonnet-4-6": {"input_per_1k_usd": 0.003, "output_per_1k_usd": 0.015}}
        price_config = {"monetary": {"price_registry": registry}}
        expected = guard.cost_guard.estimate_monetary_cost(
            {"attempts": [{"provider": "anthropic", "model": "claude-sonnet-4-6", "input_tokens": 1000, "output_tokens": 1000, "status": "success"}]},
            registry,
        )
        actual = guard.worst_case_cost_usd(price_config, "anthropic", "claude-sonnet-4-6", 1000, 1000)
        self.assertEqual(actual, expected)
        self.assertEqual(actual, 0.003 + 0.015)

    def test_missing_price_entry_returns_none_never_a_guess(self) -> None:
        price_config = {"monetary": {"price_registry": {}}}
        self.assertIsNone(guard.worst_case_cost_usd(price_config, "anthropic", "claude-sonnet-4-6", 100, 100))


class CheckPreflightBudgetTests(unittest.TestCase):
    def test_happy_path_within_budget_passes(self) -> None:
        result = guard.check_preflight_budget(
            stage="research",
            provider="anthropic",
            model="claude-sonnet-4-6",
            web_search_max_uses=0,
            prompt_text="a" * 3000,  # ~1150 estimated tokens with the 1.15x margin
            system_text="",
            profile=fixture_profile(),
            budget_config=fixture_budget_config(),
            price_config=fixture_price_config(),
        )
        self.assertTrue(result["ok"], result["violations"])
        self.assertEqual(result["violations"], [])
        report = result["report"]
        self.assertEqual(report["max_output_tokens"], 2800)
        self.assertAlmostEqual(report["worst_case_cost_usd"], (1150 / 1000 * 0.003) + (2800 / 1000 * 0.015), places=4)
        self.assertLessEqual(report["worst_case_cost_usd"], report["stage_allocated_budget_usd"])

    def test_web_search_nonzero_fails_closed_even_if_cost_is_fine(self) -> None:
        result = guard.check_preflight_budget(
            stage="research",
            provider="anthropic",
            model="claude-sonnet-4-6",
            web_search_max_uses=1,
            prompt_text="short prompt",
            system_text="",
            profile=fixture_profile(),
            budget_config=fixture_budget_config(),
            price_config=fixture_price_config(),
        )
        self.assertFalse(result["ok"])
        self.assertTrue(any("web_search_max_uses" in v for v in result["violations"]))

    def test_wrong_provider_or_model_fails_closed(self) -> None:
        for provider, model in [("openai", "claude-sonnet-4-6"), ("anthropic", "claude-opus-5"), ("openai", "gpt-5")]:
            with self.subTest(provider=provider, model=model):
                result = guard.check_preflight_budget(
                    stage="research",
                    provider=provider,
                    model=model,
                    web_search_max_uses=0,
                    prompt_text="short prompt",
                    system_text="",
                    profile=fixture_profile(),
                    budget_config=fixture_budget_config(),
                    price_config=fixture_price_config(),
                )
                self.assertFalse(result["ok"])
                self.assertTrue(any("provider/model" in v for v in result["violations"]))

    def test_missing_price_registry_entry_fails_closed(self) -> None:
        result = guard.check_preflight_budget(
            stage="research",
            provider="anthropic",
            model="claude-sonnet-4-6",
            web_search_max_uses=0,
            prompt_text="short prompt",
            system_text="",
            profile=fixture_profile(),
            budget_config=fixture_budget_config(),
            price_config=fixture_price_config(monetary={"enabled": False, "price_registry": {}}),
        )
        self.assertFalse(result["ok"])
        self.assertTrue(any("refusing to guess a price" in v for v in result["violations"]))

    def test_oversized_prompt_exceeds_stage_allocation_fails_closed_before_call(self) -> None:
        # A huge prompt alone (output held at the stage ceiling) must push the
        # worst-case estimate over the stage's $0.06 allocation and fail
        # closed — this is the core "provider çağrısından ÖNCE fail-closed"
        # behavior: no attempts[]/meta-file exists yet, this only ever looks
        # at the request about to be made.
        result = guard.check_preflight_budget(
            stage="research",
            provider="anthropic",
            model="claude-sonnet-4-6",
            web_search_max_uses=0,
            prompt_text="a" * 200_000,
            system_text="",
            profile=fixture_profile(),
            budget_config=fixture_budget_config(),
            price_config=fixture_price_config(),
        )
        self.assertFalse(result["ok"])
        self.assertTrue(any("exceeds stage" in v for v in result["violations"]))
        self.assertGreater(result["report"]["worst_case_cost_usd"], result["report"]["stage_allocated_budget_usd"])

    def test_prior_chain_spend_is_additive_against_total_cap(self) -> None:
        # Even a small, well-within-stage-allocation call must still fail
        # closed if the CHAIN's cumulative total would cross $0.50.
        result = guard.check_preflight_budget(
            stage="research",
            provider="anthropic",
            model="claude-sonnet-4-6",
            web_search_max_uses=0,
            prompt_text="short prompt",
            system_text="",
            profile=fixture_profile(),
            budget_config=fixture_budget_config(),
            price_config=fixture_price_config(),
            prior_chain_spend_usd=0.49,
        )
        self.assertFalse(result["ok"])
        self.assertTrue(any("exceeds total_chain_budget_usd" in v for v in result["violations"]))

    def test_unknown_stage_fails_closed(self) -> None:
        result = guard.check_preflight_budget(
            stage="editing",  # not "editing" — never even a valid --stage choice, but the
            provider="anthropic",  # pure function itself must still refuse an unknown key.
            model="claude-sonnet-4-6",
            web_search_max_uses=0,
            prompt_text="x",
            system_text="",
            profile=fixture_profile(),
            budget_config=fixture_budget_config(),
            price_config=fixture_price_config(),
        )
        self.assertFalse(result["ok"])
        self.assertTrue(any("unknown stage" in v for v in result["violations"]))

    def test_missing_max_model_output_in_profile_fails_closed(self) -> None:
        result = guard.check_preflight_budget(
            stage="research",
            provider="anthropic",
            model="claude-sonnet-4-6",
            web_search_max_uses=0,
            prompt_text="x",
            system_text="",
            profile={"content": {"research": {}}},  # max_model_output missing
            budget_config=fixture_budget_config(),
            price_config=fixture_price_config(),
        )
        self.assertFalse(result["ok"])
        self.assertTrue(any("max_model_output" in v for v in result["violations"]))


class RealConfigTests(unittest.TestCase):
    """Validates the actual committed config files, not fixtures — proves
    the real chain's math genuinely stays under $0.50 with the real
    max_model_output ceilings, not just in an isolated test fixture."""

    def setUp(self) -> None:
        self.budget_config = json.loads(REAL_BUDGET_CONFIG_PATH.read_text(encoding="utf-8"))
        self.price_config = json.loads(REAL_COST_GUARD_CONFIG_PATH.read_text(encoding="utf-8"))
        self.profile = json.loads(REAL_PROFILE_PATH.read_text(encoding="utf-8"))

    def test_total_chain_budget_is_exactly_fifty_cents(self) -> None:
        self.assertEqual(self.budget_config["total_chain_budget_usd"], 0.50)

    def test_sum_of_stage_allocations_never_exceeds_total_chain_budget(self) -> None:
        total_allocated = sum(stage["allocated_budget_usd"] for stage in self.budget_config["stages"].values())
        self.assertLessEqual(round(total_allocated, 10), self.budget_config["total_chain_budget_usd"])

    def test_covers_exactly_the_five_real_chain_stages(self) -> None:
        self.assertEqual(
            set(self.budget_config["stages"].keys()),
            {"research", "script", "quality_control", "correction", "final_technical_control"},
        )

    def test_allowed_provider_and_model_are_anthropic_sonnet_4_6(self) -> None:
        self.assertEqual(self.budget_config["allowed_provider"], "anthropic")
        self.assertEqual(self.budget_config["allowed_model"], "claude-sonnet-4-6")

    def test_every_stage_max_model_output_worst_case_fits_its_own_allocation(self) -> None:
        # Uses each stage's REAL max_model_output (exact, from business-profile.json)
        # and a zero-length prompt (the input floor) — i.e. the cheapest possible
        # call for that stage still must not, by itself, already be over budget
        # (a sanity floor: if this ever fails, the allocation itself is too small
        # to ever succeed, regardless of prompt size).
        for stage, stage_config in self.budget_config["stages"].items():
            with self.subTest(stage=stage):
                result = guard.check_preflight_budget(
                    stage=stage,
                    provider="anthropic",
                    model="claude-sonnet-4-6",
                    web_search_max_uses=0,
                    prompt_text="",
                    system_text="",
                    profile=self.profile,
                    budget_config=self.budget_config,
                    price_config=self.price_config,
                )
                self.assertTrue(result["ok"], result["violations"])

    def test_every_stage_at_its_assumed_max_input_tokens_still_fits(self) -> None:
        # Each stage config documents an assumed_max_input_tokens planning
        # ceiling (derived from upstream stages' own max_model_output) — a
        # prompt of roughly that size, at the real max_model_output output
        # ceiling, must still fit inside that stage's allocation.
        chars_per_token = self.budget_config["input_estimation"]["chars_per_token"]
        for stage, stage_config in self.budget_config["stages"].items():
            with self.subTest(stage=stage):
                assumed_tokens = stage_config["assumed_max_input_tokens"]
                prompt_text = "a" * int(assumed_tokens * chars_per_token)
                result = guard.check_preflight_budget(
                    stage=stage,
                    provider="anthropic",
                    model="claude-sonnet-4-6",
                    web_search_max_uses=0,
                    prompt_text=prompt_text,
                    system_text="",
                    profile=self.profile,
                    budget_config=self.budget_config,
                    price_config=self.price_config,
                )
                self.assertTrue(result["ok"], result["violations"])

    def test_price_registry_has_the_sonnet_4_6_entry_the_chain_depends_on(self) -> None:
        registry = self.price_config["monetary"]["price_registry"]
        self.assertIn("anthropic:claude-sonnet-4-6", registry)
        self.assertEqual(registry["anthropic:claude-sonnet-4-6"]["input_per_1k_usd"], 0.003)
        self.assertEqual(registry["anthropic:claude-sonnet-4-6"]["output_per_1k_usd"], 0.015)

    def test_monetary_enforcement_stays_globally_disabled(self) -> None:
        # This chain's cap is enforced by preflight_budget_guard.py reading
        # this SAME price_registry directly — cost-guard.json's own
        # monetary.enabled must stay False so the unrelated workflows that
        # already call cost_guard.py post-hoc (editing/filming package
        # agents) are not silently affected.
        self.assertEqual(self.price_config["monetary"]["enabled"], False)


class CliEndToEndTests(unittest.TestCase):
    """Exercises the real CLI as a subprocess against the real committed
    config files — proves argument parsing, exit codes, and
    GITHUB_STEP_SUMMARY reporting genuinely work end-to-end, not just the
    inner pure function."""

    def run_cli(self, *, stage: str, web_search_max_uses: int, prompt_text: str, provider: str = "anthropic", model: str = "claude-sonnet-4-6", extra_env: dict | None = None) -> subprocess.CompletedProcess:
        with tempfile.TemporaryDirectory() as tmp:
            prompt_path = Path(tmp) / "prompt.txt"
            prompt_path.write_text(prompt_text, encoding="utf-8")
            summary_path = Path(tmp) / "step-summary.md"
            env = {"GITHUB_STEP_SUMMARY": str(summary_path)}
            if extra_env:
                env.update(extra_env)
            import os

            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    "--stage", stage,
                    "--provider", provider,
                    "--model", model,
                    "--web-search-max-uses", str(web_search_max_uses),
                    "--prompt-file", str(prompt_path),
                    "--profile", str(REAL_PROFILE_PATH),
                    "--budget-config", str(REAL_BUDGET_CONFIG_PATH),
                    "--price-config", str(REAL_COST_GUARD_CONFIG_PATH),
                ],
                capture_output=True,
                text=True,
                env={**os.environ, **env},
            )
            result.summary_text = summary_path.read_text(encoding="utf-8") if summary_path.exists() else ""
            return result

    def test_cli_exits_zero_and_reports_ok_within_budget(self) -> None:
        result = self.run_cli(stage="research", web_search_max_uses=0, prompt_text="short research prompt")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("OK", result.stdout)
        self.assertIn("Real-AI budget preflight", result.summary_text)

    def test_cli_exits_nonzero_and_never_calls_a_provider_when_web_search_nonzero(self) -> None:
        result = self.run_cli(stage="quality_control", web_search_max_uses=1, prompt_text="short qc prompt")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("FAIL CLOSED", result.stdout)

    def test_cli_exits_nonzero_for_non_anthropic_provider(self) -> None:
        result = self.run_cli(stage="research", web_search_max_uses=0, prompt_text="x", provider="openai", model="gpt-5")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("FAIL CLOSED", result.stdout)


if __name__ == "__main__":
    unittest.main()

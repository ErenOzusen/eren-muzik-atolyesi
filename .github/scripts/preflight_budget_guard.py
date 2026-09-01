#!/usr/bin/env python3
"""Preflight hard-dollar-budget guard for the real (non-zero-token) AI chain:
Research -> Script -> QC -> Correction -> Final Technical Check.

Unlike cost_guard.py (which checks a *completed* provider call's actual
usage against token/attempt limits, after the money has already been
spent), this script runs strictly BEFORE any real provider call and
computes a WORST-CASE cost estimate for the call that is about to be made.
If that estimate — combined with this stage's already-realized chain spend,
when known — would exceed the stage's allocated share of the chain's
total $0.50 hard cap, it fails closed (non-zero exit, no provider call
happens) before ai_router.py is ever invoked.

Design choices, and why:

- ANTHROPIC ONLY, ONE MODEL: --provider/--model must exactly match
  real-ai-budget.json's allowed_provider/allowed_model (anthropic /
  claude-sonnet-4-6). Anything else fails closed immediately — this script
  refuses to price a call it was not explicitly configured to price.

- NEVER GUESS A PRICE: the $/token rate comes only from
  cost-guard.json's monetary.price_registry, keyed "provider:model". If
  that exact key is missing, this fails closed rather than falling back to
  an assumed/guessed rate (same invariant cost_guard.py's own
  estimate_monetary_cost() already enforces — reused here, not
  reimplemented).

- OUTPUT tokens use the stage's real, configured max_model_output exactly
  (business-profile.json) — the API can never exceed it, so this is an
  exact ceiling, not an estimate.

- INPUT tokens are estimated from the REAL prompt/system file about to be
  sent (never a hard-coded assumption): characters / chars_per_token, then
  inflated by safety_margin. This is deliberately conservative (biased to
  OVER-estimate cost) because a live tokenizer call before the real
  provider call would itself be an extra network call this preflight step
  must not make. Getting the true count wrong is safe in the
  over-estimate direction (a call that would have fit gets rejected) and
  unsafe in the under-estimate direction (an over-budget call gets
  through) — so this only ever errs the safe way.

- WEB SEARCH: --web-search-max-uses must be exactly 0 for the real-AI-
  budget-cap chain (video generation and YouTube upload/publish never
  enter this script's scope at all — they have no code path here to begin
  with).

- FAIL-CLOSED SURFACE: any of a provider/model mismatch, a missing price
  registry entry, a non-zero web-search budget, or a projected cost above
  the stage's allocation (or the chain's total cap) exits non-zero with a
  clear reason and writes nothing that looks like a pass.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import cost_guard  # noqa: E402  (reuses estimate_monetary_cost's price-lookup shape)


def load_json(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def read_optional_text(path: str | None) -> str:
    if not path:
        return ""
    return Path(path).read_text(encoding="utf-8")


def estimate_input_tokens(text: str, chars_per_token: float, safety_margin: float) -> int:
    """Conservative, offline, zero-network estimate of how many input tokens
    `text` will cost — never an exact count (only the real API knows that),
    always biased upward. `chars_per_token` and `safety_margin` come from
    real-ai-budget.json, not hard-coded here."""
    if chars_per_token <= 0:
        raise ValueError("chars_per_token must be positive")
    raw_estimate = len(text) / chars_per_token
    return math.ceil(raw_estimate * safety_margin)


def worst_case_cost_usd(
    price_config: dict[str, Any], provider: str, model: str, input_tokens: int, output_tokens: int
) -> float | None:
    """Genuinely reuses cost_guard.py's own pricing function rather than
    reimplementing it: builds a synthetic single-attempt meta shaped exactly
    like what ai_router.py's real --meta-file output looks like, using our
    worst-case token counts, and prices it through
    cost_guard.estimate_monetary_cost — the same code path that later
    prices the REAL, realized usage post-hoc. This guarantees the preflight
    estimate and the post-hoc check can never disagree about what a given
    token count costs, and inherits cost_guard's own
    never-guess-a-missing-price behavior (returns None) for free."""
    registry = price_config.get("monetary", {}).get("price_registry")
    registry = registry if isinstance(registry, dict) else {}
    synthetic_meta = {
        "attempts": [
            {
                "provider": provider,
                "model": model,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "status": "success",
            }
        ]
    }
    return cost_guard.estimate_monetary_cost(synthetic_meta, registry)


def check_preflight_budget(
    *,
    stage: str,
    provider: str,
    model: str,
    web_search_max_uses: int,
    prompt_text: str,
    system_text: str,
    profile: dict[str, Any],
    budget_config: dict[str, Any],
    price_config: dict[str, Any],
    prior_chain_spend_usd: float = 0.0,
) -> dict[str, Any]:
    """Pure function, zero I/O beyond what's already been read into the
    arguments — fully unit-testable without touching the filesystem or
    network. Returns {"ok": bool, "violations": [...], "report": {...}}."""
    violations: list[str] = []

    allowed_provider = budget_config.get("allowed_provider")
    allowed_model = budget_config.get("allowed_model")
    if provider != allowed_provider or model != allowed_model:
        violations.append(
            f"provider/model must be exactly {allowed_provider}/{allowed_model}, got {provider}/{model}"
        )

    if web_search_max_uses != 0:
        violations.append(f"web_search_max_uses must be 0 for the real-AI-budget-cap chain, got {web_search_max_uses}")

    stages = budget_config.get("stages", {})
    stage_config = stages.get(stage)
    if not isinstance(stage_config, dict):
        violations.append(f"unknown stage '{stage}' — not present in real-ai-budget.json stages")
        return {"ok": False, "violations": violations, "report": {"stage": stage}}

    content_key = stage_config["profile_content_key"]
    try:
        max_output_tokens = int(profile["content"][content_key]["max_model_output"])
    except (KeyError, TypeError, ValueError) as error:
        violations.append(f"could not read content.{content_key}.max_model_output from business-profile.json: {error}")
        return {"ok": False, "violations": violations, "report": {"stage": stage}}

    estimation = budget_config.get("input_estimation", {})
    chars_per_token = float(estimation.get("chars_per_token", 3.0))
    safety_margin = float(estimation.get("safety_margin", 1.15))

    estimated_input_tokens = estimate_input_tokens(prompt_text + system_text, chars_per_token, safety_margin)

    stage_allocation = stage_config.get("allocated_budget_usd")
    total_chain_budget = budget_config.get("total_chain_budget_usd")

    report: dict[str, Any] = {
        "stage": stage,
        "provider": provider,
        "model": model,
        "estimated_input_tokens": estimated_input_tokens,
        "max_output_tokens": max_output_tokens,
        "stage_allocated_budget_usd": stage_allocation,
        "total_chain_budget_usd": total_chain_budget,
        "prior_chain_spend_usd": prior_chain_spend_usd,
    }

    worst_case_cost = worst_case_cost_usd(price_config, provider, model, estimated_input_tokens, max_output_tokens)

    if worst_case_cost is None:
        violations.append(
            f"no explicit price_registry entry for '{provider}:{model}' in cost-guard.json — "
            "refusing to guess a price"
        )
        report["worst_case_cost_usd"] = None
        return {"ok": False, "violations": violations, "report": report}

    projected_total = prior_chain_spend_usd + worst_case_cost

    report["worst_case_cost_usd"] = round(worst_case_cost, 6)
    report["projected_chain_total_usd"] = round(projected_total, 6)
    if isinstance(stage_allocation, (int, float)):
        report["stage_remaining_after_call_usd"] = round(stage_allocation - worst_case_cost, 6)
    if isinstance(total_chain_budget, (int, float)):
        report["chain_remaining_after_call_usd"] = round(total_chain_budget - projected_total, 6)

    if not isinstance(stage_allocation, (int, float)):
        violations.append(f"stage '{stage}' has no numeric allocated_budget_usd in real-ai-budget.json")
    elif worst_case_cost > stage_allocation:
        violations.append(
            f"worst_case_cost_usd={worst_case_cost:.6f} exceeds stage '{stage}' allocated_budget_usd={stage_allocation}"
        )

    if not isinstance(total_chain_budget, (int, float)):
        violations.append("real-ai-budget.json has no numeric total_chain_budget_usd")
    elif projected_total > total_chain_budget:
        violations.append(
            f"projected_chain_total_usd={projected_total:.6f} exceeds total_chain_budget_usd={total_chain_budget}"
        )

    return {"ok": len(violations) == 0, "violations": violations, "report": report}


def format_report(result: dict[str, Any]) -> str:
    report = result["report"]
    lines = [
        f"[preflight_budget_guard] stage={report.get('stage')} provider={report.get('provider')} model={report.get('model')}",
        f"  estimated_input_tokens={report.get('estimated_input_tokens')} max_output_tokens={report.get('max_output_tokens')}",
        f"  worst_case_cost_usd={report.get('worst_case_cost_usd')}",
        f"  stage_allocated_budget_usd={report.get('stage_allocated_budget_usd')} "
        f"stage_remaining_after_call_usd={report.get('stage_remaining_after_call_usd')}",
        f"  prior_chain_spend_usd={report.get('prior_chain_spend_usd')} "
        f"projected_chain_total_usd={report.get('projected_chain_total_usd')}",
        f"  total_chain_budget_usd={report.get('total_chain_budget_usd')} "
        f"chain_remaining_after_call_usd={report.get('chain_remaining_after_call_usd')}",
    ]
    if result["violations"]:
        lines.append("  FAIL CLOSED — provider call blocked:")
        lines.extend(f"    - {v}" for v in result["violations"])
    else:
        lines.append("  OK — within budget, provider call may proceed.")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", required=True, choices=["research", "script", "quality_control", "correction", "final_technical_control"])
    parser.add_argument("--provider", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--web-search-max-uses", required=True, type=int)
    parser.add_argument("--prompt-file", required=True)
    parser.add_argument("--system-file", default=None)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--budget-config", required=True)
    parser.add_argument("--price-config", required=True)
    parser.add_argument("--prior-chain-spend-usd", type=float, default=0.0)
    args = parser.parse_args()

    profile = load_json(args.profile)
    budget_config = load_json(args.budget_config)
    price_config = load_json(args.price_config)
    prompt_text = read_optional_text(args.prompt_file)
    system_text = read_optional_text(args.system_file)

    result = check_preflight_budget(
        stage=args.stage,
        provider=args.provider,
        model=args.model,
        web_search_max_uses=args.web_search_max_uses,
        prompt_text=prompt_text,
        system_text=system_text,
        profile=profile,
        budget_config=budget_config,
        price_config=price_config,
        prior_chain_spend_usd=args.prior_chain_spend_usd,
    )

    print(format_report(result))

    step_summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary_path:
        with open(step_summary_path, "a", encoding="utf-8") as handle:
            handle.write("### Real-AI budget preflight — " + args.stage + "\n")
            handle.write("```text\n" + format_report(result) + "\n```\n")

    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

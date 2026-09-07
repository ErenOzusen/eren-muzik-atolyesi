#!/usr/bin/env python3
"""Separate persistent hard-dollar guard for the MVP production phase.

The historical content-chain ledger/cap remains untouched. Production stages use
mvp-production-budget.json and a different machine-managed GitHub Issue title.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import preflight_budget_guard as common_guard  # noqa: E402
import real_ai_budget_ledger as budget_ledger  # noqa: E402


def load_json(path: str) -> dict[str, Any]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError(f"JSON object required: {path}")
    return data


def read_optional_text(path: str | None) -> str:
    return Path(path).read_text(encoding="utf-8") if path else ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", required=True)
    parser.add_argument("--provider", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--web-search-max-uses", required=True, type=int)
    parser.add_argument("--prompt-file", required=True)
    parser.add_argument("--system-file", default=None)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--budget-config", required=True)
    parser.add_argument("--price-config", required=True)
    parser.add_argument("--prior-production-spend-usd", type=float, default=0.0)
    args = parser.parse_args()

    profile = load_json(args.profile)
    budget_config = load_json(args.budget_config)
    price_config = load_json(args.price_config)
    prompt_text = read_optional_text(args.prompt_file)
    system_text = read_optional_text(args.system_file)

    ledger_title = budget_config.get("ledger_title")
    if not isinstance(ledger_title, str) or not ledger_title.strip():
        print("production ledger_title missing; provider call blocked.", file=sys.stderr)
        raise SystemExit(1)

    seed = budget_config.get("realized_spend_floor_usd", 0.0)
    cap = budget_config.get("total_chain_budget_usd")
    if not isinstance(seed, (int, float)) or seed < 0:
        print("realized_spend_floor_usd must be non-negative; provider call blocked.", file=sys.stderr)
        raise SystemExit(1)
    if not isinstance(cap, (int, float)) or cap <= 0:
        print("total_chain_budget_usd must be positive; provider call blocked.", file=sys.stderr)
        raise SystemExit(1)
    if seed > cap:
        print("production seed exceeds production cap; provider call blocked.", file=sys.stderr)
        raise SystemExit(1)
    if args.prior_production_spend_usd < 0:
        print("--prior-production-spend-usd must be non-negative; provider call blocked.", file=sys.stderr)
        raise SystemExit(1)

    stages = budget_config.get("stages")
    if not isinstance(stages, dict) or args.stage not in stages:
        print(f"unknown production stage: {args.stage}", file=sys.stderr)
        raise SystemExit(1)

    # Reuse the mature append-only reservation implementation, but bind this
    # process to a distinct Issue title. No content-ledger comment/body is read
    # or written by this guard.
    budget_ledger.LEDGER_TITLE = ledger_title.strip()

    effective_prior = max(float(seed), float(args.prior_production_spend_usd))
    live_ledger = budget_ledger.live_budget_mode()
    repo = os.getenv("GH_REPO") or os.getenv("GITHUB_REPOSITORY") or ""
    if live_ledger:
        if not repo:
            print("GitHub repository identity missing; provider call blocked.", file=sys.stderr)
            raise SystemExit(1)
        try:
            _, remote_seed, reservations = budget_ledger.read_remote_state(
                repo, expected_seed_usd=seed
            )
            effective_prior = max(
                effective_prior,
                float(budget_ledger.ledger_total(remote_seed, reservations)),
            )
        except RuntimeError as exc:
            print(f"Persistent production budget ledger read failed; provider call blocked: {exc}", file=sys.stderr)
            raise SystemExit(1) from exc

    result = common_guard.check_preflight_budget(
        stage=args.stage,
        provider=args.provider,
        model=args.model,
        web_search_max_uses=args.web_search_max_uses,
        prompt_text=prompt_text,
        system_text=system_text,
        profile=profile,
        budget_config=budget_config,
        price_config=price_config,
        prior_chain_spend_usd=effective_prior,
    )

    if result["ok"] and live_ledger:
        try:
            reserved_total, added = budget_ledger.reserve_before_call(
                repo=repo,
                stage=args.stage,
                reserved_usd=result["report"]["worst_case_cost_usd"],
                expected_seed_usd=seed,
                total_chain_budget_usd=cap,
            )
            result["report"]["ledger_reserved_total_usd"] = float(reserved_total)
            result["report"]["ledger_reservation_added"] = added
        except RuntimeError as exc:
            result["ok"] = False
            result["violations"].append(f"persistent production budget reservation failed: {exc}")

    print(common_guard.format_report(result))
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("### MVP production budget preflight — " + args.stage + "\n")
            handle.write("```text\n" + common_guard.format_report(result) + "\n```\n")

    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

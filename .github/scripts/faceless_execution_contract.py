#!/usr/bin/env python3
"""Fail-closed execution contract for MoneyPrinterTurbo faceless jobs.

This module performs no network, AI, stock-media, TTS, or video-generation calls.
It decides whether a job may stay in dry-run planning or is eligible for a future
real execution step.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class ContractError(ValueError):
    pass


def _require_bool(obj: dict, key: str) -> bool:
    value = obj.get(key)
    if not isinstance(value, bool):
        raise ContractError(f"{key} boolean olmalı")
    return value


def validate_config(config: dict) -> None:
    if config.get("schema_version") != 1:
        raise ContractError("Geçersiz safety config schema_version")
    if config.get("engine") != "moneyprinterturbo":
        raise ContractError("Safety config engine moneyprinterturbo olmalı")
    _require_bool(config, "dry_run_only")
    _require_bool(config, "allow_network_generation_calls")
    for key in (
        "require_owner_authorization",
        "require_paid_generation_gate",
        "require_side_effect_gate",
        "require_idempotency_key",
    ):
        _require_bool(config, key)
    cost = config.get("hard_max_cost_usd")
    if not isinstance(cost, (int, float)) or isinstance(cost, bool) or cost < 0:
        raise ContractError("hard_max_cost_usd sıfır veya pozitif sayı olmalı")


def evaluate(job: dict, config: dict) -> dict:
    validate_config(config)

    if job.get("selected_mode") != "faceless":
        raise ContractError("selected_mode faceless olmalı")
    if job.get("engine") != "moneyprinterturbo":
        raise ContractError("engine moneyprinterturbo olmalı")

    source_sha = str(job.get("source_body_sha", "")).lower().strip()
    if not SHA256_RE.fullmatch(source_sha):
        raise ContractError("source_body_sha geçerli SHA-256 olmalı")

    idempotency_key = str(job.get("idempotency_key", "")).strip()
    if config["require_idempotency_key"] and not idempotency_key:
        raise ContractError("idempotency_key zorunlu")

    test_mode = _require_bool(job, "test_mode")
    owner_authorized = _require_bool(job, "approved_generation_authorized")
    paid_allowed = _require_bool(job, "paid_generation_allowed")
    side_effects_allowed = _require_bool(job, "production_side_effects_allowed")
    dispatch_ready = _require_bool(job, "generation_dispatch_ready")

    hard_max_cost = float(config["hard_max_cost_usd"])
    dry_run_allowed = bool(
        config["dry_run_only"]
        and not config["allow_network_generation_calls"]
        and hard_max_cost == 0.0
    )

    execution_allowed = bool(
        not test_mode
        and not config["dry_run_only"]
        and config["allow_network_generation_calls"]
        and hard_max_cost > 0.0
        and dispatch_ready
        and (owner_authorized or not config["require_owner_authorization"])
        and (paid_allowed or not config["require_paid_generation_gate"])
        and (side_effects_allowed or not config["require_side_effect_gate"])
    )

    reasons: list[str] = []
    if test_mode:
        reasons.append("test_mode")
    if config["dry_run_only"]:
        reasons.append("dry_run_only")
    if not config["allow_network_generation_calls"]:
        reasons.append("network_generation_disabled")
    if hard_max_cost <= 0.0:
        reasons.append("zero_cost_cap")
    if config["require_owner_authorization"] and not owner_authorized:
        reasons.append("owner_authorization_missing")
    if config["require_paid_generation_gate"] and not paid_allowed:
        reasons.append("paid_generation_gate_closed")
    if config["require_side_effect_gate"] and not side_effects_allowed:
        reasons.append("side_effect_gate_closed")
    if not dispatch_ready:
        reasons.append("generation_dispatch_not_ready")

    return {
        **job,
        "faceless_execution_contract_validated": True,
        "execution_engine": "moneyprinterturbo",
        "dry_run_allowed": dry_run_allowed,
        "execution_allowed": execution_allowed,
        "network_generation_calls_allowed": execution_allowed,
        "hard_max_cost_usd": hard_max_cost,
        "execution_block_reasons": reasons,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-file", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--output-file", required=True)
    args = parser.parse_args()

    job = json.loads(Path(args.job_file).read_text(encoding="utf-8"))
    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    decision = evaluate(job, config)
    Path(args.output_file).write_text(
        json.dumps(decision, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(decision, ensure_ascii=False))


if __name__ == "__main__":
    main()

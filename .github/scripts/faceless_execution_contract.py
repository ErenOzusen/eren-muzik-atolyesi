#!/usr/bin/env python3
"""Fail-closed execution contract for MoneyPrinterTurbo faceless jobs.

This module performs no network, AI, stock-media, TTS, or video-generation calls.
It validates all independent authorization gates before a future executor is ever
allowed to make a network generation call.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
ABSOLUTE_SAFETY_CEILING_USD = 1.0
REQUIRED_SAFETY_FLAGS = (
    "require_owner_authorization",
    "require_owner_marker_validation",
    "require_route_match",
    "require_paid_generation_gate",
    "require_side_effect_gate",
    "require_global_dispatch_gate",
    "require_idempotency_key",
)


class ContractError(ValueError):
    pass


def _require_bool(obj: dict, key: str) -> bool:
    value = obj.get(key)
    if not isinstance(value, bool):
        raise ContractError(f"{key} boolean olmalı")
    return value


def _require_positive_int(obj: dict, key: str) -> int:
    value = obj.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ContractError(f"{key} pozitif integer olmalı")
    return value


def validate_config(config: dict) -> None:
    if config.get("schema_version") != 1:
        raise ContractError("Geçersiz safety config schema_version")
    if config.get("engine") != "moneyprinterturbo":
        raise ContractError("Safety config engine moneyprinterturbo olmalı")

    _require_bool(config, "dry_run_only")
    _require_bool(config, "allow_network_generation_calls")

    # These are not optional feature flags. Keeping them in config makes the
    # safety policy explicit, but turning any of them off is rejected.
    for key in REQUIRED_SAFETY_FLAGS:
        if _require_bool(config, key) is not True:
            raise ContractError(f"Safety requirement devre dışı bırakılamaz: {key}")

    cost = config.get("hard_max_cost_usd")
    if not isinstance(cost, (int, float)) or isinstance(cost, bool) or cost < 0:
        raise ContractError("hard_max_cost_usd sıfır veya pozitif sayı olmalı")
    if float(cost) > ABSOLUTE_SAFETY_CEILING_USD:
        raise ContractError(
            f"hard_max_cost_usd güvenlik tavanını aşıyor: {ABSOLUTE_SAFETY_CEILING_USD:.2f} USD"
        )

    # Contradictory configs fail closed.
    if config["dry_run_only"] and config["allow_network_generation_calls"]:
        raise ContractError("dry_run_only iken network generation açılamaz")
    if config["dry_run_only"] and float(cost) != 0.0:
        raise ContractError("dry_run_only iken hard_max_cost_usd 0 olmalı")
    if not config["dry_run_only"]:
        if not config["allow_network_generation_calls"]:
            raise ContractError("live execution için network generation açık olmalı")
        if float(cost) <= 0.0:
            raise ContractError("live execution için pozitif hard_max_cost_usd zorunlu")


def evaluate(job: dict, config: dict) -> dict:
    validate_config(config)

    if str(job.get("event", "")).strip() != "media_generation_owner_approval_continuation":
        raise ContractError("Geçersiz execution event")

    repository = str(job.get("repository", "")).strip()
    if not REPOSITORY_RE.fullmatch(repository):
        raise ContractError("repository owner/name formatında olmalı")

    source_issue = _require_positive_int(job, "source_issue")
    selected_scenario = str(job.get("selected_scenario", "")).strip()
    if selected_scenario not in {"1", "2", "3"}:
        raise ContractError("selected_scenario 1, 2 veya 3 olmalı")

    if job.get("selected_mode") != "faceless":
        raise ContractError("selected_mode faceless olmalı")
    if job.get("approval_mode") != "faceless":
        raise ContractError("approval_mode faceless olmalı")
    if job.get("engine") != "moneyprinterturbo":
        raise ContractError("engine moneyprinterturbo olmalı")

    source_sha = str(job.get("source_body_sha", "")).lower().strip()
    if not SHA256_RE.fullmatch(source_sha):
        raise ContractError("source_body_sha geçerli SHA-256 olmalı")

    idempotency_key = str(job.get("idempotency_key", "")).strip()
    if not idempotency_key:
        raise ContractError("idempotency_key zorunlu")

    test_mode = _require_bool(job, "test_mode")
    owner_marker_validated = _require_bool(job, "owner_generation_approval_validated")
    route_match_validated = _require_bool(job, "approval_route_match_validated")
    approved_authorized = _require_bool(job, "approved_generation_authorized")
    production_allowed = _require_bool(job, "production_allowed")
    paid_allowed = _require_bool(job, "paid_generation_allowed")
    side_effects_allowed = _require_bool(job, "production_side_effects_allowed")
    dispatch_ready = _require_bool(job, "generation_dispatch_ready")
    global_dispatch_enabled = _require_bool(job, "dispatch_enabled")

    if not test_mode and not idempotency_key.startswith("media:"):
        raise ContractError("real execution idempotency_key media: ile başlamalı")

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
        and 0.0 < hard_max_cost <= ABSOLUTE_SAFETY_CEILING_USD
        and owner_marker_validated
        and route_match_validated
        and approved_authorized
        and production_allowed
        and paid_allowed
        and side_effects_allowed
        and dispatch_ready
        and global_dispatch_enabled
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
    if not owner_marker_validated:
        reasons.append("owner_marker_not_validated")
    if not route_match_validated:
        reasons.append("route_match_not_validated")
    if not approved_authorized:
        reasons.append("approved_generation_not_authorized")
    if not production_allowed:
        reasons.append("production_not_allowed")
    if not paid_allowed:
        reasons.append("paid_generation_gate_closed")
    if not side_effects_allowed:
        reasons.append("side_effect_gate_closed")
    if not dispatch_ready:
        reasons.append("generation_dispatch_not_ready")
    if not global_dispatch_enabled:
        reasons.append("global_dispatch_disabled")

    return {
        **job,
        "source_issue": source_issue,
        "selected_scenario": selected_scenario,
        "faceless_execution_contract_validated": True,
        "execution_engine": "moneyprinterturbo",
        "dry_run_allowed": dry_run_allowed,
        "execution_allowed": execution_allowed,
        "network_generation_calls_allowed": execution_allowed,
        "hard_max_cost_usd": hard_max_cost,
        "absolute_safety_ceiling_usd": ABSOLUTE_SAFETY_CEILING_USD,
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

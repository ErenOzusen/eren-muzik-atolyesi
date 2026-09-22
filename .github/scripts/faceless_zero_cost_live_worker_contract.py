#!/usr/bin/env python3
"""Fail-closed contract for the zero-cost faceless live worker.

This module performs no network calls and never starts MoneyPrinterTurbo. It
validates the immutable inputs that a later workflow may use and emits a
secret-free execution plan. Paid providers and publication are always denied.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


class ContractError(ValueError):
    pass


SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def require_bool(obj: dict, key: str) -> bool:
    value = obj.get(key)
    if not isinstance(value, bool):
        raise ContractError(f"{key} boolean olmalı")
    return value


def require_sha(obj: dict, key: str) -> str:
    value = str(obj.get(key, "")).strip().lower()
    if not SHA256_RE.fullmatch(value):
        raise ContractError(f"{key} geçerli SHA-256 olmalı")
    return value


def evaluate(job: dict, profile: dict, orchestrator: dict, paid_safety: dict) -> dict:
    if job.get("event") != "faceless_zero_cost_live_worker":
        raise ContractError("Geçersiz event")

    source_issue = job.get("source_issue")
    if not isinstance(source_issue, int) or isinstance(source_issue, bool) or source_issue <= 0:
        raise ContractError("source_issue pozitif integer olmalı")

    scenario = str(job.get("selected_scenario", "")).strip()
    if scenario not in {"1", "2", "3"}:
        raise ContractError("selected_scenario 1, 2 veya 3 olmalı")

    actor_authorized = require_bool(job, "actor_authorized")
    owner_approved = require_bool(job, "owner_generation_approved")
    issue_validated = require_bool(job, "production_issue_validated")
    route_validated = require_bool(job, "approval_route_match_validated")
    stock_key_present = require_bool(job, "stock_provider_key_present")
    readiness_validated = require_bool(job, "readiness_validated")
    approved_media_validated = require_bool(job, "approved_media_validated")

    hashes = {
        "source_body_sha256": require_sha(job, "source_body_sha256"),
        "selected_script_sha256": require_sha(job, "selected_script_sha256"),
        "profile_sha256": require_sha(job, "profile_sha256"),
        "orchestrator_sha256": require_sha(job, "orchestrator_sha256"),
        "paid_safety_sha256": require_sha(job, "paid_safety_sha256"),
    }

    blockers: list[str] = []
    if profile.get("schema_version") != 1:
        blockers.append("invalid_profile_schema")
    if profile.get("engine") != "moneyprinterturbo":
        blockers.append("invalid_engine")
    if profile.get("enabled") is not True:
        blockers.append("zero_cost_live_profile_disabled")
    if profile.get("execution_class") != "zero_cost_network":
        blockers.append("invalid_execution_class")
    if profile.get("video_source") != "pexels":
        blockers.append("only_pexels_allowed")
    if profile.get("voice_provider") != "edge":
        blockers.append("only_edge_tts_allowed")
    if profile.get("subtitle_provider") != "edge":
        blockers.append("only_edge_subtitles_allowed")
    if not str(profile.get("voice_name", "")).strip():
        blockers.append("voice_name_missing")
    if profile.get("bgm_type") != "none":
        blockers.append("bgm_must_be_disabled")
    if profile.get("allow_ai_video_generation") is not False:
        blockers.append("ai_video_generation_must_remain_closed")
    if profile.get("allow_paid_provider_calls") is not False:
        blockers.append("paid_provider_calls_must_remain_closed")
    if float(profile.get("hard_max_cost_usd", -1)) != 0.0:
        blockers.append("cost_cap_must_be_zero")
    if profile.get("youtube_publication_enabled") is not False:
        blockers.append("youtube_publication_must_remain_closed")

    if orchestrator.get("generation_dispatch_enabled") is not False:
        blockers.append("paid_global_dispatch_must_remain_closed")
    if paid_safety.get("dry_run_only") is not True:
        blockers.append("paid_safety_must_remain_dry_run")
    if paid_safety.get("allow_network_generation_calls") is not False:
        blockers.append("paid_network_generation_must_remain_closed")
    if float(paid_safety.get("hard_max_cost_usd", -1)) != 0.0:
        blockers.append("paid_cost_cap_must_remain_zero")

    if not actor_authorized:
        blockers.append("actor_not_authorized")
    if not owner_approved:
        blockers.append("owner_generation_not_approved")
    if not issue_validated:
        blockers.append("production_issue_not_validated")
    if not route_validated:
        blockers.append("approval_route_not_validated")
    if not stock_key_present:
        blockers.append("stock_provider_key_missing")
    if not readiness_validated:
        blockers.append("readiness_not_validated")
    if not approved_media_validated:
        blockers.append("approved_media_not_validated")

    expected_phrase = str(profile.get("owner_confirmation_phrase", "")).strip()
    if not expected_phrase or str(job.get("owner_confirmation", "")).strip() != expected_phrase:
        blockers.append("owner_confirmation_missing_or_invalid")

    terms = [part.strip() for part in str(job.get("video_terms", "")).split(",") if part.strip()]
    if not 2 <= len(terms) <= 12:
        blockers.append("video_terms_count_invalid")

    allowed = not blockers
    return {
        "schema_version": 1,
        "event": "faceless_zero_cost_live_worker_contract",
        "source_issue": source_issue,
        "selected_scenario": scenario,
        **hashes,
        "engine": "moneyprinterturbo",
        "video_source": "pexels",
        "voice_provider": "edge",
        "voice_name": str(profile.get("voice_name", "")),
        "subtitle_provider": "edge",
        "video_terms": terms,
        "network_scope": ["pexels_stock_media", "edge_tts"] if allowed else [],
        "hard_max_cost_usd": 0.0,
        "paid_generation_allowed": False,
        "ai_video_generation_allowed": False,
        "youtube_publication_allowed": False,
        "artifact_only": True,
        "approved_media_validated": approved_media_validated,
        "worker_allowed": allowed,
        "blockers": blockers,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-file", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--orchestrator", required=True)
    parser.add_argument("--paid-safety", required=True)
    parser.add_argument("--output-file", required=True)
    parser.add_argument("--require-ready", action="store_true")
    args = parser.parse_args()

    result = evaluate(
        json.loads(Path(args.job_file).read_text(encoding="utf-8")),
        json.loads(Path(args.profile).read_text(encoding="utf-8")),
        json.loads(Path(args.orchestrator).read_text(encoding="utf-8")),
        json.loads(Path(args.paid_safety).read_text(encoding="utf-8")),
    )
    Path(args.output_file).write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(result, ensure_ascii=False))
    if args.require_ready and not result["worker_allowed"]:
        raise SystemExit("Canlı worker güvenlik kapıları kapalı")


if __name__ == "__main__":
    main()

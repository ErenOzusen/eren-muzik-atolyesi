#!/usr/bin/env python3
"""Fail-closed preflight for real zero-cost faceless generation.

This module performs no network calls and never invokes MoneyPrinterTurbo.
It only decides whether a future zero-cost network worker is allowed to start.
Paid generation and YouTube publication must remain disabled.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


class PreflightError(ValueError):
    pass


def _require_bool(obj: dict, key: str) -> bool:
    value = obj.get(key)
    if not isinstance(value, bool):
        raise PreflightError(f"{key} boolean olmalı")
    return value


def _require_positive_int(obj: dict, key: str) -> int:
    value = obj.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise PreflightError(f"{key} pozitif integer olmalı")
    return value


def validate_profile(profile: dict) -> None:
    if profile.get("schema_version") != 1:
        raise PreflightError("Geçersiz profile schema_version")
    if profile.get("engine") != "moneyprinterturbo":
        raise PreflightError("engine moneyprinterturbo olmalı")
    if profile.get("execution_class") != "zero_cost_network":
        raise PreflightError("execution_class zero_cost_network olmalı")
    _require_bool(profile, "enabled")
    _require_bool(profile, "require_stock_provider_key")
    _require_bool(profile, "subtitle_enabled")
    _require_bool(profile, "allow_ai_video_generation")
    _require_bool(profile, "allow_paid_provider_calls")
    _require_bool(profile, "youtube_publication_enabled")
    _require_bool(profile, "require_owner_confirmation")

    if profile.get("video_source") not in {"pexels", "pixabay", "coverr"}:
        raise PreflightError("yalnız zero-cost stock provider kullanılabilir")
    if profile.get("voice_provider") != "edge":
        raise PreflightError("ilk canlı yol yalnız Edge TTS kullanabilir")
    if not str(profile.get("voice_name", "")).strip():
        raise PreflightError("voice_name zorunlu")
    if profile.get("subtitle_provider") != "edge":
        raise PreflightError("subtitle_provider edge olmalı")
    if profile.get("bgm_type") != "none":
        raise PreflightError("ilk canlı yol için bgm_type none olmalı")
    if profile.get("allow_ai_video_generation") is not False:
        raise PreflightError("AI video generation kapalı kalmalı")
    if profile.get("allow_paid_provider_calls") is not False:
        raise PreflightError("paid provider calls kapalı kalmalı")
    if float(profile.get("hard_max_cost_usd", -1)) != 0.0:
        raise PreflightError("zero-cost live profilde hard_max_cost_usd 0 olmalı")
    if profile.get("youtube_publication_enabled") is not False:
        raise PreflightError("YouTube publication kapalı kalmalı")
    phrase = str(profile.get("owner_confirmation_phrase", "")).strip()
    if not phrase:
        raise PreflightError("owner_confirmation_phrase zorunlu")


def evaluate(job: dict, profile: dict, orchestrator: dict, paid_safety: dict) -> dict:
    validate_profile(profile)

    if str(job.get("event", "")).strip() != "faceless_zero_cost_live_preflight":
        raise PreflightError("Geçersiz event")

    source_issue = _require_positive_int(job, "source_issue")
    scenario = str(job.get("selected_scenario", "")).strip()
    if scenario not in {"1", "2", "3"}:
        raise PreflightError("selected_scenario 1, 2 veya 3 olmalı")

    test_mode = _require_bool(job, "test_mode")
    owner_approved = _require_bool(job, "owner_generation_approved")
    issue_validated = _require_bool(job, "production_issue_validated")
    route_validated = _require_bool(job, "approval_route_match_validated")
    stock_key_present = _require_bool(job, "stock_provider_key_present")

    blockers: list[str] = []

    # This path must remain isolated from the paid-generation path.
    if orchestrator.get("generation_dispatch_enabled") is not False:
        blockers.append("paid_global_dispatch_must_remain_closed")
    if paid_safety.get("dry_run_only") is not True:
        blockers.append("paid_safety_must_remain_dry_run")
    if paid_safety.get("allow_network_generation_calls") is not False:
        blockers.append("paid_network_generation_must_remain_closed")
    if float(paid_safety.get("hard_max_cost_usd", -1)) != 0.0:
        blockers.append("paid_cost_cap_must_remain_zero")

    if test_mode:
        blockers.append("test_mode")
    if not profile["enabled"]:
        blockers.append("zero_cost_live_profile_disabled")
    if not owner_approved:
        blockers.append("owner_generation_not_approved")
    if not issue_validated:
        blockers.append("production_issue_not_validated")
    if not route_validated:
        blockers.append("approval_route_not_validated")
    if profile["require_stock_provider_key"] and not stock_key_present:
        blockers.append("stock_provider_key_missing")

    expected_phrase = profile["owner_confirmation_phrase"]
    if profile["require_owner_confirmation"] and str(job.get("owner_confirmation", "")).strip() != expected_phrase:
        blockers.append("owner_confirmation_missing_or_invalid")

    video_terms = [
        part.strip()
        for part in str(job.get("video_terms", "")).split(",")
        if part.strip()
    ]
    if len(video_terms) < 2:
        blockers.append("at_least_two_video_terms_required")
    if len(video_terms) > 12:
        blockers.append("too_many_video_terms")

    ready = not blockers

    return {
        **job,
        "source_issue": source_issue,
        "selected_scenario": scenario,
        "engine": "moneyprinterturbo",
        "execution_class": "zero_cost_network",
        "video_source": profile["video_source"],
        "voice_provider": profile["voice_provider"],
        "voice_name": profile["voice_name"],
        "subtitle_provider": profile["subtitle_provider"],
        "hard_max_cost_usd": 0.0,
        "paid_generation_allowed": False,
        "ai_video_generation_allowed": False,
        "youtube_publication_allowed": False,
        "ready_for_zero_cost_live_generation": ready,
        "blockers": blockers,
        "network_scope": ["stock_media", "edge_tts"] if ready else [],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-file", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--orchestrator", required=True)
    parser.add_argument("--paid-safety", required=True)
    parser.add_argument("--output-file", required=True)
    args = parser.parse_args()

    job = json.loads(Path(args.job_file).read_text(encoding="utf-8"))
    profile = json.loads(Path(args.profile).read_text(encoding="utf-8"))
    orchestrator = json.loads(Path(args.orchestrator).read_text(encoding="utf-8"))
    paid_safety = json.loads(Path(args.paid_safety).read_text(encoding="utf-8"))

    result = evaluate(job, profile, orchestrator, paid_safety)
    Path(args.output_file).write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()

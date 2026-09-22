#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODULE_PATH = ROOT / "faceless_zero_cost_live_preflight.py"
spec = importlib.util.spec_from_file_location("faceless_zero_cost_live_preflight", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)

PROFILE = json.loads((ROOT.parent / "config" / "faceless-zero-cost-live.json").read_text(encoding="utf-8"))
ORCH = json.loads((ROOT.parent / "config" / "video-orchestrator.json").read_text(encoding="utf-8"))
PAID = json.loads((ROOT.parent / "config" / "faceless-execution-safety.json").read_text(encoding="utf-8"))


def base_job() -> dict:
    return {
        "event": "faceless_zero_cost_live_preflight",
        "source_issue": 123,
        "selected_scenario": "1",
        "test_mode": False,
        "owner_generation_approved": True,
        "production_issue_validated": True,
        "approval_route_match_validated": True,
        "stock_provider_key_present": True,
        "owner_confirmation": PROFILE["owner_confirmation_phrase"],
        "video_terms": "gitar, müzik, sahne",
    }


def test_disabled_profile_is_fail_closed() -> None:
    profile = dict(PROFILE)
    profile["enabled"] = False
    result = mod.evaluate(base_job(), profile, ORCH, PAID)
    assert result["ready_for_zero_cost_live_generation"] is False
    assert "zero_cost_live_profile_disabled" in result["blockers"]
    assert result["paid_generation_allowed"] is False
    assert result["youtube_publication_allowed"] is False


def test_enabled_profile_can_be_ready_without_opening_paid_path() -> None:
    assert PROFILE["enabled"] is True
    result = mod.evaluate(base_job(), PROFILE, ORCH, PAID)
    assert result["ready_for_zero_cost_live_generation"] is True
    assert result["blockers"] == []
    assert result["network_scope"] == ["stock_media", "edge_tts"]
    assert result["hard_max_cost_usd"] == 0.0
    assert result["paid_generation_allowed"] is False
    assert ORCH["generation_dispatch_enabled"] is False
    assert PAID["dry_run_only"] is True


def test_missing_owner_confirmation_blocks() -> None:
    profile = dict(PROFILE)
    profile["enabled"] = True
    job = base_job()
    job["owner_confirmation"] = "ONAYLIYORUM"
    result = mod.evaluate(job, profile, ORCH, PAID)
    assert "owner_confirmation_missing_or_invalid" in result["blockers"]


def test_missing_stock_key_blocks() -> None:
    profile = dict(PROFILE)
    profile["enabled"] = True
    job = base_job()
    job["stock_provider_key_present"] = False
    result = mod.evaluate(job, profile, ORCH, PAID)
    assert "stock_provider_key_missing" in result["blockers"]


def test_test_mode_blocks() -> None:
    profile = dict(PROFILE)
    profile["enabled"] = True
    job = base_job()
    job["test_mode"] = True
    result = mod.evaluate(job, profile, ORCH, PAID)
    assert "test_mode" in result["blockers"]


def test_paid_path_must_stay_closed() -> None:
    profile = dict(PROFILE)
    profile["enabled"] = True
    orch = dict(ORCH)
    orch["generation_dispatch_enabled"] = True
    result = mod.evaluate(base_job(), profile, orch, PAID)
    assert "paid_global_dispatch_must_remain_closed" in result["blockers"]


if __name__ == "__main__":
    test_disabled_profile_is_fail_closed()
    test_enabled_profile_can_be_ready_without_opening_paid_path()
    test_missing_owner_confirmation_blocks()
    test_missing_stock_key_blocks()
    test_test_mode_blocks()
    test_paid_path_must_stay_closed()
    print("faceless zero-cost live preflight tests: OK")

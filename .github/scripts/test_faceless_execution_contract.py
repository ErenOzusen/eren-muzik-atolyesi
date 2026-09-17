#!/usr/bin/env python3
"""Zero-network tests for faceless_execution_contract.py."""

from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

import faceless_execution_contract as contract  # noqa: E402

CONFIG_PATH = ROOT / ".github" / "config" / "faceless-execution-safety.json"


def safe_config() -> dict:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def live_config(max_cost: float = 0.25) -> dict:
    cfg = safe_config()
    cfg["dry_run_only"] = False
    cfg["allow_network_generation_calls"] = True
    cfg["hard_max_cost_usd"] = max_cost
    return cfg


def base_job(**overrides) -> dict:
    job = {
        "event": "media_generation_owner_approval_continuation",
        "repository": "ErenOzusen/eren-muzik-atolyesi",
        "source_issue": 123,
        "selected_scenario": "2",
        "selected_mode": "faceless",
        "approval_mode": "faceless",
        "engine": "moneyprinterturbo",
        "source_body_sha": "a" * 64,
        "idempotency_key": "media:ErenOzusen/eren-muzik-atolyesi:123:2:" + "a" * 64,
        "test_mode": False,
        "owner_generation_approval_validated": True,
        "approval_route_match_validated": True,
        "approved_generation_authorized": True,
        "production_allowed": True,
        "paid_generation_allowed": True,
        "production_side_effects_allowed": True,
        "generation_dispatch_ready": True,
        "dispatch_enabled": True,
    }
    job.update(overrides)
    return job


class FacelessExecutionContractTests(unittest.TestCase):
    def test_repository_config_is_zero_cost_and_dry_run_only(self):
        cfg = safe_config()
        contract.validate_config(cfg)
        self.assertTrue(cfg["dry_run_only"])
        self.assertFalse(cfg["allow_network_generation_calls"])
        self.assertEqual(cfg["hard_max_cost_usd"], 0.0)

    def test_current_config_blocks_even_fully_authorized_real_job(self):
        result = contract.evaluate(base_job(), safe_config())
        self.assertTrue(result["dry_run_allowed"])
        self.assertFalse(result["execution_allowed"])
        self.assertFalse(result["network_generation_calls_allowed"])
        self.assertIn("dry_run_only", result["execution_block_reasons"])
        self.assertIn("network_generation_disabled", result["execution_block_reasons"])
        self.assertIn("zero_cost_cap", result["execution_block_reasons"])

    def test_hypothetical_live_config_requires_every_gate(self):
        result = contract.evaluate(base_job(), live_config())
        self.assertTrue(result["execution_allowed"])
        self.assertTrue(result["network_generation_calls_allowed"])
        self.assertEqual(result["execution_block_reasons"], [])

    def test_each_critical_gate_fails_closed(self):
        critical = {
            "owner_generation_approval_validated": "owner_marker_not_validated",
            "approval_route_match_validated": "route_match_not_validated",
            "approved_generation_authorized": "approved_generation_not_authorized",
            "production_allowed": "production_not_allowed",
            "paid_generation_allowed": "paid_generation_gate_closed",
            "production_side_effects_allowed": "side_effect_gate_closed",
            "generation_dispatch_ready": "generation_dispatch_not_ready",
            "dispatch_enabled": "global_dispatch_disabled",
        }
        for field, reason in critical.items():
            with self.subTest(field=field):
                result = contract.evaluate(base_job(**{field: False}), live_config())
                self.assertFalse(result["execution_allowed"])
                self.assertFalse(result["network_generation_calls_allowed"])
                self.assertIn(reason, result["execution_block_reasons"])

    def test_test_mode_can_never_execute(self):
        result = contract.evaluate(base_job(test_mode=True), live_config())
        self.assertFalse(result["execution_allowed"])
        self.assertFalse(result["network_generation_calls_allowed"])
        self.assertIn("test_mode", result["execution_block_reasons"])

    def test_safety_requirements_cannot_be_disabled(self):
        for flag in contract.REQUIRED_SAFETY_FLAGS:
            with self.subTest(flag=flag):
                cfg = safe_config()
                cfg[flag] = False
                with self.assertRaises(contract.ContractError):
                    contract.validate_config(cfg)

    def test_absolute_cost_ceiling_is_enforced(self):
        with self.assertRaises(contract.ContractError):
            contract.validate_config(live_config(contract.ABSOLUTE_SAFETY_CEILING_USD + 0.01))

    def test_contradictory_dry_run_config_is_rejected(self):
        cfg = safe_config()
        cfg["allow_network_generation_calls"] = True
        with self.assertRaises(contract.ContractError):
            contract.validate_config(cfg)

    def test_real_job_requires_media_idempotency_prefix(self):
        with self.assertRaises(contract.ContractError):
            contract.evaluate(base_job(idempotency_key="wrong-prefix"), live_config())

    def test_route_and_engine_identity_are_bound(self):
        for overrides in (
            {"selected_mode": "hybrid"},
            {"approval_mode": "hybrid"},
            {"engine": "vibeframe"},
        ):
            with self.subTest(overrides=overrides):
                with self.assertRaises(contract.ContractError):
                    contract.evaluate(base_job(**overrides), live_config())

    def test_source_identity_is_validated(self):
        invalid_jobs = (
            {"repository": "badrepo"},
            {"source_issue": 0},
            {"selected_scenario": "4"},
            {"source_body_sha": "bad"},
        )
        for overrides in invalid_jobs:
            with self.subTest(overrides=overrides):
                with self.assertRaises(contract.ContractError):
                    contract.evaluate(base_job(**overrides), safe_config())


if __name__ == "__main__":
    unittest.main(verbosity=2)

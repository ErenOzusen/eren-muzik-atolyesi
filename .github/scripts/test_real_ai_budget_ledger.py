#!/usr/bin/env python3
"""Pure zero-network tests for the persistent real-AI reservation ledger."""

from __future__ import annotations

import os
import unittest
from decimal import Decimal
from unittest.mock import patch

import real_ai_budget_ledger as ledger


class BudgetLedgerTests(unittest.TestCase):
    def test_seed_and_reservation_total(self) -> None:
        body = ledger.initial_body("0.367095")
        seed = ledger.parse_seed(body, expected_seed_usd="0.367095")
        rows = ledger.parse_reservations(
            [
                "<!-- REAL_AI_RESERVATION_V1 key=1:1:job:correction stage=correction run_id=1 run_attempt=1 job=job reserved_usd=0.057750 -->"
            ]
        )
        self.assertEqual(ledger.ledger_total(seed, rows), Decimal("0.424845"))

    def test_duplicate_identical_marker_is_rejected_not_double_counted(self) -> None:
        marker = "<!-- REAL_AI_RESERVATION_V1 key=1:1:job:correction stage=correction run_id=1 run_attempt=1 job=job reserved_usd=0.057750 -->"
        with self.assertRaisesRegex(RuntimeError, "malformed or duplicate"):
            ledger.parse_reservations([marker, marker])

    def test_conflicting_duplicate_marker_fails_closed(self) -> None:
        one = "<!-- REAL_AI_RESERVATION_V1 key=1:1:job:correction stage=correction run_id=1 run_attempt=1 job=job reserved_usd=0.050000 -->"
        two = "<!-- REAL_AI_RESERVATION_V1 key=1:1:job:correction stage=correction run_id=1 run_attempt=1 job=job reserved_usd=0.060000 -->"
        with self.assertRaisesRegex(RuntimeError, "conflicting duplicate"):
            ledger.parse_reservations([one, two])

    def test_seed_mismatch_fails_closed(self) -> None:
        body = ledger.initial_body("0.367095")
        with self.assertRaisesRegex(RuntimeError, "seed mismatch"):
            ledger.parse_seed(body, expected_seed_usd="0.260373")

    def test_build_reservation_is_stable_for_same_run(self) -> None:
        env = {
            "GITHUB_RUN_ID": "42",
            "GITHUB_RUN_ATTEMPT": "1",
            "GITHUB_JOB": "correct-scripts",
        }
        with patch.dict(os.environ, env, clear=False):
            row = ledger.build_reservation(stage="correction", reserved_usd="0.057750")
        self.assertEqual(row.key, "42:1:correct-scripts:correction")
        self.assertEqual(row.reserved_usd, Decimal("0.057750"))

    def test_live_mode_requires_both_github_actions_and_cap(self) -> None:
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "true", "REAL_AI_BUDGET_CAP": "true"}, clear=True):
            self.assertTrue(ledger.live_budget_mode())
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "true", "REAL_AI_BUDGET_CAP": "false"}, clear=True):
            self.assertFalse(ledger.live_budget_mode())

    def test_created_issue_verification_retries_transient_search_miss(self) -> None:
        created = (64, ledger.initial_body("0.367095"))
        with (
            patch.object(ledger, "_find_issue", side_effect=[None, created]) as find_issue,
            patch.object(ledger.time, "sleep") as sleep,
        ):
            found = ledger._find_created_issue_with_retry(
                "ErenOzusen/eren-muzik-atolyesi", attempts=3, delay_seconds=0.25
            )
        self.assertEqual(found, created)
        self.assertEqual(find_issue.call_count, 2)
        sleep.assert_called_once_with(0.25)

    def test_created_issue_verification_still_fails_closed_after_retry_window(self) -> None:
        with (
            patch.object(ledger, "_find_issue", return_value=None) as find_issue,
            patch.object(ledger.time, "sleep") as sleep,
        ):
            found = ledger._find_created_issue_with_retry(
                "ErenOzusen/eren-muzik-atolyesi", attempts=3, delay_seconds=0.25
            )
        self.assertIsNone(found)
        self.assertEqual(find_issue.call_count, 3)
        self.assertEqual(sleep.call_count, 2)


if __name__ == "__main__":
    unittest.main()

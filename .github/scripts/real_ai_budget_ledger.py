#!/usr/bin/env python3
"""Persistent preflight reservation ledger for the real-AI hard budget.

Historical spend is seeded by ``realized_spend_floor_usd`` in the committed
budget config. Every future budget-capped provider call reserves its
conservative worst-case cost in one machine-managed GitHub Issue *before*
the provider is invoked. A failed/truncated call therefore still consumes
budget, and a process crash cannot make paid usage disappear from the next
workflow's preflight calculation.

Reservations are stored as append-only Issue comments. The Issue body only
contains the seed marker. This avoids lost-update races from repeatedly
rewriting one shared Issue body. Prompts, model outputs and secrets are never
stored.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

LEDGER_TITLE = "SYSTEM Real AI Budget Ledger"
MONEY_QUANT = Decimal("0.000001")
SEED_RE = re.compile(r"<!-- REAL_AI_BUDGET_LEDGER_V2 seed_usd=([0-9]+(?:\.[0-9]+)?) -->")
RESERVATION_RE = re.compile(
    r"<!-- REAL_AI_RESERVATION_V1 "
    r"key=([^ ]+) stage=([^ ]+) run_id=([^ ]+) run_attempt=([^ ]+) job=([^ ]+) "
    r"reserved_usd=([0-9]+(?:\.[0-9]+)?) -->"
)


@dataclass(frozen=True)
class Reservation:
    key: str
    stage: str
    run_id: str
    run_attempt: str
    job: str
    reserved_usd: Decimal

    def marker(self) -> str:
        return (
            "<!-- REAL_AI_RESERVATION_V1 "
            f"key={self.key} stage={self.stage} run_id={self.run_id} "
            f"run_attempt={self.run_attempt} job={self.job} "
            f"reserved_usd={self.reserved_usd:.6f} -->"
        )


def money(value: float | int | str | Decimal) -> Decimal:
    try:
        amount = Decimal(str(value)).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
    except Exception as exc:  # pragma: no cover - defensive conversion guard
        raise RuntimeError(f"invalid monetary value: {value!r}") from exc
    if amount < 0:
        raise RuntimeError("monetary value must be non-negative")
    return amount


def live_budget_mode() -> bool:
    return os.getenv("GITHUB_ACTIONS", "").lower() == "true" and os.getenv(
        "REAL_AI_BUDGET_CAP", ""
    ).lower() == "true"


def initial_body(seed_usd: float | int | str | Decimal) -> str:
    seed = money(seed_usd)
    return (
        f"<!-- REAL_AI_BUDGET_LEDGER_V2 seed_usd={seed:.6f} -->\n"
        "# Real AI Budget Ledger\n\n"
        "Machine-managed conservative reservation ledger.\n"
        "Each budget-capped provider call reserves worst-case cost before the call.\n"
        "Prompts, outputs and secrets are never stored here.\n"
    )


def parse_seed(body: str, *, expected_seed_usd: float | int | str | Decimal) -> Decimal:
    matches = SEED_RE.findall(body)
    if len(matches) != 1:
        raise RuntimeError("budget ledger must contain exactly one REAL_AI_BUDGET_LEDGER_V2 seed marker")
    seed = money(matches[0])
    expected = money(expected_seed_usd)
    if seed != expected:
        raise RuntimeError(f"budget ledger seed mismatch: issue={seed:.6f} config={expected:.6f}")
    return seed


def parse_reservations(comments: list[str]) -> dict[str, Reservation]:
    reservations: dict[str, Reservation] = {}
    marker_count = 0
    for body in comments:
        marker_count += body.count("<!-- REAL_AI_RESERVATION_V1 ")
        for match in RESERVATION_RE.finditer(body):
            reservation = Reservation(
                key=match.group(1),
                stage=match.group(2),
                run_id=match.group(3),
                run_attempt=match.group(4),
                job=match.group(5),
                reserved_usd=money(match.group(6)),
            )
            existing = reservations.get(reservation.key)
            if existing is not None and existing != reservation:
                raise RuntimeError(f"conflicting duplicate budget reservation key: {reservation.key}")
            reservations[reservation.key] = reservation
    if marker_count != len(reservations):
        raise RuntimeError("budget ledger contains malformed or duplicate reservation markers")
    return reservations


def ledger_total(seed: Decimal, reservations: dict[str, Reservation]) -> Decimal:
    return (seed + sum((row.reserved_usd for row in reservations.values()), Decimal("0"))).quantize(
        MONEY_QUANT, rounding=ROUND_HALF_UP
    )


def build_reservation(*, stage: str, reserved_usd: float | int | str | Decimal) -> Reservation:
    run_id = os.getenv("GITHUB_RUN_ID", "")
    run_attempt = os.getenv("GITHUB_RUN_ATTEMPT", "")
    job = os.getenv("GITHUB_JOB", "")
    if not run_id or not run_attempt or not job:
        raise RuntimeError("GitHub run identity is incomplete; provider call blocked")
    return Reservation(
        key=f"{run_id}:{run_attempt}:{job}:{stage}",
        stage=stage,
        run_id=run_id,
        run_attempt=run_attempt,
        job=job,
        reserved_usd=money(reserved_usd),
    )


def _run_gh(args: list[str]) -> str:
    if not os.getenv("GH_TOKEN"):
        raise RuntimeError("GH_TOKEN is required for persistent real-AI budget ledger access")
    try:
        completed = subprocess.run(
            ["gh", *args], check=True, capture_output=True, text=True, env=os.environ.copy()
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        stderr = getattr(exc, "stderr", "") or ""
        raise RuntimeError(f"GitHub budget ledger operation failed: {stderr[:300]}") from exc
    return completed.stdout.strip()


def _find_issue(repo: str) -> tuple[int, str] | None:
    rows = json.loads(
        _run_gh(
            [
                "issue", "list", "--repo", repo, "--state", "all",
                "--search", f'"{LEDGER_TITLE}" in:title', "--limit", "20",
                "--json", "number,title",
            ]
        )
        or "[]"
    )
    exact = [row for row in rows if row.get("title") == LEDGER_TITLE]
    if len(exact) > 1:
        raise RuntimeError("multiple exact real-AI budget ledger Issues found; failing closed")
    if not exact:
        return None
    number = int(exact[0]["number"])
    detail = json.loads(
        _run_gh(["issue", "view", str(number), "--repo", repo, "--json", "body"])
    )
    return number, str(detail.get("body") or "")


def _comment_bodies(repo: str, issue_number: int) -> list[str]:
    rows = json.loads(
        _run_gh(
            [
                "api", "--paginate",
                f"repos/{repo}/issues/{issue_number}/comments?per_page=100",
                "--jq", ".[].body",
            ]
        )
        or "[]"
    ) if False else None
    # `gh api --jq .[].body` emits one JSON/string value per line rather than
    # one JSON array. Use the issue view API instead, which returns comments
    # as a JSON array and is simpler to validate deterministically.
    raw = _run_gh(["issue", "view", str(issue_number), "--repo", repo, "--json", "comments"])
    data = json.loads(raw or "{}")
    comments = data.get("comments") if isinstance(data, dict) else None
    if not isinstance(comments, list):
        raise RuntimeError("budget ledger comments could not be read")
    bodies: list[str] = []
    for item in comments:
        if not isinstance(item, dict) or not isinstance(item.get("body"), str):
            raise RuntimeError("budget ledger returned a malformed comment")
        bodies.append(item["body"])
    return bodies


def read_remote_state(
    repo: str, *, expected_seed_usd: float | int | str | Decimal
) -> tuple[int | None, Decimal, dict[str, Reservation]]:
    found = _find_issue(repo)
    if found is None:
        seed = money(expected_seed_usd)
        return None, seed, {}
    number, body = found
    seed = parse_seed(body, expected_seed_usd=expected_seed_usd)
    reservations = parse_reservations(_comment_bodies(repo, number))
    return number, seed, reservations


def reserve_before_call(
    *,
    repo: str,
    stage: str,
    reserved_usd: float | int | str | Decimal,
    expected_seed_usd: float | int | str | Decimal,
    total_chain_budget_usd: float | int | str | Decimal,
) -> tuple[Decimal, bool]:
    """Persist one idempotent worst-case reservation before provider spend.

    Returns ``(reserved_total, added)``. Any remote read/write ambiguity fails
    closed by raising RuntimeError; callers must not proceed to the provider.
    """
    reservation = build_reservation(stage=stage, reserved_usd=reserved_usd)
    issue_number, seed, reservations = read_remote_state(
        repo, expected_seed_usd=expected_seed_usd
    )
    existing = reservations.get(reservation.key)
    if existing is not None:
        if existing != reservation:
            raise RuntimeError(f"conflicting duplicate budget reservation key: {reservation.key}")
        return ledger_total(seed, reservations), False

    projected = ledger_total(seed, reservations) + reservation.reserved_usd
    cap = money(total_chain_budget_usd)
    if projected > cap:
        raise RuntimeError(
            f"reservation projected_chain_total_usd={projected:.6f} exceeds total_chain_budget_usd={cap:.6f}"
        )

    if issue_number is None:
        body = initial_body(seed)
        _run_gh(["issue", "create", "--repo", repo, "--title", LEDGER_TITLE, "--body", body])
        found = _find_issue(repo)
        if found is None:
            raise RuntimeError("budget ledger Issue creation could not be verified")
        issue_number, verified_body = found
        parse_seed(verified_body, expected_seed_usd=seed)

    # Re-read immediately before append so a concurrent preflight cannot be
    # overwritten or ignored. Comment append is atomic; if a competing run
    # used budget since the first read, fail closed instead of oversubscribing.
    _, seed, reservations = read_remote_state(repo, expected_seed_usd=seed)
    existing = reservations.get(reservation.key)
    if existing is not None:
        if existing != reservation:
            raise RuntimeError(f"conflicting duplicate budget reservation key: {reservation.key}")
        return ledger_total(seed, reservations), False
    projected = ledger_total(seed, reservations) + reservation.reserved_usd
    if projected > cap:
        raise RuntimeError(
            f"reservation projected_chain_total_usd={projected:.6f} exceeds total_chain_budget_usd={cap:.6f}"
        )

    _run_gh(
        [
            "issue", "comment", str(issue_number), "--repo", repo,
            "--body", reservation.marker(),
        ]
    )
    # Verify persistence before allowing the paid provider call.
    _, seed, reservations = read_remote_state(repo, expected_seed_usd=seed)
    stored = reservations.get(reservation.key)
    if stored != reservation:
        raise RuntimeError("budget reservation write could not be verified; provider call blocked")
    return ledger_total(seed, reservations), True

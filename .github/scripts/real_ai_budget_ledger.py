#!/usr/bin/env python3
"""Persistent real-AI spend ledger for budget-capped GitHub Actions runs.

The committed ``realized_spend_floor_usd`` is the historical seed that
covers paid calls made before this ledger existed. Future paid router calls
are appended to one machine-managed GitHub Issue. Preflight reads the same
Issue, so separately dispatched workflows cannot silently reset cumulative
spend to zero.

This module never stores prompts, responses, credentials, or user content.
Ledger entries contain only run identity, stage, provider/model, token counts,
actual priced cost, and success/failure status.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any

import cost_guard

LEDGER_TITLE = "SYSTEM Real AI Budget Ledger"
CONTEXT_PATH = Path("/tmp/real-ai-budget-context.json")
MONEY_QUANT = Decimal("0.000001")
SEED_RE = re.compile(r"<!-- REAL_AI_BUDGET_LEDGER_V1 seed_usd=([0-9]+(?:\.[0-9]+)?) -->")
ENTRY_RE = re.compile(
    r"<!-- REAL_AI_SPEND_V1 "
    r"key=([^ ]+) stage=([^ ]+) run_id=([^ ]+) run_attempt=([^ ]+) job=([^ ]+) "
    r"provider=([^ ]+) model=([^ ]+) input=([0-9]+) output=([0-9]+) "
    r"cost_usd=([0-9]+(?:\.[0-9]+)?) status=(success|failed) -->"
)


@dataclass(frozen=True)
class LedgerEntry:
    key: str
    stage: str
    run_id: str
    run_attempt: str
    job: str
    provider: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: Decimal
    status: str

    def marker(self) -> str:
        return (
            "<!-- REAL_AI_SPEND_V1 "
            f"key={self.key} stage={self.stage} run_id={self.run_id} "
            f"run_attempt={self.run_attempt} job={self.job} provider={self.provider} "
            f"model={self.model} input={self.input_tokens} output={self.output_tokens} "
            f"cost_usd={self.cost_usd:.6f} status={self.status} -->"
        )


def _money(value: float | int | str | Decimal) -> Decimal:
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


def parse_ledger_body(body: str, *, expected_seed_usd: float | int | str | Decimal) -> tuple[Decimal, dict[str, LedgerEntry]]:
    seed_matches = SEED_RE.findall(body)
    if len(seed_matches) != 1:
        raise RuntimeError("budget ledger must contain exactly one REAL_AI_BUDGET_LEDGER_V1 seed marker")
    seed = _money(seed_matches[0])
    expected_seed = _money(expected_seed_usd)
    if seed != expected_seed:
        raise RuntimeError(
            f"budget ledger seed mismatch: issue={seed:.6f} config={expected_seed:.6f}"
        )

    entries: dict[str, LedgerEntry] = {}
    for match in ENTRY_RE.finditer(body):
        entry = LedgerEntry(
            key=match.group(1),
            stage=match.group(2),
            run_id=match.group(3),
            run_attempt=match.group(4),
            job=match.group(5),
            provider=match.group(6),
            model=match.group(7),
            input_tokens=int(match.group(8)),
            output_tokens=int(match.group(9)),
            cost_usd=_money(match.group(10)),
            status=match.group(11),
        )
        existing = entries.get(entry.key)
        if existing is not None and existing != entry:
            raise RuntimeError(f"conflicting duplicate budget ledger key: {entry.key}")
        entries[entry.key] = entry

    marker_count = body.count("<!-- REAL_AI_SPEND_V1 ")
    if marker_count != len(entries):
        raise RuntimeError("budget ledger contains malformed or duplicate spend markers")
    return seed, entries


def ledger_total(seed: Decimal, entries: dict[str, LedgerEntry]) -> Decimal:
    return (seed + sum((entry.cost_usd for entry in entries.values()), Decimal("0"))).quantize(
        MONEY_QUANT, rounding=ROUND_HALF_UP
    )


def initial_body(seed_usd: float | int | str | Decimal) -> str:
    seed = _money(seed_usd)
    return (
        f"<!-- REAL_AI_BUDGET_LEDGER_V1 seed_usd={seed:.6f} -->\n"
        "# Real AI Budget Ledger\n\n"
        "Machine-managed audit ledger. Do not edit spend markers manually.\n"
        "Only priced token usage is stored; prompts, outputs and secrets are never stored.\n"
    )


def append_entry_to_body(
    body: str, entry: LedgerEntry, *, expected_seed_usd: float | int | str | Decimal
) -> tuple[str, Decimal, bool]:
    seed, entries = parse_ledger_body(body, expected_seed_usd=expected_seed_usd)
    existing = entries.get(entry.key)
    if existing is not None:
        if existing != entry:
            raise RuntimeError(f"conflicting duplicate budget ledger key: {entry.key}")
        return body, ledger_total(seed, entries), False

    new_body = body.rstrip() + "\n\n" + entry.marker() + "\n"
    entries[entry.key] = entry
    return new_body, ledger_total(seed, entries), True


def _run_gh(args: list[str]) -> str:
    env = os.environ.copy()
    if not env.get("GH_TOKEN"):
        raise RuntimeError("GH_TOKEN is required for persistent real-AI budget ledger access")
    try:
        completed = subprocess.run(
            ["gh", *args],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        stderr = getattr(exc, "stderr", "") or ""
        raise RuntimeError(f"GitHub budget ledger operation failed: {stderr[:300]}") from exc
    return completed.stdout.strip()


def _find_remote_issue(repo: str) -> tuple[int, str] | None:
    raw = _run_gh(
        [
            "issue",
            "list",
            "--repo",
            repo,
            "--state",
            "all",
            "--search",
            f'"{LEDGER_TITLE}" in:title',
            "--limit",
            "20",
            "--json",
            "number,title",
        ]
    )
    rows = json.loads(raw or "[]")
    exact = [row for row in rows if row.get("title") == LEDGER_TITLE]
    if len(exact) > 1:
        raise RuntimeError("multiple exact real-AI budget ledger Issues found; failing closed")
    if not exact:
        return None
    number = int(exact[0]["number"])
    detail = json.loads(
        _run_gh(["issue", "view", str(number), "--repo", repo, "--json", "body,url"])
    )
    return number, str(detail.get("body") or "")


def read_remote_total(repo: str, *, expected_seed_usd: float | int | str | Decimal) -> Decimal:
    found = _find_remote_issue(repo)
    if found is None:
        return _money(expected_seed_usd)
    _, body = found
    seed, entries = parse_ledger_body(body, expected_seed_usd=expected_seed_usd)
    return ledger_total(seed, entries)


def build_entry_from_meta(meta: dict[str, Any], *, stage: str) -> LedgerEntry | None:
    attempts = meta.get("attempts") if isinstance(meta.get("attempts"), list) else []
    paid_attempts = [
        item
        for item in attempts
        if isinstance(item, dict)
        and item.get("status") != "skipped"
        and (int(item.get("input_tokens") or 0) > 0 or int(item.get("output_tokens") or 0) > 0)
    ]
    if not paid_attempts:
        return None
    if len(paid_attempts) != 1:
        raise RuntimeError("budget-capped router run must contain exactly one paid provider attempt")

    price_config_path = os.environ.get("REAL_AI_PRICE_CONFIG_PATH", ".github/config/cost-guard.json")
    price_config = json.loads(Path(price_config_path).read_text(encoding="utf-8"))
    registry = price_config.get("monetary", {}).get("price_registry")
    registry = registry if isinstance(registry, dict) else {}
    cost = cost_guard.estimate_monetary_cost(meta, registry)
    if cost is None:
        raise RuntimeError("actual provider/model has no explicit price registry entry; failing closed")

    attempt = paid_attempts[0]
    run_id = os.getenv("GITHUB_RUN_ID", "")
    run_attempt = os.getenv("GITHUB_RUN_ATTEMPT", "")
    job = os.getenv("GITHUB_JOB", "")
    if not run_id or not run_attempt or not job:
        raise RuntimeError("GitHub run identity is incomplete; refusing to persist ambiguous spend")
    key = f"{run_id}:{run_attempt}:{job}:{stage}"
    status = "success" if attempt.get("status") == "success" else "failed"
    return LedgerEntry(
        key=key,
        stage=stage,
        run_id=run_id,
        run_attempt=run_attempt,
        job=job,
        provider=str(attempt.get("provider") or ""),
        model=str(attempt.get("model") or ""),
        input_tokens=int(attempt.get("input_tokens") or 0),
        output_tokens=int(attempt.get("output_tokens") or 0),
        cost_usd=_money(cost),
        status=status,
    )


def persist_router_meta(meta: dict[str, Any], *, context: dict[str, Any]) -> Decimal:
    entry = build_entry_from_meta(meta, stage=str(context["stage"]))
    seed = _money(context["realized_spend_seed_usd"])
    repo = str(context["repo"])
    if entry is None:
        return read_remote_total(repo, expected_seed_usd=seed)

    found = _find_remote_issue(repo)
    if found is None:
        body = initial_body(seed)
        new_body, total, _ = append_entry_to_body(body, entry, expected_seed_usd=seed)
        _run_gh(["issue", "create", "--repo", repo, "--title", LEDGER_TITLE, "--body", new_body])
        return total

    number, body = found
    new_body, total, changed = append_entry_to_body(body, entry, expected_seed_usd=seed)
    if changed:
        _run_gh(["issue", "edit", str(number), "--repo", repo, "--body", new_body])
    return total


def write_context(context: dict[str, Any]) -> None:
    CONTEXT_PATH.write_text(json.dumps(context, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_context_if_live() -> dict[str, Any] | None:
    if not live_budget_mode():
        return None
    if not CONTEXT_PATH.exists():
        raise RuntimeError("real-AI budget context missing; provider call blocked")
    context = json.loads(CONTEXT_PATH.read_text(encoding="utf-8"))
    for key in ("stage", "repo", "run_id", "run_attempt", "realized_spend_seed_usd"):
        if key not in context:
            raise RuntimeError(f"real-AI budget context missing field: {key}")
    if str(context["run_id"]) != os.getenv("GITHUB_RUN_ID", "") or str(
        context["run_attempt"]
    ) != os.getenv("GITHUB_RUN_ATTEMPT", ""):
        raise RuntimeError("stale real-AI budget context does not match this workflow run")
    return context

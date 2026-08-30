#!/usr/bin/env python3
"""Deterministic, standalone cost/attempt guard for AI Router runs.

Reads a router meta-file (the exact JSON shape ai_router.py already writes
via --meta-file: total_input_tokens, total_output_tokens, attempts[]) and a
cost-guard config, and fails closed (non-zero exit) if any configured
token/attempt limit is exceeded.

This is intentionally standalone rather than built into ai_router.py
itself: any workflow that already calls ai_router.py can opt in by adding
one extra step afterward (`python3 .github/scripts/cost_guard.py
--meta-file <path> --config .github/config/cost-guard.json`), with zero
changes required to ai_router.py or to workflows that don't opt in yet.

Monetary enforcement is a separate, explicitly-opt-in layer:
config.monetary.enabled defaults to false, and even when a workflow sets it
true, this script never estimates a cost from a hard-coded/guessed price —
it only computes one if every provider/model actually used has a real
entry in config.monetary.price_registry (a value someone deliberately
configured). If it does not, monetary enforcement is skipped and clearly
reported as skipped, never silently assumed to have passed.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def load_json(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def check_token_and_attempt_limits(meta: dict[str, Any], limits: dict[str, Any]) -> list[str]:
    """Returns a list of human-readable violation messages (empty if none)."""
    violations: list[str] = []

    attempts = meta.get("attempts") if isinstance(meta.get("attempts"), list) else []
    provider_attempts = len([a for a in attempts if isinstance(a, dict) and a.get("status") != "skipped"])

    total_input_tokens = int(meta.get("total_input_tokens") or 0)
    total_output_tokens = int(meta.get("total_output_tokens") or 0)
    total_tokens = total_input_tokens + total_output_tokens

    max_attempts = limits.get("max_provider_attempts")
    if isinstance(max_attempts, int) and provider_attempts > max_attempts:
        violations.append(
            f"provider_attempts={provider_attempts} exceeds max_provider_attempts={max_attempts}"
        )

    max_input = limits.get("max_input_tokens")
    if isinstance(max_input, int) and total_input_tokens > max_input:
        violations.append(f"total_input_tokens={total_input_tokens} exceeds max_input_tokens={max_input}")

    max_output = limits.get("max_output_tokens")
    if isinstance(max_output, int) and total_output_tokens > max_output:
        violations.append(f"total_output_tokens={total_output_tokens} exceeds max_output_tokens={max_output}")

    max_total = limits.get("max_total_tokens")
    if isinstance(max_total, int) and total_tokens > max_total:
        violations.append(f"total_tokens={total_tokens} exceeds max_total_tokens={max_total}")

    return violations


def estimate_monetary_cost(meta: dict[str, Any], price_registry: dict[str, Any]) -> float | None:
    """Returns an estimated USD cost, or None if any used provider/model is
    missing from price_registry (never guesses/falls back to a default
    price for a model that isn't explicitly configured)."""
    attempts = meta.get("attempts") if isinstance(meta.get("attempts"), list) else []
    total_cost = 0.0

    for attempt in attempts:
        if not isinstance(attempt, dict) or attempt.get("status") == "skipped":
            continue

        provider = attempt.get("provider")
        model = attempt.get("model")
        key = f"{provider}:{model}"
        pricing = price_registry.get(key)

        if not isinstance(pricing, dict):
            return None

        input_price_per_1k = pricing.get("input_per_1k_usd")
        output_price_per_1k = pricing.get("output_per_1k_usd")

        if not isinstance(input_price_per_1k, (int, float)) or not isinstance(output_price_per_1k, (int, float)):
            return None

        input_tokens = int(attempt.get("input_tokens") or 0)
        output_tokens = int(attempt.get("output_tokens") or 0)

        total_cost += (input_tokens / 1000.0) * input_price_per_1k
        total_cost += (output_tokens / 1000.0) * output_price_per_1k

    return total_cost


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--meta-file", required=True, help="ai_router.py --meta-file output to check")
    parser.add_argument("--config", required=True, help="cost-guard.json path")
    args = parser.parse_args()

    meta = load_json(args.meta_file)
    config = load_json(args.config)
    limits = config.get("limits") if isinstance(config.get("limits"), dict) else {}
    monetary = config.get("monetary") if isinstance(config.get("monetary"), dict) else {}

    violations = check_token_and_attempt_limits(meta, limits)

    monetary_enabled = bool(monetary.get("enabled"))
    max_cost = monetary.get("max_estimated_cost_usd")

    if monetary_enabled and isinstance(max_cost, (int, float)):
        price_registry = monetary.get("price_registry") if isinstance(monetary.get("price_registry"), dict) else {}
        estimated_cost = estimate_monetary_cost(meta, price_registry)

        if estimated_cost is None:
            print(
                "Parasal maliyet tahmini atlandı: kullanılan provider/model için "
                "price_registry içinde fiyat tanımlı değil.",
                file=sys.stderr,
            )
        elif estimated_cost > max_cost:
            violations.append(
                f"estimated_cost_usd={estimated_cost:.4f} exceeds max_estimated_cost_usd={max_cost}"
            )
        else:
            print(f"Tahmini maliyet: ${estimated_cost:.4f} (limit: ${max_cost})")
    else:
        print("Parasal harcama zorlaması devre dışı (monetary.enabled=false) — yalnızca token/attempt sınırları uygulanıyor.")

    if violations:
        print("Cost guard: bütçe/sınır aşıldı, fail-closed:", file=sys.stderr)
        for violation in violations:
            print(f"  - {violation}", file=sys.stderr)
        raise SystemExit(1)

    print("Cost guard: tüm sınırlar içinde.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Validate an AI text output against a reusable JSON quality contract.

This script performs local deterministic checks only. It makes no network or AI calls.
Exit 0 means the candidate passes; exit 1 means the candidate should be rejected.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


def load_contract(path: str) -> dict[str, Any]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Sözleşme JSON nesnesi olmalıdır.")
    if data.get("schema_version") != 1:
        raise ValueError("Desteklenmeyen sözleşme schema_version.")
    return data


def validate_text(text: str, contract: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    size = len(text)

    min_chars = int(contract.get("min_chars") or 0)
    max_chars = int(contract.get("max_chars") or 0)
    if min_chars and size < min_chars:
        errors.append(f"too_short:{size}<{min_chars}")
    if max_chars and size > max_chars:
        errors.append(f"too_long:{size}>{max_chars}")

    flags = re.MULTILINE | re.IGNORECASE
    for item in contract.get("required_regex", []):
        if not isinstance(item, str):
            errors.append("invalid_required_regex")
            continue
        if re.search(item, text, flags) is None:
            errors.append(f"missing:{item}")

    for item in contract.get("forbidden_regex", []):
        if not isinstance(item, str):
            errors.append("invalid_forbidden_regex")
            continue
        if re.search(item, text, flags) is not None:
            errors.append(f"forbidden:{item}")

    count_rules = contract.get("count_regex", [])
    if isinstance(count_rules, list):
        for rule in count_rules:
            if not isinstance(rule, dict) or not isinstance(rule.get("regex"), str):
                errors.append("invalid_count_rule")
                continue
            matches = re.findall(rule["regex"], text, flags)
            count = len(matches)
            expected = rule.get("equals")
            minimum = rule.get("min")
            maximum = rule.get("max")
            if expected is not None and count != int(expected):
                errors.append(f"count:{rule['regex']}={count}!={expected}")
            if minimum is not None and count < int(minimum):
                errors.append(f"count_min:{rule['regex']}={count}<{minimum}")
            if maximum is not None and count > int(maximum):
                errors.append(f"count_max:{rule['regex']}={count}>{maximum}")

    return errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contract", required=True)
    parser.add_argument("--input-file", required=True)
    parser.add_argument("--report-file", default="")
    args = parser.parse_args()

    try:
        contract = load_contract(args.contract)
        text = Path(args.input_file).read_text(encoding="utf-8")
        errors = validate_text(text, contract)
    except Exception as exc:
        errors = [f"validator_error:{exc}"]

    report = {"passed": not errors, "errors": errors}
    if args.report_file:
        Path(args.report_file).write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    if errors:
        print(json.dumps(report, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()

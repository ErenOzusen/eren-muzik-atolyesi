#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).with_name("temporal_freshness_preflight.py")
SPEC = importlib.util.spec_from_file_location("temporal_freshness_preflight", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def assert_equal(actual, expected, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected={expected!r} actual={actual!r}")


def make_prompt(final_text: str) -> str:
    return (
        "NİHAİ SENARYOLAR — https://example.invalid/final\n\n"
        + final_text
        + "\n\nBAĞLI KALİTE KONTROL RAPORU — https://example.invalid/qc\n\nGENEL KARAR: ✅\n"
    )


def test_extract_final_scripts() -> None:
    source = "SENARYO 1\n2026 etkinliği yaklaşıyor."
    assert_equal(MODULE.extract_final_scripts(make_prompt(source)), source + "\n", "extract")


def test_missing_markers_fail_closed() -> None:
    try:
        MODULE.extract_final_scripts("bozuk prompt")
    except ValueError:
        return
    raise AssertionError("missing markers must fail closed")


def test_business_date_override() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        profile = Path(tmp) / "profile.json"
        profile.write_text('{"business":{"timezone":"Europe/Istanbul"}}', encoding="utf-8")
        assert_equal(
            MODULE.resolve_business_date(str(profile), "2026-09-07").isoformat(),
            "2026-09-07",
            "today override",
        )


def main() -> int:
    tests = [test_extract_final_scripts, test_missing_markers_fail_closed, test_business_date_override]
    for func in tests:
        func()
        print(f"PASS {func.__name__}")
    print(f"TOTAL={len(tests)} FAILS=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

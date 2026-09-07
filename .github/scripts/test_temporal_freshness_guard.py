#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

SCRIPT = Path(__file__).with_name("temporal_freshness_guard.py")
SPEC = importlib.util.spec_from_file_location("temporal_freshness_guard", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def kinds(text: str, today: str = "2026-09-07") -> list[str]:
    return [item.kind for item in MODULE.check_text(text, date.fromisoformat(today))]


def assert_equal(actual, expected, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected={expected!r} actual={actual!r}")


def test_stale_year_near_freshness_claim() -> None:
    text = """**SEO Başlığı:** İstanbul Gitar Günleri 2025 | Sahne Gitaristleri
**Açıklamanın İlk Cümlesi:** İstanbul Gitar Günleri yaklaşıyor.
"""
    assert_equal(kinds(text), ["stale_year_freshness_claim"], "stale SEO year")


def test_historical_year_is_allowed() -> None:
    text = "2025 İstanbul Gitar Günleri'nde kullanılan sahne tekniklerini geriye dönük inceliyoruz."
    assert_equal(kinds(text), [], "historical context")


def test_current_year_is_allowed() -> None:
    text = "**SEO Başlığı:** İstanbul Gitar Günleri 2026\nEtkinlik yaklaşıyor."
    assert_equal(kinds(text), [], "current year")


def test_stale_month_is_blocked() -> None:
    assert_equal(
        kinds("Ağustos geldi, yeni dönem başlıyor."),
        ["stale_relative_month_claim"],
        "stale month",
    )


def test_current_month_is_allowed() -> None:
    assert_equal(kinds("Eylül geldi, yeni dönem başlıyor."), [], "current month")


def test_cli_fails_closed_and_writes_json() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        source = root / "input.md"
        report = root / "report.json"
        source.write_text("2025 geliyor — hazırlık başladı.\n", encoding="utf-8")
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--input",
                str(source),
                "--today",
                "2026-09-07",
                "--json-output",
                str(report),
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        assert_equal(result.returncode, 2, "CLI fail-closed status")
        if not report.exists() or '"finding_count": 1' not in report.read_text(encoding="utf-8"):
            raise AssertionError("CLI JSON report missing or unexpected")


def main() -> int:
    tests = [
        test_stale_year_near_freshness_claim,
        test_historical_year_is_allowed,
        test_current_year_is_allowed,
        test_stale_month_is_blocked,
        test_current_month_is_allowed,
        test_cli_fails_closed_and_writes_json,
    ]
    for func in tests:
        func()
        print(f"PASS {func.__name__}")
    print(f"TOTAL={len(tests)} FAILS=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

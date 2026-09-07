#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).with_name("final_technical_freshness_transform.py")
SPEC = importlib.util.spec_from_file_location("final_technical_freshness_transform", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def make_prompt(final_text: str) -> str:
    return (
        "NİHAİ SENARYOLAR — https://example.invalid/final\n\n"
        + final_text
        + "\n\nBAĞLI KALİTE KONTROL RAPORU — https://example.invalid/qc\n\nGENEL KARAR: ✅\n"
    )


def test_safe_request_passes_unchanged() -> None:
    prompt = make_prompt("**SEO Başlığı:** İstanbul Gitar Günleri 2026\nEtkinlik yaklaşıyor.")
    with mock.patch.object(MODULE, "_business_today") as today:
        from datetime import date
        today.return_value = date(2026, 9, 7)
        result = MODULE.prepare_request(prompt=prompt, system_prompt="system")
    assert result["prompt"] == prompt
    assert result["system_prompt"] == "system"
    assert result["context"]["temporal_freshness_checked"] is True


def test_stale_request_blocks_before_provider() -> None:
    prompt = make_prompt(
        "**SEO Başlığı:** İstanbul Gitar Günleri 2025 | Sahne Gitaristleri\n"
        "İstanbul Gitar Günleri yaklaşıyor."
    )
    with mock.patch.object(MODULE, "_business_today") as today:
        from datetime import date
        today.return_value = date(2026, 9, 7)
        try:
            MODULE.prepare_request(prompt=prompt, system_prompt="system")
        except RuntimeError as exc:
            assert "provider çağrısını blokladı" in str(exc)
            return
    raise AssertionError("stale request must be blocked")


def test_missing_timezone_fails_closed() -> None:
    with mock.patch.dict(os.environ, {}, clear=True):
        try:
            MODULE._business_today()
        except RuntimeError as exc:
            assert "BUSINESS_TIMEZONE eksik" in str(exc)
            return
    raise AssertionError("missing timezone must fail closed")


def test_finalize_requires_context() -> None:
    try:
        MODULE.finalize_output(text="ok", context={})
    except RuntimeError:
        return
    raise AssertionError("missing freshness context must fail closed")


def main() -> int:
    tests = [
        test_safe_request_passes_unchanged,
        test_stale_request_blocks_before_provider,
        test_missing_timezone_fails_closed,
        test_finalize_requires_context,
    ]
    for func in tests:
        func()
        print(f"PASS {func.__name__}")
    print(f"TOTAL={len(tests)} FAILS=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
from __future__ import annotations

import os
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from temporal_freshness_guard import check_text
from temporal_freshness_preflight import extract_final_scripts


def _business_today():
    timezone_name = os.getenv("BUSINESS_TIMEZONE", "").strip()
    if not timezone_name:
        raise RuntimeError("BUSINESS_TIMEZONE eksik; temporal freshness kontrolü fail-closed.")
    try:
        timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise RuntimeError(
            f"BUSINESS_TIMEZONE geçersiz: {timezone_name}; temporal freshness kontrolü fail-closed."
        ) from exc
    return datetime.now(timezone).date()


def prepare_request(*, prompt: str, system_prompt: str) -> dict:
    final_text = extract_final_scripts(prompt)
    today = _business_today()
    findings = check_text(final_text, today)
    if findings:
        detail = "; ".join(
            f"satır {finding.line}: {finding.message}" for finding in findings[:5]
        )
        raise RuntimeError(
            "Temporal freshness guard provider çağrısını blokladı: " + detail
        )

    return {
        "prompt": prompt,
        "system_prompt": system_prompt,
        "context": {
            "temporal_freshness_checked": True,
            "business_date": today.isoformat(),
            "finding_count": 0,
        },
    }


def finalize_output(*, text: str, context: dict) -> str:
    if context.get("temporal_freshness_checked") is not True:
        raise RuntimeError("Temporal freshness context kayıp; çıktı fail-closed reddedildi.")
    return text

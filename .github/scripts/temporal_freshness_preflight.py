#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from temporal_freshness_guard import check_text

FINAL_MARKER = "NİHAİ SENARYOLAR — "
QC_MARKER = "\n\nBAĞLI KALİTE KONTROL RAPORU — "


def extract_final_scripts(prompt_text: str) -> str:
    if FINAL_MARKER not in prompt_text or QC_MARKER not in prompt_text:
        raise ValueError("Son Teknik Kontrol prompt sınırları çözülemedi; fail-closed.")
    after_marker = prompt_text.split(FINAL_MARKER, 1)[1]
    first_newline = after_marker.find("\n")
    if first_newline < 0:
        raise ValueError("Nihai senaryo URL satırı çözülemedi; fail-closed.")
    payload = after_marker[first_newline + 1 :]
    final_text = payload.split(QC_MARKER, 1)[0].strip()
    if not final_text:
        raise ValueError("Nihai senaryo metni boş; fail-closed.")
    return final_text + "\n"


def resolve_business_date(profile_path: str, today_override: str | None = None):
    if today_override:
        return datetime.strptime(today_override, "%Y-%m-%d").date()
    profile = json.loads(Path(profile_path).read_text(encoding="utf-8"))
    timezone_name = profile["business"]["timezone"]
    try:
        timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"Geçersiz business timezone: {timezone_name}") from exc
    return datetime.now(timezone).date()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Final Technical promptunu AI çağrısından önce deterministik olarak güncellik açısından denetler."
    )
    parser.add_argument("--prompt-file", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--today", help="Yalnız test/debug için YYYY-MM-DD override")
    parser.add_argument("--json-output")
    args = parser.parse_args()

    prompt_text = Path(args.prompt_file).read_text(encoding="utf-8")
    final_text = extract_final_scripts(prompt_text)
    today = resolve_business_date(args.profile, args.today)
    findings = check_text(final_text, today)

    payload = {
        "schema_version": 1,
        "today": today.isoformat(),
        "finding_count": len(findings),
        "findings": [finding.__dict__ for finding in findings],
    }
    if args.json_output:
        Path(args.json_output).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    if findings:
        print(
            f"Temporal freshness preflight FAIL: {len(findings)} bloklayıcı bulgu. AI provider çağrısı yapılmamalı."
        )
        for finding in findings:
            print(f"- satır {finding.line}: {finding.message} | {finding.excerpt}")
        return 2

    print(f"temporal_freshness_preflight_ok today={today.isoformat()} findings=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

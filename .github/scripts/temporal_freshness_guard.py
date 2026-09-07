#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path

YEAR_RE = re.compile(r"\b(20\d{2})\b")
FRESHNESS_CUE_RE = re.compile(
    r"(?iu)\b("
    r"geliyor|yaklaşıyor|yaklasiyor|başlıyor|basliyor|başlayacak|baslayacak|"
    r"bu yıl|bu yil|bu sene|yeni dönem|yeni donem|"
    r"coming|upcoming|starts?|starting|this year"
    r")\b"
)
SEO_HEADING_RE = re.compile(r"(?iu)^\s*\*{0,2}(seo\s+başlığı|seo\s+basligi|seo\s+title)\b")
MONTH_RELATIVE_RE = re.compile(
    r"(?iu)\b("
    r"ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|"
    r"eylül|eylul|ekim|kasım|kasim|aralık|aralik|"
    r"january|february|march|april|may|june|july|august|september|october|november|december"
    r")\b.{0,40}\b("
    r"geldi|başladı|basladi|başlıyor|basliyor|bu ay|şimdi|simdi|şu an|su an|"
    r"is here|has arrived|starts?|starting|this month|now"
    r")\b"
)

MONTHS = {
    "ocak": 1, "january": 1,
    "şubat": 2, "subat": 2, "february": 2,
    "mart": 3, "march": 3,
    "nisan": 4, "april": 4,
    "mayıs": 5, "mayis": 5, "may": 5,
    "haziran": 6, "june": 6,
    "temmuz": 7, "july": 7,
    "ağustos": 8, "agustos": 8, "august": 8,
    "eylül": 9, "eylul": 9, "september": 9,
    "ekim": 10, "october": 10,
    "kasım": 11, "kasim": 11, "november": 11,
    "aralık": 12, "aralik": 12, "december": 12,
}


@dataclass(frozen=True)
class Finding:
    line: int
    kind: str
    message: str
    excerpt: str


def _compact(text: str, limit: int = 220) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _year_findings(lines: list[str], today: date) -> list[Finding]:
    findings: list[Finding] = []
    for i, line in enumerate(lines):
        years = [int(value) for value in YEAR_RE.findall(line)]
        stale = [year for year in years if year < today.year]
        if not stale:
            continue

        window = " ".join(lines[i : min(len(lines), i + 3)])
        same_line_cue = bool(FRESHNESS_CUE_RE.search(line))
        seo_near_cue = bool(SEO_HEADING_RE.search(line) and FRESHNESS_CUE_RE.search(window))
        if not (same_line_cue or seo_near_cue):
            continue

        year = max(stale)
        findings.append(
            Finding(
                line=i + 1,
                kind="stale_year_freshness_claim",
                message=(
                    f"{year} geçmiş bir yıl olmasına rağmen metin onu güncel/gelecek bir olay gibi sunuyor "
                    f"(işletme tarihi: {today.isoformat()})."
                ),
                excerpt=_compact(window if seo_near_cue else line),
            )
        )
    return findings


def _month_findings(lines: list[str], today: date) -> list[Finding]:
    findings: list[Finding] = []
    for i, line in enumerate(lines):
        match = MONTH_RELATIVE_RE.search(line)
        if not match:
            continue
        month_name = match.group(1).casefold()
        month_num = MONTHS.get(month_name)
        if month_num is None or month_num == today.month:
            continue
        findings.append(
            Finding(
                line=i + 1,
                kind="stale_relative_month_claim",
                message=(
                    f"'{match.group(1)}' güncel ay gibi sunuluyor; işletme tarihi {today.isoformat()} "
                    f"ve güncel ay {today.month}."
                ),
                excerpt=_compact(line),
            )
        )
    return findings


def check_text(text: str, today: date) -> list[Finding]:
    lines = text.splitlines()
    findings = _year_findings(lines, today)
    findings.extend(_month_findings(lines, today))
    return sorted(findings, key=lambda item: (item.line, item.kind, item.message))


def parse_today(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--today YYYY-MM-DD biçiminde olmalı") from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Obvious stale temporal claims are blocked before any real AI provider call."
    )
    parser.add_argument("--input", required=True, help="Nihai Markdown dosyası")
    parser.add_argument("--today", required=True, type=parse_today, help="İşletme yerel tarihi, YYYY-MM-DD")
    parser.add_argument("--json-output", help="İsteğe bağlı bulgu JSON dosyası")
    args = parser.parse_args(argv)

    text = Path(args.input).read_text(encoding="utf-8")
    findings = check_text(text, args.today)

    payload = {
        "schema_version": 1,
        "today": args.today.isoformat(),
        "finding_count": len(findings),
        "findings": [asdict(item) for item in findings],
    }
    if args.json_output:
        Path(args.json_output).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    if findings:
        print(
            f"Temporal freshness guard: {len(findings)} bloklayıcı bulgu bulundu; provider çağrısı yapılmayacak.",
            file=sys.stderr,
        )
        for item in findings:
            print(f"- satır {item.line}: {item.message} | {item.excerpt}", file=sys.stderr)
        return 2

    print(f"temporal_freshness_ok today={args.today.isoformat()} findings=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

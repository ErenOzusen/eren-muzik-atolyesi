#!/usr/bin/env python3
"""Extract exactly one approved scenario from a Nihai Senaryolar issue body.

Scenario bodies may contain Markdown horizontal rules (---). Those rules are
part of the scenario and must never be treated as scenario boundaries. The
only valid boundary is the next `## SENARYO N:` heading (or end of document
for the last scenario).
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

SCENARIO_HEADING_RE = re.compile(r"(?mi)^##\s+SENARYO\s+([123]):\s*(.+)$")


def extract_selected_scenario(
    text: str,
    scenario: int,
    *,
    minimum_bytes: int = 1200,
    maximum_bytes: int = 16000,
) -> dict[str, Any]:
    if scenario not in {1, 2, 3}:
        raise ValueError("scenario must be 1, 2 or 3")
    if minimum_bytes < 0 or maximum_bytes <= 0 or minimum_bytes > maximum_bytes:
        raise ValueError("invalid byte limits")

    headings = list(SCENARIO_HEADING_RE.finditer(text))
    matches = [item for item in headings if int(item.group(1)) == scenario]
    if len(matches) != 1:
        raise ValueError(
            f"Seçilen SENARYO {scenario} tam bir kez bulunmalı; bulunan: {len(matches)}"
        )

    heading = matches[0]
    later_headings = [item for item in headings if item.start() > heading.start()]
    end = later_headings[0].start() if later_headings else len(text)

    selected = text[heading.start() : end].strip()
    selected = re.sub(r"<!--.*?-->", "", selected, flags=re.DOTALL)
    selected = re.sub(r"\n{3,}", "\n\n", selected).strip() + "\n"

    size = len(selected.encode("utf-8"))
    if size < minimum_bytes or size > maximum_bytes:
        raise ValueError(
            f"Seçilen senaryo güvenli sınır dışında: {size} bayt; "
            f"minimum={minimum_bytes}; maximum={maximum_bytes}"
        )

    return {
        "scenario": scenario,
        "title": heading.group(2).strip(),
        "chars": size,
        "text": selected,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--scenario", required=True, type=int, choices=[1, 2, 3])
    parser.add_argument("--output", required=True)
    parser.add_argument("--meta", required=True)
    parser.add_argument("--minimum-bytes", type=int, default=1200)
    parser.add_argument("--maximum-bytes", type=int, default=16000)
    args = parser.parse_args()

    text = Path(args.input).read_text(encoding="utf-8")
    try:
        result = extract_selected_scenario(
            text,
            args.scenario,
            minimum_bytes=args.minimum_bytes,
            maximum_bytes=args.maximum_bytes,
        )
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    Path(args.output).write_text(result["text"], encoding="utf-8")
    Path(args.meta).write_text(
        json.dumps(
            {
                "scenario": result["scenario"],
                "title": result["title"],
                "chars": result["chars"],
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        f"Seçilen senaryo: {result['scenario']}; {result['chars']} bayt; "
        f"{result['title']}"
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build a MoneyPrinterTurbo-compatible payload from an approved script.

This adapter is deterministic and performs no network or AI calls. It prepares
safe defaults for compatibility testing and later orchestration.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def clean_script(text: str) -> str:
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not text:
        raise SystemExit("Senaryo boş olamaz.")
    return text


def build_payload(script: str, aspect: str = "9:16", local_media: list[str] | None = None) -> dict:
    materials = [
        {"provider": "local", "url": path, "duration": 0}
        for path in (local_media or [])
        if path.strip()
    ]
    return {
        "video_subject": "",
        "video_script": script,
        "video_aspect": aspect,
        "video_source": "local",
        "video_materials": materials or None,
        "voice_name": "no-voice",
        "bgm_type": "",
        "bgm_volume": 0,
        "subtitle_enabled": False,
        "video_count": 1,
        "video_concat_mode": "sequential",
        "match_materials_to_script": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--script-file", required=True)
    parser.add_argument("--output-file", required=True)
    parser.add_argument("--aspect", choices=["9:16", "16:9", "1:1"], default="9:16")
    parser.add_argument("--local-media", action="append", default=[])
    args = parser.parse_args()

    script = clean_script(Path(args.script_file).read_text(encoding="utf-8"))
    payload = build_payload(script, args.aspect, args.local_media)
    Path(args.output_file).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"MoneyPrinterTurbo payload hazır: {args.output_file}")


if __name__ == "__main__":
    main()

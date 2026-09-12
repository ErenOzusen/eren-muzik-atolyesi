#!/usr/bin/env python3
"""Build a deterministic, cost-safe faceless production manifest.

This module performs no network, AI, TTS, stock-media, or video-generation
calls. It prepares a MoneyPrinterTurbo-compatible payload and records the
separate approval/dispatch gates that must both be open before generation can
start.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from moneyprinter_payload_adapter import build_payload, clean_script

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def build_manifest(
    *,
    script: str,
    source_issue: int,
    scenario: int,
    source_body_sha: str,
    aspect: str,
    generation_dispatch_enabled: bool,
    owner_generation_approved: bool,
    test_mode: bool,
) -> dict:
    if source_issue <= 0:
        raise ValueError("source_issue pozitif olmalı")
    if scenario not in {1, 2, 3}:
        raise ValueError("scenario yalnızca 1, 2 veya 3 olabilir")
    if not SHA256_RE.fullmatch(source_body_sha):
        raise ValueError("source_body_sha geçerli bir SHA-256 olmalı")
    if aspect not in {"9:16", "16:9", "1:1"}:
        raise ValueError("desteklenmeyen aspect")

    cleaned_script = clean_script(script)
    script_sha = hashlib.sha256(cleaned_script.encode("utf-8")).hexdigest()
    moneyprinter_payload = build_payload(cleaned_script, aspect=aspect)

    dispatch_allowed = bool(
        generation_dispatch_enabled
        and owner_generation_approved
        and not test_mode
    )

    if test_mode:
        state = "test_ready_no_dispatch"
    elif not owner_generation_approved:
        state = "awaiting_owner_generation_approval"
    elif not generation_dispatch_enabled:
        state = "approved_waiting_dispatch_enable"
    else:
        state = "ready_for_generation"

    return {
        "schema_version": 1,
        "production_mode": "faceless",
        "engine": "moneyprinterturbo",
        "source_issue": source_issue,
        "selected_scenario": scenario,
        "source_body_sha": source_body_sha,
        "scenario_text_sha256": script_sha,
        "video_aspect": aspect,
        "requires_raw_video": False,
        "owner_approval_required": True,
        "owner_generation_approved": bool(owner_generation_approved),
        "generation_dispatch_enabled": bool(generation_dispatch_enabled),
        "dispatch_allowed": dispatch_allowed,
        "paid_generation_allowed": dispatch_allowed,
        "network_generation_calls_allowed": dispatch_allowed,
        "test_mode": bool(test_mode),
        "state": state,
        "approval_command": "FACELESS ÜRETİMİ ONAYLA",
        "moneyprinter_payload": moneyprinter_payload,
    }


def _parse_bool(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized == "true":
        return True
    if normalized == "false":
        return False
    raise argparse.ArgumentTypeError("boolean değer true veya false olmalı")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--script-file", required=True)
    parser.add_argument("--output-file", required=True)
    parser.add_argument("--source-issue", required=True, type=int)
    parser.add_argument("--scenario", required=True, type=int, choices=[1, 2, 3])
    parser.add_argument("--source-body-sha", required=True)
    parser.add_argument("--aspect", choices=["9:16", "16:9", "1:1"], default="9:16")
    parser.add_argument("--generation-dispatch-enabled", type=_parse_bool, default=False)
    parser.add_argument("--owner-generation-approved", type=_parse_bool, default=False)
    parser.add_argument("--test-mode", type=_parse_bool, default=True)
    args = parser.parse_args()

    script = Path(args.script_file).read_text(encoding="utf-8")
    manifest = build_manifest(
        script=script,
        source_issue=args.source_issue,
        scenario=args.scenario,
        source_body_sha=args.source_body_sha,
        aspect=args.aspect,
        generation_dispatch_enabled=args.generation_dispatch_enabled,
        owner_generation_approved=args.owner_generation_approved,
        test_mode=args.test_mode,
    )
    Path(args.output_file).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()

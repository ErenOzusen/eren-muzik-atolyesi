#!/usr/bin/env python3
"""Deterministic video production mode selector.

No network/AI calls. Produces a routing decision only. It never starts a video
engine. Paid generation must remain behind a separate owner approval gate.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

VALID_MODES = {"auto", "human", "hybrid", "faceless", "premium_ai"}


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.casefold()).strip()


def count_matches(text: str, terms: list[str]) -> list[str]:
    haystack = normalize(text)
    return [term for term in terms if normalize(term) in haystack]


def decide(text: str, config: dict, requested_mode: str = "auto") -> dict:
    if requested_mode not in VALID_MODES:
        raise ValueError(f"Geçersiz mod: {requested_mode}")

    modes = config["modes"]
    safeguards = config.get("safeguards", {})

    if requested_mode == "premium_ai" and safeguards.get("never_auto_select_premium_ai") is False:
        pass

    if requested_mode != "auto":
        chosen = requested_mode
        reason = "manual_override"
        matches = {}
    else:
        signals = config.get("signals", {})
        human = count_matches(text, signals.get("human_required", []))
        hybrid = count_matches(text, signals.get("hybrid_support", []))
        faceless = count_matches(text, signals.get("faceless_preferred", []))
        matches = {"human": human, "hybrid": hybrid, "faceless": faceless}

        if human and hybrid:
            chosen = "hybrid"
            reason = "human_required_plus_visual_support"
        elif human:
            chosen = "human"
            reason = "human_demonstration_required"
        elif faceless:
            chosen = "faceless"
            reason = "faceless_signal_detected"
        elif hybrid:
            chosen = "hybrid"
            reason = "visual_support_signal_detected"
        else:
            chosen = config.get("default_auto_mode", "human")
            reason = "safe_default"

        if chosen == "premium_ai":
            chosen = "human"
            reason = "premium_ai_forbidden_in_auto"

    mode = modes[chosen]
    return {
        "schema_version": 1,
        "requested_mode": requested_mode,
        "selected_mode": chosen,
        "engine": mode["engine"],
        "engine_status": mode["engine_status"],
        "requires_raw_video": mode["requires_raw_video"],
        "allows_ai_broll": mode["allows_ai_broll"],
        "next_stage": mode["next_stage"],
        "dispatch_enabled": bool(config.get("generation_dispatch_enabled", False)),
        "paid_generation_allowed": False,
        "reason": reason,
        "matches": matches,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--input-file", required=True)
    parser.add_argument("--output-file", required=True)
    parser.add_argument("--mode", choices=sorted(VALID_MODES), default="auto")
    args = parser.parse_args()

    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    text = Path(args.input_file).read_text(encoding="utf-8")
    decision = decide(text, config, args.mode)
    Path(args.output_file).write_text(
        json.dumps(decision, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(decision, ensure_ascii=False))


if __name__ == "__main__":
    main()

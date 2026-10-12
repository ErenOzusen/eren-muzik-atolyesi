#!/usr/bin/env python3
"""Offline handoff contract; never generates audio, renders, or publishes.

Accepts normalized scene-level alignment from a future ElevenLabs adapter.
The caller must independently measure audio duration; this module binds the
alignment to audio bytes and checks coverage, not the acoustic transcription.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

from faceless_scene_plan_contract import ScenePlanError, evaluate, normalize_text


def _seconds(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ScenePlanError(f"{label} finite number required")
    return float(value)


def evaluate_timeline(plan: dict, script_text: str, config: dict,
                      alignment: dict, audio_bytes: bytes) -> dict:
    validated = evaluate(plan, script_text, config)
    if validated["render_ready"] is not True:
        raise ScenePlanError("timeline requires reviewed render-ready scene plan")
    if not isinstance(alignment, dict) or alignment.get("schema_version") != 1:
        raise ScenePlanError("alignment schema_version 1 required")
    if alignment.get("event") != "faceless_final_tts_alignment_v2":
        raise ScenePlanError("invalid alignment event")
    if alignment.get("provider") != "elevenlabs":
        raise ScenePlanError("final alignment requires ElevenLabs")
    if alignment.get("script_sha256") != validated["script_sha256"]:
        raise ScenePlanError("alignment script mismatch")
    if not isinstance(audio_bytes, bytes) or not audio_bytes:
        raise ScenePlanError("audio bytes required")
    audio_sha = hashlib.sha256(audio_bytes).hexdigest()
    if alignment.get("audio_sha256") != audio_sha:
        raise ScenePlanError("alignment audio mismatch")
    duration = _seconds(alignment.get("duration_seconds"), "duration")
    if duration <= 0:
        raise ScenePlanError("positive audio duration required")
    segments = alignment.get("segments")
    if not isinstance(segments, list) or len(segments) != validated["scene_count"]:
        raise ScenePlanError("exactly one alignment segment per scene required")

    timeline = []
    previous_end = 0.0
    for scene, segment in zip(validated["scenes"], segments):
        if not isinstance(segment, dict) or type(segment.get("scene_id")) is not int:
            raise ScenePlanError("alignment scene_id must be integer")
        if segment["scene_id"] != scene["scene_id"]:
            raise ScenePlanError("alignment scene order mismatch")
        if not isinstance(segment.get("narration"), str) or normalize_text(segment["narration"]) != scene["narration"]:
            raise ScenePlanError("alignment narration mismatch")
        start = _seconds(segment.get("start_seconds"), "start")
        end = _seconds(segment.get("end_seconds"), "end")
        if abs(start - previous_end) > 1e-6 or end <= start or end > duration + 1e-6:
            raise ScenePlanError("alignment must cover audio contiguously without overlaps")
        timing = scene["timing"]
        if abs(start - timing["start_seconds"]) > 1e-6 or abs(end - timing["end_seconds"]) > 1e-6:
            raise ScenePlanError("scene timing differs from final audio alignment")
        timeline.append({"scene_id": scene["scene_id"], "start_seconds": start,
                         "end_seconds": end, "narration": scene["narration"],
                         "approved_asset_ids": scene["approved_asset_ids"]})
        previous_end = end
    if abs(previous_end - duration) > 1e-6:
        raise ScenePlanError("alignment must cover complete audio duration")
    return {"schema_version": 1, "event": "faceless_audio_timeline_v2_contract",
            "script_sha256": validated["script_sha256"], "audio_sha256": audio_sha,
            "duration_seconds": duration, "timing_source": "final_tts_alignment",
            "render_dispatch_allowed": False, "publication_allowed": False,
            "scenes": timeline}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("plan", "script", "config", "alignment", "audio", "output"):
        parser.add_argument(f"--{name}-file", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = evaluate_timeline(json.loads(args.plan_file.read_text()),
                                   args.script_file.read_text(encoding="utf-8"),
                                   json.loads(args.config_file.read_text()),
                                   json.loads(args.alignment_file.read_text()),
                                   args.audio_file.read_bytes())
    except (ValueError, OSError, KeyError, TypeError) as exc:
        parser.exit(1, f"timeline blocked: {exc}\n")
    args.output_file.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

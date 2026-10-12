#!/usr/bin/env python3
"""Offline conversion of saved ElevenLabs character timestamps to scene cuts.

No provider calls, audio generation, duration probing, rendering, or approval.
Duration must be measured independently from the supplied local audio bytes.
The /with-timestamps response fields are documented at:
https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
Original alignment is preferred; normalized text expansions must still match
the script exactly except for Unicode whitespace. No fuzzy matching is used.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import copy
import hashlib
import json
import math
from pathlib import Path

from faceless_scene_plan_contract import ScenePlanError, evaluate, normalize_text


def _seconds(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ScenePlanError(f"{label}: finite nonnegative seconds required")
    try:
        seconds = float(value)
    except (OverflowError, ValueError) as exc:
        raise ScenePlanError(f"{label}: finite nonnegative seconds required") from exc
    if not math.isfinite(seconds) or seconds < 0:
        raise ScenePlanError(f"{label}: finite nonnegative seconds required")
    return seconds


def _text_indices(characters):
    """Collapse/trim whitespace while retaining each original character index."""
    text, indices = [], []
    pending_space = None
    for index, character in enumerate(characters):
        if character.isspace():
            if text and pending_space is None:
                pending_space = index
            continue
        if pending_space is not None:
            text.append(" ")
            indices.append(pending_space)
            pending_space = None
        text.append(character)
        indices.append(index)
    return "".join(text), indices


def adapt_alignment(response: dict, duration_seconds: float, script_text: str,
                    plan: dict, config: dict, audio_bytes: bytes) -> dict:
    """Return {alignment, updated_plan}; pending timing always needs fresh review.

    Accept either an extracted character-alignment object or the saved JSON
    /with-timestamps response. If audio_base64 is present, it must decode to the
    exact local bytes. Original alignment is authoritative when provided;
    normalized_alignment is supported only when original alignment is null or
    absent, without silently falling back when original text is inconsistent.
    Cuts split the silence between a scene's last non-whitespace character end
    and the next scene's first non-whitespace character start at its midpoint.
    Initial/trailing silence belongs to the first/last scene respectively.
    """
    if not isinstance(script_text, str) or not script_text.strip():
        raise ScenePlanError("nonempty script text required")
    if not isinstance(plan, dict) or not isinstance(config, dict):
        raise ScenePlanError("plan and quality config objects required")
    validated = evaluate(plan, script_text, config)
    if not isinstance(audio_bytes, bytes) or not audio_bytes:
        raise ScenePlanError("nonempty local audio bytes required")
    duration = _seconds(duration_seconds, "measured audio duration")
    if duration <= 0:
        raise ScenePlanError("positive measured audio duration required")
    if not isinstance(response, dict):
        raise ScenePlanError("saved alignment response object required")
    if "audio_base64" in response:
        try:
            encoded = response["audio_base64"]
            if not isinstance(encoded, str):
                raise ValueError("audio_base64 must be string")
            decoded = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ScenePlanError("invalid response audio_base64") from exc
        if decoded != audio_bytes:
            raise ScenePlanError("saved response audio differs from local audio")

    if "characters" in response:
        character_alignment = response
    elif response.get("alignment") is not None:
        character_alignment = response["alignment"]
    else:
        character_alignment = response.get("normalized_alignment")
    if not isinstance(character_alignment, dict):
        raise ScenePlanError("character alignment object required")
    characters = character_alignment.get("characters")
    starts = character_alignment.get("character_start_times_seconds")
    ends = character_alignment.get("character_end_times_seconds")
    if (not isinstance(characters, list) or not characters
            or any(not isinstance(item, str) or len(item) != 1 for item in characters)
            or not isinstance(starts, list) or not isinstance(ends, list)
            or len(starts) != len(characters) or len(ends) != len(characters)):
        raise ScenePlanError("equal nonempty character/start/end arrays required")
    previous_start = previous_end = 0.0
    for index, (start, end) in enumerate(zip(starts, ends)):
        start = _seconds(start, f"character {index} start")
        end = _seconds(end, f"character {index} end")
        if (end < start or start < previous_start or end < previous_end
                or start < previous_end or end > duration):
            raise ScenePlanError("character timing must be ordered within measured audio")
        previous_start, previous_end = start, end

    text, indices = _text_indices(characters)
    if text != normalize_text(script_text):
        raise ScenePlanError("aligned characters do not exactly match script")
    spans = []
    offset = 0
    for scene in validated["scenes"]:
        # Existing scene contract coerces some narration inputs; this boundary
        # deliberately requires actual text and actual integer identifiers.
        raw_scene = plan["scenes"][scene["scene_id"] - 1]
        if (not isinstance(raw_scene.get("narration"), str)
                or type(raw_scene.get("scene_id")) is not int):
            raise ScenePlanError("scene narration text and integer scene_id required")
        narration = scene["narration"]
        if text[offset:offset + len(narration)] != narration:
            raise ScenePlanError("scene narration does not match characters in order")
        spans.append((indices[offset], indices[offset + len(narration) - 1]))
        offset += len(narration)
        if scene["scene_id"] < len(validated["scenes"]):
            if text[offset:offset + 1] != " ":
                raise ScenePlanError("scene separator whitespace required")
            offset += 1
    if offset != len(text):
        raise ScenePlanError("scene narration must consume entire alignment")

    cuts = [0.0]
    for previous, following in zip(spans, spans[1:]):
        cuts.append((float(ends[previous[1]]) + float(starts[following[0]])) / 2)
    cuts.append(duration)
    segments = []
    for scene, start, end in zip(validated["scenes"], cuts, cuts[1:]):
        if end <= start:
            raise ScenePlanError("each aligned scene must have positive duration")
        segments.append({"scene_id": scene["scene_id"], "narration": scene["narration"],
                         "start_seconds": start, "end_seconds": end})
    alignment = {"schema_version": 1, "event": "faceless_final_tts_alignment_v2",
                 "provider": "elevenlabs", "script_sha256": validated["script_sha256"],
                 "audio_sha256": hashlib.sha256(audio_bytes).hexdigest(),
                 "duration_seconds": duration, "segments": segments}
    updated = copy.deepcopy(plan)
    updated.pop("owner_editorial_approval", None)
    updated["render_ready"] = False
    updated["timing_source"] = "pending_final_tts"
    # Keep the draft contract valid and expose proposed timing separately.
    updated["pending_final_tts_alignment"] = copy.deepcopy(alignment)
    for scene in updated["scenes"]:
        scene["timing"] = None
    evaluate(updated, script_text, config)
    return {"alignment": alignment, "updated_plan": updated}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("response", "script", "plan", "config", "audio", "output"):
        parser.add_argument(f"--{name}-file", required=True, type=Path)
    parser.add_argument("--duration-seconds", required=True, type=float,
                        help="independently measured duration of --audio-file")
    args = parser.parse_args()
    try:
        result = adapt_alignment(json.loads(args.response_file.read_text(encoding="utf-8")),
                                 args.duration_seconds,
                                 args.script_file.read_text(encoding="utf-8"),
                                 json.loads(args.plan_file.read_text(encoding="utf-8")),
                                 json.loads(args.config_file.read_text(encoding="utf-8")),
                                 args.audio_file.read_bytes())
    except (ValueError, OSError, KeyError, TypeError, OverflowError) as exc:
        parser.exit(1, f"alignment blocked: {exc}\n")
    args.output_file.write_text(json.dumps(result, ensure_ascii=False, indent=2,
                                           allow_nan=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

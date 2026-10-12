#!/usr/bin/env python3
"""Prepare local FFmpeg arguments and synced captions from reviewed inputs.

Only reads local files and probes metadata. Never renders, generates speech,
downloads footage, or publishes. Actual clip review and owner authentication
must happen outside this module before supplied approval evidence is trusted.
"""
from __future__ import annotations

import hashlib
import json
import math
import subprocess
from pathlib import Path

from faceless_audio_timeline_contract import evaluate_timeline
from faceless_scene_plan_contract import ScenePlanError


def probe_media(path: Path) -> dict:
    completed = subprocess.run(["ffprobe", "-v", "error", "-show_format", "-show_streams",
                                "-of", "json", str(path)], capture_output=True, text=True,
                               check=True, timeout=30)
    return json.loads(completed.stdout)


def _duration(metadata: dict) -> float:
    try:
        seconds = float(metadata["format"]["duration"])
    except (ValueError, TypeError, KeyError) as exc:
        raise ScenePlanError("measured media duration missing") from exc
    if not math.isfinite(seconds) or seconds <= 0:
        raise ScenePlanError("measured duration must be finite and positive")
    return seconds


def _local_file(value) -> Path:
    if not isinstance(value, str) or not value.strip() or "://" in value:
        raise ScenePlanError("existing local media path required")
    path = Path(value).resolve()
    if not path.is_file():
        raise ScenePlanError("local media file missing")
    return path


def _timestamp(seconds: float) -> str:
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3600000)
    minutes, milliseconds = divmod(milliseconds, 60000)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}"


def prepare_render(plan: dict, script_text: str, config: dict, alignment: dict,
                   audio_path: str, bindings: list[dict]) -> dict:
    audio = _local_file(audio_path)
    timeline = evaluate_timeline(plan, script_text, config, alignment, audio.read_bytes())
    audio_metadata = probe_media(audio)
    if not any(stream.get("codec_type") == "audio" for stream in audio_metadata.get("streams", [])):
        raise ScenePlanError("final narration requires an audio stream")
    if abs(_duration(audio_metadata) - timeline["duration_seconds"]) > 0.05:
        raise ScenePlanError("alignment differs from measured audio duration")
    scenes = timeline["scenes"]
    if not isinstance(bindings, list) or len(bindings) != len(scenes):
        raise ScenePlanError("one explicit local clip selection per scene required")

    arguments = ["ffmpeg", "-n", "-filter_complex_threads", "1"]
    filters = []
    captions = []
    selected = []
    for index, (scene, binding) in enumerate(zip(scenes, bindings)):
        if (not isinstance(binding, dict) or type(binding.get("scene_id")) is not int
                or binding["scene_id"] != scene["scene_id"]
                or binding.get("asset_id") not in scene["approved_asset_ids"]):
            raise ScenePlanError("clip selection must match scene and reviewed asset")
        clip = _local_file(binding.get("path"))
        digest = hashlib.sha256(clip.read_bytes()).hexdigest()
        if binding.get("sha256") != digest:
            raise ScenePlanError("local clip differs from selected file fingerprint")
        reviews = plan["scenes"][index].get("semantic_qc", [])
        review = next((r for r in reviews if r.get("asset_id") == binding["asset_id"]), None)
        if not review or review.get("asset_sha256") != digest:
            raise ScenePlanError("actual clip bytes must match fingerprint-bound visual review")
        metadata = probe_media(clip)
        video = next((s for s in metadata.get("streams", []) if s.get("codec_type") == "video"), None)
        if not video or not video.get("width") or not video.get("height"):
            raise ScenePlanError("selected clip requires a valid video stream")
        start = binding.get("trim_start_seconds", 0.0)
        if isinstance(start, bool) or not isinstance(start, (int, float)) or not math.isfinite(start) or start < 0:
            raise ScenePlanError("clip trim start must be finite and nonnegative")
        duration = scene["end_seconds"] - scene["start_seconds"]
        if start + duration > _duration(metadata) + 1e-6:
            raise ScenePlanError("selected clip too short; looping or replacement forbidden")
        arguments.extend(["-i", str(clip)])
        filters.append(f"[{index}:v]trim=start={start:.6f}:duration={duration:.6f},"
                       f"setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=decrease,"
                       f"pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v{index}]")
        captions.append(f"{index + 1}\n{_timestamp(scene['start_seconds'])} --> "
                        f"{_timestamp(scene['end_seconds'])}\n{scene['narration']}\n")
        selected.append({"scene_id": scene["scene_id"], "asset_id": binding["asset_id"],
                         "path": str(clip), "sha256": digest})
    arguments.extend(["-i", str(audio)])
    filters.append("".join(f"[v{i}]" for i in range(len(scenes))) +
                   f"concat=n={len(scenes)}:v=1:a=0[joined]")
    filters.append("[joined]subtitles=final-captions.srt:force_style='FontName=DejaVu Sans,FontSize=18,MarginV=30'[outv]")
    arguments.extend(["-filter_complex", ";".join(filters), "-map", "[outv]", "-map",
                      f"{len(scenes)}:a:0", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                      "-threads", "2", "-c:a", "aac", "-b:a", "192k", "-t", f"{timeline['duration_seconds']:.6f}",
                      "-movflags", "+faststart", "final-video.mp4"])
    return {"schema_version": 1, "event": "faceless_reviewed_local_render_plan_v2",
            "script_sha256": timeline["script_sha256"], "audio_sha256": timeline["audio_sha256"],
            "duration_seconds": timeline["duration_seconds"], "selected_clips": selected,
            "ffmpeg_arguments": arguments, "subtitle_filename": "final-captions.srt",
            "subtitle_text": "\n".join(captions), "output_filename": "final-video.mp4",
            "publication_allowed": False, "live_worker_wired": False}

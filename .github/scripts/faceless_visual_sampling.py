#!/usr/bin/env python3
"""Produce immutable, offline frame evidence for candidate Pexels clips.

This is a staging adapter, NOT image understanding or editorial approval.
No searching, API calls, AI, TTS, spending, rendering or publication.
A future vision reviewer must examine the actual sampled frames. The owner
and existing hash-bound approval gates must still validate chosen assets.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from faceless_scene_plan_contract import evaluate, ScenePlanError

MAX_CANDIDATES = 16
MAX_PER_SCENE = 3
MAX_BYTES = 150 * 1024 * 1024
FRAME_FRACTIONS = (0.1, 0.5, 0.9)


class SamplingError(ValueError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def require_local_video(value: object) -> Path:
    if not isinstance(value, str) or not value.strip() or "://" in value:
        raise SamplingError("local file path required (no URLs)")
    raw = Path(value)
    if raw.is_symlink() or not raw.is_file():
        raise SamplingError("regular existing video file required; symlinks rejected")
    path = raw.resolve(strict=True)
    if not 1024 <= path.stat().st_size <= MAX_BYTES:
        raise SamplingError("candidate media size out of bounds")
    return path


def require_source_page(value: object, asset_id: str) -> str:
    if not isinstance(value, str):
        raise SamplingError("Pexels source page required")
    url = urlsplit(value)
    if (url.scheme != "https" or url.netloc != "www.pexels.com"
            or url.query or url.fragment or url.username or url.password
            or not re.fullmatch(rf"/video/(?:[^/]*-)?{re.escape(asset_id)}/?", url.path)):
        raise SamplingError("source page must identify the exact Pexels clip")
    return value


def probe_video(path: Path) -> dict:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
            capture_output=True, text=True, timeout=30, check=True,
        )
        metadata = json.loads(result.stdout)
        videos = [s for s in metadata.get("streams", []) if s.get("codec_type") == "video"]
        seconds = float(metadata["format"]["duration"])
        if (len(videos) != 1 or videos[0].get("width") != 1080
                or videos[0].get("height") != 1920
                or not math.isfinite(seconds) or seconds < 5 or seconds > 120):
            raise SamplingError("1080x1920 single-stream clip of 5-120 seconds required")
        return {"duration_seconds": seconds, "width": 1080, "height": 1920}
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError, OSError, ValueError, KeyError, TypeError) as exc:
        if isinstance(exc, SamplingError):
            raise
        raise SamplingError("cannot inspect local video with ffprobe") from exc


def extract_frame(video: Path, seconds: float, destination: Path) -> None:
    try:
        subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-ss", f"{seconds:.6f}",
             "-i", str(video), "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=360:640",
             "-y", str(destination)], capture_output=True, text=True, timeout=35, check=True,
        )
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError, OSError) as exc:
        raise SamplingError("unable to extract candidate frame") from exc
    if not destination.is_file() or destination.stat().st_size < 100:
        raise SamplingError("extracted frame missing or empty")


def validate_candidates(candidates: object, scenes: list[dict]) -> list[dict]:
    if not isinstance(candidates, list) or not 1 <= len(candidates) <= MAX_CANDIDATES:
        raise SamplingError("candidate list must contain 1-16 assets")
    scene_ids = {scene["scene_id"] for scene in scenes}
    seen, counts, result = set(), {}, []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            raise SamplingError("candidate must be a JSON object")
        scene_id, asset_id = candidate.get("scene_id"), candidate.get("asset_id")
        if type(scene_id) is not int or scene_id not in scene_ids:
            raise SamplingError("scene ID not in the selected plan")
        if not isinstance(asset_id, str) or not re.fullmatch(r"[1-9][0-9]*", asset_id):
            raise SamplingError("numeric string Pexels asset ID required")
        if asset_id in seen:
            raise SamplingError("reused/duplicate asset ID rejected across scenes")
        seen.add(asset_id)
        counts[scene_id] = counts.get(scene_id, 0) + 1
        if counts[scene_id] > MAX_PER_SCENE:
            raise SamplingError("too many candidate assets for a scene")
        result.append({"scene_id": scene_id, "asset_id": asset_id,
                       "path": require_local_video(candidate.get("path")),
                       "source_page": require_source_page(candidate.get("source_page"), asset_id)})
    return sorted(result, key=lambda entry: (entry["scene_id"], int(entry["asset_id"])))


def collect(plan: dict, script_text: str, quality_config: dict,
            candidates: object, output_dir: Path) -> dict:
    """Write sampled frames and an explicitly UNREVIEWED manifest atomically."""
    if plan.get("render_ready") is not False:
        raise SamplingError("only draft scene plans can be sampled")
    validated = evaluate(plan, script_text, quality_config)
    selections = validate_candidates(candidates, validated["scenes"])
    output_dir = Path(output_dir)
    if output_dir.exists():
        raise SamplingError("output already exists; refuses overwrite")
    if not output_dir.parent.is_dir():
        raise SamplingError("output parent directory must exist")
    staging = Path(tempfile.mkdtemp(prefix=".visual-sampling-", dir=output_dir.parent))
    try:
        rows = []
        for selection in selections:
            inspected = probe_video(selection["path"])
            digest = sha256_file(selection["path"])
            frames = []
            for index, fraction in enumerate(FRAME_FRACTIONS, start=1):
                relative = f"frames/s{selection['scene_id']}-a{selection['asset_id']}-f{index}.png"
                destination = staging / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                offset = inspected["duration_seconds"] * fraction
                extract_frame(selection["path"], offset, destination)
                frames.append({"time_seconds": round(offset, 6), "path": relative,
                               "sha256": sha256_file(destination)})
            if sha256_file(selection["path"]) != digest:
                raise SamplingError("source video changed during frame extraction")
            rows.append({"scene_id": selection["scene_id"], "asset_id": selection["asset_id"],
                         "source_page": selection["source_page"],
                         "video_sha256": digest, **inspected, "frames": frames,
                         "visual_review_status": "NOT_REVIEWED",
                         "semantic_qc_approved": False})
        missing = sorted({s["scene_id"] for s in validated["scenes"]} - {r["scene_id"] for r in rows})
        output = {"schema_version": 1, "event": "faceless_visual_sampling_v1",
                  "source_issue": plan.get("source_issue"),
                  "script_sha256": validated["script_sha256"],
                  "scene_count": validated["scene_count"], "candidates": rows,
                  "missing_candidate_scenes": missing,
                  "frame_evidence_is_semantic_review": False,
                  "editorial_approved": False, "render_ready": False,
                  "paid_calls": 0, "network_calls": 0, "publication_allowed": False}
        (staging / "candidate_frames_manifest.json").write_text(
            json.dumps(output, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
        if output_dir.exists():
            raise SamplingError("output destination appeared during sampling")
        os.rename(staging, output_dir)
        return output
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("plan", "script", "config", "candidates", "output_dir"):
        parser.add_argument("--" + name.replace("_", "-"), required=True, type=Path)
    args = parser.parse_args()
    try:
        collect(json.loads(args.plan.read_text(encoding="utf-8")),
                args.script.read_text(encoding="utf-8").strip(),
                json.loads(args.config.read_text(encoding="utf-8")),
                json.loads(args.candidates.read_text(encoding="utf-8")), args.output_dir)
    except (SamplingError, ScenePlanError, OSError, ValueError) as exc:
        parser.exit(1, f"visual sampling blocked: {exc}\n")
    print(f"visual evidence collected at {args.output_dir}; NOT visually approved")


if __name__ == "__main__":
    main()
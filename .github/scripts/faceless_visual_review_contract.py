#!/usr/bin/env python3
"""Offline, hash-bound preparation and checking of external vision-review proposals.

DOES NOT inspect pixels, call a model, authenticate reviewers, approve clips,
produce a video, or publish. A structurally valid vision claim is not proof
that a clip visually matches the scene. Motion and owner review stay mandatory.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from pathlib import Path, PurePosixPath

from faceless_scene_plan_contract import evaluate, ScenePlanError

SHA_RE = re.compile(r"[a-f0-9]{64}\Z")
ID_RE = re.compile(r"[1-9][0-9]*\Z")
MAX_CANDIDATES = 16
MAX_FRAMES = 3
MAX_FRAME_BYTES = 5 * 1024 * 1024


class VisionContractError(ValueError):
    pass


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canonical_hash(data: dict) -> str:
    return _sha(json.dumps(data, ensure_ascii=False, sort_keys=True,
                           separators=(",", ":"), allow_nan=False).encode("utf-8"))


def _exact(keys: object, expected: set[str], label: str) -> None:
    if not isinstance(keys, dict) or set(keys) != expected:
        raise VisionContractError(f"{label}: unexpected or missing fields")


def _safe_frame(root: Path, name: object) -> Path:
    if not isinstance(name, str) or len(name) > 200 or "\\" in name:
        raise VisionContractError("invalid frame path")
    path = PurePosixPath(name)
    if path.is_absolute() or len(path.parts) != 2 or path.parts[0] != "frames" or any(
        part in ("", ".", "..") for part in path.parts
    ) or not re.fullmatch(r"s[1-9][0-9]*-a[1-9][0-9]*-f[123]\.png", path.name):
        raise VisionContractError("untrusted frame path")
    actual = root / name
    if actual.is_symlink() or not actual.is_file() or actual.resolve().parent != (root / "frames").resolve():
        raise VisionContractError("frame missing or symlinked")
    if not 100 <= actual.stat().st_size <= MAX_FRAME_BYTES:
        raise VisionContractError("frame size invalid")
    with actual.open("rb") as image_file:
        signature = image_file.read(8)
    if signature != b"\x89PNG\r\n\x1a\n":
        raise VisionContractError("frame is not a PNG")
    return actual


def review_packets(plan: dict, script: str, config: dict, manifest: dict,
                   frame_root: Path) -> dict:
    """Verify frame bytes and build model-agnostic, non-approved review requests."""
    validated = evaluate(plan, script, config)
    if validated["render_ready"] or plan.get("render_ready") is not False:
        raise VisionContractError("only unapproved draft plans can be reviewed")
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 1 or \
       manifest.get("event") != "faceless_visual_sampling_v1" or \
       manifest.get("script_sha256") != validated["script_sha256"] or \
       manifest.get("scene_count") != validated["scene_count"] or \
       manifest.get("source_issue") != plan.get("source_issue") or \
       manifest.get("frame_evidence_is_semantic_review") is not False or \
       manifest.get("editorial_approved") is not False or \
       manifest.get("render_ready") is not False or \
       manifest.get("publication_allowed") is not False or \
       manifest.get("paid_calls") != 0 or manifest.get("network_calls") != 0:
        raise VisionContractError("untrusted or inconsistent sampling manifest")
    candidates = manifest.get("candidates")
    if not isinstance(candidates, list) or not 1 <= len(candidates) <= MAX_CANDIDATES:
        raise VisionContractError("candidate count must be 1-16")
    root = Path(frame_root).resolve()
    if not root.is_dir():
        raise VisionContractError("frames root missing")
    packet_rows, seen, seen_frames = [], set(), set()
    scene_by_id = {s["scene_id"]: s for s in validated["scenes"]}
    for candidate in candidates:
        if not isinstance(candidate, dict) or candidate.get("visual_review_status") != "NOT_REVIEWED" or \
           candidate.get("semantic_qc_approved") is not False:
            raise VisionContractError("sampling cannot claim prior semantic approval")
        sid, aid = candidate.get("scene_id"), candidate.get("asset_id")
        if type(sid) is not int or sid not in scene_by_id or not isinstance(aid, str) or \
           not ID_RE.fullmatch(aid) or aid in seen:
            raise VisionContractError("invalid/duplicate asset or scene")
        seen.add(aid)
        h = candidate.get("video_sha256")
        if not isinstance(h, str) or not SHA_RE.fullmatch(h):
            raise VisionContractError("invalid video fingerprint")
        duration = candidate.get("duration_seconds")
        if (candidate.get("width") != 1080 or candidate.get("height") != 1920
                or type(duration) not in (float, int) or not math.isfinite(duration)
                or not 5 <= duration <= 120):
            raise VisionContractError("untrusted candidate media properties")
        frames = candidate.get("frames")
        if not isinstance(frames, list) or len(frames) != MAX_FRAMES:
            raise VisionContractError("exactly 3 sampled frames required")
        checks = []
        previous_t = -1.0
        for number, frame in enumerate(frames, start=1):
            if not isinstance(frame, dict):
                raise VisionContractError("invalid frame record")
            expected_name = f"frames/s{sid}-a{aid}-f{number}.png"
            if frame.get("path") != expected_name or expected_name in seen_frames:
                raise VisionContractError("frame does not match candidate")
            seen_frames.add(expected_name)
            t, digest = frame.get("time_seconds"), frame.get("sha256")
            if type(t) not in (float, int) or not math.isfinite(t) or t <= previous_t or \
               t <= 0 or t >= duration or \
               not isinstance(digest, str) or not SHA_RE.fullmatch(digest):
                raise VisionContractError("bad frame timing or fingerprint")
            previous_t = t
            p = _safe_frame(root, expected_name)
            if _sha(p.read_bytes()) != digest:
                raise VisionContractError("frame bytes changed since sampling")
            checks.append({"path": expected_name, "sha256": digest, "time_seconds": t})
        scene = scene_by_id[sid]
        packet_rows.append({
            "scene_id": sid, "asset_id": aid, "video_sha256": h,
            "narration": scene["narration"], "must_show": scene["must_show"],
            "must_not_show": scene["must_not_show"], "frames": checks,
            "instruction": "Describe only observable facts. If an ACTION cannot be proven by still frames, mark it uncertain. Never infer motion or correctness from a single guitar image.",
        })
    missing = sorted(set(scene_by_id) - {r["scene_id"] for r in packet_rows})
    if manifest.get("missing_candidate_scenes") != missing:
        raise VisionContractError("manifest scene-coverage mismatch")
    packets = []
    for row in packet_rows:
        packets.append({**row, "review_request_sha256": _canonical_hash(row)})
    return {"schema_version": 1, "event": "faceless_vision_review_requests_v1",
            "script_sha256": validated["script_sha256"], "packets": packets,
            "missing_candidate_scenes": missing, "source_manifest_sha256": _canonical_hash(manifest),
            "all_scenes_have_candidates": not missing, "review_calls_attempted": 0,
            "semantic_qc_approved": False, "render_ready": False,
            "publication_allowed": False}


def check_vision_claims(requests: dict, reviews: object, *, min_score: float = 0.85) -> dict:
    """Check submitted vision claims against *exact* sampled-frame request hashes.

    Note: an LLM could still hallucinate visual facts. A passing claim is a
    shortlist suggestion ONLY, never independent visual proof or owner approval.
    """
    if not isinstance(requests, dict) or requests.get("event") != "faceless_vision_review_requests_v1" or \
       requests.get("semantic_qc_approved") is not False or \
       requests.get("publication_allowed") is not False or requests.get("render_ready") is not False:
        raise VisionContractError("review request not safe to consume")
    if type(min_score) not in (int, float) or not math.isfinite(min_score) or not 0 < min_score <= 1:
        raise VisionContractError("invalid score threshold")
    packets = requests.get("packets")
    if not isinstance(packets, list) or not packets:
        raise VisionContractError("no reviewed assets")
    expected = {(p["scene_id"], p["asset_id"]): p for p in packets}
    if len(expected) != len(packets) or not isinstance(reviews, list) or len(reviews) != len(packets):
        raise VisionContractError("missing/duplicate review responses")
    rows, seen = [], set()
    for review in reviews:
        _exact(review, {"scene_id", "asset_id", "review_request_sha256", "reviewer_model",
                        "score", "must_show_evidence", "must_not_show_status", "motion_verified"}, "vision review")
        key = (review["scene_id"], review["asset_id"])
        if key not in expected or key in seen:
            raise VisionContractError("stale, duplicate or unknown vision review")
        seen.add(key)
        p = expected[key]
        if review["review_request_sha256"] != p["review_request_sha256"] or \
           not isinstance(review["reviewer_model"], str) or not 2 <= len(review["reviewer_model"].strip()) <= 100:
            raise VisionContractError("unbound response or reviewer identity")
        score = review["score"]
        if type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 1:
            raise VisionContractError("invalid vision score")
        show = review["must_show_evidence"]
        not_show = review["must_not_show_status"]
        if not isinstance(show, dict) or set(show) != set(p["must_show"]) or \
           not isinstance(not_show, dict) or set(not_show) != set(p["must_not_show"]):
            raise VisionContractError("missing expected visible or forbidden elements")
        available_frames = {f["sha256"] for f in p["frames"]}
        clearly_observed = True
        for requirement, evidence in show.items():
            _exact(evidence, {"status", "frame_sha256", "observation"}, "must_show_evidence")
            if evidence["status"] not in ("observed", "uncertain", "absent"):
                raise VisionContractError("invalid visual evidence status")
            if not isinstance(evidence["frame_sha256"], list) or len(evidence["frame_sha256"]) > 3 or \
               len(set(evidence["frame_sha256"])) != len(evidence["frame_sha256"]) or \
               any(h not in available_frames for h in evidence["frame_sha256"]):
                raise VisionContractError("evidence must cite the sampled frames")
            if not isinstance(evidence["observation"], str) or len(evidence["observation"].strip()) > 300:
                raise VisionContractError("observation text invalid")
            if evidence["status"] == "observed":
                if not evidence["frame_sha256"] or len(evidence["observation"].strip()) < 8:
                    raise VisionContractError("observed element lacks anchored description")
            else:
                clearly_observed = False
        for requirement, status in not_show.items():
            if status not in ("absent_in_samples", "present", "uncertain"):
                raise VisionContractError("invalid forbidden-object assessment")
            if status != "absent_in_samples":
                clearly_observed = False
        if review["motion_verified"] is not False:
            # Three STILL frames cannot verify movement, technique or continuity.
            raise VisionContractError("sample frames cannot prove temporal motion")
        status = "PRELIMINARY_MATCH_REQUIRES_MOTION_AND_OWNER" if clearly_observed and score >= min_score else "REJECTED_OR_UNCERTAIN"
        rows.append({"scene_id": key[0], "asset_id": key[1], "status": status,
                     "reported_score": score, "video_sha256": p["video_sha256"],
                     "review_request_sha256": p["review_request_sha256"]})
    rows.sort(key=lambda x: (x["scene_id"], int(x["asset_id"])))
    return {"schema_version": 1, "event": "faceless_vision_candidate_screening_v1",
            "candidates": rows, "preliminary_count": sum(r["status"].startswith("PRELIMINARY") for r in rows),
            "requires_temporal_video_review": True, "requires_owner_editorial_review": True,
            "semantic_qc_approved": False, "render_ready": False,
            "publication_allowed": False, "provider_calls_attempted": 0}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("plan", "script", "config", "manifest", "frames_root", "output"):
        parser.add_argument("--" + field.replace("_", "-"), type=Path, required=True)
    parser.add_argument("--reviews", type=Path, default=None)
    args = parser.parse_args()
    try:
        request = review_packets(json.loads(args.plan.read_text(encoding="utf-8")),
                                 args.script.read_text(encoding="utf-8").strip(),
                                 json.loads(args.config.read_text(encoding="utf-8")),
                                 json.loads(args.manifest.read_text(encoding="utf-8")),
                                 args.frames_root)
        output = {"review_requests": request}
        if args.reviews is not None:
            output["screening"] = check_vision_claims(
                request, json.loads(args.reviews.read_text(encoding="utf-8")),
                min_score=float(json.loads(args.config.read_text(encoding="utf-8"))["scene_planner"]["min_semantic_score"]))
        if args.output.exists():
            raise VisionContractError("output already exists")
        args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except (ValueError, ScenePlanError, OSError, json.JSONDecodeError) as exc:
        parser.exit(1, f"offline vision review blocked: {exc}\n")
    print("Offline review packet prepared. NOT visually verified or approved.")


if __name__ == "__main__":
    main()
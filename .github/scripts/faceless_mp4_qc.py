#!/usr/bin/env python3
import hashlib
import json
import subprocess
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit("usage: faceless_mp4_qc.py <artifact-dir>")

root = Path(sys.argv[1]).resolve()
video = root / "video.mp4"
result_file = root / "worker-result.json"
manifest_file = root / "faceless-manifest.json"

for path in (video, result_file, manifest_file):
    if not path.is_file() or path.stat().st_size == 0:
        raise SystemExit(f"missing or empty required file: {path.name}")

worker = json.loads(result_file.read_text(encoding="utf-8"))
manifest = json.loads(manifest_file.read_text(encoding="utf-8"))

required_worker = {
    "test_mode": True,
    "status": "mp4_ready_for_qc",
    "cost_usd": 0,
    "network_generation_calls_allowed": False,
    "youtube_publication_attempted": False,
}
for key, expected in required_worker.items():
    if worker.get(key) != expected:
        raise SystemExit(f"worker contract failed: {key}={worker.get(key)!r}")

if manifest.get("test_mode") is not True:
    raise SystemExit("manifest must remain test_mode=true")
if manifest.get("dispatch_allowed") is not False:
    raise SystemExit("manifest dispatch_allowed must remain false")
if manifest.get("paid_generation_allowed") is not False:
    raise SystemExit("manifest paid_generation_allowed must remain false")
if manifest.get("network_generation_calls_allowed") is not False:
    raise SystemExit("manifest network generation must remain false")

actual_sha = hashlib.sha256(video.read_bytes()).hexdigest()
if worker.get("video_sha256") != actual_sha:
    raise SystemExit("video SHA-256 does not match worker-result.json")

probe = subprocess.run(
    [
        "ffprobe", "-v", "error",
        "-show_entries",
        "format=duration:stream=index,codec_type,codec_name,width,height,pix_fmt",
        "-of", "json",
        str(video),
    ],
    check=True,
    capture_output=True,
    text=True,
)
meta = json.loads(probe.stdout)
streams = meta.get("streams") or []
videos = [s for s in streams if s.get("codec_type") == "video"]
if len(videos) != 1:
    raise SystemExit(f"expected exactly one video stream, got {len(videos)}")

v = videos[0]
duration = float((meta.get("format") or {}).get("duration") or 0)
if not (2.0 <= duration <= 120.0):
    raise SystemExit(f"duration outside test QC bounds: {duration}")
if v.get("codec_name") not in {"h264", "hevc"}:
    raise SystemExit(f"unexpected video codec: {v.get('codec_name')}")
if (v.get("width"), v.get("height")) != (720, 1280):
    raise SystemExit(f"unexpected dimensions: {v.get('width')}x{v.get('height')}")
if v.get("pix_fmt") not in {"yuv420p", "yuvj420p"}:
    raise SystemExit(f"unexpected pixel format: {v.get('pix_fmt')}")

qc = {
    "schema_version": 1,
    "event": "faceless_zero_cost_qc_test",
    "test_mode": True,
    "status": "qc_passed",
    "video_sha256": actual_sha,
    "duration_seconds": duration,
    "video_codec": v.get("codec_name"),
    "width": v.get("width"),
    "height": v.get("height"),
    "pixel_format": v.get("pix_fmt"),
    "cost_usd": 0,
    "network_generation_calls_allowed": False,
    "youtube_publication_attempted": False,
}
(root / "qc-result.json").write_text(
    json.dumps(qc, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print(json.dumps(qc, ensure_ascii=False))

#!/usr/bin/env python3
"""QC for artifact-only Pexels + Edge faceless pilot output."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path


class QCError(ValueError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def evaluate(
    worker_result: dict,
    probe: dict,
    subtitle_text: str,
    source_manifest: dict,
    actual_video_sha: str,
) -> dict:
    if worker_result.get("status") != "mp4_ready_for_qc":
        raise QCError("worker status mp4_ready_for_qc olmalı")
    if float(worker_result.get("cost_usd", -1)) != 0.0:
        raise QCError("cost_usd 0 olmalı")
    if worker_result.get("youtube_publication_attempted") is not False:
        raise QCError("YouTube publication denenmemeli")
    if worker_result.get("paid_generation_allowed") is not False:
        raise QCError("paid generation kapalı olmalı")
    if worker_result.get("network_scope") != ["pexels_stock_media", "edge_tts"]:
        raise QCError("network_scope yalnız Pexels ve Edge olmalı")
    if worker_result.get("video_sha256") != actual_video_sha:
        raise QCError("video SHA-256 uyuşmuyor")

    streams = probe.get("streams", [])
    videos = [stream for stream in streams if stream.get("codec_type") == "video"]
    audios = [stream for stream in streams if stream.get("codec_type") == "audio"]
    if len(videos) != 1 or not audios:
        raise QCError("tek video ve en az bir audio stream zorunlu")
    if videos[0].get("width") != 1080 or videos[0].get("height") != 1920:
        raise QCError("video 1080x1920 olmalı")
    duration = float(probe.get("format", {}).get("duration", 0))
    if not 2.0 <= duration <= 120.0:
        raise QCError("video süresi 2-120 saniye arasında olmalı")
    if not subtitle_text.strip() or "-->" not in subtitle_text:
        raise QCError("geçerli ve boş olmayan SRT zorunlu")

    sources = source_manifest.get("material_sources")
    if not isinstance(sources, list) or not sources:
        raise QCError("Pexels kaynak kayıtları zorunlu")
    approved = worker_result.get("approved_asset_ids")
    if not isinstance(approved, list) or not 6 <= len(approved) <= 8:
        raise QCError("6-8 onaylı Pexels ID'si zorunlu")
    if len(set(approved)) != len(approved) or any(
        not isinstance(item, str) or not re.fullmatch(r"[1-9][0-9]*", item)
        for item in approved
    ):
        raise QCError("Onaylı Pexels ID listesi geçersiz")
    if [str(source.get("asset_id", "")) for source in sources] != approved:
        raise QCError("Kaynaklar onaylı Pexels ID listesiyle uyuşmuyor")
    if not re.fullmatch(r"[0-9a-f]{64}", str(worker_result.get("media_approval_sha256", ""))):
        raise QCError("Media onay SHA-256 eksik")
    for source in sources:
        if not isinstance(source, dict) or source.get("provider") != "pexels":
            raise QCError("yalnız Pexels kaynak kaydı kabul edilir")
        for key in ("asset_id", "source_page", "local_file"):
            if not str(source.get(key, "")).strip():
                raise QCError(f"Pexels kaynak kaydında {key} zorunlu")

    return {
        "schema_version": 1,
        "status": "technical_qc_passed",
        "editorial_review_required": True,
        "width": 1080,
        "height": 1920,
        "duration_seconds": duration,
        "audio_streams": len(audios),
        "subtitle_validated": True,
        "pexels_sources_validated": len(sources),
        "video_sha256": actual_video_sha,
        "cost_usd": 0.0,
        "youtube_publication_attempted": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--subtitle", required=True)
    parser.add_argument("--worker-result", required=True)
    parser.add_argument("--source-manifest", required=True)
    parser.add_argument("--output-file", required=True)
    args = parser.parse_args()

    video = Path(args.video)
    subtitle = Path(args.subtitle)
    if not video.is_file() or not subtitle.is_file():
        raise SystemExit("Video veya altyazı dosyası eksik")
    probe = json.loads(
        subprocess.check_output(
            [
                "ffprobe", "-v", "error", "-show_streams", "-show_format",
                "-of", "json", str(video),
            ],
            text=True,
        )
    )
    result = evaluate(
        json.loads(Path(args.worker_result).read_text(encoding="utf-8")),
        probe,
        subtitle.read_text(encoding="utf-8"),
        json.loads(Path(args.source_manifest).read_text(encoding="utf-8")),
        sha256(video),
    )
    Path(args.output_file).write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()

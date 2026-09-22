#!/usr/bin/env python3
"""Require an owner's exact clip approval and download only those Pexels clips.

Approval validation is deterministic. Network access is confined to the
explicit download command, which runs only after the existing worker gates.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path


class MediaApprovalError(ValueError):
    pass


def parse_ids(value: str) -> list[str]:
    ids = [part.strip() for part in value.split(",")]
    if not 6 <= len(ids) <= 8 or any(not re.fullmatch(r"[1-9][0-9]*", part) for part in ids):
        raise MediaApprovalError("6-8 benzersiz sayısal Pexels klip ID'si gerekli")
    if len(set(ids)) != len(ids):
        raise MediaApprovalError("Pexels klip ID'leri tekrarlanamaz")
    return ids


def approval_line(issue: int, scenario: str, script_sha: str, ids: list[str]) -> str:
    if not re.fullmatch(r"[0-9a-f]{64}", script_sha):
        raise MediaApprovalError("Senaryo SHA-256 geçersiz")
    return (
        f"ONAYLI PEXELS KLIPLERI V1 issue={issue} scenario={scenario} "
        f"script_sha256={script_sha} ids={','.join(ids)}"
    )


def validate_approval(
    comments: list[dict], owner: str, issue: int, scenario: str,
    script_sha: str, ids: list[str],
) -> str:
    expected = approval_line(issue, scenario, script_sha, ids)
    matching = [
        item for item in comments
        if isinstance(item, dict)
        and (item.get("author") or {}).get("login") == owner
        and str(item.get("body", "")).strip() == expected
    ]
    if len(matching) != 1:
        raise MediaApprovalError("Owner'ın senaryo ve klip listesi için tam onayı gerekli")
    return hashlib.sha256(expected.encode("utf-8")).hexdigest()


def select_rendition(video: dict, asset_id: str) -> tuple[str, dict]:
    if str(video.get("id")) != asset_id:
        raise MediaApprovalError("Pexels klip ID'si API yanıtıyla uyuşmuyor")
    page = str(video.get("url", ""))
    parsed = urllib.parse.urlparse(page)
    if parsed.scheme != "https" or parsed.hostname != "www.pexels.com":
        raise MediaApprovalError("Pexels kaynak sayfası geçersiz")
    if not re.fullmatch(rf"/video/(?:[^/]*-)?{asset_id}/?", parsed.path):
        raise MediaApprovalError("Pexels sayfası seçili klibe ait değil")
    candidates = [
        item for item in video.get("video_files", [])
        if isinstance(item, dict)
        and item.get("width") == 1080 and item.get("height") == 1920
        and item.get("file_type") == "video/mp4"
    ]
    if not candidates:
        raise MediaApprovalError(f"{asset_id}: 1080x1920 MP4 bulunamadı")
    selected = candidates[0]
    link = str(selected.get("link", ""))
    url = urllib.parse.urlparse(link)
    if url.scheme != "https" or url.hostname != "videos.pexels.com":
        raise MediaApprovalError("Klip URL'si Pexels video alanından gelmeli")
    if int(video.get("duration", 0)) < 5:
        raise MediaApprovalError("Klip en az 5 saniye olmalı")
    return link, selected


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise MediaApprovalError("Pexels dışında yönlendirme kabul edilmez")


def fetch_json(url: str, key: str) -> dict:
    req = urllib.request.Request(url, headers={"Authorization": key})
    with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as response:
        return json.load(response)


def download_video(link: str, destination: Path) -> None:
    req = urllib.request.Request(link)
    total = 0
    with urllib.request.build_opener(NoRedirect).open(req, timeout=60) as response:
        with destination.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > 150 * 1024 * 1024:
                    raise MediaApprovalError("Klip boyutu 150 MiB sınırını aşıyor")
                output.write(chunk)
    if total < 1024:
        raise MediaApprovalError("Klip boş veya geçersiz")
    probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_streams", "-of", "json", str(destination),
    ], text=True))
    if not any(stream.get("codec_type") == "video" and
               stream.get("width") == 1080 and stream.get("height") == 1920
               for stream in probe.get("streams", [])):
        raise MediaApprovalError("İndirilen klip 1080x1920 video değil")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--issue-comments", required=True)
    parser.add_argument("--owner", required=True)
    parser.add_argument("--source-issue", type=int, required=True)
    parser.add_argument("--scenario", choices=["1", "2", "3"], required=True)
    parser.add_argument("--script-sha", required=True)
    parser.add_argument("--ids", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()

    ids = parse_ids(args.ids)
    comments = json.loads(Path(args.issue_comments).read_text(encoding="utf-8"))
    digest = validate_approval(
        comments, args.owner, args.source_issue, args.scenario, args.script_sha, ids,
    )
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    (output / "approval.sha256").write_text(digest + "\n", encoding="utf-8")
    if not args.download:
        return

    import os
    key = os.environ.get("PEXELS_API_KEY", "")
    if not key:
        raise MediaApprovalError("PEXELS_API_KEY eksik")
    sources = []
    for asset_id in ids:
        video = fetch_json(f"https://api.pexels.com/v1/videos/videos/{asset_id}", key)
        link, rendition = select_rendition(video, asset_id)
        destination = output / f"pexels-{asset_id}.mp4"
        download_video(link, destination)
        sources.append({
            "provider": "pexels", "asset_id": asset_id,
            "source_page": video["url"], "local_file": destination.name,
            "creator": video.get("user"),
            "rendition": {key: rendition.get(key) for key in ("id", "width", "height")},
        })
    (output / "source-manifest.json").write_text(
        json.dumps({"schema_version": 1, "material_sources": sources},
                   ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    (output / "paths.txt").write_text(
        ",".join(str(output / f"pexels-{asset_id}.mp4") for asset_id in ids),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

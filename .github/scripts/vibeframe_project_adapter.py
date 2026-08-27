#!/usr/bin/env python3
"""Create a minimal VibeFrame-compatible project from an approved script.

This adapter is intentionally deterministic and uses no AI/API calls. It turns
an already-approved script into a storyboard project that can be validated and
priced by VibeFrame before any paid generation is allowed.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


SUPPORTED_ASPECTS = {"9:16", "16:9", "1:1"}


def clean_script(text: str) -> str:
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not text:
        raise SystemExit("Senaryo boş olamaz.")
    return text


def yaml_quote(text: str) -> str:
    return '"' + text.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'


def as_blockquote(text: str) -> str:
    """Render source text without letting its Markdown headings become VibeFrame beats."""
    return "\n".join(">" if not line else f"> {line}" for line in text.splitlines())


def load_profile(profile_path: Path) -> dict:
    try:
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        business = profile["business"]
        video_formats = profile["content"]["video_formats"]
        for field in ("brand_name", "owner_display_name", "category"):
            if not isinstance(business[field], str) or not business[field].strip():
                raise ValueError(field)
        if not isinstance(video_formats, list) or not video_formats:
            raise ValueError("content.video_formats")
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        raise SystemExit(f"İşletme profili VibeFrame için okunamadı: {exc}") from exc
    return profile


def validate_aspect(aspect: str, profile: dict) -> None:
    if aspect not in SUPPORTED_ASPECTS:
        raise SystemExit(
            f"VibeFrame adapter bu aspect değerini desteklemiyor: {aspect}. "
            f"Desteklenenler: {', '.join(sorted(SUPPORTED_ASPECTS))}."
        )
    allowed = profile["content"]["video_formats"]
    if aspect not in allowed:
        raise SystemExit(f"Aspect işletme profilinde izinli değil: {aspect}.")


def default_project_title(profile: dict) -> str:
    return f"{profile['business']['brand_name']} — VibeFrame Test"


def project_config(title: str, duration: int, aspect: str) -> dict:
    image_size = "1024x1536" if aspect == "9:16" else "1536x1024"
    return {
        "schemaVersion": "1",
        "name": re.sub(r"[^a-z0-9]+", "-", title.lower(), flags=re.I).strip("-") or "video",
        "aspect": aspect,
        "kind": "cinema",
        "defaults": {
            "sceneDurationSec": duration,
            "narrationPaddingSec": 0.5,
            "fps": 30,
            "quality": "standard",
        },
        "providers": {
            "image": None,
            "video": None,
            "narration": None,
            "music": None,
            "composer": None,
        },
        "build": {
            "mode": "auto",
            "stage": "all",
            "maxCostUsd": None,
            "imageQuality": "hd",
            "imageSize": image_size,
        },
        "composition": {
            "engine": "hyperframes",
            "entry": "index.html",
            "compositionsDir": "compositions",
            "assetsDir": "assets",
            "rendersDir": "renders",
        },
    }


def make_project(
    script: str,
    output: Path,
    title: str,
    duration: int,
    aspect: str,
    profile: dict | None = None,
) -> None:
    output.mkdir(parents=True, exist_ok=True)
    (output / "scenes").mkdir(exist_ok=True)
    (output / "media").mkdir(exist_ok=True)

    business = (profile or {}).get("business", {})
    brand_name = business.get("brand_name", "İşletme")
    owner_display_name = business.get("owner_display_name", "İşletme sahibi")
    category = business.get("category", "Belirtilmedi")
    storyboard = f"""---
title: {yaml_quote(title)}
duration: {duration}
aspect: {yaml_quote(aspect)}
---

# {title}

Bu proje, onaylanmış senaryonun VibeFrame uygunluk testi için deterministik olarak oluşturulmuştur.
İşletme: {brand_name}. Görünen işletme sahibi: {owner_display_name}. Kategori: {category}.
Senaryo metni bu aşamada değiştirilmez. Ücretli üretim başlamaz.
"""

    design = """# Design

## Görsel yaklaşım
Temiz, doğal ve eğitim odaklı. Gerçek çekim varsa mevcut medya önceliklidir.

## Tipografi
Okunaklı, yüksek kontrastlı altyazı.

## Hareket
Gereksiz efekt yok; kısa ve anlaşılır geçişler.
"""

    quoted_script = as_blockquote(clean_script(script))
    scene = f"""---
type: Scene
duration: {duration}
---

# Onaylı Senaryo

{quoted_script}

Üretim notu: Bu dry-run testinde ücretli asset cue'su yoktur. Gerçek çekim daha sonra `media/` içinden referans edilir.
"""

    (output / "STORYBOARD.md").write_text(storyboard, encoding="utf-8")
    (output / "DESIGN.md").write_text(design, encoding="utf-8")
    (output / "scenes" / "01-approved-script.md").write_text(scene, encoding="utf-8")
    (output / "APPROVED_SCRIPT.md").write_bytes(script.encode("utf-8"))
    (output / "vibe.config.json").write_text(
        json.dumps(project_config(title, duration, aspect), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--script-file", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--title")
    parser.add_argument("--duration", type=int, default=10)
    parser.add_argument("--aspect", default="9:16")
    args = parser.parse_args()

    if args.duration < 5 or args.duration > 15:
        raise SystemExit("Uyumluluk testinde beat süresi 5-15 saniye aralığında olmalı.")

    profile = load_profile(Path(args.profile))
    validate_aspect(args.aspect, profile)
    try:
        script = Path(args.script_file).read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise SystemExit(f"Onaylanmış senaryo UTF-8 olarak okunamadı: {exc}") from exc
    clean_script(script)
    title = args.title or default_project_title(profile)
    make_project(script, Path(args.output_dir), title, args.duration, args.aspect, profile)
    print(f"VibeFrame proje taslağı hazır: {args.output_dir}")


if __name__ == "__main__":
    main()

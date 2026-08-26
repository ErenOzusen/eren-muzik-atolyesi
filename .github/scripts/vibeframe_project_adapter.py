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


def make_project(script: str, output: Path, title: str, duration: int, aspect: str) -> None:
    output.mkdir(parents=True, exist_ok=True)
    (output / "scenes").mkdir(exist_ok=True)
    (output / "media").mkdir(exist_ok=True)

    storyboard = f"""---
title: {yaml_quote(title)}
duration: {duration}
aspect: {yaml_quote(aspect)}
---

# {title}

Bu proje, Eren tarafından onaylanmış senaryonun VibeFrame uygunluk testi için deterministik olarak oluşturulmuştur.
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

    quoted_script = as_blockquote(script)
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
    (output / "APPROVED_SCRIPT.md").write_text(script + "\n", encoding="utf-8")
    (output / "vibe.config.json").write_text(
        json.dumps(project_config(title, duration, aspect), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--script-file", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--title", default="Eren Müzik Atölyesi Test Videosu")
    parser.add_argument("--duration", type=int, default=10)
    parser.add_argument("--aspect", choices=["9:16", "16:9", "1:1"], default="9:16")
    args = parser.parse_args()

    if args.duration < 5 or args.duration > 15:
        raise SystemExit("Uyumluluk testinde beat süresi 5-15 saniye aralığında olmalı.")

    script = clean_script(Path(args.script_file).read_text(encoding="utf-8"))
    make_project(script, Path(args.output_dir), args.title, args.duration, args.aspect)
    print(f"VibeFrame proje taslağı hazır: {args.output_dir}")


if __name__ == "__main__":
    main()

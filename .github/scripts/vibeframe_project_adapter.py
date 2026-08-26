#!/usr/bin/env python3
"""Create a minimal VibeFrame-compatible project from an approved script.

This adapter is intentionally deterministic and uses no AI/API calls. It turns
an already-approved script into a storyboard project that can be validated and
priced by VibeFrame before any paid generation is allowed.
"""

from __future__ import annotations

import argparse
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

    scene = f"""---
type: Scene
duration: {duration}
narration: {yaml_quote(script)}
---

# Onaylı Senaryo

{script}

## Üretim notu
Bu dry-run testinde video/backdrop üretim cue'su yoktur. Gerçek çekim daha sonra `media/` içinden referans edilir.
"""

    (output / "STORYBOARD.md").write_text(storyboard, encoding="utf-8")
    (output / "DESIGN.md").write_text(design, encoding="utf-8")
    (output / "scenes" / "01-approved-script.md").write_text(scene, encoding="utf-8")
    (output / "APPROVED_SCRIPT.md").write_text(script + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--script-file", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--title", default="Eren Müzik Atölyesi Test Videosu")
    parser.add_argument("--duration", type=int, default=30)
    parser.add_argument("--aspect", choices=["9:16", "16:9", "1:1"], default="9:16")
    args = parser.parse_args()

    if args.duration < 5 or args.duration > 180:
        raise SystemExit("Süre 5-180 saniye aralığında olmalı.")

    script = clean_script(Path(args.script_file).read_text(encoding="utf-8"))
    make_project(script, Path(args.output_dir), args.title, args.duration, args.aspect)
    print(f"VibeFrame proje taslağı hazır: {args.output_dir}")


if __name__ == "__main__":
    main()

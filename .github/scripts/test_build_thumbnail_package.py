#!/usr/bin/env python3
"""Zero-token portability tests for the thumbnail-package builder."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BUILDER = ROOT / ".github/scripts/build_thumbnail_package.py"
WORKFLOW = ROOT / ".github/workflows/thumbnail-package-agent.yml"
CURRENT_PROFILE = ROOT / ".github/config/business-profile.json"
SECOND_PROFILE = ROOT / ".github/scripts/fixtures/second-business-profile.json"


def load_profile(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def scenario_text(topic: str) -> tuple[str, str]:
    seo_title = f"{topic} neden önemli? Güvenli günlük yaklaşım"
    source = f"""**SEO Başlığı:** {seo_title}

**[KANCA]**
KORUNACAK-ANLAM günlük yaklaşımın temel noktasını açıklar.

---
**[ANA AKIŞ]**
Kaynakta bulunan bilgi yeni vaat veya sonuç eklenmeden aktarılır.

---
**[KAPANIŞ VE CTA]**
İzleyici yalnız kaynakta bulunan sonraki adıma yönlendirilir.
"""
    return source, seo_title


def build(profile_path: Path, directory: Path) -> tuple[str, str]:
    profile = load_profile(profile_path)
    final_source, seo_title = scenario_text(profile["content"]["content_topics"][0])
    final_path = directory / f"final-{profile_path.stem}.md"
    subtitle_path = directory / f"subtitle-{profile_path.stem}.md"
    output_path = directory / f"thumbnail-{profile_path.stem}.md"
    final_path.write_text(final_source, encoding="utf-8")
    subtitle_path.write_text("Zamanlanmamış altyazı kaynağı.\n", encoding="utf-8")
    subprocess.run(
        [
            sys.executable,
            str(BUILDER),
            "--final",
            str(final_path),
            "--subtitle",
            str(subtitle_path),
            "--output",
            str(output_path),
            "--final-url",
            "https://example.test/final",
            "--subtitle-url",
            "https://example.test/subtitle",
            "--profile",
            str(profile_path),
            "--test-mode",
            "false",
        ],
        check=True,
    )
    return output_path.read_text(encoding="utf-8"), seo_title


def assert_profile_output(profile_path: Path, output: str, seo_title: str) -> None:
    profile = load_profile(profile_path)
    upper_brand = profile["business"]["brand_name"].replace("i", "İ").replace("ı", "I").upper()
    expected = [
        upper_brand,
        profile["business"]["owner_display_name"],
        profile["business"]["category"],
        profile["content"]["content_topics"][0],
        seo_title,
        "KORUNACAK ANLAM",
    ]
    for value in expected:
        assert value in output, f"Beklenen profil/kaynak değeri çıktıda yok: {value}"


def main() -> None:
    with tempfile.TemporaryDirectory() as temp:
        directory = Path(temp)
        current_output, current_title = build(CURRENT_PROFILE, directory)
        second_output, second_title = build(SECOND_PROFILE, directory)

    assert_profile_output(CURRENT_PROFILE, current_output, current_title)
    assert_profile_output(SECOND_PROFILE, second_output, second_title)
    assert "Profilde tanımlı marka rengi yok" in current_output
    for color in load_profile(SECOND_PROFILE)["assets"]["brand_colors"]:
        assert color in second_output, f"İkinci işletme marka rengi çıktıda yok: {color}"

    for forbidden in ("Eren", "Eren Müzik Atölyesi", "gitar", "piyano", "öğrenci"):
        assert forbidden.casefold() not in second_output.casefold(), (
            f"İkinci işletme çıktısında hard-code kaldı: {forbidden}"
        )

    workflow = WORKFLOW.read_text(encoding="utf-8")
    assert "--profile .github/config/business-profile.json" in workflow
    assert 'any(.name == "eren-onayli")' in workflow
    assert '"eren-onayi-bekliyor"' in workflow

    print("thumbnail_package_portability_ok ai_calls=0 api_calls=0 image_calls=0 video_calls=0")


if __name__ == "__main__":
    main()

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
    # Wrapped in a real "## SENARYO 1: ..." heading, matching the real Nihai
    # Senaryolar Issue body shape build_thumbnail_package.py's --scenario
    # argument now scopes its extraction to (see select_scenario_block).
    source = f"""## SENARYO 1: {seo_title}

**SEO Başlığı:** {seo_title}

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
            "--scenario",
            "1",
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

    # Main owner approval label migration Faz 1 — read-both on the source scenario gate.
    assert 'any(.name == "eren-onayli" or .name == "owner-approved")' in workflow

    # This file's own identity/pending label mutation now goes through a
    # shared, single-call-site persistence script (MUTATE -> REFETCH ->
    # VERIFY -> SUCCESS) instead of inline gh label create/edit calls — see
    # persist_thumbnail_package_labels.sh.
    persist_script = (ROOT / ".github/scripts/persist_thumbnail_package_labels.sh").read_text(encoding="utf-8")
    workflow_and_persistence = workflow + "\n" + persist_script

    # This file's own eren-onayi-bekliyor is UI/status only (audit-confirmed no
    # downstream reader) — dual-write it alongside the legacy label without creating
    # any new functional gate.
    assert '"eren-onayi-bekliyor"' in workflow_and_persistence, "legacy status label kayboldu"
    assert '"owner-approval-pending"' in workflow_and_persistence, "generic status label eklenmedi"
    # Both pending labels are added together, in the SAME create/edit call
    # that determines THUMBNAIL_NUMBER — a stronger guarantee than the old
    # design (a separate follow-up call was a torn-state risk, now removed).
    assert (
        'ISSUE_LABELS=("thumbnail-paketi" "thumbnail-package" "eren-onayi-bekliyor" "owner-approval-pending")'
        in persist_script
    ), "generic status label yeni/güncellenen Issue'ya eklenmiyor"
    assert (
        'gh issue edit "$THUMBNAIL_NUMBER" --add-label "owner-approval-pending"'
        not in workflow_and_persistence
    ), "eski torn-state follow-up call geri gelmiş"

    print("thumbnail_package_portability_ok ai_calls=0 api_calls=0 image_calls=0 video_calls=0")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Zero-token portability tests for the YouTube publication package builder."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BUILDER = ROOT / ".github/scripts/build_youtube_package.py"
WORKFLOW = ROOT / ".github/workflows/youtube-publication-package-agent.yml"
CURRENT_PROFILE = ROOT / ".github/config/business-profile.json"
SECOND_PROFILE = ROOT / ".github/scripts/fixtures/second-business-profile.json"


def load_profile(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def final_text(topic: str) -> dict[str, str]:
    values = {
        "title": f"{topic} için kaynak başlık",
        "description": "KORUNACAK-AÇIKLAMA yalnız onaylanmış kaynak anlamını aktarır.",
        "hashtags": "#KaynakEtiketi #OnayliIcerik",
        "playlist": "KORUNACAK Oynatma Listesi",
        "heading_one": "KORUNACAK Birinci Bölüm",
        "heading_two": "KORUNACAK İkinci Bölüm",
    }
    # Wrapped in a real "## SENARYO 1: ..." heading, matching the real Nihai
    # Senaryolar Issue body shape build_youtube_package.py's --scenario
    # argument now scopes its extraction to (see select_scenario_block).
    values["source"] = f"""## SENARYO 1: {values['title']}

**SEO Başlığı:** {values['title']}
**Açıklamanın İlk Cümlesi:** {values['description']}
**Etiketler:** {values['hashtags']}
**Playlist Önerisi:** {values['playlist']}

**[KANCA]**
Kaynak kanca değiştirilmeden korunur.

---
**[ANA AKIŞ]**
**{values['heading_one']}**
Kaynak bilgi.

**{values['heading_two']}**
Kaynak bilgi.

---
**[KAPANIŞ VE CTA]**
Kaynak çağrı metni.
"""
    return values


def thumbnail_text() -> str:
    return """### Seçenek A
- **Kapak yazısı:** `KAYNAK KAPAK A`

### Seçenek B
- **Kapak yazısı:** `KAYNAK KAPAK B`

### Seçenek C
- **Kapak yazısı:** `KAYNAK KAPAK C`
"""


def build(profile_path: Path, directory: Path) -> tuple[str, dict[str, str]]:
    profile = load_profile(profile_path)
    source_values = final_text(profile["content"]["content_topics"][0])
    final_path = directory / f"final-{profile_path.stem}.md"
    thumbnail_path = directory / f"thumbnail-{profile_path.stem}.md"
    output_path = directory / f"youtube-{profile_path.stem}.md"
    final_path.write_text(source_values["source"], encoding="utf-8")
    thumbnail_path.write_text(thumbnail_text(), encoding="utf-8")
    subprocess.run(
        [
            sys.executable,
            str(BUILDER),
            "--final",
            str(final_path),
            "--thumbnail",
            str(thumbnail_path),
            "--output",
            str(output_path),
            "--final-url",
            "https://example.test/final",
            "--thumbnail-url",
            "https://example.test/thumbnail",
            "--thumbnail-choice",
            "PENDING",
            "--scenario",
            "1",
            "--profile",
            str(profile_path),
            "--test-mode",
            "true",
        ],
        check=True,
    )
    return output_path.read_text(encoding="utf-8"), source_values


def assert_profile_output(profile_path: Path, output: str, source: dict[str, str]) -> None:
    profile = load_profile(profile_path)
    upper_brand = profile["business"]["brand_name"].replace("i", "İ").replace("ı", "I").upper()
    expected = [
        upper_brand,
        profile["business"]["owner_display_name"],
        profile["business"]["category"],
        *profile["offer"]["services"],
        profile["offer"]["reservation_url"],
        profile["offer"]["primary_cta"],
        profile["approval"]["production_command"],
        *profile["content"]["content_topics"],
        source["title"],
        source["description"],
        source["hashtags"],
        source["playlist"],
        source["heading_one"],
        source["heading_two"],
    ]
    for value in expected:
        assert value in output, f"Beklenen profil/kaynak değeri çıktıda yok: {value}"


def main() -> None:
    with tempfile.TemporaryDirectory() as temp:
        directory = Path(temp)
        current_output, current_source = build(CURRENT_PROFILE, directory)
        second_output, second_source = build(SECOND_PROFILE, directory)

    assert_profile_output(CURRENT_PROFILE, current_output, current_source)
    assert_profile_output(SECOND_PROFILE, second_output, second_source)

    for forbidden in (
        "Eren",
        "Eren Müzik Atölyesi",
        "https://eren-muzik-atolyesi.vercel.app",
        "ONAYLIYORUM",
    ):
        assert forbidden.casefold() not in second_output.casefold(), (
            f"İkinci işletme çıktısında hard-code kaldı: {forbidden}"
        )

    workflow = WORKFLOW.read_text(encoding="utf-8")
    assert "--profile .github/config/business-profile.json" in workflow
    assert "https://eren-muzik-atolyesi.vercel.app" not in workflow
    assert "--reservation-url" not in workflow
    # Main owner approval label migration Faz 1 — read-both on the source scenario gate.
    assert 'any(.name == "eren-onayli" or .name == "owner-approved")' in workflow

    # This file's own identity/pending label mutation now goes through a
    # shared, single-call-site persistence script (MUTATE -> REFETCH ->
    # VERIFY -> SUCCESS) instead of inline gh label create/edit calls — see
    # persist_youtube_publication_package_labels.sh.
    persist_script = (
        ROOT / ".github/scripts/persist_youtube_publication_package_labels.sh"
    ).read_text(encoding="utf-8")
    workflow_and_persistence = workflow + "\n" + persist_script

    # Publication approval label migration Faz 1 — dual-write on the package agent side:
    # the legacy pending label must still be produced, and the generic pending label
    # must now be produced alongside it (neither replaces the other in this package).
    assert '"eren-yayin-onayi-bekliyor"' in workflow_and_persistence, "legacy pending label kayboldu"
    assert '"publication-approval-pending"' in workflow_and_persistence, "generic pending label eklenmedi"
    # Both pending labels are added together, in the SAME create/edit call
    # that determines YOUTUBE_NUMBER — a stronger guarantee than the old
    # design (a separate follow-up call was a torn-state risk, now removed).
    assert (
        'ISSUE_LABELS=("youtube-yayin-paketi" "youtube-publication-package" "eren-yayin-onayi-bekliyor" "publication-approval-pending")'
        in persist_script
    ), "generic pending label yeni/güncellenen Issue'ya eklenmiyor"
    assert (
        'gh issue edit "$YOUTUBE_NUMBER" --add-label "publication-approval-pending"'
        not in workflow_and_persistence
    ), "eski torn-state follow-up call geri gelmiş"

    print("youtube_package_portability_ok ai_calls=0 api_calls=0 youtube_calls=0 video_calls=0")


if __name__ == "__main__":
    main()

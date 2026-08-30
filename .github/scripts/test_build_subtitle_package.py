#!/usr/bin/env python3
"""Zero-token portability tests for the subtitle-package builder."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BUILDER = ROOT / ".github/scripts/build_subtitle_package.py"
WORKFLOW = ROOT / ".github/workflows/subtitle-package-agent.yml"
CURRENT_PROFILE = ROOT / ".github/config/business-profile.json"
SECOND_PROFILE = ROOT / ".github/scripts/fixtures/second-business-profile.json"


def scenario_text() -> str:
    main_sentence = "KORUNACAK-KONUŞMA-METNİ genel açıklamayı hiçbir ek iddia katmadan aktarır. "
    shorts_sentence = "KISA-KORUNACAK-METİN yalnız kaynakta bulunan bilgiyi aktarır. "
    return f"""**[KANCA]**
{main_sentence * 5}

---
**[ANA AKIŞ]**
{main_sentence * 9}

---
**[KAPANIŞ VE CTA]**
{main_sentence * 4}

---
**[SHORTS KESİTİ]**
{shorts_sentence * 4}
"""


def editing_text() -> str:
    return """## 1. Kaynak ve Dosya Haritası
Kaynak dosya.

## 2. Ana Video Kurgu Akışı
Genel akış.

## 3. Ekran Yazıları ve Altyazı Planı
- Kaynaktaki ifadeyi aynen kullan.

## 4. Ses Düzeni
Kaynak sesi koru.
"""


def build(profile_path: Path, directory: Path) -> str:
    final_path = directory / "final.md"
    editing_path = directory / "editing.md"
    output_path = directory / f"subtitle-{profile_path.stem}.md"
    final_path.write_text(scenario_text(), encoding="utf-8")
    editing_path.write_text(editing_text(), encoding="utf-8")
    subprocess.run(
        [
            sys.executable,
            str(BUILDER),
            "--final",
            str(final_path),
            "--editing",
            str(editing_path),
            "--output",
            str(output_path),
            "--final-url",
            "https://example.test/final",
            "--editing-url",
            "https://example.test/editing",
            "--profile",
            str(profile_path),
            "--test-mode",
            "false",
        ],
        check=True,
    )
    return output_path.read_text(encoding="utf-8")


def assert_profile_output(profile_path: Path, output: str) -> None:
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    expected = [
        profile["business"]["brand_name"],
        profile["business"]["owner_display_name"],
        profile["business"]["category"],
        *profile["content"]["content_topics"],
        "KORUNACAK-KONUŞMA-METNİ",
        "KISA-KORUNACAK-METİN",
    ]
    for value in expected:
        assert value in output, f"Beklenen profil/kaynak değeri çıktıda yok: {value}"


def main() -> None:
    with tempfile.TemporaryDirectory() as temp:
        directory = Path(temp)
        current_output = build(CURRENT_PROFILE, directory)
        second_output = build(SECOND_PROFILE, directory)

    assert_profile_output(CURRENT_PROFILE, current_output)
    assert_profile_output(SECOND_PROFILE, second_output)

    for forbidden in (
        "Eren",
        "Eren Müzik Atölyesi",
        "piyano",
        "gitar",
        "müzik teorisi",
        "Türkçe müzik terimleri",
    ):
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
    # persist_subtitle_package_labels.sh. Checked as part of "workflow" here
    # too, since it's logically that workflow's own persistence.
    persist_script = (ROOT / ".github/scripts/persist_subtitle_package_labels.sh").read_text(encoding="utf-8")
    workflow_and_persistence = workflow + "\n" + persist_script

    # This file's own eren-onayi-bekliyor is UI/status only (audit-confirmed no
    # downstream reader) — dual-write it alongside the legacy label without creating
    # any new functional gate.
    assert '"eren-onayi-bekliyor"' in workflow_and_persistence, "legacy status label kayboldu"
    assert '"owner-approval-pending"' in workflow_and_persistence, "generic status label eklenmedi"
    # Both pending labels are added together, in the SAME create/edit call
    # that determines SUBTITLE_NUMBER — a stronger guarantee than the old
    # design (a separate follow-up call was a torn-state risk, now removed).
    assert (
        'ISSUE_LABELS=("altyazi-paketi" "subtitle-package" "eren-onayi-bekliyor" "owner-approval-pending")'
        in persist_script
    ), "generic status label yeni/güncellenen Issue'ya eklenmiyor"
    assert (
        'gh issue edit "$SUBTITLE_NUMBER" --add-label "owner-approval-pending"'
        not in workflow_and_persistence
    ), "eski torn-state follow-up call geri gelmiş"

    print("subtitle_package_portability_ok ai_calls=0 api_calls=0 video_calls=0")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Deterministic zero-token portability checks for the system audit builder."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BUILDER = ROOT / ".github" / "scripts" / "build_system_audit.py"
CURRENT_PROFILE = ROOT / ".github" / "config" / "business-profile.json"
SECOND_PROFILE = ROOT / ".github" / "scripts" / "fixtures" / "second-business-profile.json"
WORKFLOW = ROOT / ".github" / "workflows" / "system-status-cost-agent.yml"

STAGE_TITLES = (
    "Haftalık İçerik Raporu",
    "Haftalık Senaryolar",
    "Kalite Kontrol Raporu",
    "Nihai Senaryolar",
    "Çekim Paketi",
    "Kurgu Paketi",
    "Altyazı Paketi",
    "Thumbnail Paketi",
    "YouTube Yayın Paketi",
)


def build_issues() -> list[dict]:
    issues = []
    for number, title in enumerate(STAGE_TITLES, start=1):
        body = "<!-- STAGE_USAGE_V1 input=0 output=0 web_search=0 api_calls=0 -->"
        if number > 1:
            body += f"\nhttps://github.com/source/demo/issues/{number - 1}"
        labels = ["sistem-testi"]
        if number == 9:
            labels.extend(("youtube-yayin-paketi", "test-yayin-onayli"))
            body += (
                "\n<!-- PUBLICATION_USAGE_V1 uploads=0 publications=0 -->"
                "\n**Ana video dosyası:** Sağlanmadı"
                "\n**Zamanlanmış SRT dosyası:** Sağlanmadı"
                "\n**Onaylı thumbnail dosyası:** Sağlanmadı"
            )
        issues.append(
            {
                "number": number,
                "title": f"TEST {title} - 28.08.2026",
                "body": body,
                "state": "OPEN",
                "labels": labels,
                "updatedAt": "2026-08-28T00:00:00Z",
            }
        )
    return issues


def render(profile: Path, repository: str, directory: Path) -> str:
    issues_path = directory / "issues.json"
    output_path = directory / f"{repository.replace('/', '-')}.md"
    source = build_issues()
    issues_path.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")
    subprocess.run(
        [
            "python3",
            str(BUILDER),
            "--issues-json",
            str(issues_path),
            "--root-issue",
            "9",
            "--output",
            str(output_path),
            "--test-mode",
            "true",
            "--profile",
            str(profile),
            "--repository",
            repository,
        ],
        check=True,
        cwd=ROOT,
    )
    assert json.loads(issues_path.read_text(encoding="utf-8")) == source
    return output_path.read_text(encoding="utf-8")


def assert_audit_semantics(output: str) -> None:
    expected = (
        "**Zincirde bulunan Issue sayısı:** 9",
        "**Aşama bütünlüğü:** ✅ Tam",
        "**Kayıtlı toplam token:** 0",
        "**Test yayın onay kapısı:** ✅ Geçti",
        "**YouTube yükleme/yayın sayacı:** ✅ 0 / 0",
    )
    for value in expected:
        assert value in output, value


def main() -> None:
    with tempfile.TemporaryDirectory() as temp:
        directory = Path(temp)
        current = render(CURRENT_PROFILE, "ErenOzusen/eren-muzik-atolyesi", directory)
        second = render(SECOND_PROFILE, "mavi-dis-demo/ornek-repo", directory)

    assert "EREN MÜZİK ATÖLYESİ — SİSTEM DURUM VE MALİYET RAPORU" in current
    assert "**İşletme sahibi:** Eren Özüşen" in current
    assert "**Yetkili GitHub sahibi:** @ErenOzusen" in current
    assert "https://github.com/ErenOzusen/eren-muzik-atolyesi/issues/9" in current

    assert "MAVİ DİS KLİNİGİ — SİSTEM DURUM VE MALİYET RAPORU" in second
    assert "**İşletme sahibi:** Klinik Yoneticisi" in second
    assert "**Yetkili GitHub sahibi:** @mavi-dis-demo" in second
    assert "https://github.com/mavi-dis-demo/ornek-repo/issues/9" in second
    for forbidden in ("Eren", "Eren Müzik Atölyesi", "ErenOzusen/eren-muzik-atolyesi"):
        assert forbidden not in second, forbidden

    assert_audit_semantics(current)
    assert_audit_semantics(second)

    workflow = WORKFLOW.read_text(encoding="utf-8")
    for contract in (
        '--profile .github/config/business-profile.json',
        '--repository "$GH_REPO"',
        "<!-- system-audit-version: $AUDIT_VERSION -->",
        "<!-- SYSTEM_AUDIT_USAGE_V1",
        '"sistem-durum-raporu"',
        '"sistem-testi"',
    ):
        assert contract in workflow, contract

    print("system_audit_portability_ok ai_calls=0 api_calls=0 issue_writes=0 video_calls=0")


if __name__ == "__main__":
    main()

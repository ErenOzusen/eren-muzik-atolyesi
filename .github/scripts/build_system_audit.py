#!/usr/bin/env python3
"""Build a deterministic pipeline status and AI-usage audit from GitHub Issues."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import deque
from pathlib import Path


STAGES = (
    ("Haftalık İçerik Raporu", "Araştırma", 1),
    ("Haftalık Senaryolar", "Senaryo", 2),
    ("Kalite Kontrol Raporu", "Kalite kontrol", 3),
    ("Nihai Senaryolar", "Nihai senaryo", 4),
    ("Çekim Paketi", "Çekim paketi", 5),
    ("Kurgu Paketi", "Kurgu paketi", 6),
    ("Altyazı Paketi", "Altyazı paketi", 7),
    ("Thumbnail Paketi", "Thumbnail paketi", 8),
    ("YouTube Yayın Paketi", "YouTube yayın paketi", 9),
)
USAGE_KEYS = ("input", "output", "web_search", "api_calls", "uploads", "publications", "image_generation")


def labels_of(issue: dict) -> list[str]:
    labels = issue.get("labels") or []
    return [item if isinstance(item, str) else item.get("name", "") for item in labels]


def clean_title(title: str) -> str:
    return title.removeprefix("TEST ").strip()


def stage_of(issue: dict) -> tuple[str, int]:
    title = clean_title(issue.get("title", ""))
    for prefix, label, order in STAGES:
        if title.startswith(prefix):
            return label, order
    return "Diğer", 99


def linked_issue_numbers(body: str) -> set[int]:
    return {
        int(value)
        for value in re.findall(
            r"https://github\.com/[^/]+/[^/]+/issues/([1-9][0-9]*)",
            body or "",
        )
    }


def date_suffix(title: str) -> str | None:
    match = re.search(r"([0-9]{2}[-.][0-9]{2}[-.][0-9]{4})\s*$", title)
    if not match:
        return None
    return re.sub(r"[^0-9]", "", match.group(1))


def collect_chain(issues: dict[int, dict], root_number: int) -> list[dict]:
    if root_number not in issues:
        raise SystemExit(f"Kök Issue #{root_number} listede bulunamadı.")

    visited: set[int] = set()
    queue: deque[int] = deque([root_number])
    while queue:
        number = queue.popleft()
        if number in visited or number not in issues:
            continue
        visited.add(number)
        for linked in linked_issue_numbers(issues[number].get("body", "")):
            if linked not in visited:
                queue.append(linked)

    # Older scenario outputs did not persist their research source link. Recover only
    # the nearest earlier research Issue with the exact same date, avoiding old tests.
    scenario_issues = [issues[number] for number in visited if stage_of(issues[number])[1] == 2]
    for scenario in scenario_issues:
        suffix = date_suffix(scenario.get("title", ""))
        if not suffix:
            continue
        candidates = [
            issue
            for issue in issues.values()
            if stage_of(issue)[1] == 1
            and date_suffix(issue.get("title", "")) == suffix
            and int(issue["number"]) < int(scenario["number"])
        ]
        if candidates:
            visited.add(int(max(candidates, key=lambda item: int(item["number"]))["number"]))

    chain = [issues[number] for number in visited]
    return sorted(chain, key=lambda item: (stage_of(item)[1], int(item["number"])))


def parse_usage_markers(body: str) -> list[tuple[str, dict[str, int | str]]]:
    markers: list[tuple[str, dict[str, int | str]]] = []
    for match in re.finditer(r"<!--\s*([^>]*USAGE[^>]*)-->", body or "", flags=re.IGNORECASE):
        raw = re.sub(r"\s+", " ", match.group(1)).strip()
        name, _, payload = raw.partition(" ")
        values: dict[str, int | str] = {}
        for key, value in re.findall(r"([A-Za-z0-9_]+)=([^\s]+)", payload):
            values[key] = int(value) if value.isdigit() else value
        markers.append((name, values))
    return markers


def turkish_upper(value: str) -> str:
    return value.translate(str.maketrans({"i": "İ", "ı": "I"})).upper()


def load_business(profile_path: str) -> tuple[str, str, str]:
    profile = json.loads(Path(profile_path).read_text(encoding="utf-8"))
    business = profile.get("business") or {}
    required = ("brand_name", "owner_display_name", "github_owner")
    missing = [key for key in required if not str(business.get(key, "")).strip()]
    if missing:
        raise SystemExit(f"İşletme profilinde zorunlu alan eksik: {', '.join(missing)}")
    return tuple(str(business[key]).strip() for key in required)


def validate_repository(repository: str) -> str:
    repository = repository.strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise SystemExit("Repository owner/name biçiminde olmalı.")
    return repository


def issue_link(issue: dict, repository: str) -> str:
    number = int(issue["number"])
    url = issue.get("url") or f"https://github.com/{repository}/issues/{number}"
    return f"[#{number}]({url})"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--issues-json", required=True)
    parser.add_argument("--root-issue", type=int, required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--test-mode", choices=("true", "false"), required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--repository", required=True)
    args = parser.parse_args()

    brand_name, owner_display_name, github_owner = load_business(args.profile)
    repository = validate_repository(args.repository)

    raw_issues = json.loads(Path(args.issues_json).read_text(encoding="utf-8"))
    issues = {int(issue["number"]): issue for issue in raw_issues}
    chain = collect_chain(issues, args.root_issue)
    root = issues[args.root_issue]

    stage_rows: list[str] = []
    usage_rows: list[str] = []
    totals = {key: 0 for key in USAGE_KEYS}
    recorded_issues = 0
    missing_usage_issues = 0
    zero_ai_issues: list[str] = []
    nonzero_ai_issues: list[str] = []

    for issue in chain:
        stage, _ = stage_of(issue)
        labels = labels_of(issue)
        mode = "🧪 Test" if "sistem-testi" in labels else "Üretim"
        state = "Açık" if issue.get("state", "OPEN").upper() == "OPEN" else "Kapalı"
        label_text = ", ".join(f"`{label}`" for label in labels) or "—"
        stage_rows.append(
            f"| {stage} | {issue_link(issue, repository)} | {mode} | {state} | {label_text} |"
        )

        markers = parse_usage_markers(issue.get("body", ""))
        if not markers:
            missing_usage_issues += 1
            usage_rows.append(f"| {issue_link(issue, repository)} | {stage} | Kayıt yok | — | — | — |")
            continue

        recorded_issues += 1
        issue_input = 0
        issue_output = 0
        marker_names: list[str] = []
        issue_web = 0
        for marker_name, values in markers:
            marker_names.append(marker_name)
            for key in USAGE_KEYS:
                value = values.get(key)
                if isinstance(value, int):
                    totals[key] += value
            issue_input += int(values.get("input", 0)) if isinstance(values.get("input", 0), int) else 0
            issue_output += int(values.get("output", 0)) if isinstance(values.get("output", 0), int) else 0
            issue_web += int(values.get("web_search", 0)) if isinstance(values.get("web_search", 0), int) else 0
        total_tokens = issue_input + issue_output
        if total_tokens == 0:
            zero_ai_issues.append(issue_link(issue, repository))
        else:
            nonzero_ai_issues.append(issue_link(issue, repository))
        usage_rows.append(
            f"| {issue_link(issue, repository)} | {stage} | `{', '.join(marker_names)}` | "
            f"{issue_input:,} | {issue_output:,} | {issue_web:,} |"
        )

    found_orders = {stage_of(issue)[1] for issue in chain}
    missing_stages = [label for _, label, order in STAGES if order not in found_orders]
    chain_complete = not missing_stages
    known_total_tokens = totals["input"] + totals["output"]
    root_labels = labels_of(root)
    root_body = root.get("body", "")
    upload_zero = bool(re.search(r"uploads=0\s+publications=0", root_body))
    approval_tested = "test-yayin-onayli" in root_labels
    media_deferred = all(
        phrase in root_body
        for phrase in (
            "**Ana video dosyası:** Sağlanmadı",
            "**Zamanlanmış SRT dosyası:** Sağlanmadı",
            "**Onaylı thumbnail dosyası:** Sağlanmadı",
        )
    )
    source_digest = hashlib.sha256(
        "\n".join(
            f"{issue['number']}:{issue.get('title','')}:{issue.get('updatedAt','')}"
            for issue in chain
        ).encode("utf-8")
    ).hexdigest()
    status = (
        "🧪 Sistem testi — mevcut üretim zincirinin salt-okunur denetimi"
        if args.test_mode == "true"
        else "📊 Üretim zinciri durum ve maliyet denetimi"
    )

    output = f"""> **Durum:** {status}

# 📊 {turkish_upper(brand_name)} — SİSTEM DURUM VE MALİYET RAPORU

> Rapor GitHub Issue kayıtlarından deterministik olarak üretildi. AI modeli veya web araması kullanılmadı; kaynak Issue'lar değiştirilmedi.

## 1. Denetim Özeti

- **İşletme:** {brand_name}
- **İşletme sahibi:** {owner_display_name}
- **Yetkili GitHub sahibi:** @{github_owner}
- **Repository:** `{repository}`
- **Kök paket:** {issue_link(root, repository)} — {root.get('title', '')}
- **Zincirde bulunan Issue sayısı:** {len(chain)}
- **Beklenen aşama sayısı:** {len(STAGES)}
- **Aşama bütünlüğü:** {'✅ Tam' if chain_complete else '⚠️ Eksik'}
- **Eksik aşamalar:** {', '.join(missing_stages) if missing_stages else 'Yok'}
- **Raporun AI kullanımı:** 0 giriş tokenı, 0 çıkış tokenı, 0 web araması
- **Kaynak özeti SHA-256:** `{source_digest}`

## 2. Üretim Zinciri

| Aşama | Issue | Mod | Durum | Etiketler |
|---|---:|---|---|---|
{chr(10).join(stage_rows)}

## 3. AI Kullanım Kayıtları

| Issue | Aşama | Kullanım kaydı | Giriş | Çıkış | Web araması |
|---|---|---|---:|---:|---:|
{chr(10).join(usage_rows)}

> `Kayıt yok`, o aşamanın sıfır token kullandığı anlamına gelmez. Yalnızca Issue gövdesinde doğrulanabilir kullanım kaydı bulunmadığını gösterir.

## 4. Doğrulanabilir Token ve İşlem Toplamları

- **Kayıtlı giriş tokenı:** {totals['input']:,}
- **Kayıtlı çıkış tokenı:** {totals['output']:,}
- **Kayıtlı toplam token:** {known_total_tokens:,}
- **Kayıtlı web araması:** {totals['web_search']:,}
- **Kayıtlı harici API çağrısı:** {totals['api_calls']:,}
- **Kayıtlı görsel üretimi:** {totals['image_generation']:,}
- **Kayıtlı video yüklemesi:** {totals['uploads']:,}
- **Kayıtlı yayın işlemi:** {totals['publications']:,}
- **Kullanım kaydı bulunan Issue:** {recorded_issues}
- **Kullanım kaydı bulunmayan Issue:** {missing_usage_issues}
- **Parasal maliyet:** Hesaplanmadı; model adı ve çalıştırma anındaki fiyat kaydı bütün aşamalarda bulunmuyor

## 5. Token Tasarrufu ve Kayıt Kalitesi

- **Doğrulanmış sıfır-AI aşamaları:** {', '.join(zero_ai_issues) if zero_ai_issues else 'Yok'}
- **Doğrulanmış AI kullanan aşamalar:** {', '.join(nonzero_ai_issues) if nonzero_ai_issues else 'Yok'}
- Sıfır-token sonucu yalnızca açık kullanım işareti bulunan Issue'lar için verildi.
- Gelecek sürümlerde her ajanın aynı `*_USAGE_V1` biçiminde kayıt bırakması gerekir.

## 6. Yayın Güvenliği

- **Test yayın onay kapısı:** {'✅ Geçti' if approval_tested else '⏳ Bekliyor'}
- **YouTube yükleme/yayın sayacı:** {'✅ 0 / 0' if upload_zero else '⚠️ Doğrulanamadı'}
- **Gerçek medya dosyaları:** {f'{owner_display_name} tarafından sonraya bırakıldı; henüz sağlanmadı' if media_deferred else 'Durum ayrıca incelenmeli'}
- **Herkese açık yayın:** Yapılmadı
- Bu rapor etiket eklemez, kaynak Issue'lara yorum yazmaz ve üretim durumunu değiştirmez.

## 7. Sonuç ve Sıradaki Aşama

- Metin, kontrol, çekim planı, kurgu planı, zamanlanmamış altyazı, thumbnail brifi, YouTube metadata ve test yayın onayı zinciri {'tamamlandı' if chain_complete else 'kısmen tamamlandı'}.
- Gerçek video gerektiren teknik medya kontrolü, zamanlanmış SRT, nihai thumbnail dosyası ve YouTube yüklemesi videolar gelene kadar beklemede kalır.
- Video gelmeden yapılabilecek sonraki sistem işi: marka/işletme ayarlarını tek yapılandırma dosyasına taşıyarak sistemi çoğaltılabilir hale getirmek.
"""

    if len(re.findall(r"(?m)^## [1-7]\.", output)) != 7:
        raise SystemExit("Sistem raporunda tam olarak yedi bölüm bulunmalı.")
    if not chain_complete:
        print(f"audit_warning missing_stages={','.join(missing_stages)}")

    Path(args.output).write_text(output.strip() + "\n", encoding="utf-8")
    print(
        f"system_audit_ok issues={len(chain)} recorded={recorded_issues} "
        f"missing_usage={missing_usage_issues} known_tokens={known_total_tokens}"
    )


if __name__ == "__main__":
    main()

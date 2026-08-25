#!/usr/bin/env python3
"""Build a source-grounded YouTube publication package without AI or upload."""

from __future__ import annotations

import argparse
import hashlib
import re
from pathlib import Path


def read_text(path: str) -> str:
    return Path(path).read_text(encoding="utf-8").replace("\r\n", "\n")


def remove_comments(text: str) -> str:
    return re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)


def extract_bold_field(text: str, field: str) -> str:
    match = re.search(rf"(?m)^\*\*{re.escape(field)}:\*\*\s*(.+?)\s*$", text)
    if not match:
        raise SystemExit(f"Nihai senaryoda {field} alanı bulunamadı.")
    return match.group(1).strip()


def extract_script_section(text: str, name: str) -> str:
    match = re.search(
        rf"(?ms)^\*\*\[{re.escape(name)}\]\*\*\s*\n(.*?)(?=^---\s*$|\Z)",
        text,
    )
    if not match:
        raise SystemExit(f"Nihai senaryoda [{name}] bölümü bulunamadı.")
    return match.group(1).strip()


def extract_flow_headings(final_source: str) -> list[str]:
    main_flow = extract_script_section(final_source, "ANA AKIŞ")
    headings = [
        re.sub(r"\s+", " ", heading).strip().rstrip(".")
        for heading in re.findall(r"(?m)^\*\*(.+?)\*\*\s*$", main_flow)
    ]
    if not headings:
        raise SystemExit("Ana akışta yayın özeti için bölüm başlığı bulunamadı.")
    return headings[:6]


def extract_thumbnail_options(thumbnail_source: str) -> dict[str, str]:
    options: dict[str, str] = {}
    for letter in "ABC":
        match = re.search(
            rf"(?ms)^### Seçenek {letter}\s*$.*?^\- \*\*Kapak yazısı:\*\* `([^`]+)`",
            thumbnail_source,
        )
        if not match:
            raise SystemExit(f"Thumbnail paketinde Seçenek {letter} bulunamadı.")
        options[letter] = match.group(1).strip()
    return options


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--final", required=True)
    parser.add_argument("--thumbnail", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--final-url", required=True)
    parser.add_argument("--thumbnail-url", required=True)
    parser.add_argument("--thumbnail-choice", choices=("PENDING", "A", "B", "C"), required=True)
    parser.add_argument("--reservation-url", required=True)
    parser.add_argument("--test-mode", choices=("true", "false"), required=True)
    args = parser.parse_args()

    final_source = remove_comments(read_text(args.final))
    thumbnail_source = remove_comments(read_text(args.thumbnail))
    seo_title = extract_bold_field(final_source, "SEO Başlığı")
    description_first = extract_bold_field(final_source, "Açıklamanın İlk Cümlesi")
    hashtags = extract_bold_field(final_source, "Etiketler")
    playlist = extract_bold_field(final_source, "Playlist Önerisi")
    flow_headings = extract_flow_headings(final_source)
    thumbnail_options = extract_thumbnail_options(thumbnail_source)

    if not re.fullmatch(r"https://[^\s]+", args.reservation_url):
        raise SystemExit("Rezervasyon bağlantısı geçerli bir https adresi olmalı.")
    if args.test_mode == "false" and args.thumbnail_choice == "PENDING":
        raise SystemExit("Gerçek yayın paketi için Eren'in thumbnail seçimi gerekli.")

    hashtag_list = re.findall(r"#[^\s#]+", hashtags)
    if not hashtag_list:
        raise SystemExit("Nihai senaryoda hashtag bulunamadı.")
    keyword_line = ", ".join(tag.removeprefix("#") for tag in hashtag_list)
    description_bullets = "\n".join(f"- {heading}" for heading in flow_headings)
    chapter_rows = ["- `[ZAMAN EKLENECEK]` Açılış ve kanca"]
    chapter_rows.extend(f"- `[ZAMAN EKLENECEK]` {heading}" for heading in flow_headings)
    chapter_rows.append("- `[ZAMAN EKLENECEK]` Kapanış ve çağrı")

    selected_copy = (
        "Henüz seçilmedi — Eren'in kararı bekleniyor"
        if args.thumbnail_choice == "PENDING"
        else f"Seçenek {args.thumbnail_choice} — {thumbnail_options[args.thumbnail_choice]}"
    )
    status = (
        "🧪 Yüklemesiz sistem testi — gerçek YouTube kaydı veya yayın işlemi değildir"
        if args.test_mode == "true"
        else "📺 YouTube yayın hazırlık paketi — Eren'in son onayını bekliyor"
    )
    source_sha = hashlib.sha256(
        (
            final_source
            + "\n"
            + thumbnail_source
            + "\n"
            + args.thumbnail_choice
            + "\n"
            + args.reservation_url
        ).encode("utf-8")
    ).hexdigest()

    output = f"""> **Durum:** {status}

# ▶️ EREN MÜZİK ATÖLYESİ — YOUTUBE YAYIN HAZIRLIK PAKETİ

> Bu paket yalnızca metadata ve yayın kontrol taslağıdır. Video, altyazı veya thumbnail yüklenmedi; görünürlük ve zamanlama ayarlanmadı.

## 1. Kaynak ve Güvenlik Durumu

- **Kaynak thumbnail paketi:** {args.thumbnail_url}
- **Kaynak onaylı senaryo:** {args.final_url}
- **AI kullanımı:** 0 giriş tokenı, 0 çıkış tokenı, 0 web araması
- **YouTube API kullanımı:** 0
- **Yükleme/yayın işlemi:** 0
- **Onay kuralı:** Eren bu yayın paketi için açık onay vermeden video yüklenemez veya yayımlanamaz

## 2. Video Başlığı

```text
{seo_title}
```

- Başlık onaylı senaryodaki SEO başlığından değiştirilmeden alındı.
- Platform sınırları gerçek yükleme öncesinde yeniden kontrol edilmelidir.

## 3. Video Açıklaması

```text
{description_first}

Bu videoda:
{description_bullets}

Ders ve rezervasyon: {args.reservation_url}

{hashtags}
```

- Rezervasyon bağlantısı açılarak Eren tarafından son kez kontrol edilmelidir.
- Kaynakta bulunmayan başarı, süre veya sonuç vaadi eklenmemiştir.

## 4. Hashtag, Anahtar Kelime ve Oynatma Listesi

- **Hashtagler:** {hashtags}
- **Anahtar kelime taslağı:** {keyword_line}
- **Oynatma listesi:** {playlist}
- Hashtag yazımları nihai senaryodan aynen alındı; yayın öncesi Türkçe karakter kontrolü gereklidir.

## 5. Zaman Kodu Olmadan Bölüm Sırası

{chr(10).join(chapter_rows)}

> Gerçek video görülmediği için saniye tahmini yapılmadı. Zaman kodları kurgu tamamlandıktan sonra elle veya videodan çıkarılmalıdır.

## 6. Thumbnail Kararı

- **Seçim durumu:** {selected_copy}
- **Seçenek A:** `{thumbnail_options['A']}`
- **Seçenek B:** `{thumbnail_options['B']}`
- **Seçenek C:** `{thumbnail_options['C']}`
- Eren bir seçenek belirlemeden thumbnail dosyası oluşturulamaz veya yüklenemez.

## 7. Yükleme ve Görünürlük Durumu

- **Ana video dosyası:** Sağlanmadı
- **Zamanlanmış SRT dosyası:** Sağlanmadı
- **Onaylı thumbnail dosyası:** Sağlanmadı
- **YouTube'a video yükleme:** Yapılmadı
- **Thumbnail yükleme:** Yapılmadı
- **Altyazı yükleme:** Yapılmadı
- **Görünürlük:** Ayarlanmadı
- **Yayın tarihi/saati:** Ayarlanmadı

## 8. Eren'in Son Yayın Kontrol Listesi

- [ ] Gerçek video baştan sona izlendi mi?
- [ ] Başlık, açıklama, hashtagler ve oynatma listesi doğru mu?
- [ ] Rezervasyon bağlantısı açılıyor ve doğru sayfaya gidiyor mu?
- [ ] Gerçek videodan zaman kodları eklendi mi?
- [ ] Zamanlanmış SRT dosyası videoyla birebir uyumlu mu?
- [ ] Eren thumbnail seçimini yaptı ve son görseli onayladı mı?
- [ ] Telif hakkı bulunan müzik veya görsel var mı?
- [ ] Eren bu yayın paketi Issue'suna `ONAYLIYORUM` yazdı mı?
- [ ] Açık onay verilmeden yükleme ve yayın yapılmadığı doğrulandı mı?
"""

    if len(re.findall(r"(?m)^## [1-8]\.", output)) != 8:
        raise SystemExit("YouTube paketinde tam olarak sekiz bölüm bulunmalı.")
    if re.search(r"\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->", output):
        raise SystemExit("Videosuz YouTube paketinde gerçek zaman kodu bulunamaz.")
    if "yüklenmedi" not in output.casefold() or "yapılmadı" not in output.casefold():
        raise SystemExit("Yükleme ve yayın güvenlik kaydı eksik.")

    Path(args.output).write_text(output.strip() + "\n", encoding="utf-8")
    print(
        f"youtube_package_ok source_sha={source_sha} title_chars={len(seo_title)} "
        f"description_chars={len(description_first)} choice={args.thumbnail_choice}"
    )


if __name__ == "__main__":
    main()

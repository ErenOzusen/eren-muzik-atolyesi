#!/usr/bin/env python3
"""Create an untimed subtitle preparation package without an AI call."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import textwrap
from pathlib import Path


SECTION_NAMES = ("KANCA", "ANA AKIŞ", "KAPANIŞ VE CTA", "SHORTS KESİTİ")


def read_text(path: str) -> str:
    return Path(path).read_text(encoding="utf-8").replace("\r\n", "\n")


def remove_comments(text: str) -> str:
    return re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)


def extract_script_section(text: str, name: str) -> str:
    # Stops at whichever comes first: a "---" separator, the NEXT bracketed
    # section heading (**[...]**), or end of text. Stopping only at "---"/
    # end (the previous behavior) silently let one section's capture run
    # through every later section in the same scenario — e.g. KANCA would
    # swallow ANA AKIŞ, KAPANIŞ VE CTA and SHORTS KESİTİ too, since nothing
    # in the actual script-writing/correction prompts ever guaranteed a
    # "---" between individual bracketed sections (only, at best, between
    # whole scenarios). The extra alternation closes that regardless of
    # whether "---" is present.
    pattern = re.compile(
        rf"(?ms)^\*\*\[{re.escape(name)}\]\*\*\s*\n(.*?)(?=^\*\*\[[^\]]+\]\*\*\s*$|^---\s*$|\Z)"
    )
    match = pattern.search(text)
    if not match:
        raise SystemExit(f"Nihai senaryoda [{name}] bölümü bulunamadı.")
    return clean_spoken_text(match.group(1))


def select_scenario_block(text: str, scenario: int) -> str:
    # The "Nihai Senaryolar" issue body still holds all three scenarios side
    # by side — the production-selection gate only changes labels, it never
    # shortens the body. Every field/section extractor below runs a plain
    # re.search, which only ever returns the FIRST match in the whole text —
    # i.e. always SENARYO 1 — no matter which scenario the owner actually
    # selected for production. Isolating the selected scenario's own block
    # first keeps every later extraction correctly scoped to it.
    match = re.search(
        rf"(?ms)^##\s+SENARYO\s+{scenario}:.*?\n(.*?)(?=^##\s+SENARYO\s+[123]:|\Z)",
        text,
    )
    if not match:
        raise SystemExit(f"Nihai senaryoda SENARYO {scenario} bloğu bulunamadı.")
    return match.group(0)


def clean_spoken_text(text: str) -> str:
    text = remove_comments(text)
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"(?<!\*)\*(?!\*)(.*?)\*(?!\*)", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    paragraphs = []
    for block in re.split(r"\n\s*\n", text):
        normalized = re.sub(r"\s+", " ", block).strip()
        if normalized:
            paragraphs.append(normalized)
    return "\n\n".join(paragraphs)


def extract_editing_section(text: str, number: int) -> str:
    match = re.search(
        rf"(?ms)^##\s+{number}\.\s+.*?\n(.*?)(?=^---\s*$|^##\s+[1-9]\.\s+|\Z)",
        remove_comments(text),
    )
    if not match:
        raise SystemExit(f"Kurgu paketinde {number}. bölüm bulunamadı.")
    return match.group(1).strip()


def make_cues(text: str, width: int = 42) -> list[str]:
    flattened = re.sub(r"\s+", " ", text).strip()
    lines = textwrap.wrap(
        flattened,
        width=width,
        break_long_words=False,
        break_on_hyphens=False,
        replace_whitespace=True,
        drop_whitespace=True,
    )
    cues = ["\n".join(lines[index : index + 2]) for index in range(0, len(lines), 2)]
    rebuilt = re.sub(r"\s+", " ", " ".join(cues)).strip()
    if rebuilt != flattened:
        raise SystemExit("Altyazı satırlarına bölünürken konuşma metni değişti.")
    if any(len(line) > width for cue in cues for line in cue.splitlines()):
        raise SystemExit("Altyazı satır sınırı aşıldı.")
    return cues


def render_cues(cues: list[str]) -> str:
    return "\n\n".join(f"[{index:03d}]\n{cue}" for index, cue in enumerate(cues, 1))


def turkish_upper(value: str) -> str:
    return value.replace("i", "İ").replace("ı", "I").upper()


def load_profile(path: str) -> dict:
    profile = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(profile, dict):
        raise SystemExit("Business profile kökte bir JSON nesnesi olmalı.")
    return profile


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--final", required=True)
    parser.add_argument("--editing", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--final-url", required=True)
    parser.add_argument("--editing-url", required=True)
    parser.add_argument("--scenario", type=int, choices=(1, 2, 3), required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--test-mode", choices=("true", "false"), required=True)
    args = parser.parse_args()

    profile = load_profile(args.profile)
    business = profile["business"]
    content = profile["content"]
    brand = business["brand_name"]
    owner = business["owner_display_name"]
    category = business["category"]
    control_terms = list(dict.fromkeys([brand, category, *content["content_topics"]]))
    control_term_lines = "\n".join(f"- {term}" for term in control_terms)

    final_source = select_scenario_block(remove_comments(read_text(args.final)), args.scenario)
    editing_source = remove_comments(read_text(args.editing))

    parts = {name: extract_script_section(final_source, name) for name in SECTION_NAMES}
    main_spoken = "\n\n".join(
        (parts["KANCA"], parts["ANA AKIŞ"], parts["KAPANIŞ VE CTA"])
    )
    shorts_spoken = parts["SHORTS KESİTİ"]
    if len(main_spoken) < 800 or len(shorts_spoken) < 150:
        raise SystemExit("Konuşma metni güvenli uzunluk sınırının altında.")

    main_cues = make_cues(main_spoken)
    shorts_cues = make_cues(shorts_spoken)
    screen_texts = extract_editing_section(editing_source, 3)
    source_sha = hashlib.sha256(
        (final_source + "\n" + editing_source).encode("utf-8")
    ).hexdigest()

    status = (
        "🧪 Videosuz sistem testi — gerçek zaman kodu veya yayın dosyası değildir"
        if args.test_mode == "true"
        else f"📝 Altyazı hazırlık paketi — {owner} tarafından zamanlama ve yayın onayı bekleniyor"
    )

    output = f"""> **Durum:** {status}

# 💬 {turkish_upper(brand)} — ALTYAZI HAZIRLIK PAKETİ

> Ham video görülmediği için zaman kodu üretilmemiştir. Aşağıdaki metinler onaylı senaryodan değiştirilmeden bölünmüştür.

## 1. Kaynak ve Güvenlik Durumu

- **Kaynak kurgu paketi:** {args.editing_url}
- **Kaynak onaylı senaryo:** {args.final_url}
- **Seçilen senaryo:** {args.scenario}
- **AI kullanımı:** 0 giriş tokenı, 0 çıkış tokenı, 0 web araması
- **Metin koruması:** Kelimeler değiştirilmedi; yalnızca satır sonları eklendi
- **Zaman kodu:** Bilerek oluşturulmadı; gerçek ses duyulmadan saniye tahmini yapılmaz

## 2. Ana Video — Zamanlanmamış Altyazı Blokları

```text
{render_cues(main_cues)}
```

## 3. Shorts/Reels — Zamanlanmamış Altyazı Blokları

```text
{render_cues(shorts_cues)}
```

## 4. Ekran Yazıları

{screen_texts}

## 5. Elle Kontrol Edilecek Yazımlar

{control_term_lines}

## 6. Gerçek Videoda Zamanlama ve Dışa Aktarma

1. Ana video ve dikey videoyu ayrı projelerde aç.
2. Her bloğu duyulan ilk kelimede başlat, son kelimenin bitiminde kapat.
3. Bir ekranda en fazla iki satır ve satır başına en fazla 42 karakter kullan.
4. Ana videoda 16:9, Shorts/Reels'te 9:16 güvenli altyazı alanını kontrol et.
5. Otomatik zamanlama kullanılırsa {category} kategorisine ve içerik konularına özgü terimleri elle karşılaştır.
6. Son kontrolden sonra ana video ve Shorts/Reels için ayrı SRT dışa aktar.

## 7. {owner} Son Kontrol Listesi

- [ ] Altyazı metni videoda söylenenlerle birebir aynı mı?
- [ ] Her blok doğru kelimede başlayıp doğru kelimede bitiyor mu?
- [ ] İki satır ve 42 karakter sınırı korunuyor mu?
- [ ] Kategori/içerik terimleri ve marka adı doğru yazılmış mı?
- [ ] Altyazı önemli yüzleri, nesneleri veya gösterim alanını kapatıyor mu?
- [ ] Ana video ve Shorts/Reels ayrı kontrol edildi mi?
- [ ] Zaman kodlarında çakışma veya boşluk hatası var mı?
- [ ] {owner} altyazılı videoyu izledi ve yayın için onayladı mı?
"""

    if re.search(r"\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->", output):
        raise SystemExit("Videosuz pakette zaman kodu üretildi.")
    if output.count("## ") != 7:
        raise SystemExit("Altyazı paketinde tam olarak yedi bölüm bulunmalı.")

    Path(args.output).write_text(output.strip() + "\n", encoding="utf-8")
    print(
        f"subtitle_package_ok main_cues={len(main_cues)} "
        f"shorts_cues={len(shorts_cues)} source_sha={source_sha}"
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build a source-grounded thumbnail brief without calling an AI model."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


NUMBER_WORDS = (
    "bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on|yirmi|otuz|"
    "kırk|elli|altmış"
)


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
    # Stops at the next bracketed section heading too, not just "---"/end —
    # see build_subtitle_package.py's copy of this function for the full
    # explanation of the spillover bug this closes.
    match = re.search(
        rf"(?ms)^\*\*\[{re.escape(name)}\]\*\*\s*\n(.*?)(?=^\*\*\[[^\]]+\]\*\*\s*$|^---\s*$|\Z)",
        text,
    )
    if not match:
        raise SystemExit(f"Nihai senaryoda [{name}] bölümü bulunamadı.")
    section = re.sub(r"[*`]", "", match.group(1))
    return re.sub(r"\s+", " ", section).strip()


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


def words(text: str) -> list[str]:
    return re.findall(r"[0-9A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû]+", text)


def turkish_upper(text: str) -> str:
    return text.translate(str.maketrans({"i": "İ", "ı": "I"})).upper()


def limit_words(text: str, limit: int = 5, from_end: bool = False) -> str:
    tokens = words(text)
    if not tokens:
        raise SystemExit("Kapak yazısı üretmek için kaynak kelime bulunamadı.")
    selected = tokens[-limit:] if from_end and len(tokens) > limit else tokens[:limit]
    result = turkish_upper(" ".join(selected))
    if text.strip().endswith("?") and not result.endswith("?"):
        result += "?"
    return result


def build_copy_options(title: str, final_source: str) -> tuple[str, str, str, str | None]:
    if "?" in title:
        question, benefit = title.split("?", 1)
        question_copy = limit_words(question.strip() + "?")
        benefit_copy = limit_words(benefit.strip() or title, from_end=False)
    else:
        question_copy = limit_words(title)
        benefit_copy = limit_words(title, from_end=True)

    duration_match = re.search(
        rf"(?i)\b((?:{NUMBER_WORDS})(?:\s+(?:{NUMBER_WORDS}))?|\d+)\s+dakika\b",
        final_source,
    )
    duration = duration_match.group(0) if duration_match else None
    if duration:
        daily = bool(re.search(r"(?i)\bher gün\b", final_source))
        routine_copy = limit_words(("Her gün " if daily else "") + duration)
    else:
        routine_copy = limit_words(extract_script_section(final_source, "KANCA"))

    copies = [question_copy, benefit_copy, routine_copy]
    if len(set(copies)) != 3:
        raise SystemExit("Üç benzersiz kapak yazısı kaynak metinden üretilemedi.")
    if any(len(words(copy)) > 5 for copy in copies):
        raise SystemExit("Kapak yazısı beş kelime sınırını aştı.")
    return question_copy, benefit_copy, routine_copy, duration


def detect_subject(title: str, topics: list[str], category: str) -> str:
    lowered = title.casefold()
    for topic in sorted(topics, key=len, reverse=True):
        if topic.casefold() in lowered:
            return topic
    return category


def load_profile(path: str) -> dict:
    profile = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(profile, dict):
        raise SystemExit("Business profile kökte bir JSON nesnesi olmalı.")
    return profile


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--final", required=True)
    parser.add_argument("--subtitle", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--final-url", required=True)
    parser.add_argument("--subtitle-url", required=True)
    parser.add_argument("--scenario", type=int, choices=(1, 2, 3), required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--test-mode", choices=("true", "false"), required=True)
    args = parser.parse_args()

    profile = load_profile(args.profile)
    business = profile["business"]
    content = profile["content"]
    assets = profile["assets"]
    brand = business["brand_name"]
    owner = business["owner_display_name"]
    category = business["category"]
    topics = content["content_topics"]
    brand_colors = ", ".join(assets["brand_colors"])
    color_guidance = (
        f"Profilde tanımlı marka renkleri: {brand_colors}."
        if brand_colors
        else "Profilde tanımlı marka rengi yok; kaynak materyalle uyumlu tek vurgu rengi seç."
    )
    logo_guidance = (
        f"Profildeki logo kaynağı kullanılabilir: {assets['logo_path']}."
        if assets["logo_path"]
        else "Profilde logo kaynağı tanımlı değil; logo kullanımını zorunlu tutma."
    )
    asset_notes = assets["notes"] or "Ek görsel varlık notu yok."

    final_source = select_scenario_block(remove_comments(read_text(args.final)), args.scenario)
    subtitle_source = remove_comments(read_text(args.subtitle))
    seo_title = extract_bold_field(final_source, "SEO Başlığı")
    hook = extract_script_section(final_source, "KANCA")
    option_a, option_b, option_c, duration = build_copy_options(seo_title, final_source)
    subject = detect_subject(seo_title, topics, category)
    source_sha = hashlib.sha256(
        (
            final_source
            + "\n"
            + subtitle_source
            + "\n"
            + json.dumps(profile, ensure_ascii=False, sort_keys=True)
        ).encode("utf-8")
    ).hexdigest()

    number_hint = "Üç küçük 1–2–3 işaretiyle yöntem sayısını destekle." if re.search(
        r"\b3\b|\büç\b", seo_title, flags=re.IGNORECASE
    ) else "Tek bir güçlü görsel odak kullan; ek rozet ekleme."
    timer_hint = (
        f"Kaynakta geçen “{duration}” ifadesini küçük bir zaman simgesiyle destekle."
        if duration
        else "Kaynakta süre vaadi olmadığı için saat veya sayaç kullanma."
    )
    status = (
        "🧪 Videosuz sistem testi — gerçek kapak görseli veya yayın kaydı değildir"
        if args.test_mode == "true"
        else f"🎨 Thumbnail hazırlık paketi — görsel üretimi ve {owner} onayı bekleniyor"
    )

    output = f"""> **Durum:** {status}

# 🖼️ {turkish_upper(brand)} — THUMBNAIL HAZIRLIK PAKETİ

> Bu paket yalnızca tasarım brifidir. Görsel üretilmedi, dosya yüklenmedi ve yayın işlemi yapılmadı.

## 1. Kaynak ve Güvenlik Durumu

- **Kaynak altyazı paketi:** {args.subtitle_url}
- **Kaynak onaylı senaryo:** {args.final_url}
- **SEO başlığı:** {seo_title}
- **Seçilen senaryo:** {args.scenario}
- **İşletme kategorisi:** {category}
- **İçerik konusu:** {subject}
- **AI kullanımı:** 0 giriş tokenı, 0 çıkış tokenı, 0 web araması, 0 görsel üretimi
- **İddia koruması:** Kapak yazıları yalnızca onaylı başlık ve senaryodaki ifadelerden türetildi
- **Yayın durumu:** {owner} seçim yapmadan görsel üretilemez veya yayınlanamaz

## 2. Seçenek A — Arama Niyeti

### Seçenek A

- **Kapak yazısı:** `{option_a}`
- **Kompozisyon:** {owner} solda; {subject} sağda ve net biçimde görünür. Yüz ifadesi merak uyandırır ama abartılı olmaz.
- **Görsel hiyerarşi:** Yazı en büyük unsur, yüz ikinci, {subject} üçüncü unsur.
- **Amaç:** İzleyicinin başlıktaki temel soruyu bir bakışta anlaması.

## 3. Seçenek B — Yöntem/Fayda

### Seçenek B

- **Kapak yazısı:** `{option_b}`
- **Kompozisyon:** {owner} ve {subject} aynı karede; sade arka plan ve güçlü ön plan ayrımı kullan.
- **Sayı desteği:** {number_hint}
- **Amaç:** Videonun öğretici ve uygulanabilir yapısını göstermek.

## 4. Seçenek C — Rutin/Süre

### Seçenek C

- **Kapak yazısı:** `{option_c}`
- **Kompozisyon:** {subject.capitalize()} yakın planı ana görsel; {owner} daha küçük ikincil odak olabilir.
- **Süre desteği:** {timer_hint}
- **Amaç:** Kaynakta gerçekten bulunan uygulanabilir rutin veya kancayı öne çıkarmak.

## 5. Ortak Tasarım Kuralları

- Kapak yazısı en fazla 5 kelime olmalı; mobil ekranda küçültmeden okunmalı.
- Tek ana fikir, tek yüz ifadesi ve tek görsel odak kullanılmalı.
- {color_guidance}
- {logo_guidance}
- **Profil görsel notu:** {asset_notes}
- SEO başlığı kapakta bütünüyle tekrarlanmamalı.
- Kaynakta bulunmayan sonuç, süre, yüzde, kişi sayısı veya başarı vaadi eklenmemeli.
- Logo kullanılacaksa küçük tutulmalı; yazı ve yüzün önüne geçmemeli.

## 6. Gerekli Görsel Malzeme

- [ ] Yatay kadrajda {owner} için kullanılabilir, izinli bir görsel
- [ ] {subject.capitalize()} net görünen yakın veya orta plan fotoğrafı
- [ ] Seçenekler için yazısız temiz arka plan karesi
- [ ] Işık, kadraj ve netlik kontrolü
- [ ] Kullanılacak bütün görsellerin işletmeye ait veya kullanım izni alınmış olması

## 7. {owner} Seçim ve Son Kontrol Listesi

- [ ] Seçenek A, B ve C mobil boyutta karşılaştırıldı mı?
- [ ] Kapak yazısı videonun gerçek içeriğiyle birebir uyumlu mu?
- [ ] Kaynakta olmayan bir vaat veya sayı var mı?
- [ ] Görünen kişi, ana konu ve yazı birbirini kapatıyor mu?
- [ ] Türkçe karakterler ve marka adı doğru mu?
- [ ] {owner} seçimini `KAPAK A`, `KAPAK B` veya `KAPAK C` olarak verdi mi?
- [ ] Seçilen kapak {owner} tarafından son onay verilmeden yüklenmedi mi?
"""

    if len(re.findall(r"(?m)^## [1-7]\.", output)) != 7:
        raise SystemExit("Thumbnail paketinde tam olarak yedi bölüm bulunmalı.")
    if len(re.findall(r"(?m)^### Seçenek [ABC]$", output)) != 3:
        raise SystemExit("Thumbnail paketinde tam olarak üç seçenek bulunmalı.")
    if re.search(r"\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->", output):
        raise SystemExit("Thumbnail paketinde zaman kodu bulunamaz.")

    Path(args.output).write_text(output.strip() + "\n", encoding="utf-8")
    print(
        f"thumbnail_package_ok subject={subject!r} source_sha={source_sha} "
        f"copies={option_a!r}|{option_b!r}|{option_c!r}"
    )


if __name__ == "__main__":
    main()

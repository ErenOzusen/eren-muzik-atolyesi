#!/usr/bin/env python3
"""Validate the portable business profile and render a safe configuration report."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


REQUIRED_ROOT_KEYS = {
    "schema_version",
    "business",
    "offer",
    "content",
    "approval",
    "cost_control",
    "assets",
}
SENSITIVE_KEY_PATTERN = re.compile(
    r"(^|_)(api_?key|secret|password|passwd|token|private_?key|credential)s?($|_)",
    flags=re.IGNORECASE,
)
PLACEHOLDER_PATTERN = re.compile(r"ÖRNEK|GITHUB_KULLANICI|İŞLETME SAHİBİ|HİZMET 1|KONU 1")


def require(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def nonempty_text(value: Any, minimum: int = 1, maximum: int = 160) -> bool:
    return isinstance(value, str) and minimum <= len(value.strip()) <= maximum


def nonempty_unique_list(value: Any, maximum: int = 30) -> bool:
    if not isinstance(value, list) or not 1 <= len(value) <= maximum:
        return False
    if not all(nonempty_text(item) for item in value):
        return False
    normalized = [item.strip().casefold() for item in value]
    return len(normalized) == len(set(normalized))


def find_sensitive_keys(value: Any, path: str = "$", found: list[str] | None = None) -> list[str]:
    if found is None:
        found = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}"
            if SENSITIVE_KEY_PATTERN.search(key):
                found.append(child_path)
            find_sensitive_keys(child, child_path, found)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            find_sensitive_keys(child, f"{path}[{index}]", found)
    return found


def validate(profile: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    require(set(profile) == REQUIRED_ROOT_KEYS, "Kök alanlar şema sürümü 1 ile eşleşmiyor.", errors)
    require(profile.get("schema_version") == 1, "schema_version tam olarak 1 olmalı.", errors)

    business = profile.get("business") if isinstance(profile.get("business"), dict) else {}
    offer = profile.get("offer") if isinstance(profile.get("offer"), dict) else {}
    content = profile.get("content") if isinstance(profile.get("content"), dict) else {}
    research = content.get("research") if isinstance(content.get("research"), dict) else {}
    script = content.get("script") if isinstance(content.get("script"), dict) else {}
    quality_control = (
        content.get("quality_control")
        if isinstance(content.get("quality_control"), dict)
        else {}
    )
    correction = content.get("correction") if isinstance(content.get("correction"), dict) else {}
    final_technical_control = (
        content.get("final_technical_control")
        if isinstance(content.get("final_technical_control"), dict)
        else {}
    )
    approval = profile.get("approval") if isinstance(profile.get("approval"), dict) else {}
    cost = profile.get("cost_control") if isinstance(profile.get("cost_control"), dict) else {}
    assets = profile.get("assets") if isinstance(profile.get("assets"), dict) else {}

    require(nonempty_text(business.get("brand_name"), 2, 80), "Marka adı 2–80 karakter olmalı.", errors)
    require(nonempty_text(business.get("owner_display_name"), 2, 80), "İşletme sahibi adı gerekli.", errors)
    require(
        isinstance(business.get("github_owner"), str)
        and bool(re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?", business["github_owner"])),
        "GitHub sahibi geçerli kullanıcı adı biçiminde olmalı.",
        errors,
    )
    require(nonempty_text(business.get("category"), 2, 80), "Faaliyet alanı gerekli.", errors)
    require(bool(re.fullmatch(r"[a-z]{2}-[A-Z]{2}", str(business.get("language", "")))), "Dil kodu tr-TR biçiminde olmalı.", errors)
    require(bool(re.fullmatch(r"[A-Za-z_]+/[A-Za-z_]+", str(business.get("timezone", "")))), "Saat dilimi Europe/Istanbul biçiminde olmalı.", errors)

    require(nonempty_unique_list(offer.get("services")), "En az bir benzersiz hizmet gerekli.", errors)
    require(nonempty_unique_list(offer.get("available_equipment")), "En az bir mevcut ekipman gerekli.", errors)
    require(bool(re.fullmatch(r"https://[^\s]+", str(offer.get("reservation_url", "")))), "Rezervasyon bağlantısı https olmalı.", errors)
    require(nonempty_text(offer.get("primary_cta"), 2, 100), "Ana çağrı metni gerekli.", errors)

    require(nonempty_text(content.get("primary_platform"), 2, 40), "Birincil platform gerekli.", errors)
    require(nonempty_unique_list(content.get("secondary_formats")), "En az bir ikincil içerik biçimi gerekli.", errors)
    require(nonempty_unique_list(content.get("video_formats")), "En az bir video oranı gerekli.", errors)
    require(nonempty_unique_list(content.get("content_topics")), "En az bir içerik konusu gerekli.", errors)

    capture = content.get("capture") if isinstance(content.get("capture"), dict) else {}
    require(isinstance(content.get("capture"), dict), "content.capture bir nesne olmalı.", errors)
    require(
        nonempty_text(capture.get("primary_device")),
        "Ana kayıt cihazı (primary_device) boş olmayan bir metin olmalı.",
        errors,
    )
    available_equipment = (
        offer.get("available_equipment") if isinstance(offer.get("available_equipment"), list) else []
    )
    require(
        isinstance(capture.get("primary_device"), str)
        and capture.get("primary_device") in available_equipment,
        "Ana kayıt cihazı (primary_device), offer.available_equipment listesindeki bir ekipmanla birebir eşleşmelidir.",
        errors,
    )

    require(
        isinstance(research.get("lookback_days"), int) and 1 <= research["lookback_days"] <= 30,
        "Araştırma geriye bakış süresi 1–30 gün olmalı.",
        errors,
    )
    youtube_channels = research.get("youtube_channels")
    require(
        isinstance(youtube_channels, list) and 1 <= len(youtube_channels) <= 20,
        "Araştırma için 1–20 YouTube kanalı gerekli.",
        errors,
    )
    if isinstance(youtube_channels, list):
        valid_channels = all(
            isinstance(channel, dict)
            and set(channel) == {"name", "feed_url"}
            and nonempty_text(channel.get("name"), 2, 100)
            and isinstance(channel.get("feed_url"), str)
            and bool(
                re.fullmatch(
                    r"https://www\.youtube\.com/feeds/videos\.xml\?(?:channel_id|user)=[A-Za-z0-9_-]+",
                    channel["feed_url"],
                )
            )
            for channel in youtube_channels
        )
        require(valid_channels, "YouTube araştırma kanalları ad ve geçerli RSS adresi içermeli.", errors)
        if valid_channels:
            names = [channel["name"].strip().casefold() for channel in youtube_channels]
            urls = [channel["feed_url"] for channel in youtube_channels]
            require(len(names) == len(set(names)), "YouTube kanal adları benzersiz olmalı.", errors)
            require(len(urls) == len(set(urls)), "YouTube RSS adresleri benzersiz olmalı.", errors)
    require(
        isinstance(research.get("trend_feed_url"), str)
        and bool(re.fullmatch(r"https://[^\s]+", research["trend_feed_url"])),
        "Trend RSS adresi https olmalı.",
        errors,
    )
    require(nonempty_unique_list(research.get("news_extra_terms")), "En az bir ek haber arama terimi gerekli.", errors)
    require(bool(re.fullmatch(r"[A-Z]{2}", str(research.get("news_country", "")))), "Haber ülke kodu TR biçiminde olmalı.", errors)
    require(bool(re.fullmatch(r"[a-z]{2}", str(research.get("news_language", "")))), "Haber dil kodu tr biçiminde olmalı.", errors)
    channel_count = len(youtube_channels) if isinstance(youtube_channels, list) else 0
    require(
        isinstance(research.get("minimum_youtube_feeds"), int)
        and 1 <= research["minimum_youtube_feeds"] <= channel_count,
        "Minimum başarılı YouTube akışı kanal sayısını aşamaz.",
        errors,
    )
    require(research.get("minimum_news_feeds") == 1, "Minimum başarılı haber akışı tam olarak 1 olmalı.", errors)
    require(research.get("idea_count") == 5, "Araştırma ajanı sözleşmesi için fikir sayısı tam olarak 5 olmalı.", errors)
    require(
        isinstance(research.get("report_max_words"), int) and 500 <= research["report_max_words"] <= 1500,
        "Araştırma raporu kelime sınırı 500–1500 olmalı.",
        errors,
    )
    require(
        isinstance(research.get("source_char_limit"), int) and 4000 <= research["source_char_limit"] <= 20000,
        "Araştırma kaynak sınırı 4.000–20.000 karakter olmalı.",
        errors,
    )
    require(
        isinstance(research.get("max_model_output"), int) and 1000 <= research["max_model_output"] <= 4000,
        "Araştırma çıktı token bütçesi 1.000–4.000 olmalı.",
        errors,
    )

    require(script.get("idea_count") == 3, "Senaryo ajanı sözleşmesi için fikir sayısı tam olarak 3 olmalı.", errors)
    require(
        isinstance(script.get("target_min_words"), int)
        and isinstance(script.get("target_max_words"), int)
        and 200 <= script["target_min_words"] <= script["target_max_words"] <= 800,
        "Senaryo hedef uzunluğu 200–800 kelime aralığında ve sıralı olmalı.",
        errors,
    )
    require(
        isinstance(script.get("validation_min_words"), int)
        and isinstance(script.get("validation_max_words"), int)
        and 150 <= script["validation_min_words"] <= script.get("target_min_words", 0)
        and script.get("target_max_words", 10_000) <= script["validation_max_words"] <= 1000,
        "Senaryo doğrulama aralığı hedef kelime aralığını kapsamalı.",
        errors,
    )
    require(
        isinstance(script.get("shorts_min_seconds"), int)
        and isinstance(script.get("shorts_max_seconds"), int)
        and 15 <= script["shorts_min_seconds"] < script["shorts_max_seconds"] <= 90,
        "Shorts süresi 15–90 saniye aralığında ve sıralı olmalı.",
        errors,
    )
    require(
        isinstance(script.get("ideas_char_limit"), int) and 1000 <= script["ideas_char_limit"] <= 12000,
        "Senaryo fikir veri sınırı 1.000–12.000 karakter olmalı.",
        errors,
    )
    require(
        isinstance(script.get("max_model_output"), int) and 2000 <= script["max_model_output"] <= 6000,
        "Senaryo çıktı token bütçesi 2.000–6.000 olmalı.",
        errors,
    )

    require(
        isinstance(quality_control.get("max_script_chars"), int)
        and 10_000 <= quality_control["max_script_chars"] <= 60_000,
        "Kalite kontrol senaryo veri sınırı 10.000–60.000 karakter olmalı.",
        errors,
    )
    require(
        isinstance(quality_control.get("max_model_output"), int)
        and 2_000 <= quality_control["max_model_output"] <= 6_000,
        "Kalite kontrol çıktı token bütçesi 2.000–6.000 olmalı.",
        errors,
    )
    require(
        isinstance(quality_control.get("target_report_output"), int)
        and 1_000 <= quality_control["target_report_output"]
        <= quality_control.get("max_model_output", 0),
        "Kalite kontrol rapor hedefi 1.000 token ile model çıktı bütçesi arasında olmalı.",
        errors,
    )
    require(
        isinstance(quality_control.get("max_web_searches"), int)
        and 1 <= quality_control["max_web_searches"] <= 3,
        "Kalite kontrol web arama sınırı 1–3 olmalı.",
        errors,
    )
    require(
        nonempty_unique_list(quality_control.get("domain_rules"), maximum=20),
        "Kalite kontrol için 1–20 benzersiz sektör doğrulama kuralı gerekli.",
        errors,
    )

    require(
        correction.get("scenario_count") == script.get("idea_count") == 3,
        "Düzeltme ajanı senaryo sayısı senaryo ajanıyla eşleşmeli ve tam olarak 3 olmalı.",
        errors,
    )
    require(
        isinstance(correction.get("max_base_chars"), int)
        and 8_000 <= correction["max_base_chars"] <= 40_000,
        "Düzeltme temel metin sınırı 8.000–40.000 karakter olmalı.",
        errors,
    )
    require(
        isinstance(correction.get("max_qc_chars"), int)
        and 4_000 <= correction["max_qc_chars"] <= 30_000,
        "Düzeltme kalite raporu sınırı 4.000–30.000 karakter olmalı.",
        errors,
    )
    require(
        isinstance(correction.get("max_final_check_chars"), int)
        and 2_000 <= correction["max_final_check_chars"] <= 20_000,
        "Düzeltme son teknik kontrol sınırı 2.000–20.000 karakter olmalı.",
        errors,
    )
    source_cap_sum = sum(
        value
        for value in (
            correction.get("max_base_chars"),
            correction.get("max_qc_chars"),
            correction.get("max_final_check_chars"),
        )
        if isinstance(value, int)
    )
    require(
        isinstance(correction.get("max_total_input_chars"), int)
        and 15_000 <= correction["max_total_input_chars"] <= 80_000
        and correction["max_total_input_chars"] <= source_cap_sum,
        "Düzeltme toplam girdi sınırı 15.000–80.000 karakter olmalı ve kaynak sınırları toplamını aşmamalı.",
        errors,
    )
    require(
        isinstance(correction.get("max_model_output"), int)
        and 2_000 <= correction["max_model_output"] <= 6_000,
        "Düzeltme çıktı token bütçesi 2.000–6.000 olmalı.",
        errors,
    )
    require(
        nonempty_unique_list(correction.get("domain_rules"), maximum=20),
        "Düzeltme ajanı için 1–20 benzersiz sektör kuralı gerekli.",
        errors,
    )

    require(
        isinstance(final_technical_control.get("max_final_chars"), int)
        and 4_000 <= final_technical_control["max_final_chars"] <= 40_000,
        "Son teknik kontrol nihai metin sınırı 4.000–40.000 karakter olmalı.",
        errors,
    )
    require(
        isinstance(final_technical_control.get("max_qc_chars"), int)
        and 4_000 <= final_technical_control["max_qc_chars"] <= 30_000,
        "Son teknik kontrol QC sınırı 4.000–30.000 karakter olmalı.",
        errors,
    )
    final_technical_source_cap_sum = sum(
        value
        for value in (
            final_technical_control.get("max_final_chars"),
            final_technical_control.get("max_qc_chars"),
        )
        if isinstance(value, int)
    )
    require(
        isinstance(final_technical_control.get("max_total_input_chars"), int)
        and 8_000 <= final_technical_control["max_total_input_chars"] <= 60_000
        and final_technical_control["max_total_input_chars"] <= final_technical_source_cap_sum,
        "Son teknik kontrol toplam girdi sınırı 8.000–60.000 karakter olmalı ve kaynak sınırları toplamını aşmamalı.",
        errors,
    )
    require(
        isinstance(final_technical_control.get("max_model_output"), int)
        and 1_000 <= final_technical_control["max_model_output"] <= 3_000,
        "Son teknik kontrol çıktı token bütçesi 1.000–3.000 olmalı.",
        errors,
    )
    require(
        isinstance(final_technical_control.get("max_blockers"), int)
        and 1 <= final_technical_control["max_blockers"] <= 5,
        "Son teknik kontrol bloklayıcı bulgu sınırı 1–5 olmalı.",
        errors,
    )
    require(
        isinstance(final_technical_control.get("max_improvements"), int)
        and 1 <= final_technical_control["max_improvements"] <= 10,
        "Son teknik kontrol küçük iyileştirme sınırı 1–10 olmalı.",
        errors,
    )
    require(
        final_technical_control.get("require_explicit_qc_link") is True,
        "Son teknik kontrol açık QC kaynak bağlantısını zorunlu tutmalı.",
        errors,
    )
    require(
        nonempty_unique_list(final_technical_control.get("authoritative_facts"), maximum=20),
        "Son teknik kontrol için 1–20 benzersiz bağlayıcı uzman bilgisi gerekli.",
        errors,
    )
    require(
        nonempty_unique_list(final_technical_control.get("domain_rules"), maximum=20),
        "Son teknik kontrol için 1–20 benzersiz sektör kuralı gerekli.",
        errors,
    )

    require(approval.get("required") is True, "İşletme sahibi onayı zorunlu olmalı.", errors)
    require(nonempty_text(approval.get("production_command"), 3, 80), "Gerçek onay komutu gerekli.", errors)
    require(nonempty_text(approval.get("test_command"), 3, 80), "Test onay komutu gerekli.", errors)
    require(approval.get("production_command") != approval.get("test_command"), "Test ve gerçek onay komutları farklı olmalı.", errors)
    require(approval.get("allow_publication_without_owner_approval") is False, "Onaysız yayın kesin olarak kapalı olmalı.", errors)

    require(cost.get("prefer_no_ai_when_deterministic") is True, "Deterministik işlerde sıfır-token tercihi açık olmalı.", errors)
    require(nonempty_text(cost.get("default_model"), 2, 100), "Varsayılan model adı gerekli.", errors)
    require(cost.get("web_search_only_when_required") is True, "Web araması yalnızca gerektiğinde kullanılmalı.", errors)
    require(cost.get("usage_marker_required") is True, "Kullanım kaydı zorunlu olmalı.", errors)

    require(assets.get("logo_path") is None or nonempty_text(assets.get("logo_path")), "Logo yolu null veya geçerli metin olmalı.", errors)
    require(isinstance(assets.get("brand_colors"), list), "Marka renkleri liste olmalı.", errors)
    if isinstance(assets.get("brand_colors"), list):
        require(
            all(bool(re.fullmatch(r"#[0-9A-Fa-f]{6}", color)) for color in assets["brand_colors"]),
            "Marka renkleri #RRGGBB biçiminde olmalı.",
            errors,
        )
    require(nonempty_text(assets.get("notes"), 1, 500), "Varlık notu gerekli.", errors)

    require(not find_sensitive_keys(profile), "Profil dosyasına secret, token, parola veya API anahtarı konamaz.", errors)
    serialized = json.dumps(profile, ensure_ascii=False)
    require(not PLACEHOLDER_PATTERN.search(serialized), "Aktif profilde örnek/placeholder değer bırakılamaz.", errors)
    return errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--test-mode", choices=("true", "false"), required=True)
    args = parser.parse_args()

    config_path = Path(args.config)
    try:
        profile = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"İşletme profili okunamadı: {exc}") from exc
    if not isinstance(profile, dict):
        raise SystemExit("İşletme profili JSON nesnesi olmalı.")

    errors = validate(profile)
    if errors:
        raise SystemExit("İşletme profili geçersiz:\n- " + "\n- ".join(errors))

    business = profile["business"]
    offer = profile["offer"]
    content = profile["content"]
    research = content["research"]
    script = content["script"]
    quality_control = content["quality_control"]
    correction = content["correction"]
    final_technical_control = content["final_technical_control"]
    approval = profile["approval"]
    cost = profile["cost_control"]
    assets = profile["assets"]
    digest = hashlib.sha256(
        json.dumps(profile, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    status = (
        "🧪 Yapılandırma sistem testi — mevcut ajan davranışları değiştirilmedi"
        if args.test_mode == "true"
        else "⚙️ Aktif işletme profili doğrulandı"
    )

    output = f"""> **Durum:** {status}

# ⚙️ {business['brand_name']} — MARKA VE İŞLETME YAPILANDIRMA RAPORU

> Profil doğrulandı. Dosyada secret, token, parola veya API anahtarı bulunmuyor. Haftalık Araştırma, Senaryo, Kalite Kontrol, Düzeltme ve Son Teknik Kontrol ajanları merkezi profile bağlıdır; diğer ajanların kontrollü geçişi sürüyor.

## 1. İşletme Kimliği

- **Marka:** {business['brand_name']}
- **İşletme sahibi:** {business['owner_display_name']}
- **Yetkili GitHub hesabı:** `{business['github_owner']}`
- **Faaliyet alanı:** {business['category']}
- **Dil:** `{business['language']}`
- **Saat dilimi:** `{business['timezone']}`
- **Profil SHA-256:** `{digest}`

## 2. Hizmetler ve Mevcut İmkânlar

**Hizmetler**
{chr(10).join(f'- {item}' for item in offer['services'])}

**Mevcut ekipman**
{chr(10).join(f'- {item}' for item in offer['available_equipment'])}

- **Ana çekim cihazı:** {content['capture']['primary_device']}

## 3. İçerik ve Dönüşüm Ayarları

- **Birincil platform:** {content['primary_platform']}
- **İkincil biçimler:** {', '.join(content['secondary_formats'])}
- **Video oranları:** {', '.join(content['video_formats'])}
- **İçerik konuları:** {', '.join(content['content_topics'])}
- **Araştırma dönemi:** Son {research['lookback_days']} gün
- **Rakip YouTube akışı:** {len(research['youtube_channels'])} kanal
- **Haftalık fikir sayısı:** {research['idea_count']}
- **Araştırma çıktı bütçesi:** {research['max_model_output']} token
- **Haftalık senaryo sayısı:** {script['idea_count']}
- **Senaryo hedef uzunluğu:** {script['target_min_words']}–{script['target_max_words']} kelime
- **Senaryo çıktı bütçesi:** {script['max_model_output']} token
- **Kalite kontrol veri sınırı:** {quality_control['max_script_chars']} karakter
- **Kalite kontrol çıktı bütçesi:** {quality_control['max_model_output']} token
- **Kalite kontrol web arama sınırı:** {quality_control['max_web_searches']}
- **Sektörel doğrulama kuralı:** {len(quality_control['domain_rules'])}
- **Düzeltme toplam girdi sınırı:** {correction['max_total_input_chars']} karakter
- **Düzeltme çıktı bütçesi:** {correction['max_model_output']} token
- **Düzeltme sektörel kuralı:** {len(correction['domain_rules'])}
- **Son teknik kontrol toplam girdi sınırı:** {final_technical_control['max_total_input_chars']} karakter
- **Son teknik kontrol çıktı bütçesi:** {final_technical_control['max_model_output']} token
- **Son teknik kontrol bağlayıcı uzman bilgisi:** {len(final_technical_control['authoritative_facts'])}
- **Son teknik kontrol sektörel kuralı:** {len(final_technical_control['domain_rules'])}
- **Ana çağrı:** {offer['primary_cta']}
- **Rezervasyon bağlantısı:** {offer['reservation_url']}

## 4. Onay ve Yayın Güvenliği

- **İşletme sahibi onayı:** Zorunlu
- **Gerçek onay komutu:** `{approval['production_command']}`
- **Test onay komutu:** `{approval['test_command']}`
- **Onaysız yayın:** Kapalı
- Profil doğrulayıcısı bu güvenlik değerlerinin gevşetilmesini reddeder.

## 5. Maliyet Kontrolü

- **Deterministik işlerde sıfır-token:** Açık
- **Varsayılan model:** `{cost['default_model']}`
- **Web araması:** Yalnızca gerektiğinde
- **Ajan kullanım kaydı:** Zorunlu
- **Bu doğrulamanın AI kullanımı:** 0 giriş tokenı, 0 çıkış tokenı, 0 web araması

## 6. Marka Varlıkları

- **Logo:** {assets['logo_path'] or 'Henüz eklenmedi'}
- **Marka renkleri:** {', '.join(assets['brand_colors']) if assets['brand_colors'] else 'Henüz eklenmedi'}
- **Not:** {assets['notes']}
- Logo veya marka rengi bulunmaması otomasyonu durdurmaz; görsel üretim aşamasında {business['owner_display_name']} onayı gerekir.

## 7. Taşınabilirlik ve Geçiş Planı

- **Merkezi işletme profili:** ✅ Hazır
- **Kopyalanabilir boş şablon:** ✅ Hazır
- **Secret bilgilerin profilden ayrılması:** ✅ Doğrulandı
- **Haftalık Araştırma Ajanı profil ayarları:** ✅ Hazır
- **Haftalık Araştırma workflow bağlantısı:** ✅ Yetkili işletme sahibi {business['owner_display_name']} onayıyla hazır
- **Haftalık Senaryo Ajanı profil ayarları:** ✅ Hazır
- **Haftalık Senaryo workflow bağlantısı:** ✅ Yetkili işletme sahibi {business['owner_display_name']} onayıyla hazır
- **Kalite Kontrol Ajanı profil ayarları:** ✅ Hazır
- **Kalite Kontrol workflow bağlantısı:** ✅ Yetkili işletme sahibi {business['owner_display_name']} onayıyla hazır
- **Düzeltme Ajanı profil ayarları:** ✅ Hazır
- **Düzeltme workflow bağlantısı:** ✅ Yetkili işletme sahibi {business['owner_display_name']} onayıyla hazır
- **Son Teknik Kontrol Ajanı profil ayarları:** ✅ Hazır
- **Son Teknik Kontrol workflow bağlantısı:** ✅ Yetkili işletme sahibi {business['owner_display_name']} onayıyla hazır
- **Diğer ajanların profile bağlanması:** ⏳ Sıradaki aşama
- **İkinci işletme ile çoğaltma testi:** ⏳ Profil geçişinden sonra
- Geçişi tamamlanmamış ajanlar profildeki {business['brand_name']} ayarlarıyla aynı biçimde çalışmaya devam eder.
"""

    if len(re.findall(r"(?m)^## [1-7]\.", output)) != 7:
        raise SystemExit("Yapılandırma raporunda tam olarak yedi bölüm bulunmalı.")

    Path(args.output).write_text(output.strip() + "\n", encoding="utf-8")
    print(
        f"business_config_ok brand={business['brand_name']!r} services={len(offer['services'])} "
        f"topics={len(content['content_topics'])} sha256={digest}"
    )


if __name__ == "__main__":
    main()

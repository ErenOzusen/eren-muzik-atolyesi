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

> Profil doğrulandı. Dosyada secret, token, parola veya API anahtarı bulunmuyor. Bu ilk aşamada mevcut ajanlar henüz merkezi profile geçirilmedi.

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

## 3. İçerik ve Dönüşüm Ayarları

- **Birincil platform:** {content['primary_platform']}
- **İkincil biçimler:** {', '.join(content['secondary_formats'])}
- **Video oranları:** {', '.join(content['video_formats'])}
- **İçerik konuları:** {', '.join(content['content_topics'])}
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
- Logo veya marka rengi bulunmaması otomasyonu durdurmaz; görsel üretim aşamasında Eren onayı gerekir.

## 7. Taşınabilirlik ve Geçiş Planı

- **Merkezi işletme profili:** ✅ Hazır
- **Kopyalanabilir boş şablon:** ✅ Hazır
- **Secret bilgilerin profilden ayrılması:** ✅ Doğrulandı
- **Mevcut ajanların profile bağlanması:** ⏳ Sıradaki aşama
- **İkinci işletme ile çoğaltma testi:** ⏳ Profil geçişinden sonra
- Ajanlar profile bağlanana kadar mevcut Eren Müzik Atölyesi iş akışları aynı biçimde çalışmaya devam eder.
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

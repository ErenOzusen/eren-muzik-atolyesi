#!/usr/bin/env python3
"""Zero-network tests for output_contract.py."""

from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("output_contract.py")
spec = importlib.util.spec_from_file_location("output_contract", SCRIPT_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("output_contract.py yüklenemedi")
output_contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(output_contract)

CONTRACT_PATH = SCRIPT_PATH.parent.parent / "config" / "contracts" / "filming-package.json"


def good_filming_package() -> str:
    """Canonical, device-agnostic output — what every NEW production run must emit,
    regardless of which primary_device the business profile selects."""
    return """# 🎥 EREN MÜZİK ATÖLYESİ — ÇEKİM PAKETİ

## 1. Çekimden Önce Ortak Hazırlık
Kayıt cihazını hazırla. Pil ve depolamayı kontrol et. Sessiz odayı seç ve kısa deneme kaydı al.

## 2. Oda ve Kayıt Cihazı Yerleşimi
Pencere önde olsun. Kayıt cihazı güvenli bir yüzeye sabitlensin ve düşme kontrolü yapılsın.

## 3. Seçilen Senaryo Çekim Planı
Sıra | Bölüm | Kayıt Cihazı/Kadraj | Eren'in Yapacağı | Ses/Işık | Kontrol
--- | --- | --- | --- | --- | ---
1 | Kanca | Yatay yakın plan | Metni söyle | Pencere ışığı | Ses patlamıyor
2 | Gösterim | Eller ve gitar | Bölümü çal | Sessiz oda | Kadraj temiz
3 | CTA | Orta plan | CTA'yı söyle | Aynı ışık | Metin tam

## 4. Shorts/Reels Dikey Çekimi
Aynı kancayı ayrıca dikey çek. Kayıt cihazını güvenli biçimde yeniden konumlandır ve kısa kayıt al.

## 5. En Verimli Çekim Sırası
Önce tüm yatay planları, ardından dikey planı çek. Kayıt cihazının konumunu gereksiz yere değiştirme.

## 6. Çekim Sonu Dosya Kontrolü
Dosyaları aç, ses ve görüntüyü kontrol et. Eksik veya bozuk kayıt varsa yalnız o bölümü yeniden çek.

""" + ("Kontrol notu. " * 30)


def good_filming_package_second_business() -> str:
    """Canonical output for a non-phone business (Mavi Diş Kliniği, primary_device =
    'Klinik kamera'). Must pass the same shared contract without any phone wording."""
    return """# 🎥 MAVİ DİS KLİNİGİ — ÇEKİM PAKETİ

## 1. Çekimden Önce Ortak Hazırlık
Kayıt cihazını hazırla. Pil ve depolamayı kontrol et. Sessiz odayı seç ve kısa deneme kaydı al.

## 2. Oda ve Kayıt Cihazı Yerleşimi
Pencere önde olsun. Kayıt cihazı güvenli bir yüzeye sabitlensin ve düşme kontrolü yapılsın.

## 3. Seçilen Senaryo Çekim Planı
Sıra | Bölüm | Kayıt Cihazı/Kadraj | Klinik Yoneticisi'nin Yapacağı | Ses/Işık | Kontrol
--- | --- | --- | --- | --- | ---
1 | Kanca | Yatay yakın plan | Metni söyle | Pencere ışığı | Ses patlamıyor
2 | Gösterim | Muayene uniti | Bölümü anlat | Sessiz oda | Kadraj temiz
3 | CTA | Orta plan | CTA'yı söyle | Aynı ışık | Metin tam

## 4. Shorts/Reels Dikey Çekimi
Aynı kancayı ayrıca dikey çek. Kayıt cihazını güvenli biçimde yeniden konumlandır ve kısa kayıt al.

## 5. En Verimli Çekim Sırası
Önce tüm yatay planları, ardından dikey planı çek. Kayıt cihazının konumunu gereksiz yere değiştirme.

## 6. Çekim Sonu Dosya Kontrolü
Dosyaları aç, ses ve görüntüyü kontrol et. Eksik veya bozuk kayıt varsa yalnız o bölümü yeniden çek.

""" + ("Kontrol notu. " * 30)


def legacy_good_filming_package() -> str:
    """Old phone-specific output format, exactly as previously emitted before Paket 2.
    Must still be accepted for backward compatibility with past Issues/output, even
    though no NEW production run will ever generate this form again."""
    return """# 🎥 EREN MÜZİK ATÖLYESİ — TELEFONLA ÇEKİM PAKETİ

## 1. Çekimden Önce Ortak Hazırlık
Telefonu hazırla. Pil ve depolamayı kontrol et. Sessiz odayı seç ve kısa deneme kaydı al.

## 2. Oda ve Telefon Yerleşimi
Pencere önde olsun. Telefon güvenli bir yüzeye sabitlensin ve düşme kontrolü yapılsın.

## 3. Seçilen Senaryo Çekim Planı
Sıra | Bölüm | Telefon/Kadraj | Eren'in Yapacağı | Ses/Işık | Kontrol
--- | --- | --- | --- | --- | ---
1 | Kanca | Yatay yakın plan | Metni söyle | Pencere ışığı | Ses patlamıyor
2 | Gösterim | Eller ve gitar | Bölümü çal | Sessiz oda | Kadraj temiz
3 | CTA | Orta plan | CTA'yı söyle | Aynı ışık | Metin tam

## 4. Shorts/Reels Dikey Çekimi
Aynı kancayı ayrıca dikey çek. Telefonu güvenli biçimde yeniden konumlandır ve kısa kayıt al.

## 5. En Verimli Çekim Sırası
Önce tüm yatay planları, ardından dikey planı çek. Telefon konumunu gereksiz yere değiştirme.

## 6. Çekim Sonu Dosya Kontrolü
Dosyaları aç, ses ve görüntüyü kontrol et. Eksik veya bozuk kayıt varsa yalnız o bölümü yeniden çek.

""" + ("Kontrol notu. " * 30)


class OutputContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

    def test_good_package_passes(self) -> None:
        errors = output_contract.validate_text(good_filming_package(), self.contract)
        self.assertEqual(errors, [])

    def test_good_package_second_business_passes(self) -> None:
        errors = output_contract.validate_text(good_filming_package_second_business(), self.contract)
        self.assertEqual(errors, [])

    def test_legacy_phone_format_still_passes(self) -> None:
        """Backward compatibility: past Issues/output written in the old phone-specific
        format must not be retroactively invalidated by this contract."""
        errors = output_contract.validate_text(legacy_good_filming_package(), self.contract)
        self.assertEqual(errors, [])

    def test_missing_section_is_rejected(self) -> None:
        bad = good_filming_package().replace("## 4. Shorts/Reels Dikey Çekimi", "## Dikey Çekim")
        errors = output_contract.validate_text(bad, self.contract)
        self.assertTrue(any(item.startswith("missing:") for item in errors))
        self.assertTrue(any(item.startswith("count:") for item in errors))

    def test_stale_approval_warning_is_rejected(self) -> None:
        bad = good_filming_package() + "\nEren onayı bekleniyor.\n"
        errors = output_contract.validate_text(bad, self.contract)
        self.assertTrue(any(item.startswith("forbidden:") for item in errors))

    def test_extra_scenario_heading_is_rejected(self) -> None:
        bad = good_filming_package() + "\n## 7. Senaryo 2\nBaşka içerik\n"
        errors = output_contract.validate_text(bad, self.contract)
        self.assertTrue(any(item.startswith("forbidden:") for item in errors))

    def test_too_short_output_is_rejected(self) -> None:
        errors = output_contract.validate_text("kısa", self.contract)
        self.assertTrue(any(item.startswith("too_short:") for item in errors))

    def test_wrong_title_wording_is_rejected(self) -> None:
        """Neither the old nor the new title wording alone is enough; the title must
        actually match one of the two accepted canonical/legacy forms."""
        bad = good_filming_package().replace("— ÇEKİM PAKETİ", "— ÇEKİM PLANI")
        errors = output_contract.validate_text(bad, self.contract)
        self.assertTrue(any(item.startswith("missing:") for item in errors))


if __name__ == "__main__":
    unittest.main(verbosity=2)

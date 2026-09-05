#!/usr/bin/env python3
"""Zero-network tests for targeted correction request/output transformation."""

from __future__ import annotations

import unittest

import targeted_correction_transform as transform


BASE = """## Senaryo 1: Birinci başlık
S1_APPROVED_BODY

---

## Senaryo 2: Popüler Bir Şarkıyı Öğren
S2_ORIGINAL_BODY

---

## Senaryo 3: Üçüncü başlık
S3_APPROVED_BODY
"""

QC = """# SENARYO 1
## 5. SENARYO KARARI
**YAYINA HAZIR**

---

# SENARYO 2
## 3. HASSASİYET ÖNERİLERİ
- Başlık popüler şarkı diyor ancak somut şarkı yok.
## 5. SENARYO KARARI
**DÜZELTME GEREKİYOR** — Başlığı içerikle eşleştir.

---

# SENARYO 3
## 5. SENARYO KARARI
**YAYINA HAZIR**

# GENEL TUTARLILIK KONTROLÜ
GENEL KARAR: DÜZELTME GEREKİYOR
"""

SYSTEM = """Sen Test Marka için çalışan nihai senaryo düzeltme editörüsün.
2. Yeni web araştırması yapma; kaynak, fiyat, kampanya veya doğrulanmamış bilgi uydurma.

ÇIKTI SÖZLEŞMESİ:
- Tam olarak 3 senaryo üret.
- İlk satır tam olarak: # 🎬 Test Marka — NİHAİ SENARYOLAR
- Her senaryoda gerekli alanlar bulunsun.
"""

PROMPT = f"TEMEL SENARYO METNİ — https://example.test/base\n\n{BASE}\n\nKALİTE KONTROL RAPORU — https://example.test/qc\n\n{QC}"


class TargetedCorrectionTransformTests(unittest.TestCase):
    def test_prepare_sends_only_blocked_scenario(self) -> None:
        prepared = transform.prepare_request(prompt=PROMPT, system_prompt=SYSTEM)
        self.assertEqual(prepared["context"]["blocked"], [2])
        self.assertIn("S2_ORIGINAL_BODY", prepared["prompt"])
        self.assertNotIn("S1_APPROVED_BODY", prepared["prompt"])
        self.assertNotIn("S3_APPROVED_BODY", prepared["prompt"])
        self.assertIn("Başlık popüler şarkı diyor", prepared["prompt"])
        self.assertIn("Yalnız şu senaryoları düzelt: 2", prepared["system_prompt"])
        self.assertIn("doğrulanmamış ayrıntı uydurmak yerine başlığı", prepared["system_prompt"])
        self.assertNotIn("Tam olarak 3 senaryo üret", prepared["system_prompt"])

    def test_finalize_preserves_approved_scenarios_and_replaces_only_two(self) -> None:
        prepared = transform.prepare_request(prompt=PROMPT, system_prompt=SYSTEM)
        model_text = """## SENARYO 2: Bir Şarkıyı Gitarda Nasıl Öğrenirsin?
S2_CORRECTED_BODY

### Uygulanan QC düzeltmeleri
- Somut şarkı varmış gibi davranan başlık, mevcut genel içerikle eşleştirildi.
"""
        final_text = transform.finalize_output(text=model_text, context=prepared["context"])
        self.assertTrue(final_text.startswith("# 🎬 Test Marka — NİHAİ SENARYOLAR\n"))
        self.assertIn("S1_APPROVED_BODY", final_text)
        self.assertIn("S2_CORRECTED_BODY", final_text)
        self.assertIn("S3_APPROVED_BODY", final_text)
        self.assertNotIn("S2_ORIGINAL_BODY", final_text)
        self.assertEqual(final_text.count("Uygulanan QC düzeltmeleri"), 3)
        self.assertEqual(final_text.count("Yok — QC kararı YAYINA HAZIR"), 2)
        self.assertEqual(final_text.count("\n---\n"), 2)
        self.assertEqual(final_text.count("## SENARYO 1:"), 1)
        self.assertEqual(final_text.count("## SENARYO 2:"), 1)
        self.assertEqual(final_text.count("## SENARYO 3:"), 1)

    def test_model_cannot_rewrite_an_approved_scenario(self) -> None:
        prepared = transform.prepare_request(prompt=PROMPT, system_prompt=SYSTEM)
        bad = """## SENARYO 1: Yeniden yazılmış
BAD
### Uygulanan QC düzeltmeleri
- bad

## SENARYO 2: Düzeltme
OK
### Uygulanan QC düzeltmeleri
- ok
"""
        with self.assertRaisesRegex(ValueError, "expected exactly"):
            transform.finalize_output(text=bad, context=prepared["context"])

    def test_no_blocked_scenario_fails_closed_without_ai_request(self) -> None:
        all_ready = QC.replace("**DÜZELTME GEREKİYOR** — Başlığı içerikle eşleştir.", "**YAYINA HAZIR**")
        all_ready = all_ready.replace("GENEL KARAR: DÜZELTME GEREKİYOR", "GENEL KARAR: YAYINA HAZIR")
        prompt = f"TEMEL SENARYO METNİ — x\n\n{BASE}\n\nKALİTE KONTROL RAPORU — y\n\n{all_ready}"
        with self.assertRaisesRegex(ValueError, "no scenario explicitly marked"):
            transform.prepare_request(prompt=prompt, system_prompt=SYSTEM)


if __name__ == "__main__":
    unittest.main()

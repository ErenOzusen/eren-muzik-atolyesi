#!/usr/bin/env python3
"""Zero-network tests for the AI provider router.

These tests exercise provider ordering, credential/model skipping, system prompt
preservation, API fallback, and quality-contract fallback without calling any
external AI API, so they consume 0 AI tokens.
"""

from __future__ import annotations

import importlib.util
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch


ROUTER_PATH = Path(__file__).with_name("ai_router.py")
spec = importlib.util.spec_from_file_location("ai_router", ROUTER_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("ai_router.py yüklenemedi")
ai_router = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ai_router)

CONTRACT_PATH = ROUTER_PATH.parent.parent / "config" / "contracts" / "filming-package.json"


def good_filming_package() -> str:
    return """# 🎥 EREN MÜZİK ATÖLYESİ — TELEFONLA ÇEKİM PAKETİ

## 1. Çekimden Önce Ortak Hazırlık
Telefonu hazırla. Pil, depolama ve Rahatsız Etmeyin ayarını kontrol et. Sessiz odada kısa deneme kaydı al.

## 2. Oda ve Telefon Yerleşimi
Pencere önde olsun. Telefonu güvenli bir yüzeye sabitle ve düşme kontrolü yap.

## 3. Seçilen Senaryo Çekim Planı
Sıra | Bölüm | Telefon/Kadraj | Eren'in Yapacağı | Ses/Işık | Kontrol
--- | --- | --- | --- | --- | ---
1 | Kanca | Yatay yakın plan | Metni söyle | Pencere ışığı | Ses patlamıyor
2 | Gösterim | Eller ve gitar | Bölümü çal | Sessiz oda | Kadraj temiz
3 | CTA | Orta plan | CTA'yı söyle | Aynı ışık | Metin tam

## 4. Shorts/Reels Dikey Çekimi
Aynı kancayı ayrıca dikey çek. Telefonu güvenli biçimde yeniden konumlandır.

## 5. En Verimli Çekim Sırası
Önce tüm yatay planları, ardından dikey planı çek. Telefon konumunu gereksiz yere değiştirme.

## 6. Çekim Sonu Dosya Kontrolü
Dosyaları aç, ses ve görüntüyü kontrol et. Eksik kayıt varsa yalnız o bölümü yeniden çek.

""" + ("Kontrol notu. " * 30)


class RouterUnitTests(unittest.TestCase):
    def test_resolve_model_prefers_env_then_primary_then_default(self) -> None:
        provider = {
            "model_env": "TEST_MODEL",
            "use_primary_model_as_default": True,
            "default_model": "fallback-model",
        }
        with patch.dict(os.environ, {"TEST_MODEL": "env-model"}, clear=False):
            self.assertEqual(ai_router.resolve_model("x", provider, "primary-model"), "env-model")
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(ai_router.resolve_model("x", provider, "primary-model"), "primary-model")

        provider["use_primary_model_as_default"] = False
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(ai_router.resolve_model("x", provider, "primary-model"), "fallback-model")

    def test_resolve_endpoint_prefers_env_and_requires_https(self) -> None:
        provider = {
            "endpoint_env": "TEST_ENDPOINT",
            "default_endpoint": "https://default.example/v1/chat",
        }
        with patch.dict(os.environ, {"TEST_ENDPOINT": "https://env.example/v1/chat"}, clear=False):
            self.assertEqual(ai_router.resolve_endpoint(provider), "https://env.example/v1/chat")
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(ai_router.resolve_endpoint(provider), "https://default.example/v1/chat")
        self.assertEqual(ai_router.resolve_endpoint({"endpoint": "http://unsafe.example"}), "")

    def test_usable_rejects_empty_truncated_and_filtered_results(self) -> None:
        ok = {"http_status": 200, "text": "OK", "stop_reason": "end_turn"}
        self.assertTrue(ai_router.usable(ok))
        self.assertFalse(ai_router.usable({**ok, "text": ""}))
        self.assertFalse(ai_router.usable({**ok, "http_status": 429}))
        self.assertFalse(ai_router.usable({**ok, "stop_reason": "max_tokens"}))
        self.assertFalse(ai_router.usable({**ok, "stop_reason": "content_filter"}))

    def test_anthropic_payload_preserves_system_prompt(self) -> None:
        response = {
            "content": [{"type": "text", "text": "OK"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 2},
        }
        with patch.object(ai_router, "request_json", return_value=(200, response)) as mocked:
            result = ai_router.call_anthropic(
                "https://anthropic.invalid/messages",
                "key",
                "model",
                "SYSTEM RULES",
                "USER PROMPT",
                100,
                5,
            )
        payload = mocked.call_args.args[2]
        self.assertEqual(payload["system"], "SYSTEM RULES")
        self.assertEqual(payload["messages"], [{"role": "user", "content": "USER PROMPT"}])
        self.assertEqual(result["text"], "OK")

    def test_openai_payload_preserves_system_prompt(self) -> None:
        response = {
            "choices": [{"message": {"content": "OK"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 3},
        }
        with patch.object(ai_router, "request_json", return_value=(200, response)) as mocked:
            result = ai_router.call_openai_chat(
                "https://openai.invalid/chat",
                "key",
                "model",
                "SYSTEM RULES",
                "USER PROMPT",
                100,
                5,
            )
        payload = mocked.call_args.args[2]
        self.assertEqual(
            payload["messages"],
            [
                {"role": "system", "content": "SYSTEM RULES"},
                {"role": "user", "content": "USER PROMPT"},
            ],
        )
        self.assertEqual(result["text"], "OK")

    def test_usage_totals_include_failed_attempt_costs(self) -> None:
        attempts = [
            {"input_tokens": 100, "output_tokens": 5},
            {"input_tokens": 120, "output_tokens": 20},
            {"status": "skipped"},
        ]
        self.assertEqual(ai_router.usage_totals(attempts), (220, 25))

    def test_provider_order_and_fallback_can_be_simulated_without_network(self) -> None:
        order = ["anthropic", "openai", "deepseek", "qwen"]
        fixtures = {
            "anthropic": {"http_status": 429, "text": "", "stop_reason": None},
            "openai": {"http_status": 200, "text": "AI_ROUTER_OK", "stop_reason": "stop"},
        }
        attempts: list[str] = []
        winner = None
        for provider_name in order:
            if provider_name not in fixtures:
                continue
            attempts.append(provider_name)
            if ai_router.usable(fixtures[provider_name]):
                winner = provider_name
                break

        self.assertEqual(attempts, ["anthropic", "openai"])
        self.assertEqual(winner, "openai")

    def test_quality_failure_falls_through_to_next_provider_without_network(self) -> None:
        contract = ai_router.load_contract(str(CONTRACT_PATH))
        order = ["anthropic", "openai"]
        fixtures = {
            "anthropic": {
                "http_status": 200,
                "text": "Teknik olarak cevap geldi ama çekim paketi biçimi yanlış.",
                "stop_reason": "end_turn",
                "input_tokens": 90,
                "output_tokens": 20,
            },
            "openai": {
                "http_status": 200,
                "text": good_filming_package(),
                "stop_reason": "stop",
                "input_tokens": 100,
                "output_tokens": 70,
            },
        }
        attempts = []
        winner = None
        for provider_name in order:
            result = fixtures[provider_name]
            attempt = {
                "provider": provider_name,
                "input_tokens": result["input_tokens"],
                "output_tokens": result["output_tokens"],
            }
            if not ai_router.usable(result):
                attempt["status"] = "failed"
                attempts.append(attempt)
                continue
            errors = ai_router.quality_errors(result["text"], contract)
            if errors:
                attempt["status"] = "rejected_quality"
                attempts.append(attempt)
                continue
            attempt["status"] = "success"
            attempts.append(attempt)
            winner = provider_name
            break

        self.assertEqual([item["status"] for item in attempts], ["rejected_quality", "success"])
        self.assertEqual(winner, "openai")
        self.assertEqual(ai_router.usage_totals(attempts), (190, 90))

    def test_quality_contract_is_backward_compatible_when_not_requested(self) -> None:
        self.assertEqual(ai_router.quality_errors("Herhangi bir kullanılabilir çıktı", None), [])

    def test_real_config_has_unique_known_provider_order(self) -> None:
        config_path = ROUTER_PATH.parent.parent / "config" / "ai-router.json"
        config = json.loads(config_path.read_text(encoding="utf-8"))
        order = config["routing"]["default_order"]
        self.assertEqual(order, ["anthropic", "openai", "deepseek", "qwen"])
        self.assertEqual(len(order), len(set(order)))
        for name in order:
            provider = config["providers"][name]
            self.assertIn(provider["api_style"], {"anthropic_messages", "openai_chat"})
            endpoint = provider.get("endpoint") or provider.get("default_endpoint", "")
            self.assertTrue(endpoint.startswith("https://"))


if __name__ == "__main__":
    unittest.main(verbosity=2)

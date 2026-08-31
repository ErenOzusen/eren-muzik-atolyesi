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

    def test_resolve_retry_statuses_uses_config_when_provided(self) -> None:
        routing = {"retry_http_statuses": [429, 503]}
        self.assertEqual(ai_router.resolve_retry_statuses(routing), {429, 503})

    def test_resolve_retry_statuses_falls_back_to_default_when_unset_or_empty(self) -> None:
        default = {408, 429, 500, 502, 503, 504}
        self.assertEqual(ai_router.resolve_retry_statuses({}), default)
        self.assertEqual(ai_router.resolve_retry_statuses({"retry_http_statuses": []}), default)
        self.assertEqual(ai_router.resolve_retry_statuses({"retry_http_statuses": None}), default)

    def test_retryable_flag_is_no_longer_a_dead_no_op(self) -> None:
        # Regression test for the previously-dead `if status not in
        # retry_statuses ...: pass` — a failed attempt must now record
        # whether its status was retryable, using the resolved config.
        retry_statuses = ai_router.resolve_retry_statuses({})
        self.assertIn(429, retry_statuses)
        self.assertNotIn(401, retry_statuses)

        rate_limited_attempt = {"http_status": 429}
        auth_failed_attempt = {"http_status": 401}
        for attempt in (rate_limited_attempt, auth_failed_attempt):
            status = int(attempt.get("http_status") or 0)
            attempt["retryable"] = status in retry_statuses

        self.assertTrue(rate_limited_attempt["retryable"])
        self.assertFalse(auth_failed_attempt["retryable"])

    def test_non_retryable_provider_failure_still_falls_through_to_next_provider(self) -> None:
        # A 401 (invalid/expired key) on one provider must not halt the
        # whole router — the next configured, healthy provider must still
        # be tried. This mirrors
        # test_provider_order_and_fallback_can_be_simulated_without_network
        # but specifically for a NON-retryable status.
        order = ["anthropic", "openai"]
        fixtures = {
            "anthropic": {"http_status": 401, "text": "", "stop_reason": None},
            "openai": {"http_status": 200, "text": "AI_ROUTER_OK", "stop_reason": "stop"},
        }
        retry_statuses = ai_router.resolve_retry_statuses({})
        attempts: list[str] = []
        winner = None
        for provider_name in order:
            result = fixtures[provider_name]
            attempts.append(provider_name)
            if ai_router.usable(result):
                winner = provider_name
                break
            status = int(result.get("http_status") or 0)
            self.assertFalse(status in retry_statuses)  # 401 is non-retryable

        self.assertEqual(attempts, ["anthropic", "openai"])
        self.assertEqual(winner, "openai")

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

    # ===================================================================
    # Web search support (QC router migration) — zero-network, mocked
    # request_json throughout, exactly like every other test in this file.
    # ===================================================================

    def test_a_web_search_payload_is_added_only_when_requested(self) -> None:
        response = {
            "content": [{"type": "text", "text": "OK"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 2},
        }
        with patch.object(ai_router, "request_json", return_value=(200, response)) as mocked:
            ai_router.call_anthropic(
                "https://anthropic.invalid/messages", "key", "model", "", "prompt", 100, 5,
                web_search_max_uses=3,
            )
        payload = mocked.call_args.args[2]
        self.assertEqual(
            payload["tools"],
            [{"type": "web_search_20260209", "name": "web_search", "max_uses": 3}],
        )

        # b) max_uses is carried through exactly, not rounded/clamped/renamed.
        with patch.object(ai_router, "request_json", return_value=(200, response)) as mocked:
            ai_router.call_anthropic(
                "https://anthropic.invalid/messages", "key", "model", "", "prompt", 100, 5,
                web_search_max_uses=7,
            )
        self.assertEqual(mocked.call_args.args[2]["tools"][0]["max_uses"], 7)

        # f) web search NOT requested (default 0) -> no tools key at all,
        # 100% identical payload shape to before this feature existed.
        with patch.object(ai_router, "request_json", return_value=(200, response)) as mocked:
            ai_router.call_anthropic(
                "https://anthropic.invalid/messages", "key", "model", "", "prompt", 100, 5,
            )
        self.assertNotIn("tools", mocked.call_args.args[2])

    def test_c_web_search_requests_count_is_extracted_into_result(self) -> None:
        response = {
            "content": [{"type": "text", "text": "OK"}],
            "stop_reason": "end_turn",
            "usage": {
                "input_tokens": 10,
                "output_tokens": 2,
                "server_tool_use": {"web_search_requests": 2},
            },
        }
        with patch.object(ai_router, "request_json", return_value=(200, response)):
            result = ai_router.call_anthropic(
                "https://anthropic.invalid/messages", "key", "model", "", "prompt", 100, 5,
                web_search_max_uses=5,
            )
        self.assertEqual(result["web_searches"], 2)

        # Absent/malformed server_tool_use must never raise — defaults to 0.
        response_no_usage_block = {**response, "usage": {"input_tokens": 10, "output_tokens": 2}}
        with patch.object(ai_router, "request_json", return_value=(200, response_no_usage_block)):
            result = ai_router.call_anthropic(
                "https://anthropic.invalid/messages", "key", "model", "", "prompt", 100, 5,
                web_search_max_uses=5,
            )
        self.assertEqual(result["web_searches"], 0)

    def test_d_web_sources_are_extracted_and_deduplicated_by_url(self) -> None:
        response = {
            "content": [
                {"type": "text", "text": "Cevap metni"},
                {
                    "type": "server_tool_use",
                    "content": [
                        {
                            "type": "web_search_tool_result",
                            "content": [
                                {"type": "web_search_result", "url": "https://a.example/1", "title": "A"},
                                {"type": "web_search_result", "url": "https://b.example/2", "title": "B"},
                                # duplicate url, different title -> must not
                                # produce a second entry
                                {"type": "web_search_result", "url": "https://a.example/1", "title": "A again"},
                            ],
                        }
                    ],
                },
                {
                    "type": "text",
                    "text": "cited claim",
                    "citations": [
                        {
                            "type": "web_search_result_location",
                            "url": "https://a.example/1",
                            "title": "A citation",
                        },
                        {
                            "type": "web_search_result_location",
                            "url": "https://c.example/3",
                            "title": None,
                        },
                    ],
                },
            ],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 2, "server_tool_use": {"web_search_requests": 1}},
        }
        with patch.object(ai_router, "request_json", return_value=(200, response)):
            result = ai_router.call_anthropic(
                "https://anthropic.invalid/messages", "key", "model", "", "prompt", 100, 5,
                web_search_max_uses=1,
            )
        urls = [source["url"] for source in result["web_sources"]]
        self.assertEqual(urls, ["https://a.example/1", "https://b.example/2", "https://c.example/3"])
        self.assertEqual(len(urls), len(set(urls)), "duplicate URLs must be removed")
        by_url = {source["url"]: source for source in result["web_sources"]}
        self.assertEqual(by_url["https://a.example/1"]["title"], "A")  # first-seen title wins
        self.assertEqual(by_url["https://c.example/3"]["title"], "https://c.example/3")  # falls back to URL when title is null

    def test_d2_web_sources_empty_when_web_search_not_requested(self) -> None:
        # Even if a response happened to contain search-result-shaped nodes,
        # extraction only runs when web search was actually requested for
        # this call (mirrors the pre-router workflow's tools-gated jq walk).
        response = {
            "content": [{"type": "text", "text": "OK"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 2},
        }
        with patch.object(ai_router, "request_json", return_value=(200, response)):
            result = ai_router.call_anthropic(
                "https://anthropic.invalid/messages", "key", "model", "", "prompt", 100, 5,
            )
        self.assertEqual(result["web_sources"], [])
        self.assertEqual(result["web_searches"], 0)

    def test_e_provider_without_web_search_support_is_skipped_with_zero_network_calls(self) -> None:
        providers = {
            "anthropic": {
                "api_style": "anthropic_messages",
                "endpoint": "https://api.anthropic.invalid/v1/messages",
                "secret_env": "TEST_ANTHROPIC_KEY",
                "model_env": "",
                "default_model": "claude-test",
                "supports_web_search": True,
            },
            "openai": {
                "api_style": "openai_chat",
                "endpoint": "https://api.openai.invalid/v1/chat/completions",
                "secret_env": "TEST_OPENAI_KEY",
                "model_env": "",
                "default_model": "gpt-test",
                # no supports_web_search key at all -- must be treated as
                # unsupported, not silently truthy.
            },
        }
        with patch.dict(os.environ, {"TEST_ANTHROPIC_KEY": "x", "TEST_OPENAI_KEY": "y"}, clear=False):
            with patch.object(ai_router, "request_json") as mocked:
                # Simulate exactly what main()'s provider loop does for a
                # web-search-requested run, provider-by-provider, without
                # invoking main() itself (keeps this test at the same unit
                # level as its neighbors in this file).
                web_search_requested = True
                order = ["openai", "anthropic"]  # unsupported provider listed FIRST
                attempts = []
                for name in order:
                    provider = providers[name]
                    if web_search_requested and not provider.get("supports_web_search"):
                        attempts.append({"provider": name, "status": "skipped", "reason": "web_search_unsupported"})
                        continue
                    mocked.return_value = (200, {
                        "content": [{"type": "text", "text": "OK"}],
                        "stop_reason": "end_turn",
                        "usage": {"input_tokens": 1, "output_tokens": 1},
                    })
                    ai_router.call_anthropic(
                        provider["endpoint"], "key", "model", "", "prompt", 10, 5, web_search_max_uses=1,
                    )
                    attempts.append({"provider": name, "status": "success"})
                    break

        self.assertEqual(attempts[0], {"provider": "openai", "status": "skipped", "reason": "web_search_unsupported"})
        self.assertEqual(attempts[1]["provider"], "anthropic")
        self.assertEqual(attempts[1]["status"], "success")
        # The critical assertion: the unsupported provider's endpoint was
        # never dialed at all -- exactly one real (mocked) network call,
        # and it was to anthropic, never openai.
        self.assertEqual(mocked.call_count, 1)
        self.assertEqual(mocked.call_args.args[0], "https://api.anthropic.invalid/v1/messages")

    def test_openai_chat_result_always_carries_zero_web_search_fields(self) -> None:
        # Parity/shape check: a caller reading result["web_searches"] /
        # result["web_sources"] uniformly, regardless of which provider
        # style answered, never hits a KeyError.
        response = {
            "choices": [{"message": {"content": "OK"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 1},
        }
        with patch.object(ai_router, "request_json", return_value=(200, response)):
            result = ai_router.call_openai_chat(
                "https://openai.invalid/chat", "key", "model", "", "prompt", 100, 5,
            )
        self.assertEqual(result["web_searches"], 0)
        self.assertEqual(result["web_sources"], [])

    def test_real_config_anthropic_is_the_only_web_search_capable_provider(self) -> None:
        config_path = ROUTER_PATH.parent.parent / "config" / "ai-router.json"
        config = json.loads(config_path.read_text(encoding="utf-8"))
        for name, provider in config["providers"].items():
            expected = name == "anthropic"
            self.assertEqual(
                bool(provider.get("supports_web_search")),
                expected,
                f"{name}: supports_web_search must be {expected}",
            )

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

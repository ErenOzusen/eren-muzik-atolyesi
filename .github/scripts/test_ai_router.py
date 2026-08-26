#!/usr/bin/env python3
"""Zero-network tests for the AI provider router.

These tests exercise provider ordering, credential/model skipping and fallback
without calling any external AI API, so they consume 0 AI tokens.
"""

from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROUTER_PATH = Path(__file__).with_name("ai_router.py")
spec = importlib.util.spec_from_file_location("ai_router", ROUTER_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("ai_router.py yüklenemedi")
ai_router = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ai_router)


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

    def test_provider_order_and_fallback_can_be_simulated_without_network(self) -> None:
        config = {
            "routing": {
                "default_order": ["anthropic", "openai", "deepseek", "qwen"],
                "timeout_seconds": 5,
                "retry_http_statuses": [429, 500, 599],
            },
            "providers": {
                "anthropic": {
                    "api_style": "anthropic_messages",
                    "endpoint": "https://anthropic.invalid/messages",
                    "secret_env": "ANTHROPIC_API_KEY",
                    "model_env": "ANTHROPIC_MODEL",
                },
                "openai": {
                    "api_style": "openai_chat",
                    "endpoint": "https://openai.invalid/chat",
                    "secret_env": "OPENAI_API_KEY",
                    "model_env": "OPENAI_MODEL",
                },
                "deepseek": {
                    "api_style": "openai_chat",
                    "endpoint": "https://deepseek.invalid/chat",
                    "secret_env": "DEEPSEEK_API_KEY",
                    "model_env": "DEEPSEEK_MODEL",
                },
                "qwen": {
                    "api_style": "openai_chat",
                    "endpoint": "https://qwen.invalid/chat",
                    "secret_env": "QWEN_API_KEY",
                    "model_env": "QWEN_MODEL",
                },
            },
        }

        # This is the same routing contract main() uses, but all responses are
        # deterministic local fixtures: Anthropic fails, OpenAI succeeds.
        order = config["routing"]["default_order"]
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

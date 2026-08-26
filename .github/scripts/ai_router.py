#!/usr/bin/env python3
"""Provider-independent text generation router for GitHub Actions.

The router keeps agent workflows independent from a single LLM vendor.
It tries configured providers in order, skips providers without credentials/model
configuration, and falls back on retryable API failures or unusable responses.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def load_json(path: str) -> dict[str, Any]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit(f"JSON nesnesi bekleniyordu: {path}")
    return data


def resolve_endpoint(provider: dict[str, Any]) -> str:
    env_name = provider.get("endpoint_env")
    if isinstance(env_name, str) and os.getenv(env_name):
        return os.environ[env_name]
    endpoint = provider.get("endpoint") or provider.get("default_endpoint")
    if not isinstance(endpoint, str) or not endpoint.startswith("https://"):
        return ""
    return endpoint


def resolve_model(name: str, provider: dict[str, Any], primary_model: str) -> str:
    env_name = provider.get("model_env")
    if isinstance(env_name, str) and os.getenv(env_name):
        return os.environ[env_name].strip()
    if provider.get("use_primary_model_as_default") is True and primary_model:
        return primary_model.strip()
    default_model = provider.get("default_model")
    return default_model.strip() if isinstance(default_model, str) else ""


def request_json(url: str, headers: dict[str, str], payload: dict[str, Any], timeout: int) -> tuple[int, dict[str, Any]]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return int(response.status), json.loads(raw)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = {"error": {"message": raw[:1000]}}
        return int(exc.code), data
    except (urllib.error.URLError, TimeoutError) as exc:
        return 599, {"error": {"message": str(exc)}}


def call_anthropic(endpoint: str, api_key: str, model: str, prompt: str, max_tokens: int, timeout: int) -> dict[str, Any]:
    status, data = request_json(
        endpoint,
        {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        {
            "model": model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout,
    )
    text = ""
    content = data.get("content")
    if isinstance(content, list):
        text = "\n\n".join(
            item.get("text", "")
            for item in content
            if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str)
        ).strip()
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    return {
        "http_status": status,
        "text": text,
        "stop_reason": data.get("stop_reason"),
        "input_tokens": int(usage.get("input_tokens") or 0),
        "output_tokens": int(usage.get("output_tokens") or 0),
        "raw_error": data.get("error"),
    }


def call_openai_chat(endpoint: str, api_key: str, model: str, prompt: str, max_tokens: int, timeout: int) -> dict[str, Any]:
    status, data = request_json(
        endpoint,
        {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "stream": False,
        },
        timeout,
    )
    text = ""
    finish_reason = None
    choices = data.get("choices")
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        finish_reason = choices[0].get("finish_reason")
        message = choices[0].get("message")
        if isinstance(message, dict) and isinstance(message.get("content"), str):
            text = message["content"].strip()
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    return {
        "http_status": status,
        "text": text,
        "stop_reason": finish_reason,
        "input_tokens": int(usage.get("prompt_tokens") or 0),
        "output_tokens": int(usage.get("completion_tokens") or 0),
        "raw_error": data.get("error"),
    }


def usable(result: dict[str, Any]) -> bool:
    if result.get("http_status") != 200:
        return False
    text = result.get("text")
    if not isinstance(text, str) or not text.strip():
        return False
    stop = result.get("stop_reason")
    if stop in {"max_tokens", "length", "content_filter", "insufficient_system_resource"}:
        return False
    return True


def error_message(result: dict[str, Any]) -> str:
    error = result.get("raw_error")
    if isinstance(error, dict):
        message = error.get("message")
        if isinstance(message, str):
            return message[:500]
    if isinstance(error, str):
        return error[:500]
    return f"HTTP {result.get('http_status')} / stop={result.get('stop_reason')}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--prompt-file", required=True)
    parser.add_argument("--output-file", required=True)
    parser.add_argument("--meta-file", required=True)
    parser.add_argument("--max-tokens", required=True, type=int)
    parser.add_argument("--primary-model", default="")
    parser.add_argument("--provider-order", default="")
    args = parser.parse_args()

    config = load_json(args.config)
    routing = config.get("routing") if isinstance(config.get("routing"), dict) else {}
    providers = config.get("providers") if isinstance(config.get("providers"), dict) else {}
    configured_order = routing.get("default_order") if isinstance(routing.get("default_order"), list) else []
    order = [item.strip() for item in args.provider_order.split(",") if item.strip()] or configured_order
    timeout = int(routing.get("timeout_seconds") or 120)
    retry_statuses = set(routing.get("retry_http_statuses") or [408, 429, 500, 502, 503, 504])
    prompt = Path(args.prompt_file).read_text(encoding="utf-8")

    attempts: list[dict[str, Any]] = []

    for provider_name in order:
        provider = providers.get(provider_name)
        if not isinstance(provider, dict):
            attempts.append({"provider": provider_name, "status": "skipped", "reason": "provider_not_configured"})
            continue

        secret_env = provider.get("secret_env")
        api_key = os.getenv(secret_env, "") if isinstance(secret_env, str) else ""
        model = resolve_model(provider_name, provider, args.primary_model)
        endpoint = resolve_endpoint(provider)

        if not api_key:
            attempts.append({"provider": provider_name, "status": "skipped", "reason": "missing_api_key"})
            continue
        if not model:
            attempts.append({"provider": provider_name, "status": "skipped", "reason": "missing_model"})
            continue
        if not endpoint:
            attempts.append({"provider": provider_name, "status": "skipped", "reason": "missing_endpoint"})
            continue

        style = provider.get("api_style")
        started = time.monotonic()
        try:
            if style == "anthropic_messages":
                result = call_anthropic(endpoint, api_key, model, prompt, args.max_tokens, timeout)
            elif style == "openai_chat":
                result = call_openai_chat(endpoint, api_key, model, prompt, args.max_tokens, timeout)
            else:
                attempts.append({"provider": provider_name, "status": "skipped", "reason": "unsupported_api_style"})
                continue
        except Exception as exc:  # keep fallback alive on provider-specific surprises
            result = {
                "http_status": 599,
                "text": "",
                "stop_reason": None,
                "input_tokens": 0,
                "output_tokens": 0,
                "raw_error": {"message": str(exc)},
            }

        elapsed_ms = round((time.monotonic() - started) * 1000)
        attempt = {
            "provider": provider_name,
            "model": model,
            "http_status": result.get("http_status"),
            "stop_reason": result.get("stop_reason"),
            "input_tokens": result.get("input_tokens", 0),
            "output_tokens": result.get("output_tokens", 0),
            "elapsed_ms": elapsed_ms,
        }

        if usable(result):
            attempt["status"] = "success"
            attempts.append(attempt)
            Path(args.output_file).write_text(result["text"].strip() + "\n", encoding="utf-8")
            meta = {
                "provider": provider_name,
                "model": model,
                "input_tokens": result.get("input_tokens", 0),
                "output_tokens": result.get("output_tokens", 0),
                "stop_reason": result.get("stop_reason"),
                "attempts": attempts,
            }
            Path(args.meta_file).write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(json.dumps({"provider": provider_name, "model": model, "status": "success"}, ensure_ascii=False))
            return

        attempt["status"] = "failed"
        attempt["reason"] = error_message(result)
        attempts.append(attempt)
        status = int(result.get("http_status") or 0)
        if status not in retry_statuses and status not in {200, 599}:
            # Authentication/config errors should not retry the same provider, but
            # the next configured provider is still allowed to run.
            pass

    Path(args.meta_file).write_text(json.dumps({"attempts": attempts}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Hiçbir yapılandırılmış AI sağlayıcısı kullanılabilir çıktı üretemedi.", file=sys.stderr)
    print(json.dumps(attempts, ensure_ascii=False, indent=2), file=sys.stderr)
    raise SystemExit(1)


if __name__ == "__main__":
    main()

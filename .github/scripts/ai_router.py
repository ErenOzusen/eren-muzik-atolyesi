#!/usr/bin/env python3
"""Provider-independent text generation router for GitHub Actions.

The router keeps agent workflows independent from a single LLM vendor.
It tries configured providers in order, skips providers without credentials/model
configuration, and falls back on API failures, unusable responses, or outputs
that fail an optional deterministic quality contract.
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

from output_contract import load_contract, validate_text


def load_json(path: str) -> dict[str, Any]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit(f"JSON nesnesi bekleniyordu: {path}")
    return data


def resolve_endpoint(provider: dict[str, Any]) -> str:
    env_name = provider.get("endpoint_env")
    if isinstance(env_name, str) and os.getenv(env_name):
        endpoint = os.environ[env_name].strip()
    else:
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


def resolve_quality_contract(
    explicit_path: str,
    output_file: str,
    routing: dict[str, Any],
) -> str:
    if explicit_path.strip():
        return explicit_path.strip()
    mappings = routing.get("quality_contracts_by_output")
    if not isinstance(mappings, dict):
        return ""
    candidate = mappings.get(Path(output_file).name)
    return candidate.strip() if isinstance(candidate, str) else ""


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


def call_anthropic(
    endpoint: str,
    api_key: str,
    model: str,
    system_prompt: str,
    prompt: str,
    max_tokens: int,
    timeout: int,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system_prompt.strip():
        payload["system"] = system_prompt

    status, data = request_json(
        endpoint,
        {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        payload,
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


def call_openai_chat(
    endpoint: str,
    api_key: str,
    model: str,
    system_prompt: str,
    prompt: str,
    max_tokens: int,
    timeout: int,
) -> dict[str, Any]:
    messages: list[dict[str, str]] = []
    if system_prompt.strip():
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    status, data = request_json(
        endpoint,
        {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        {
            "model": model,
            "messages": messages,
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


def quality_errors(text: str, contract: dict[str, Any] | None) -> list[str]:
    if contract is None:
        return []
    return validate_text(text, contract)


def error_message(result: dict[str, Any]) -> str:
    error = result.get("raw_error")
    if isinstance(error, dict):
        message = error.get("message")
        if isinstance(message, str):
            return message[:500]
    if isinstance(error, str):
        return error[:500]
    return f"HTTP {result.get('http_status')} / stop={result.get('stop_reason')}"


def usage_totals(attempts: list[dict[str, Any]]) -> tuple[int, int]:
    input_tokens = sum(int(item.get("input_tokens") or 0) for item in attempts)
    output_tokens = sum(int(item.get("output_tokens") or 0) for item in attempts)
    return input_tokens, output_tokens


def resolve_retry_statuses(routing: dict[str, Any]) -> set[int]:
    """Which HTTP statuses config considers transient/retryable.

    Used only to label each failed attempt (attempt["retryable"]) for
    observability/cost-guard purposes — it intentionally never stops the
    provider fallback chain, retryable status or not. A single provider's
    non-retryable failure (e.g. 401 invalid/expired key, 400 bad request)
    must not prevent trying the next configured, healthy provider; that
    per-provider fallback resilience is this router's whole purpose.
    """
    configured = routing.get("retry_http_statuses")
    return set(configured or [408, 429, 500, 502, 503, 504])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--prompt-file", required=True)
    parser.add_argument("--system-file", default="")
    parser.add_argument("--output-file", required=True)
    parser.add_argument("--meta-file", required=True)
    parser.add_argument("--max-tokens", required=True, type=int)
    parser.add_argument("--primary-model", default="")
    parser.add_argument("--provider-order", default="")
    parser.add_argument(
        "--quality-contract",
        default="",
        help="Opsiyonel yerel JSON çıktı sözleşmesi. Başarısız aday reddedilir ve sıradaki provider denenir.",
    )
    args = parser.parse_args()

    config = load_json(args.config)
    routing = config.get("routing") if isinstance(config.get("routing"), dict) else {}
    providers = config.get("providers") if isinstance(config.get("providers"), dict) else {}
    configured_order = routing.get("default_order") if isinstance(routing.get("default_order"), list) else []
    order = [item.strip() for item in args.provider_order.split(",") if item.strip()] or configured_order
    timeout = int(routing.get("timeout_seconds") or 120)
    retry_statuses = resolve_retry_statuses(routing)
    prompt = Path(args.prompt_file).read_text(encoding="utf-8")
    system_prompt = Path(args.system_file).read_text(encoding="utf-8") if args.system_file else ""
    contract_path = resolve_quality_contract(args.quality_contract, args.output_file, routing)

    try:
        contract = load_contract(contract_path) if contract_path else None
    except Exception as exc:
        raise SystemExit(f"Kalite sözleşmesi yüklenemedi: {exc}") from exc

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
                result = call_anthropic(endpoint, api_key, model, system_prompt, prompt, args.max_tokens, timeout)
            elif style == "openai_chat":
                result = call_openai_chat(endpoint, api_key, model, system_prompt, prompt, args.max_tokens, timeout)
            else:
                attempts.append({"provider": provider_name, "status": "skipped", "reason": "unsupported_api_style"})
                continue
        except Exception as exc:
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
            errors = quality_errors(result["text"], contract)
            if errors:
                attempt["status"] = "rejected_quality"
                attempt["reason"] = "quality_contract_failed"
                attempt["quality_errors"] = errors[:20]
                attempts.append(attempt)
                continue

            attempt["status"] = "success"
            attempt["quality_contract"] = "passed" if contract is not None else "not_requested"
            attempts.append(attempt)
            Path(args.output_file).write_text(result["text"].strip() + "\n", encoding="utf-8")
            total_input_tokens, total_output_tokens = usage_totals(attempts)
            meta = {
                "provider": provider_name,
                "model": model,
                "input_tokens": result.get("input_tokens", 0),
                "output_tokens": result.get("output_tokens", 0),
                "total_input_tokens": total_input_tokens,
                "total_output_tokens": total_output_tokens,
                "stop_reason": result.get("stop_reason"),
                "quality_contract": contract_path or None,
                "quality_passed": True if contract is not None else None,
                "system_chars": len(system_prompt),
                "prompt_chars": len(prompt),
                "attempts": attempts,
            }
            Path(args.meta_file).write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(json.dumps({"provider": provider_name, "model": model, "status": "success"}, ensure_ascii=False))
            return

        attempt["status"] = "failed"
        attempt["reason"] = error_message(result)
        status = int(result.get("http_status") or 0)
        # retry_http_statuses (config: routing.retry_http_statuses) marks
        # which HTTP statuses are considered transient/retryable (default:
        # 408/429/500/502/503/504) purely for observability in the attempts
        # log. It deliberately does NOT stop the provider fallback chain for
        # a non-retryable status (e.g. 401 invalid/expired key, 400 bad
        # request): a config problem or auth failure on one provider must
        # not prevent trying the next configured, healthy provider — that
        # per-provider fallback resilience is the entire point of this
        # router and always continues below, retryable or not.
        attempt["retryable"] = status in retry_statuses
        attempts.append(attempt)

    total_input_tokens, total_output_tokens = usage_totals(attempts)
    Path(args.meta_file).write_text(
        json.dumps(
            {
                "total_input_tokens": total_input_tokens,
                "total_output_tokens": total_output_tokens,
                "quality_contract": contract_path or None,
                "quality_passed": False if contract is not None else None,
                "system_chars": len(system_prompt),
                "prompt_chars": len(prompt),
                "attempts": attempts,
            },
            ensure_ascii=False,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    print("Hiçbir yapılandırılmış AI sağlayıcısı kullanılabilir ve kaliteli çıktı üretemedi.", file=sys.stderr)
    print(json.dumps(attempts, ensure_ascii=False, indent=2), file=sys.stderr)
    raise SystemExit(1)


if __name__ == "__main__":
    main()

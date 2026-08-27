#!/usr/bin/env python3
"""Deterministically validate the Video Orchestrator configuration."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


REQUIRED_ROOT_KEYS = {
    "schema_version",
    "default_auto_mode",
    "generation_dispatch_enabled",
    "premium_ai_manual_only",
    "modes",
    "signals",
    "thresholds",
    "safeguards",
}
REQUIRED_MODES = {"human", "hybrid", "faceless", "premium_ai"}
REQUIRED_MODE_KEYS = {
    "engine",
    "engine_status",
    "requires_raw_video",
    "allows_ai_broll",
    "next_stage",
}
REQUIRED_SIGNAL_KEYS = {"human_required", "hybrid_support", "faceless_preferred"}
REQUIRED_THRESHOLD_KEYS = {"faceless_min_matches", "hybrid_min_matches"}
REQUIRED_SAFEGUARD_KEYS = {
    "owner_approval_before_paid_generation",
    "owner_approval_before_publication",
    "never_auto_select_premium_ai",
    "prefer_real_media_when_human_required",
}
SENSITIVE_KEY_PATTERN = re.compile(
    r"(^|_)(api_?key|secret|password|passwd|token|private_?key|credential)s?($|_)",
    flags=re.IGNORECASE,
)


def find_sensitive_keys(value: Any, path: str = "$") -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}"
            if SENSITIVE_KEY_PATTERN.search(str(key)):
                found.append(child_path)
            found.extend(find_sensitive_keys(child, child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(find_sensitive_keys(child, f"{path}[{index}]"))
    return found


def is_nonempty_text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def validate_signal_list(value: Any, name: str, errors: list[str]) -> None:
    if not isinstance(value, list) or not value:
        errors.append(f"Sinyal listesi boş olamaz: {name}")
        return
    if not all(is_nonempty_text(item) for item in value):
        errors.append(f"Sinyaller boş olmayan metinlerden oluşmalı: {name}")
        return
    normalized = [item.strip().casefold() for item in value]
    if len(normalized) != len(set(normalized)):
        errors.append(f"Sinyal listesinde duplicate değer olamaz: {name}")


def validate(config: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    if set(config) != REQUIRED_ROOT_KEYS:
        errors.append("Kök alanlar Video Orchestrator şemasıyla eşleşmiyor.")
    if config.get("schema_version") != 1:
        errors.append("schema_version tam olarak 1 olmalı.")

    if config.get("default_auto_mode") not in {"human", "hybrid", "faceless"}:
        errors.append("default_auto_mode güvenli otomatik modlardan biri olmalı.")
    if config.get("generation_dispatch_enabled") is not False:
        errors.append("generation_dispatch_enabled güvenlik için false olmalı.")
    if config.get("premium_ai_manual_only") is not True:
        errors.append("premium_ai_manual_only güvenlik için true olmalı.")

    modes = config.get("modes")
    if not isinstance(modes, dict) or set(modes) != REQUIRED_MODES:
        errors.append("Modes tam olarak human, hybrid, faceless ve premium_ai içermeli.")
        modes = {}
    for mode_name in sorted(REQUIRED_MODES & set(modes)):
        mode = modes[mode_name]
        if not isinstance(mode, dict) or set(mode) != REQUIRED_MODE_KEYS:
            errors.append(f"Mode alanları şemayla eşleşmiyor: {mode_name}")
            continue
        for field in ("engine", "engine_status", "next_stage"):
            if not is_nonempty_text(mode.get(field)):
                errors.append(f"Mode metin alanı boş olamaz: {mode_name}.{field}")
        for field in ("requires_raw_video", "allows_ai_broll"):
            if type(mode.get(field)) is not bool:
                errors.append(f"Mode alanı boolean olmalı: {mode_name}.{field}")

    signals = config.get("signals")
    if not isinstance(signals, dict) or set(signals) != REQUIRED_SIGNAL_KEYS:
        errors.append("Signals alanları orchestrator şemasıyla eşleşmiyor.")
        signals = {}
    for signal_name in sorted(REQUIRED_SIGNAL_KEYS):
        validate_signal_list(signals.get(signal_name), signal_name, errors)

    thresholds = config.get("thresholds")
    if not isinstance(thresholds, dict) or set(thresholds) != REQUIRED_THRESHOLD_KEYS:
        errors.append("Threshold alanları orchestrator şemasıyla eşleşmiyor.")
        thresholds = {}
    threshold_signals = {
        "faceless_min_matches": "faceless_preferred",
        "hybrid_min_matches": "hybrid_support",
    }
    for threshold_name, signal_name in threshold_signals.items():
        value = thresholds.get(threshold_name)
        signal_values = signals.get(signal_name)
        maximum = len(signal_values) if isinstance(signal_values, list) else 0
        if type(value) is not int or not 1 <= value <= maximum:
            errors.append(
                f"Threshold pozitif olmalı ve sinyal sayısını aşmamalı: {threshold_name}"
            )

    safeguards = config.get("safeguards")
    if not isinstance(safeguards, dict) or set(safeguards) != REQUIRED_SAFEGUARD_KEYS:
        errors.append("Safeguard alanları orchestrator şemasıyla eşleşmiyor.")
        safeguards = {}
    for safeguard in sorted(REQUIRED_SAFEGUARD_KEYS):
        if safeguards.get(safeguard) is not True:
            errors.append(f"Safeguard true olmalı: {safeguard}")

    sensitive_paths = find_sensitive_keys(config)
    if sensitive_paths:
        errors.append(
            "Video Orchestrator config secret, token veya API anahtarı içeremez: "
            + ", ".join(sensitive_paths)
        )

    return errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()

    try:
        config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Video Orchestrator config okunamadı: {exc}") from exc
    if not isinstance(config, dict):
        raise SystemExit("Video Orchestrator config JSON nesnesi olmalı.")

    errors = validate(config)
    if errors:
        raise SystemExit("Video Orchestrator config geçersiz:\n- " + "\n- ".join(errors))

    print("video_orchestrator_config_ok ai_calls=0 network_requests=0 dispatches=0")


if __name__ == "__main__":
    main()

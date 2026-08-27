#!/usr/bin/env python3
"""Zero-token validation and portability tests for Video Orchestrator configs."""

from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = SCRIPT_DIR.parent / "config" / "video-orchestrator.json"
SECOND_CONFIG_PATH = SCRIPT_DIR / "fixtures" / "second-business-video-orchestrator.json"
SECOND_PROFILE_PATH = SCRIPT_DIR / "fixtures" / "second-business-profile.json"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Modül yüklenemedi: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


validator = load_module(
    "validate_video_orchestrator",
    SCRIPT_DIR / "validate_video_orchestrator.py",
)
orchestrator = load_module("video_orchestrator", SCRIPT_DIR / "video_orchestrator.py")


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(value, dict), f"JSON nesnesi bekleniyordu: {path}"
    return value


def assert_valid(name: str, config: dict) -> None:
    errors = validator.validate(config)
    assert not errors, f"{name} geçerli olmalıydı: {errors}"
    print(f"ok valid: {name}")


def assert_invalid(name: str, config: dict, expected_error: str) -> None:
    errors = validator.validate(config)
    combined = "\n".join(errors)
    assert errors, f"{name} reddedilmeliydi"
    assert expected_error in combined, (
        f"{name} için beklenen hata bulunamadı: {expected_error!r}\n{combined}"
    )
    print(f"ok rejected: {name} -> {expected_error}")


def test_negative_cases(base_config: dict) -> None:
    dispatch_on = copy.deepcopy(base_config)
    dispatch_on["generation_dispatch_enabled"] = True
    assert_invalid(
        "generation_dispatch_enabled=true",
        dispatch_on,
        "generation_dispatch_enabled güvenlik için false olmalı.",
    )

    premium_auto = copy.deepcopy(base_config)
    premium_auto["safeguards"]["never_auto_select_premium_ai"] = False
    assert_invalid(
        "never_auto_select_premium_ai=false",
        premium_auto,
        "Safeguard true olmalı: never_auto_select_premium_ai",
    )

    duplicate_signal = copy.deepcopy(base_config)
    duplicate_signal["signals"]["human_required"].append(
        duplicate_signal["signals"]["human_required"][0].upper()
    )
    assert_invalid(
        "duplicate signal",
        duplicate_signal,
        "Sinyal listesinde duplicate değer olamaz: human_required",
    )

    empty_signal = copy.deepcopy(base_config)
    empty_signal["signals"]["hybrid_support"] = []
    assert_invalid(
        "empty signal list",
        empty_signal,
        "Sinyal listesi boş olamaz: hybrid_support",
    )


def test_second_business_routing(config: dict) -> None:
    cases = (
        (
            "Doğru fırçalama tekniğini klinik kamerada uygulamalı göster.",
            "human",
            "human_demonstration_required",
        ),
        (
            "Doğru tekniği göster, aşamaları grafik ve görsel destek ile açıkla.",
            "hybrid",
            "human_required_plus_visual_support",
        ),
        (
            "Çocuklarda ağız hijyeni hakkında bilmeniz gereken 5 bilgi listesi.",
            "faceless",
            "faceless_signal_detected",
        ),
    )
    for text, expected_mode, expected_reason in cases:
        decision = orchestrator.decide(text, config, requested_mode="auto")
        assert decision["selected_mode"] == expected_mode, decision
        assert decision["reason"] == expected_reason, decision
        assert decision["selected_mode"] != "premium_ai", decision
        assert decision["dispatch_enabled"] is False, decision
        assert decision["paid_generation_allowed"] is False, decision
        print(
            f"ok route: second_business -> {expected_mode} "
            f"({expected_reason})"
        )


def main() -> None:
    current_config = load_json(CONFIG_PATH)
    second_config = load_json(SECOND_CONFIG_PATH)
    second_profile = load_json(SECOND_PROFILE_PATH)

    assert second_profile["business"]["brand_name"] == "Mavi Dis Klinigi"
    assert_valid("current Eren config", current_config)
    assert_valid("second business config", second_config)
    test_negative_cases(current_config)
    test_second_business_routing(second_config)

    print("video_orchestrator_validation_ok")
    print("Network/API/AI/video calls: 0")


if __name__ == "__main__":
    main()

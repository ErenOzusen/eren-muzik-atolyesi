#!/usr/bin/env python3
"""Zero-token CLI smoke tests for validate_business_config.py."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parents[1]
VALIDATOR = SCRIPTS_DIR / "validate_business_config.py"
FIXTURES = SCRIPTS_DIR / "fixtures"

CASES = (
    (REPO_ROOT / ".github/config/business-profile.json", True, None),
    (FIXTURES / "second-business-profile.json", True, None),
    (FIXTURES / "nova-coffee-business-profile.json", True, None),
    (
        FIXTURES / "invalid-approval-off.json",
        False,
        "İşletme sahibi onayı zorunlu olmalı",
    ),
    (
        FIXTURES / "invalid-secret-leak.json",
        False,
        "Profil dosyasına secret, token, parola veya API anahtarı konamaz.",
    ),
    (
        FIXTURES / "invalid-extra-root-key.json",
        False,
        "Kök alanlar şema sürümü 1 ile eşleşmiyor.",
    ),
    (
        FIXTURES / "invalid-capture-device-not-in-equipment.json",
        False,
        "Ana kayıt cihazı (primary_device), offer.available_equipment listesindeki bir ekipmanla birebir eşleşmelidir.",
    ),
    (
        FIXTURES / "invalid-capture-device-empty.json",
        False,
        "Ana kayıt cihazı (primary_device) boş olmayan bir metin olmalı.",
    ),
)


def run_case(
    config_path: Path,
    should_pass: bool,
    expected_error: str | None,
    output_dir: Path,
) -> None:
    output_path = output_dir / f"{config_path.stem}.md"
    result = subprocess.run(
        [
            sys.executable,
            "-X",
            "utf8",
            str(VALIDATOR),
            "--config",
            str(config_path),
            "--output",
            str(output_path),
            "--test-mode",
            "true",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
        timeout=30,
    )

    passed = result.returncode == 0
    process_output = result.stdout + result.stderr
    if passed != should_pass:
        expectation = "pass" if should_pass else "fail"
        details = process_output.strip() or "no process output"
        raise AssertionError(
            f"{config_path.name}: expected validator to {expectation}, "
            f"got exit code {result.returncode}\n{details}"
        )

    if not should_pass and expected_error not in process_output:
        details = process_output.strip() or "no process output"
        raise AssertionError(
            f"{config_path.name}: expected validator error was not found: "
            f"{expected_error!r}\n{details}"
        )

    if should_pass and not output_path.is_file():
        raise AssertionError(f"{config_path.name}: validator did not create its report")
    if not should_pass and output_path.exists():
        raise AssertionError(f"{config_path.name}: rejected fixture created a report")

    if should_pass:
        profile = json.loads(config_path.read_text(encoding="utf-8"))

        primary_device = profile["content"]["capture"]["primary_device"]
        if not isinstance(primary_device, str) or not primary_device.strip():
            raise AssertionError(
                f"{config_path.name}: content.capture.primary_device boş olmayan bir metin olmalı"
            )
        if primary_device not in profile["offer"]["available_equipment"]:
            raise AssertionError(
                f"{config_path.name}: content.capture.primary_device "
                f"({primary_device!r}) offer.available_equipment içinde değil"
            )
        expected_primary_devices = {
            "business-profile.json": "Telefon",
            "second-business-profile.json": "Klinik kamera",
            "nova-coffee-business-profile.json": "Telefon",
        }
        expected_device = expected_primary_devices.get(config_path.name)
        if expected_device is not None and primary_device != expected_device:
            raise AssertionError(
                f"{config_path.name}: content.capture.primary_device beklenen "
                f"{expected_device!r} yerine {primary_device!r}"
            )

        report = output_path.read_text(encoding="utf-8")
        expected_values = (
            f"**Marka:** {profile['business']['brand_name']}",
            f"**İşletme sahibi:** {profile['business']['owner_display_name']}",
            f"**Yetkili GitHub hesabı:** `{profile['business']['github_owner']}`",
            f"**Faaliyet alanı:** {profile['business']['category']}",
            f"**Dil:** `{profile['business']['language']}`",
            f"**Saat dilimi:** `{profile['business']['timezone']}`",
            f"**Gerçek onay komutu:** `{profile['approval']['production_command']}`",
            f"**Test onay komutu:** `{profile['approval']['test_command']}`",
            f"**Ana çekim cihazı:** {profile['content']['capture']['primary_device']}",
        )
        for value in expected_values:
            if value not in report:
                raise AssertionError(
                    f"{config_path.name}: profile value missing from report: {value!r}"
                )
        if config_path.name in ("second-business-profile.json", "nova-coffee-business-profile.json"):
            for hard_code in ("Eren", "EREN MÜZİK ATÖLYESİ", "gitar", "piyano", "müzik teorisi"):
                if hard_code in report:
                    raise AssertionError(
                        f"{config_path.name}: hidden business hard-code in report: {hard_code!r}"
                    )

    print(f"ok: {config_path.name} -> {'pass' if passed else 'rejected'}")


def check_example_profile_capture_consistency() -> None:
    """business-profile.example.json is a placeholder template and is never run through
    the validator (its ÖRNEK/placeholder values are intentionally rejected by
    PLACEHOLDER_PATTERN). Still verify its content.capture.primary_device is internally
    consistent with its own offer.available_equipment, so the template stays a valid
    starting point once a real business fills in its values."""
    example_path = REPO_ROOT / ".github/config/business-profile.example.json"
    if not example_path.is_file():
        raise SystemExit(f"Missing test input: {example_path}")

    example_profile = json.loads(example_path.read_text(encoding="utf-8"))
    example_device = example_profile["content"]["capture"]["primary_device"]
    available_equipment = example_profile["offer"]["available_equipment"]
    if not isinstance(example_device, str) or not example_device.strip():
        raise AssertionError(
            "business-profile.example.json: content.capture.primary_device boş olmayan bir metin olmalı"
        )
    if example_device not in available_equipment:
        raise AssertionError(
            "business-profile.example.json: content.capture.primary_device "
            f"({example_device!r}) offer.available_equipment içinde değil ({available_equipment!r})"
        )
    print(f"ok: business-profile.example.json -> capture.primary_device {example_device!r} in available_equipment")


def main() -> None:
    missing = [str(path) for path, _, _ in CASES if not path.is_file()]
    if not VALIDATOR.is_file():
        missing.append(str(VALIDATOR))
    if missing:
        raise SystemExit("Missing test input:\n- " + "\n- ".join(missing))

    validator_source = VALIDATOR.read_text(encoding="utf-8")
    for security_contract in (
        "SENSITIVE_KEY_PATTERN",
        "PLACEHOLDER_PATTERN",
        "set(profile) == REQUIRED_ROOT_KEYS",
        "allow_publication_without_owner_approval",
        "https://[^\\s]+",
    ):
        if security_contract not in validator_source:
            raise AssertionError(
                f"validator security contract missing: {security_contract!r}"
            )

    check_example_profile_capture_consistency()

    with tempfile.TemporaryDirectory(prefix="business-profile-smoke-") as temp_dir:
        output_dir = Path(temp_dir)
        for config_path, should_pass, expected_error in CASES:
            run_case(config_path, should_pass, expected_error, output_dir)

    print("business_profile_smoke_ok ai_calls=0 web_requests=0")


if __name__ == "__main__":
    main()

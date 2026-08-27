#!/usr/bin/env python3
"""Zero-token CLI smoke tests for validate_business_config.py."""

from __future__ import annotations

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

    print(f"ok: {config_path.name} -> {'pass' if passed else 'rejected'}")


def main() -> None:
    missing = [str(path) for path, _, _ in CASES if not path.is_file()]
    if not VALIDATOR.is_file():
        missing.append(str(VALIDATOR))
    if missing:
        raise SystemExit("Missing test input:\n- " + "\n- ".join(missing))

    with tempfile.TemporaryDirectory(prefix="business-profile-smoke-") as temp_dir:
        output_dir = Path(temp_dir)
        for config_path, should_pass, expected_error in CASES:
            run_case(config_path, should_pass, expected_error, output_dir)

    print("business_profile_smoke_ok ai_calls=0 web_requests=0")


if __name__ == "__main__":
    main()

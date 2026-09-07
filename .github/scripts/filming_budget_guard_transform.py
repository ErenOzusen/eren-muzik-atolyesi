#!/usr/bin/env python3
"""Pre-provider hard-budget and compact-output transformer for filming packages."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
COMPACT_RULES = """

ÇEKİM PAKETİ UZUNLUK SÖZLEŞMESİ:
- Toplam çıktıyı 550–700 kelime arasında tut.
- Kaynak konuşma metnini yeniden yazma; yalnız çekim aksiyonlarını ve gerekli kısa referansları ver.
- Çekim planı tablosunda en fazla 8 veri satırı kullan.
- Tablo dışındaki her bölümde en fazla 5 kısa madde kullan.
- Tekrarlanan açıklama, gerekçe ve genel prodüksiyon teorisi ekleme.
- Altı zorunlu başlığı ve zorunlu tablo sütunlarını eksiksiz koru.
""".strip()


def _is_live_filming_run() -> bool:
    return (
        os.getenv("GITHUB_ACTIONS", "").lower() == "true"
        and os.getenv("TEST_MODE", "").lower() == "false"
        and os.getenv("SOURCE_ISSUE_NUMBER", "").isdigit()
        and os.getenv("SOURCE_SCENARIO", "") in {"1", "2", "3"}
    )


def _run_persistent_preflight(prompt: str, system_prompt: str) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        prompt_path = tmp_path / "prompt.txt"
        system_path = tmp_path / "system.txt"
        prompt_path.write_text(prompt, encoding="utf-8")
        system_path.write_text(system_prompt, encoding="utf-8")
        env = os.environ.copy()
        env["REAL_AI_BUDGET_CAP"] = "true"
        completed = subprocess.run(
            [
                sys.executable,
                str(ROOT / ".github/scripts/preflight_budget_guard.py"),
                "--stage", "filming_package",
                "--provider", "anthropic",
                "--model", "claude-sonnet-4-6",
                "--web-search-max-uses", "0",
                "--prompt-file", str(prompt_path),
                "--system-file", str(system_path),
                "--profile", str(ROOT / ".github/config/business-profile.json"),
                "--budget-config", str(ROOT / ".github/config/real-ai-budget.json"),
                "--price-config", str(ROOT / ".github/config/cost-guard.json"),
            ],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
        )
        report = (completed.stdout + "\n" + completed.stderr).strip()
        if completed.returncode != 0:
            raise RuntimeError("Filming persistent budget preflight provider çağrısını blokladı:\n" + report[-3000:])
        return report[-3000:]


def prepare_request(*, prompt: str, system_prompt: str) -> dict[str, Any]:
    compact_system = system_prompt.rstrip() + "\n\n" + COMPACT_RULES + "\n"
    context: dict[str, Any] = {"compact_output": True, "target_words": "550-700", "budget_preflight": "offline"}
    if _is_live_filming_run():
        context["budget_report"] = _run_persistent_preflight(prompt, compact_system)
        context["budget_preflight"] = "persistent-live"
    return {"prompt": prompt, "system_prompt": compact_system, "context": context}


def finalize_output(*, text: str, context: dict[str, Any]) -> str:
    return text

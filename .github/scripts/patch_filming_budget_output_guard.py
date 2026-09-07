#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one patch target, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


# 1) Extend preflight budget guard with production-stage lookup and direct output ceilings.
preflight = ROOT / ".github/scripts/preflight_budget_guard.py"
replace_once(
    preflight,
    "Research -> Script -> QC -> Correction -> Final Technical Check.\n",
    "Research -> Script -> QC -> Correction -> Final Technical Check, plus explicitly configured controlled production stages.\n",
)
replace_once(
    preflight,
    '    stages = budget_config.get("stages", {})\n    stage_config = stages.get(stage)\n',
    '    stages = budget_config.get("stages", {})\n    production_stages = budget_config.get("production_stages", {})\n    stage_config = stages.get(stage) if isinstance(stages, dict) else None\n    if not isinstance(stage_config, dict) and isinstance(production_stages, dict):\n        stage_config = production_stages.get(stage)\n',
)
replace_once(
    preflight,
    '    content_key = stage_config["profile_content_key"]\n    try:\n        max_output_tokens = int(profile["content"][content_key]["max_model_output"])\n    except (KeyError, TypeError, ValueError) as error:\n        violations.append(\n            f"could not read content.{content_key}.max_model_output from business-profile.json: {error}"\n        )\n        return {"ok": False, "violations": violations, "report": {"stage": stage}}\n',
    '    try:\n        if "max_output_tokens" in stage_config:\n            max_output_tokens = int(stage_config["max_output_tokens"])\n            if max_output_tokens <= 0:\n                raise ValueError("max_output_tokens must be positive")\n        else:\n            content_key = stage_config["profile_content_key"]\n            max_output_tokens = int(profile["content"][content_key]["max_model_output"])\n            if max_output_tokens <= 0:\n                raise ValueError("max_model_output must be positive")\n    except (KeyError, TypeError, ValueError) as error:\n        violations.append(f"could not resolve max output tokens for stage {stage!r}: {error}")\n        return {"ok": False, "violations": violations, "report": {"stage": stage}}\n',
)
replace_once(
    preflight,
    'choices=["research", "script", "quality_control", "correction", "final_technical_control"],',
    'choices=["research", "script", "quality_control", "correction", "final_technical_control", "filming_package"],',
)
replace_once(
    preflight,
    '    configured_floor = budget_config.get("realized_spend_floor_usd", 0.0)\n    if not isinstance(configured_floor, (int, float)) or configured_floor < 0:\n',
    '    configured_floor = budget_config.get("realized_spend_floor_usd", 0.0)\n    unreserved_realized_spend = budget_config.get("unreserved_realized_spend_usd", 0.0)\n    if not isinstance(configured_floor, (int, float)) or configured_floor < 0:\n',
)
replace_once(
    preflight,
    '    if args.prior_chain_spend_usd < 0:\n        print("--prior-chain-spend-usd must be non-negative; failing closed.", file=sys.stderr)\n        raise SystemExit(1)\n\n    effective_prior_spend = max(float(configured_floor), args.prior_chain_spend_usd)\n',
    '    if not isinstance(unreserved_realized_spend, (int, float)) or unreserved_realized_spend < 0:\n        print("unreserved_realized_spend_usd must be a non-negative number; failing closed.", file=sys.stderr)\n        raise SystemExit(1)\n    if args.prior_chain_spend_usd < 0:\n        print("--prior-chain-spend-usd must be non-negative; failing closed.", file=sys.stderr)\n        raise SystemExit(1)\n\n    configured_known_spend = float(configured_floor) + float(unreserved_realized_spend)\n    effective_prior_spend = max(configured_known_spend, args.prior_chain_spend_usd)\n',
)
replace_once(
    preflight,
    '                effective_prior_spend, float(budget_ledger.ledger_total(seed, reservations))\n',
    '                effective_prior_spend,\n                float(budget_ledger.ledger_total(seed, reservations)) + float(unreserved_realized_spend),\n',
)

# 2) Add generic per-output max-token and provider-order policy to AI Router.
router = ROOT / ".github/scripts/ai_router.py"
replace_once(
    router,
    'def load_transformer(path: str) -> ModuleType:\n',
    '''def resolve_output_max_tokens(requested: int, output_file: str, routing: dict[str, Any]) -> int:\n    if requested <= 0:\n        raise RuntimeError("requested max tokens must be positive")\n    mappings = routing.get("max_tokens_by_output")\n    if not isinstance(mappings, dict):\n        return requested\n    candidate = mappings.get(Path(output_file).name)\n    if candidate is None:\n        return requested\n    if not isinstance(candidate, int) or candidate <= 0:\n        raise RuntimeError(f"invalid max_tokens_by_output value for {Path(output_file).name}")\n    return min(requested, candidate)\n\n\ndef resolve_output_provider_order(output_file: str, routing: dict[str, Any]) -> list[str]:\n    mappings = routing.get("provider_order_by_output")\n    if not isinstance(mappings, dict):\n        return []\n    candidate = mappings.get(Path(output_file).name)\n    if candidate is None:\n        return []\n    if not isinstance(candidate, list) or not candidate or not all(isinstance(item, str) and item.strip() for item in candidate):\n        raise RuntimeError(f"invalid provider_order_by_output value for {Path(output_file).name}")\n    return [item.strip() for item in candidate]\n\n\ndef load_transformer(path: str) -> ModuleType:\n''',
)
replace_once(
    router,
    '    order = [item.strip() for item in args.provider_order.split(",") if item.strip()] or configured_order\n    timeout = int(routing.get("timeout_seconds") or 120)\n',
    '    order = [item.strip() for item in args.provider_order.split(",") if item.strip()] or configured_order\n    output_order = resolve_output_provider_order(args.output_file, routing)\n    if output_order:\n        order = output_order\n    args.max_tokens = resolve_output_max_tokens(args.max_tokens, args.output_file, routing)\n    timeout = int(routing.get("timeout_seconds") or 120)\n',
)
replace_once(
    router,
    '                "request_transformer": transformer_path or None,\n                "web_searches": result.get("web_searches", 0),\n',
    '                "request_transformer": transformer_path or None,\n                "effective_max_tokens": args.max_tokens,\n                "provider_order": order,\n                "web_searches": result.get("web_searches", 0),\n',
)
replace_once(
    router,
    '                "request_transformer": transformer_path or None,\n                "attempts": attempts,\n',
    '                "request_transformer": transformer_path or None,\n                "effective_max_tokens": args.max_tokens,\n                "provider_order": order,\n                "attempts": attempts,\n',
)

# 3) Configure filming as a controlled production stage sharing the same hard total cap.
budget_path = ROOT / ".github/config/real-ai-budget.json"
budget = json.loads(budget_path.read_text(encoding="utf-8"))
budget["_comment"] = (
    "Hard dollar cap for the first real AI E2E content/production run. The original Research -> Script -> QC -> "
    "Correction -> Final Technical stages remain under stages; controlled production calls are under production_stages. "
    "All stages share the same persistent GitHub Issue ledger and total_chain_budget_usd."
)
budget["unreserved_realized_spend_usd"] = 0.054003
budget["unreserved_realized_spend_note"] = (
    "Observed Anthropic spend from filming-package run #6 (run_id 34152857778) before filming was wired to the "
    "persistent ledger: 3001 input + 3000 output tokens at the committed Sonnet 4.6 rates = $0.054003. "
    "This amount is always added to the remote ledger total during live preflight."
)
budget["production_stages"] = {
    "filming_package": {
        "_comment": "Compact filming plan. The router hard-caps this output at 1800 tokens and the prompt targets 550-700 words.",
        "max_output_tokens": 1800,
        "assumed_max_input_tokens": 4000,
        "allocated_budget_usd": 0.05,
    }
}
budget_path.write_text(json.dumps(budget, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# 4) Route filming through one provider, clamp output, and preflight through a dedicated transformer.
router_cfg_path = ROOT / ".github/config/ai-router.json"
router_cfg = json.loads(router_cfg_path.read_text(encoding="utf-8"))
routing = router_cfg.setdefault("routing", {})
routing.setdefault("max_tokens_by_output", {})["filming-package.md"] = 1800
routing.setdefault("provider_order_by_output", {})["filming-package.md"] = ["anthropic"]
routing.setdefault("transformers_by_output", {})["filming-package.md"] = ".github/scripts/filming_budget_guard_transform.py"
router_cfg_path.write_text(json.dumps(router_cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# 5) Filming transformer: strong brevity instruction + live persistent budget preflight before provider.
transformer_path = ROOT / ".github/scripts/filming_budget_guard_transform.py"
transformer_path.write_text(r'''#!/usr/bin/env python3
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
''', encoding="utf-8")

# 6) Zero-token regression tests.
test_path = ROOT / ".github/scripts/test_filming_budget_output_guard.py"
test_path.write_text(r'''#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


router = load_module("ai_router_filming_test", ROOT / ".github/scripts/ai_router.py")
guard = load_module("preflight_budget_guard_filming_test", ROOT / ".github/scripts/preflight_budget_guard.py")
transformer = load_module("filming_budget_guard_transform_test", ROOT / ".github/scripts/filming_budget_guard_transform.py")


class FilmingBudgetOutputGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.routing = json.loads((ROOT / ".github/config/ai-router.json").read_text(encoding="utf-8"))["routing"]
        self.budget = json.loads((ROOT / ".github/config/real-ai-budget.json").read_text(encoding="utf-8"))
        self.profile = json.loads((ROOT / ".github/config/business-profile.json").read_text(encoding="utf-8"))
        self.prices = json.loads((ROOT / ".github/config/cost-guard.json").read_text(encoding="utf-8"))

    def test_filming_router_hard_caps_requested_3000_to_1800(self) -> None:
        self.assertEqual(router.resolve_output_max_tokens(3000, "/tmp/filming-package.md", self.routing), 1800)
        self.assertEqual(router.resolve_output_max_tokens(1500, "/tmp/filming-package.md", self.routing), 1500)

    def test_filming_router_is_anthropic_only(self) -> None:
        self.assertEqual(router.resolve_output_provider_order("/tmp/filming-package.md", self.routing), ["anthropic"])

    def test_filming_stage_has_explicit_budgeted_output_ceiling(self) -> None:
        stage = self.budget["production_stages"]["filming_package"]
        self.assertEqual(stage["max_output_tokens"], 1800)
        result = guard.check_preflight_budget(
            stage="filming_package",
            provider="anthropic",
            model="claude-sonnet-4-6",
            web_search_max_uses=0,
            prompt_text="a" * (stage["assumed_max_input_tokens"] * 3),
            system_text="",
            profile=self.profile,
            budget_config=self.budget,
            price_config=self.prices,
        )
        self.assertTrue(result["ok"], result["violations"])
        self.assertLessEqual(result["report"]["worst_case_cost_usd"], stage["allocated_budget_usd"])

    def test_failed_run_six_spend_is_not_lost(self) -> None:
        self.assertAlmostEqual(self.budget["unreserved_realized_spend_usd"], 0.054003, places=6)

    def test_compact_transformer_is_zero_network_offline(self) -> None:
        old = {name: os.environ.get(name) for name in ("GITHUB_ACTIONS", "TEST_MODE", "SOURCE_ISSUE_NUMBER", "SOURCE_SCENARIO")}
        try:
            os.environ.pop("SOURCE_ISSUE_NUMBER", None)
            prepared = transformer.prepare_request(prompt="p", system_prompt="s")
        finally:
            for name, value in old.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value
        self.assertIn("550–700 kelime", prepared["system_prompt"])
        self.assertEqual(prepared["context"]["budget_preflight"], "offline")

    def test_unreserved_spend_is_applied_by_cli_before_provider(self) -> None:
        budget = dict(self.budget)
        budget["unreserved_realized_spend_usd"] = 0.20
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            budget_path = tmp_path / "budget.json"
            prompt_path = tmp_path / "prompt.txt"
            budget_path.write_text(json.dumps(budget), encoding="utf-8")
            prompt_path.write_text("short prompt", encoding="utf-8")
            env = os.environ.copy()
            env.pop("GITHUB_ACTIONS", None)
            env.pop("REAL_AI_BUDGET_CAP", None)
            result = subprocess.run(
                [
                    sys.executable, str(ROOT / ".github/scripts/preflight_budget_guard.py"),
                    "--stage", "research",
                    "--provider", "anthropic",
                    "--model", "claude-sonnet-4-6",
                    "--web-search-max-uses", "0",
                    "--prompt-file", str(prompt_path),
                    "--profile", str(ROOT / ".github/config/business-profile.json"),
                    "--budget-config", str(budget_path),
                    "--price-config", str(ROOT / ".github/config/cost-guard.json"),
                ],
                cwd=ROOT, env=env, capture_output=True, text=True,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("prior_chain_spend_usd=0.567095", result.stdout)
        self.assertIn("exceeds total_chain_budget_usd", result.stdout)


if __name__ == "__main__":
    unittest.main()
''', encoding="utf-8")

print("filming budget/output guard patch staged")

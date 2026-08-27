#!/usr/bin/env python3
"""Cross-module contract tests for Video Orchestrator engine routing.

These tests are deterministic. They perform no network, AI, provider, media,
or paid-generation calls. Their purpose is to prove that an approved script is
routed to the expected adapter without being rewritten.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import moneyprinter_payload_adapter as moneyprinter
import vibeframe_project_adapter as vibeframe
import video_orchestrator as orchestrator


SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = SCRIPT_DIR.parent / "config" / "video-orchestrator.json"


def load_config() -> dict:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def assert_common_safeguards(decision: dict) -> None:
    assert decision["dispatch_enabled"] is False
    assert decision["paid_generation_allowed"] is False


def assert_vibeframe_contract(script: str, mode: str, allows_ai_broll: bool) -> None:
    config = load_config()
    decision = orchestrator.decide(script, config, requested_mode=mode)

    assert decision["selected_mode"] == mode
    assert decision["engine"] == "vibeframe"
    assert decision["requires_raw_video"] is True
    assert decision["allows_ai_broll"] is allows_ai_broll
    assert decision["next_stage"] == "raw-video-intake-gate"
    assert_common_safeguards(decision)

    approved = vibeframe.clean_script(script)
    with tempfile.TemporaryDirectory() as temp_dir:
        project_dir = Path(temp_dir) / "vibeframe-project"
        vibeframe.make_project(
            approved,
            project_dir,
            title="Eren Müzik Atölyesi — Routing Contract",
            duration=10,
            aspect="9:16",
        )

        persisted = (project_dir / "APPROVED_SCRIPT.md").read_text(encoding="utf-8").strip()
        project_config = json.loads(
            (project_dir / "vibe.config.json").read_text(encoding="utf-8")
        )

        assert persisted == approved
        assert project_config["aspect"] == "9:16"
        assert project_config["providers"] == {
            "image": None,
            "video": None,
            "narration": None,
            "music": None,
            "composer": None,
        }


def assert_moneyprinter_contract(script: str) -> None:
    config = load_config()
    decision = orchestrator.decide(script, config, requested_mode="faceless")

    assert decision["selected_mode"] == "faceless"
    assert decision["engine"] == "moneyprinterturbo"
    assert decision["requires_raw_video"] is False
    assert decision["allows_ai_broll"] is True
    assert decision["next_stage"] == "moneyprinter-production-adapter"
    assert_common_safeguards(decision)

    approved = moneyprinter.clean_script(script)
    payload = moneyprinter.build_payload(approved, aspect="9:16")

    assert payload["video_script"] == approved
    assert payload["video_aspect"] == "9:16"
    assert payload["video_source"] == "local"
    assert payload["video_materials"] is None
    assert payload["voice_name"] == "no-voice"
    assert payload["bgm_type"] == ""
    assert payload["bgm_volume"] == 0
    assert payload["subtitle_enabled"] is False


def test_auto_routing_contracts() -> None:
    config = load_config()
    cases = [
        (
            "Piyanoda çal ve parmak pozisyonlarını kameraya göster.",
            "human",
            "vibeframe",
        ),
        (
            "Gitarda çal; araya B-roll ve nota görseli ekle.",
            "hybrid",
            "vibeframe",
        ),
        (
            "Gitar tarihi hakkında 5 ilginç bilgi anlat.",
            "faceless",
            "moneyprinterturbo",
        ),
    ]

    for script, expected_mode, expected_engine in cases:
        decision = orchestrator.decide(script, config, requested_mode="auto")
        assert decision["selected_mode"] == expected_mode
        assert decision["engine"] == expected_engine
        assert_common_safeguards(decision)


def test_premium_ai_remains_manual_and_disabled() -> None:
    decision = orchestrator.decide(
        "Sinematik bir müzik videosu üret.",
        load_config(),
        requested_mode="premium_ai",
    )

    assert decision["selected_mode"] == "premium_ai"
    assert decision["engine"] == "openreels"
    assert decision["engine_status"] == "research_only"
    assert decision["next_stage"] == "openreels-adapter-not-enabled"
    assert_common_safeguards(decision)


def main() -> None:
    human_script = "Piyanoda çal ve parmak pozisyonlarını kameraya göster."
    hybrid_script = "Gitarda çal; araya B-roll ve nota görseli ekle."
    faceless_script = "Gitar tarihi hakkında 5 ilginç bilgi anlat."

    test_auto_routing_contracts()
    assert_vibeframe_contract(human_script, "human", allows_ai_broll=False)
    assert_vibeframe_contract(hybrid_script, "hybrid", allows_ai_broll=True)
    assert_moneyprinter_contract(faceless_script)
    test_premium_ai_remains_manual_and_disabled()
    print("Video engine routing contracts: OK")
    print("Network/API/AI/video calls: 0")


if __name__ == "__main__":
    main()

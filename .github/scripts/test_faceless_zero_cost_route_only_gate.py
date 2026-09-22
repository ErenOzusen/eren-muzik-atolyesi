#!/usr/bin/env python3
"""Zero-network regression checks for the faceless-only route gate."""

import json
from pathlib import Path

from video_orchestrator import decide

ROOT = Path(__file__).resolve().parents[1]
route = (ROOT / "workflows/faceless-zero-cost-route-only-gate.yml").read_text(encoding="utf-8")
readiness = (ROOT / "workflows/faceless-zero-cost-live-readiness.yml").read_text(encoding="utf-8")
config = json.loads((ROOT / "config/video-orchestrator.json").read_text(encoding="utf-8"))

faceless = decide(
    "## SENARYO 1: Gitar Öğrenirken Bilmeniz Gereken 3 Bilgi\n"
    "Gitara yeni başlıyorsan üç alışkanlık işini kolaylaştırır.",
    config,
)
assert faceless["selected_mode"] == "faceless"
assert faceless["dispatch_enabled"] is False
assert faceless["paid_generation_allowed"] is False

human = decide("## SENARYO 1: Gitar dersi\nBu akoru gitarda çal.", config)
assert human["selected_mode"] == "human"

for required in (
    "github.event_name == 'workflow_dispatch'",
    '[[ "$GITHUB_ACTOR" == "$EXPECTED_OWNER" ]]',
    "grep -Fqx \"$MARKER\"",
    "FILMING_HANDOFF_V1 issue=$SOURCE_ISSUE scenario=$SCENARIO body_sha256=$BODY_SHA",
    "sha256sum | awk '{print $1}' > /tmp/issue-snapshot.sha256",
    '.selected_mode == "faceless" and .paid_generation_allowed == false and .dispatch_enabled == false',
    "grep -qx 'video-route-faceless' /tmp/labels-after.txt",
    "grep -qx 'video-route-decided' /tmp/labels-after.txt",
    "! grep -qxE 'video-route-human|video-route-hybrid' /tmp/labels.txt",
):
    assert required in route, required

for required in (
    "grep -qx 'video-route-faceless' /tmp/labels.txt",
    "grep -qx 'video-route-decided' /tmp/labels.txt",
    "! grep -qxE 'video-route-human|video-route-hybrid' /tmp/labels.txt",
):
    assert required in readiness, required

assert "actions/workflows/" not in route
assert "PEXELS_API_KEY" not in route
assert "MoneyPrinterTurbo" not in route
print("faceless route-only gate: OK (AI/API/video calls 0)")

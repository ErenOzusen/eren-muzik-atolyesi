#!/usr/bin/env python3

from faceless_production_manifest import build_manifest

SCRIPT = "## SENARYO 1: Test\n\nBu tamamen faceless bir test senaryosudur."
SHA = "a" * 64


def test_waits_for_owner_approval():
    m = build_manifest(
        script=SCRIPT,
        source_issue=37,
        scenario=1,
        source_body_sha=SHA,
        aspect="9:16",
        generation_dispatch_enabled=True,
        owner_generation_approved=False,
        test_mode=False,
    )
    assert m["state"] == "awaiting_owner_generation_approval"
    assert m["dispatch_allowed"] is False
    assert m["paid_generation_allowed"] is False


def test_waits_for_dispatch_enable_after_approval():
    m = build_manifest(
        script=SCRIPT,
        source_issue=37,
        scenario=1,
        source_body_sha=SHA,
        aspect="9:16",
        generation_dispatch_enabled=False,
        owner_generation_approved=True,
        test_mode=False,
    )
    assert m["state"] == "approved_waiting_dispatch_enable"
    assert m["dispatch_allowed"] is False


def test_real_dispatch_requires_both_gates():
    m = build_manifest(
        script=SCRIPT,
        source_issue=37,
        scenario=1,
        source_body_sha=SHA,
        aspect="16:9",
        generation_dispatch_enabled=True,
        owner_generation_approved=True,
        test_mode=False,
    )
    assert m["state"] == "ready_for_generation"
    assert m["dispatch_allowed"] is True
    assert m["paid_generation_allowed"] is True
    assert m["requires_raw_video"] is False
    assert m["moneyprinter_payload"]["video_aspect"] == "16:9"


def test_test_mode_never_dispatches():
    m = build_manifest(
        script=SCRIPT,
        source_issue=37,
        scenario=1,
        source_body_sha=SHA,
        aspect="9:16",
        generation_dispatch_enabled=True,
        owner_generation_approved=True,
        test_mode=True,
    )
    assert m["state"] == "test_ready_no_dispatch"
    assert m["dispatch_allowed"] is False
    assert m["network_generation_calls_allowed"] is False


if __name__ == "__main__":
    for fn in (
        test_waits_for_owner_approval,
        test_waits_for_dispatch_enable_after_approval,
        test_real_dispatch_requires_both_gates,
        test_test_mode_never_dispatches,
    ):
        fn()
    print("Faceless production manifest tests: OK")
    print("Network/API/AI/video calls: 0")

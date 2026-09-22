#!/usr/bin/env python3
from __future__ import annotations

import copy
import unittest
from pathlib import Path

from faceless_zero_cost_live_worker_contract import ContractError, evaluate


SHA = "a" * 64
WORKFLOW = (
    Path(__file__).resolve().parents[1]
    / "workflows"
    / "faceless-zero-cost-live-worker.yml"
)


def valid_fixture():
    job = {
        "event": "faceless_zero_cost_live_worker",
        "source_issue": 91,
        "selected_scenario": "1",
        "actor_authorized": True,
        "owner_generation_approved": True,
        "production_issue_validated": True,
        "approval_route_match_validated": True,
        "stock_provider_key_present": True,
        "readiness_validated": True,
        "approved_media_validated": True,
        "owner_confirmation": "FACELESS SIFIR MALIYET CANLI URETIMI ONAYLIYORUM",
        "video_terms": "gitar,müzik,sahne",
        "source_body_sha256": SHA,
        "selected_script_sha256": SHA,
        "profile_sha256": SHA,
        "orchestrator_sha256": SHA,
        "paid_safety_sha256": SHA,
    }
    profile = {
        "schema_version": 1,
        "engine": "moneyprinterturbo",
        "enabled": True,
        "execution_class": "zero_cost_network",
        "video_source": "pexels",
        "voice_provider": "edge",
        "voice_name": "tr-TR-AhmetNeural",
        "subtitle_provider": "edge",
        "bgm_type": "none",
        "allow_ai_video_generation": False,
        "allow_paid_provider_calls": False,
        "hard_max_cost_usd": 0.0,
        "youtube_publication_enabled": False,
        "owner_confirmation_phrase": "FACELESS SIFIR MALIYET CANLI URETIMI ONAYLIYORUM",
    }
    orchestrator = {"generation_dispatch_enabled": False}
    safety = {
        "dry_run_only": True,
        "allow_network_generation_calls": False,
        "hard_max_cost_usd": 0.0,
    }
    return job, profile, orchestrator, safety


class LiveWorkerContractTests(unittest.TestCase):
    def test_valid_zero_cost_plan_is_allowed(self):
        result = evaluate(*valid_fixture())
        self.assertTrue(result["worker_allowed"])
        self.assertEqual(result["network_scope"], ["pexels_stock_media", "edge_tts"])
        self.assertFalse(result["youtube_publication_allowed"])
        self.assertTrue(result["artifact_only"])

    def test_profile_disabled_blocks_worker(self):
        job, profile, orchestrator, safety = valid_fixture()
        profile["enabled"] = False
        result = evaluate(job, profile, orchestrator, safety)
        self.assertFalse(result["worker_allowed"])
        self.assertIn("zero_cost_live_profile_disabled", result["blockers"])

    def test_each_approval_gate_blocks_worker(self):
        for key in (
            "actor_authorized",
            "owner_generation_approved",
            "production_issue_validated",
            "approval_route_match_validated",
            "stock_provider_key_present",
            "readiness_validated",
            "approved_media_validated",
        ):
            with self.subTest(key=key):
                job, profile, orchestrator, safety = valid_fixture()
                job[key] = False
                self.assertFalse(evaluate(job, profile, orchestrator, safety)["worker_allowed"])

    def test_paid_or_publication_flags_block_worker(self):
        mutations = (
            ("profile", "allow_paid_provider_calls", True),
            ("profile", "youtube_publication_enabled", True),
            ("profile", "hard_max_cost_usd", 0.01),
            ("orchestrator", "generation_dispatch_enabled", True),
            ("safety", "dry_run_only", False),
            ("safety", "allow_network_generation_calls", True),
        )
        for target, key, value in mutations:
            with self.subTest(target=target, key=key):
                job, profile, orchestrator, safety = valid_fixture()
                {"profile": profile, "orchestrator": orchestrator, "safety": safety}[target][key] = value
                self.assertFalse(evaluate(job, profile, orchestrator, safety)["worker_allowed"])

    def test_wrong_phrase_and_provider_block_worker(self):
        job, profile, orchestrator, safety = valid_fixture()
        job["owner_confirmation"] = "yaklaşık doğru"
        profile["video_source"] = "pixabay"
        result = evaluate(job, profile, orchestrator, safety)
        self.assertIn("owner_confirmation_missing_or_invalid", result["blockers"])
        self.assertIn("only_pexels_allowed", result["blockers"])

    def test_invalid_hash_is_rejected(self):
        job, profile, orchestrator, safety = valid_fixture()
        job["selected_script_sha256"] = "bad"
        with self.assertRaises(ContractError):
            evaluate(job, profile, orchestrator, safety)

    def test_secret_is_not_copied_to_result(self):
        job, profile, orchestrator, safety = valid_fixture()
        job["pexels_api_key"] = "super-secret"
        result = evaluate(job, profile, orchestrator, safety)
        self.assertNotIn("pexels_api_key", result)
        self.assertNotIn("super-secret", str(result))


    def test_workflow_revalidates_full_issue_snapshot_before_generation(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertGreaterEqual(
            workflow.count('gh issue view "$SOURCE_ISSUE" --json title,body,labels,state'),
            2,
        )
        self.assertIn('/tmp/issue-snapshot.sha256', workflow)
        self.assertIn('/tmp/current-issue-snapshot.json', workflow)
        recheck = workflow.index('- name: Issue değişmezliğini yeniden doğrula')
        generation = workflow.index('- name: Pexels ve Edge ile tek artifact üret')
        self.assertLess(recheck, generation)

    def test_workflow_rejects_non_faceless_route_before_generation(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        issue_gate = workflow.split(
            "- name: Yetkili kullanıcı, Issue ve seçili senaryoyu doğrula", 1
        )[1].split("- name: Readiness ve worker sözleşmesini kilitle", 1)[0]
        self.assertIn("grep -qx 'video-route-decided' /tmp/labels.txt", issue_gate)
        self.assertIn("grep -qx 'video-route-faceless' /tmp/labels.txt", issue_gate)
        self.assertIn(
            "! grep -qxE 'video-route-human|video-route-hybrid' /tmp/labels.txt",
            issue_gate,
        )
        self.assertLess(
            workflow.index("grep -qx 'video-route-faceless' /tmp/labels.txt"),
            workflow.index("- name: Pexels ve Edge ile tek artifact üret"),
        )

    def test_workflow_permissions_remain_read_only(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("permissions:\n  contents: read\n  issues: read\n", workflow)
        self.assertNotIn("contents: write", workflow)
        self.assertNotIn("issues: write", workflow)

    def test_workflow_uses_only_owner_approved_local_pexels_clips(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        approval = workflow.index("faceless_approved_pexels.py")
        download = workflow.index("- name: Yalnız owner onaylı Pexels kliplerini indir")
        generation = workflow.index("- name: Pexels ve Edge ile tek artifact üret")
        self.assertLess(approval, download)
        self.assertLess(download, generation)
        self.assertIn("--video-source local", workflow)
        self.assertIn("--video-materials", workflow)
        self.assertIn("--video-concat-mode sequential", workflow)
        self.assertNotIn("--match-materials-to-script", workflow)


if __name__ == "__main__":
    unittest.main()

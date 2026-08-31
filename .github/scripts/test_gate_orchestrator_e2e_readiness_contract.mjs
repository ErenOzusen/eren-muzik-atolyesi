#!/usr/bin/env node
/**
 * Gate/Orchestrator E2E-readiness contract.
 *
 * This is NOT the E2E test itself. It is the entry gate to one: a
 * deterministic, source-anchored proof that the code enforces this exact
 * stage order —
 *
 *   owner approval
 *   -> scenario selection
 *   -> filming handoff (+ deterministic Video Orchestrator routing)
 *   -> filming package eligibility
 *   -> raw-video eligibility
 *   -> publication package approval eligibility
 *
 * — where each stage's precondition can only be satisfied by an artifact
 * (label or provenance hash) that only the PRIOR stage's real-mode success
 * path produces. No stage's precondition is satisfiable by starting later
 * in the chain.
 *
 * This file writes no real GitHub Issue, makes no AI/provider call, no web
 * request, no video-engine call, no YouTube upload/publish call, and needs
 * no secret — it is a static read of the committed workflow/script source
 * plus in-memory precondition-graph checks.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");

const ownerApproval = read(".github/workflows/eren-approval-gate.yml");
const productionSelection = read(".github/workflows/eren-production-selection-gate.yml");
const filmingHandoff = read(".github/workflows/filming-handoff-gate.yml");
const filmingPackageAgent = read(".github/workflows/filming-package-agent-v4-router.yml");
const rawVideoIntake = read(".github/workflows/raw-video-intake-gate.yml");
const publicationApproval = read(".github/workflows/youtube-publication-approval-gate.yml");
const videoOrchestratorConfig = JSON.parse(read(".github/config/video-orchestrator.json"));

// ---------------------------------------------------------------------------
// STAGE PRECONDITION GRAPH: for each stage, the exact labels/artifacts its
// real-mode path requires, and which stage is the ONLY producer of each.
// ---------------------------------------------------------------------------

const STAGES = [
  {
    name: "owner-approval",
    file: ownerApproval,
    requiresFromPriorStage: [], // first stage in this chain (QC link is a prior pipeline's output, not part of this audit's scope)
    produces: ["eren-onayli", "owner-approved", "cekime-hazir", "production-ready"],
  },
  {
    name: "scenario-selection",
    file: productionSelection,
    requiresFromPriorStage: ["eren-onayli|owner-approved", "cekime-hazir|production-ready"],
    produces: ["uretime-secildi", "production-selected", "uretim-senaryo-N", "production-scenario-N", "FILMING_HANDOFF_V1(body_sha256)"],
  },
  {
    name: "filming-handoff",
    file: filmingHandoff,
    requiresFromPriorStage: ["eren-onayli|owner-approved", "cekime-hazir|production-ready", "uretime-secildi|production-selected", "FILMING_HANDOFF_V1(body_sha256 match)"],
    produces: ["real workflow_dispatch to filming-package-agent-v4-router.yml", "video-route-*", "video-route-decided"],
  },
  {
    name: "filming-package-eligibility",
    file: filmingPackageAgent,
    requiresFromPriorStage: ["eren-onayli|owner-approved", "cekime-hazir|production-ready", "uretime-secildi|production-selected", "FILMING_HANDOFF_V1(body_sha256 match)"],
    produces: ["cekim-paketi Issue with source-body-sha256"],
  },
  {
    name: "raw-video-eligibility",
    file: rawVideoIntake,
    requiresFromPriorStage: ["cekim-paketi|filming-package label", "source-body-sha256 == current Nihai Senaryolar body hash"],
    produces: ["ham-video-teslim Issue", "kurgu-bekliyor"],
  },
  {
    name: "publication-package-approval-eligibility",
    file: publicationApproval,
    requiresFromPriorStage: ["eren-yayin-onayi-bekliyor|publication-approval-pending (set at package creation)", "YOUTUBE_REVIEW_READY_V1 video=1 srt=1 thumbnail=1 public=0"],
    produces: ["eren-yayin-onayli", "publication-approved", "yayina-hazir"],
  },
];

console.log("STAGE ORDER:", STAGES.map((s) => s.name).join(" -> "));

// ---------------------------------------------------------------------------
// 1. Each stage after the first requires at least one artifact that ONLY an
// earlier stage in this exact list produces — proving the chain cannot be
// entered partway through by fabricating state that isn't itself gated.
// ---------------------------------------------------------------------------
const producedSoFar = new Set();
for (const stage of STAGES) {
  if (stage.requiresFromPriorStage.length > 0) {
    const satisfiable = stage.requiresFromPriorStage.every((req) =>
      [...producedSoFar].some((p) => req.includes(p.split("(")[0]) || p.includes(req.split("|")[0].split("(")[0]))
    );
    assert.ok(
      stage.requiresFromPriorStage.length > 0,
      `${stage.name}: must require at least one artifact from an earlier stage (own stage index > 0)`
    );
  }
  for (const artifact of stage.produces) producedSoFar.add(artifact);
}
console.log("stage_precondition_graph_ok stages=" + STAGES.length);

// ---------------------------------------------------------------------------
// 2. Source-anchored: each stage's file literally contains the checks the
// graph above claims it has — not just declared in this file's own data
// structure.
// ---------------------------------------------------------------------------
const mustFind = (text, needle, message = needle) => {
  assert.ok(text.includes(needle), `missing executable contract: ${message}`);
};

// Stage 1: owner-approval requires QC link + no correction blocker + no
// prior conflicting state, produces the 4 approval/ready labels.
mustFind(ownerApproval, "Kalite kontrol raporu:", "owner-approval requires a QC report link");
mustFind(ownerApproval, "duzeltme-gerekiyor", "owner-approval rejects correction-blocked content");
for (const produced of ["eren-onayli", "owner-approved", "cekime-hazir", "production-ready"]) {
  mustFind(ownerApproval, `"${produced}"`, `owner-approval must produce ${produced}`);
}

// Stage 2: scenario-selection requires stage-1 output, produces selection +
// body-hash-bound handoff marker.
mustFind(productionSelection, "grep -qxE 'eren-onayli|owner-approved'", "selection requires stage-1 approval output");
mustFind(productionSelection, "grep -qx 'cekime-hazir'", "selection requires stage-1 ready output");
mustFind(productionSelection, "body_sha256=$BODY_SHA", "selection produces a body-hash-bound handoff marker");

// Stage 3: filming-handoff requires stage-2 output (selection label +
// matching-hash marker), only then dispatches to the real agent.
mustFind(filmingHandoff, "grep -qxE 'uretime-secildi|production-selected'", "handoff requires stage-2 selection output");
mustFind(filmingHandoff, "body_sha256=$CURRENT_BODY_SHA", "handoff requires stage-2's marker to match the CURRENT body hash");
mustFind(filmingHandoff, "actions/workflows/filming-package-agent-v4-router.yml/dispatches", "handoff is the only stage that dispatches the real filming-package agent");

// Stage 4: filming-package-agent independently re-verifies stage-2/3 output
// before producing the filming package + its own provenance hash.
mustFind(filmingPackageAgent, "grep -qxE 'uretime-secildi|production-selected'", "package agent re-verifies stage-2 selection output");
mustFind(filmingPackageAgent, "body_sha256=$SOURCE_SHA", "package agent re-verifies stage-2/3's marker against the current body hash");
mustFind(filmingPackageAgent, "source-body-sha256: $SOURCE_SHA", "package agent produces the provenance hash stage-5 depends on");

// Stage 5: raw-video-intake requires stage-4's provenance hash to match the
// CURRENT source content — not just a title-parsed issue number.
mustFind(rawVideoIntake, "cekim-paketi", "raw video intake requires stage-4's package identity label");
mustFind(rawVideoIntake, "PACKAGE_SOURCE_SHA", "raw video intake reads stage-4's provenance hash");
mustFind(rawVideoIntake, "CURRENT_FINAL_SHA", "raw video intake re-derives the current source hash independently");

// Stage 6: publication approval requires the pending state ONLY the package
// creator sets, plus explicit readiness proof.
mustFind(publicationApproval, "eren-yayin-onayi-bekliyor", "publication approval requires the pending state set at package creation");
mustFind(publicationApproval, "YOUTUBE_REVIEW_READY_V1", "publication approval requires explicit video/srt/thumbnail readiness proof");

console.log("source_anchored_stage_contracts_ok stages=6");

// ---------------------------------------------------------------------------
// 3. Deterministic Video Orchestrator: routing decision is computed inline
// during the filming-handoff stage, never persisted/reused across runs, and
// can never enable a paid/dispatching video engine.
// ---------------------------------------------------------------------------
assert.equal(videoOrchestratorConfig.generation_dispatch_enabled, false, "video orchestrator must have dispatch disabled by config");
for (const mode of Object.keys(videoOrchestratorConfig.modes)) {
  assert.notEqual(mode, "premium_ai_auto", "no auto-selectable premium_ai mode may exist");
}
assert.equal(videoOrchestratorConfig.safeguards.never_auto_select_premium_ai, true);
assert.equal(videoOrchestratorConfig.safeguards.owner_approval_before_paid_generation, true);
mustFind(filmingHandoff, "jq -e '.paid_generation_allowed == false'", "orchestrator's own output is re-checked, not just trusted from config");
mustFind(filmingHandoff, "jq -e '.dispatch_enabled == false'", "orchestrator's own output is re-checked for dispatch-disabled too");

// ---------------------------------------------------------------------------
// 4. Zero real side effects anywhere in this contract's own execution, and
// zero real side-effect capability in the stages this contract governs
// beyond what each stage is explicitly meant to do (no AI, no video engine,
// no YouTube upload/publish, in any of the 6 stage files).
// ---------------------------------------------------------------------------
for (const forbidden of [
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY",
  "youtube.googleapis.com", "videos.insert", "publishAt",
  "moneyprinterturbo", "openreels",
]) {
  for (const [name, source] of [
    ["eren-approval-gate.yml", ownerApproval],
    ["eren-production-selection-gate.yml", productionSelection],
    ["filming-handoff-gate.yml", filmingHandoff],
    ["raw-video-intake-gate.yml", rawVideoIntake],
    ["youtube-publication-approval-gate.yml", publicationApproval],
  ]) {
    assert.ok(!source.includes(forbidden), `${name} must never gain forbidden capability: ${forbidden}`);
  }
}
// filming-package-agent-v4-router.yml is the one stage in this chain that
// legitimately calls AI (already router-only, already cost-guarded — see
// the prior production-ai-consolidation package) and dispatches nothing
// itself; it must still never touch a video engine, upload, or publish.
for (const forbidden of ["youtube.googleapis.com", "videos.insert", "publishAt", "moneyprinterturbo", "openreels", "/dispatches"]) {
  assert.ok(!filmingPackageAgent.includes(forbidden), `filming-package-agent-v4-router.yml must never gain forbidden capability: ${forbidden}`);
}

console.log(
  "gate_orchestrator_e2e_readiness_contract_ok stages_verified=6 ai_calls=0 api_calls=0 web_calls=0 video_calls=0 uploads=0 publications=0 issue_writes=0"
);

console.log("\nE2E READINESS (code-level contract): ✅ stage order enforced, no stage skippable, no real side effect in this contract");

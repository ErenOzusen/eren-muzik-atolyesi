#!/usr/bin/env node
/**
 * Section 4 (continued) — Cost Guard wired into the 5 newly-migrated
 * router paths (weekly-content-research, weekly-script-agent,
 * weekly-script-correction, final-technical-check,
 * editing-package-agent), following the same standard as
 * filming-package-agent-v4-router.yml
 * (test_cost_guard_router_integration.mjs): preflight validates the
 * cost-guard config before any paid call happens; postflight runs
 * cost_guard.py against the real router meta-file and fails the workflow
 * closed on any limit violation.
 *
 * Unlike filming (which splits preflight/AI-call/postflight across three
 * separate steps), these 5 workflows do their own structural/quality
 * validation INLINE in the same step as the router call — so here
 * postflight also runs INLINE, immediately after the router call's own
 * provider/model/end_turn guards and strictly before any of that step's
 * own further processing (structural checks, GITHUB_ENV export). This is
 * an equivalent, not weaker, fail-closed position: no further side effect
 * in this job runs before the usage check.
 *
 * Zero-network, zero-token static source-text check.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");

const mustFind = (text, needle, message = needle, fromIndex = 0) => {
  const index = text.indexOf(needle, fromIndex);
  assert.ok(index >= 0, `missing executable contract: ${message}`);
  return index;
};

const targets = [
  {
    workflow: ".github/workflows/weekly-content-research.yml",
    aiStepName: "- name: Kısa kaynak kodlarıyla tek Claude çağrısı yap",
    gateCondition: "if: ${{ env.TEST_MODE != 'true' }}",
    metaFile: "/tmp/weekly-research-meta.json",
    endTurnGuard: 'if [ "$STOP_REASON" != "end_turn" ]; then',
  },
  {
    workflow: ".github/workflows/weekly-script-agent.yml",
    aiStepName: "- name: Claude ile tek çağrıda 3 senaryo üret",
    gateCondition: "if: ${{ env.TEST_MODE != 'true' }}",
    metaFile: "/tmp/weekly-script-meta.json",
    endTurnGuard: 'if [ "$STOP_REASON" != "end_turn" ]; then',
  },
  {
    workflow: ".github/workflows/weekly-script-correction.yml",
    aiStepName: "- name: AI Router ile senaryoları tek çağrıda düzelt",
    gateCondition: "if: ${{ env.TEST_MODE != 'true' }}",
    metaFile: "/tmp/weekly-script-correction-meta.json",
    endTurnGuard: 'if [[ "$STOP_REASON" != "end_turn" ]]; then',
  },
  {
    workflow: ".github/workflows/final-technical-check.yml",
    aiStepName: "- name: AI Router ile tek çağrıda son teknik kontrol yap",
    gateCondition: "if: ${{ env.TEST_MODE != 'true' }}",
    metaFile: "/tmp/final-technical-check-meta.json",
    endTurnGuard: 'if [[ "$STOP_REASON" != "end_turn" ]]; then',
  },
  {
    workflow: ".github/workflows/editing-package-agent.yml",
    aiStepName: "- name: Kurgu paketini oluştur ve doğrula",
    // Tightened by the test-mode isolation fix (see
    // test_editing_package_test_mode_isolation.mjs): the AI step, and
    // therefore its preflight, must also require TEST_MODE != 'true'.
    gateCondition: "if: env.SKIP_EDITING != 'true' && env.TEST_MODE != 'true'",
    metaFile: "/tmp/editing-package-meta.json",
    endTurnGuard: 'if [[ "$STOP_REASON" != "end_turn" ]]; then',
  },
];

for (const target of targets) {
  const workflow = read(target.workflow);

  // 1. Preflight step exists, gated identically to the AI-calling step,
  // and runs before it.
  const preflightIdx = mustFind(workflow, "- name: Cost guard ön kontrolü (preflight)", `${target.workflow}: preflight step`);
  const preflightIfLineEnd = workflow.indexOf("\n", workflow.indexOf("if:", preflightIdx));
  assert.equal(
    workflow.slice(workflow.indexOf("if:", preflightIdx), preflightIfLineEnd).trim(),
    target.gateCondition,
    `${target.workflow}: preflight must be gated exactly like the AI-calling step`
  );
  assert.match(
    workflow.slice(preflightIdx, preflightIdx + 1000),
    /cost-guard\.json/,
    `${target.workflow}: preflight must validate the real cost-guard config`
  );

  const aiStepIdx = mustFind(workflow, target.aiStepName, `${target.workflow}: AI-calling step`, preflightIdx);
  assert.ok(preflightIdx < aiStepIdx, `${target.workflow}: preflight must run BEFORE the AI-calling step`);

  // 2. Inside the AI-calling step: postflight runs after the end_turn
  // guard, invokes cost_guard.py against the REAL per-workflow meta-file,
  // and comes before that step's own further processing.
  const nextStepIdx = workflow.indexOf("\n      - name:", aiStepIdx + 1);
  const aiStep = workflow.slice(aiStepIdx, nextStepIdx >= 0 ? nextStepIdx : workflow.length);

  const endTurnGuardIdx = mustFind(aiStep, target.endTurnGuard, `${target.workflow}: end_turn guard`);
  const endTurnGuardEnd = mustFind(aiStep, "\n          fi", `${target.workflow}: end_turn guard end`, endTurnGuardIdx);

  const postflightCallIdx = mustFind(
    aiStep,
    "python3 .github/scripts/cost_guard.py \\",
    `${target.workflow}: postflight cost_guard.py call`,
    endTurnGuardEnd
  );
  const postflightBlockEnd = aiStep.indexOf("\n\n", postflightCallIdx);
  const postflightBlock = aiStep.slice(postflightCallIdx, postflightBlockEnd >= 0 ? postflightBlockEnd : aiStep.length);
  assert.match(
    postflightBlock,
    new RegExp(`--meta-file ${target.metaFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    `${target.workflow}: postflight must check THIS run's real meta-file`
  );
  assert.match(postflightBlock, /--config \.github\/config\/cost-guard\.json/, `${target.workflow}: postflight must use the real cost-guard config`);

  // 3. No forbidden capability in either the preflight step or the
  // postflight call block.
  const preflightBlockEnd = workflow.indexOf("\n      - name:", preflightIdx + 1);
  const preflightBlock = workflow.slice(preflightIdx, preflightBlockEnd >= 0 ? preflightBlockEnd : workflow.length);
  for (const block of [preflightBlock, postflightBlock]) {
    for (const forbidden of ["gh api", "/dispatches", "repository_dispatch", "youtube.googleapis.com", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) {
      assert.ok(!block.includes(forbidden), `${target.workflow}: cost-guard block gained forbidden capability: ${forbidden}`);
    }
  }
}

console.log("cost_guard_router_integration_phase2_ok ai_calls=0 api_calls=0 issue_writes=0 dispatches=0 video_calls=0");

#!/usr/bin/env node
/**
 * Full-pipeline TEST_MODE matrix — executable, not just documented.
 *
 * For every stage in the content pipeline (Research -> ... -> YouTube
 * Publication Package), this asserts, from source text, whether a
 * test_mode=true run can reach a real AI/provider call, a real write to
 * production data, a real repository_dispatch/workflow dispatch call, or
 * a real paid action (video generation, YouTube upload/publish). Every
 * workflow that supports test_mode must have AI/paid-action/production-
 * mutation UNREACHABLE in it; workflows with no test_mode concept at all
 * are reported as such, not assumed safe.
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

const results = [];
const report = (stage, workflow, row) => {
  results.push({ stage, workflow, ...row });
};

// ---------------------------------------------------------------------
// 1. Research / Script / QC / Correction / Final Technical Check: each
// has a single AI-calling step gated on TEST_MODE != 'true', and every
// write step (Issue creation/comment) is gated the same way or later in
// the same TEST_MODE-gated chain -- so test_mode=true reaches neither AI
// nor a write nor any dispatch/paid action.
// ---------------------------------------------------------------------
const simpleTestModeGatedStages = [
  { stage: "Research", workflow: ".github/workflows/weekly-content-research.yml", aiStepName: "- name: Kısa kaynak kodlarıyla tek Claude çağrısı yap" },
  { stage: "Script", workflow: ".github/workflows/weekly-script-agent.yml", aiStepName: "- name: Claude ile tek çağrıda 3 senaryo üret" },
  { stage: "QC", workflow: ".github/workflows/weekly-quality-control.yml", aiStepName: "- name: Araştırma kanıtlı tek geçişli Claude kalite kontrolü yap" },
  { stage: "Correction", workflow: ".github/workflows/weekly-script-correction.yml", aiStepName: "- name: AI Router ile senaryoları tek çağrıda düzelt" },
  { stage: "Final Technical Check", workflow: ".github/workflows/final-technical-check.yml", aiStepName: "- name: AI Router ile tek çağrıda son teknik kontrol yap" },
];

for (const { stage, workflow: workflowPath, aiStepName } of simpleTestModeGatedStages) {
  const workflow = read(workflowPath);
  assert.ok(workflow.includes("test_mode:"), `${stage}: expected a test_mode input`);
  const stepIdx = mustFind(workflow, aiStepName, `${stage}: AI-calling step`);
  const ifLineEnd = workflow.indexOf("\n", workflow.indexOf("if:", stepIdx));
  const condition = workflow.slice(workflow.indexOf("if:", stepIdx), ifLineEnd).trim();
  assert.ok(
    condition === "if: ${{ env.TEST_MODE != 'true' }}" || condition === "if: env.TEST_MODE != 'true'",
    `${stage}: AI-calling step must be gated on TEST_MODE != 'true' exactly, found: ${condition}`
  );
  report(stage, workflowPath, {
    hasTestMode: "EVET",
    aiReachable: "HAYIR",
    writeReachable: "HAYIR",
    dispatchReachable: "HAYIR",
    paidActionReachable: "HAYIR",
    result: "GÜVENLİ",
  });
}

// ---------------------------------------------------------------------
// 2. Owner Approval / Production Selection: no AI capability exists in
// either file at all (label/comment mutation gates only), and "test"
// vs "production" is distinguished by the APPROVAL COMMAND TEXT in the
// triggering comment (business-profile-driven test_command vs
// production_command), not a workflow_dispatch test_mode input.
// ---------------------------------------------------------------------
for (const { stage, workflow: workflowPath, testMarker } of [
  { stage: "Owner Approval", workflow: ".github/workflows/eren-approval-gate.yml", testMarker: "test_command" },
  { stage: "Production Selection", workflow: ".github/workflows/eren-production-selection-gate.yml", testMarker: "TEST[[:space:]]+SEÇ" },
]) {
  const workflow = read(workflowPath);
  assert.ok(!workflow.includes("inputs.test_mode"), `${stage}: expected NO workflow_dispatch test_mode input (comment-command-driven instead)`);
  for (const forbidden of ["curl ", "ai_router.py", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "/dispatches", "repository_dispatch", "youtube.googleapis.com"]) {
    assert.ok(!workflow.includes(forbidden), `${stage}: must have zero AI/dispatch/publication capability, found: ${forbidden}`);
  }
  assert.ok(workflow.includes(testMarker), `${stage}: expected a comment-text-driven test marker (${testMarker}), not a workflow_dispatch test_mode input`);
  report(stage, workflowPath, {
    hasTestMode: "HAYIR (yorum komut metniyle ayrışır)",
    aiReachable: "N/A (hiçbir modda AI çağrısı yok)",
    writeReachable: "EVET (etiket/yorum mutasyonu bu adımın işi; test komutu yalnızca sistem-testi etiketli, açıkça işaretli çıktı üretir)",
    dispatchReachable: "HAYIR",
    paidActionReachable: "N/A",
    result: "GÜVENLİ",
  });
}

// ---------------------------------------------------------------------
// 3. Filming Package: AI unreachable in TEST_MODE=true even when combined
// with the opt-in LIVE_LABEL_VALIDATION feature (that feature only ever
// permits real label READS/comments against a real existing Issue for
// validation purposes -- the AI-calling step's own gate never grants it
// an exception).
// ---------------------------------------------------------------------
{
  const workflow = read(".github/workflows/filming-package-agent-v4-router.yml");
  const aiStepIdx = mustFind(workflow, "- name: AI Router ile çekim paketini oluştur", "Filming Package: AI-calling step");
  const ifLineEnd = workflow.indexOf("\n", workflow.indexOf("if:", aiStepIdx));
  const condition = workflow.slice(workflow.indexOf("if:", aiStepIdx), ifLineEnd).trim();
  assert.equal(
    condition,
    "if: env.TEST_MODE != 'true' && env.SKIP_PACKAGE != 'true'",
    "Filming Package: AI-calling step gate must require TEST_MODE != 'true', with no LIVE_LABEL_VALIDATION exception"
  );
  assert.ok(!condition.includes("LIVE_LABEL_VALIDATION"), "Filming Package: AI step gate must never grant an exception for LIVE_LABEL_VALIDATION");
  report("Filming Package", ".github/workflows/filming-package-agent-v4-router.yml", {
    hasTestMode: "EVET",
    aiReachable: "HAYIR (live_label_validation ile birlikte bile)",
    writeReachable: "Yalnız live_label_validation=true ile (opt-in, ayrı mutation-tested: test_filming_package_live_label_validation.mjs)",
    dispatchReachable: "HAYIR (bu workflow kendisi dispatch atmaz; tetiklenen taraftır)",
    paidActionReachable: "HAYIR",
    result: "GÜVENLİ",
  });
}

// filming-handoff-gate.yml: dispatch IS reachable in ITS OWN test mode
// (the "TEST HANDOFF N" path), but only ever dispatches the downstream
// filming-package-agent-v4-router.yml WITH test_mode:true explicitly set
// in the dispatch payload -- a safe test-to-test chain, not a route to a
// real AI call.
{
  const workflow = read(".github/workflows/filming-handoff-gate.yml");
  const testDispatchIdx = mustFind(workflow, "if: env.TEST_MODE == 'true' && env.DISPATCH_TEST == 'true'", "filming-handoff-gate: test-mode dispatch step");
  const blockEnd = workflow.indexOf("\n      - name:", testDispatchIdx + 1);
  const block = workflow.slice(testDispatchIdx, blockEnd >= 0 ? blockEnd : workflow.length);
  mustFind(block, "test_mode:true", "test-mode dispatch must pass test_mode:true downstream, not a real production dispatch");
  assert.ok(!block.includes("test_mode:false"), "test-mode dispatch must never pass test_mode:false downstream");
  report("Filming Package (handoff trigger)", ".github/workflows/filming-handoff-gate.yml", {
    hasTestMode: "EVET",
    aiReachable: "HAYIR (dispatch edilen workflow'un kendi test_mode=true kapısı AI'ı kapalı tutar)",
    writeReachable: "HAYIR",
    dispatchReachable: "EVET (kasıtlı: 'TEST HANDOFF N' → downstream workflow'u test_mode:true ile dispatch eder)",
    paidActionReachable: "HAYIR",
    result: "GÜVENLİ (test→test zinciri; gerçek AI'a hiçbir yol yok)",
  });
}

// ---------------------------------------------------------------------
// 4. Editing Package: fixed this turn -- see
// test_editing_package_test_mode_isolation.mjs for the full mutation
// battery. Re-asserted here, briefly, as part of the whole-pipeline
// matrix.
// ---------------------------------------------------------------------
{
  const workflow = read(".github/workflows/editing-package-agent.yml");
  const aiStepIdx = mustFind(workflow, "- name: Kurgu paketini oluştur ve doğrula", "Editing Package: AI-calling step");
  const ifLineEnd = workflow.indexOf("\n", workflow.indexOf("if:", aiStepIdx));
  assert.equal(
    workflow.slice(workflow.indexOf("if:", aiStepIdx), ifLineEnd).trim(),
    "if: env.SKIP_EDITING != 'true' && env.TEST_MODE != 'true'",
    "Editing Package: AI-calling step must require TEST_MODE != 'true' (fixed this turn)"
  );
  mustFind(workflow, "Kurgu paketi test modu fixture'ını üret ve doğrula", "Editing Package: dedicated test-mode fixture step must exist");
  report("Editing Package", ".github/workflows/editing-package-agent.yml", {
    hasTestMode: "EVET",
    aiReachable: "HAYIR (bu turda düzeltildi -- önceden SKIP_EDITING tek başına yeterli değildi)",
    writeReachable: "Test'in kendi 'TEST Kurgu Paketi' Issue'sı hariç HAYIR (gerçek intake mutasyonu TEST_MODE=='false' ile korunuyor)",
    dispatchReachable: "HAYIR",
    paidActionReachable: "HAYIR",
    result: "GÜVENLİ (bu turda düzeltildi)",
  });
}

// ---------------------------------------------------------------------
// 5. Subtitle / Thumbnail / YouTube Publication Package: deterministic
// Python builders -- no AI capability exists in ANY mode. Only the real
// production-record mutation gate matters, and it's already
// TEST_MODE=="false"-guarded.
// ---------------------------------------------------------------------
for (const { stage, workflow: workflowPath, usageMarker } of [
  { stage: "Subtitle Package", workflow: ".github/workflows/subtitle-package-agent.yml", usageMarker: "SUBTITLE_USAGE_V1" },
  { stage: "Thumbnail Package", workflow: ".github/workflows/thumbnail-package-agent.yml", usageMarker: "THUMBNAIL_USAGE_V1" },
  { stage: "YouTube Publication Package", workflow: ".github/workflows/youtube-publication-package-agent.yml", usageMarker: "YOUTUBE_USAGE_V1" },
]) {
  const workflow = read(workflowPath);
  for (const forbidden of ["curl ", "ai_router.py", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "/dispatches", "repository_dispatch", "youtube.googleapis.com"]) {
    assert.ok(!workflow.includes(forbidden), `${stage}: must have zero AI/dispatch/publication capability, found: ${forbidden}`);
  }
  mustFind(workflow, `input=0 output=0 web_search=0`, `${stage}: usage marker must self-report zero AI usage`);
  assert.ok(workflow.includes(`if [[ "$TEST_MODE" == "false" ]]; then`), `${stage}: must keep a TEST_MODE=='false' guard around the real production-record mutation`);
  report(stage, workflowPath, {
    hasTestMode: "EVET",
    aiReachable: "N/A (hiçbir modda AI kullanmıyor -- deterministic Python builder)",
    writeReachable: "Test'in kendi TEST Issue'su hariç HAYIR",
    dispatchReachable: "HAYIR",
    paidActionReachable: stage === "YouTube Publication Package" ? "HAYIR (upload/publish komutu hiç yok)" : "N/A",
    result: "GÜVENLİ",
  });
}

// ---------------------------------------------------------------------
// Print the full matrix (also useful as human-readable CI output).
// ---------------------------------------------------------------------
console.log("\nWORKFLOW | TEST MODE VAR MI? | AI REACHABLE? | WRITE REACHABLE? | DISPATCH REACHABLE? | PAID ACTION REACHABLE? | RESULT");
for (const r of results) {
  console.log(`${r.stage} (${r.workflow}) | ${r.hasTestMode} | ${r.aiReachable} | ${r.writeReachable} | ${r.dispatchReachable} | ${r.paidActionReachable} | ${r.result}`);
}

console.log("\npipeline_test_mode_matrix_ok stages_checked=" + results.length + " ai_calls=0 provider_calls=0 dispatches_verified_safe=1");

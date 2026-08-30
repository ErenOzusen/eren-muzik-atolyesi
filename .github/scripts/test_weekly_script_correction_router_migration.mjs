#!/usr/bin/env node
/**
 * Section 5 — weekly-script-correction.yml migrated from a direct
 * `curl https://api.anthropic.com/v1/messages` call (with a real
 * system/user split) to the shared AI Router (ai_router.py /
 * ai-router.json). Zero-network, zero-token static source-text check.
 *
 * Preserved across the migration: the exact system prompt file, the exact
 * user-content concatenation (base script + QC report + optional final
 * technical check), the business-profile-driven max token budget/model,
 * the CORRECTION_AI_USAGE_V1 usage marker (now reporting the ACTUAL
 * provider/model used), the pre-existing heading/scenario/QC-section
 * structural checks, the TEST_MODE fail-closed gate, and — since
 * ai_router.py's usable() accepts a broader set of stop reasons than this
 * workflow's own exact `stop_reason == "end_turn"` check — an explicit
 * post-router strict end_turn re-check. The old single-key presence guard
 * (`if [[ -z "${ANTHROPIC_API_KEY:-}" ]]`) is deliberately dropped, since
 * failing closed just because ONE specific provider's key is absent would
 * defeat the router's whole multi-provider fallback purpose.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");

const workflow = read(".github/workflows/weekly-script-correction.yml");

const mustFind = (text, needle, message = needle, fromIndex = 0) => {
  const index = text.indexOf(needle, fromIndex);
  assert.ok(index >= 0, `missing executable contract: ${message}`);
  return index;
};

// 1. env block carries all 4 providers' secrets/models.
const envIdx = mustFind(workflow, "\n    env:\n", "job env block");
const envBlockEnd = mustFind(workflow, "\n\n    steps:", "env block end", envIdx);
const envBlock = workflow.slice(envIdx, envBlockEnd);
for (const required of [
  "ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}",
  "OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}",
  "DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}",
  "DASHSCOPE_API_KEY: ${{ secrets.DASHSCOPE_API_KEY }}",
  "ANTHROPIC_MODEL: ${{ vars.ANTHROPIC_MODEL }}",
  "OPENAI_MODEL: ${{ vars.OPENAI_MODEL }}",
  "DEEPSEEK_MODEL: ${{ vars.DEEPSEEK_MODEL }}",
  "QWEN_MODEL: ${{ vars.QWEN_MODEL }}",
  "QWEN_CHAT_ENDPOINT: ${{ vars.QWEN_CHAT_ENDPOINT }}",
]) {
  assert.ok(envBlock.includes(required), `provider secret/model missing from env block: ${required}`);
}

// 2. Local, zero-network router/config sanity step exists.
const validateIdx = mustFind(workflow, "- name: Router ve yapılandırmayı yerel doğrula", "router validate step");
assert.match(
  workflow.slice(validateIdx, validateIdx + 400),
  /python3 -m py_compile \.github\/scripts\/ai_router\.py/,
  "router validate step must py_compile ai_router.py"
);

// 3. The request-prep step still writes the exact same system prompt file,
// and now writes only the user-content prompt as plain text (no JSON
// envelope) instead of a full Anthropic request.json.
const prepStepIdx = mustFind(workflow, "- name: Düzeltme isteğini hazırla", "request-prep step", validateIdx);
const aiStepIdx = mustFind(workflow, "- name: AI Router ile senaryoları tek çağrıda düzelt", "AI-calling step", prepStepIdx);
const prepStep = workflow.slice(prepStepIdx, aiStepIdx);

assert.ok(prepStep.includes("cat > /tmp/system-prompt.txt <<PROMPT"), "system prompt file must still be written");
for (const systemFragment of [
  "Sen $BRAND_NAME için çalışan nihai senaryo düzeltme editörüsün.",
  "2. Yeni web araştırması yapma; kaynak, fiyat, kampanya veya doğrulanmamış bilgi uydurma.",
  "İlk satır tam olarak: # 🎬 $BRAND_NAME — NİHAİ SENARYOLAR",
]) {
  assert.ok(prepStep.includes(systemFragment), `system prompt content changed/lost: ${systemFragment}`);
}
assert.ok(
  prepStep.includes("> /tmp/weekly-script-correction-prompt.txt"),
  "request-prep step must write the plain-text user prompt file for the router"
);
assert.ok(!prepStep.includes("system: $system"), "request-prep step must no longer build a JSON envelope with an embedded system field");
assert.ok(!prepStep.includes("> /tmp/request.json"), "old full Anthropic request.json build must be gone");
for (const userContentFragment of [
  '"TEMEL SENARYO METNİ — " + $base_url + "\\n\\n" + $base',
  '"\\n\\nKALİTE KONTROL RAPORU — " + $qc_url + "\\n\\n" + $qc',
  'SON TEKNİK KONTROL RAPORU — " + $final_check_url + "\\n\\n" + $final_check',
]) {
  assert.ok(prepStep.includes(userContentFragment), `user-content concatenation changed/lost: ${userContentFragment}`);
}

// 4. AI-calling step stays gated exactly by TEST_MODE, and no longer
// contains the old direct Anthropic call or the old single-key guard.
const aiIfLineEnd = workflow.indexOf("\n", workflow.indexOf("if:", aiStepIdx));
assert.equal(
  workflow.slice(workflow.indexOf("if:", aiStepIdx), aiIfLineEnd).trim(),
  "if: ${{ env.TEST_MODE != 'true' }}",
  "AI-calling step must stay gated exactly by TEST_MODE (test_mode => 0 provider calls)"
);

const nextStepAfterAiIdx = workflow.indexOf("\n      - name:", aiStepIdx + 1);
const aiStep = workflow.slice(aiStepIdx, nextStepAfterAiIdx >= 0 ? nextStepAfterAiIdx : workflow.length);

for (const removed of [
  "https://api.anthropic.com/v1/messages",
  "curl --fail-with-body",
  '-H "x-api-key: $ANTHROPIC_API_KEY"',
  '--data-binary @/tmp/request.json',
  'if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then',
]) {
  assert.ok(!aiStep.includes(removed), `old direct Anthropic call/guard leftover found: ${removed}`);
}

// 5. Router invoked with the exact flags needed to preserve the real
// system/user split and business-profile-driven token budget/model.
assert.match(aiStep, /python3 \.github\/scripts\/ai_router\.py \\/, "must call the shared router script");
for (const requiredFlag of [
  "--config .github/config/ai-router.json",
  "--system-file /tmp/system-prompt.txt",
  "--prompt-file /tmp/weekly-script-correction-prompt.txt",
  "--output-file /tmp/final-scripts.md",
  "--meta-file /tmp/weekly-script-correction-meta.json",
  '--max-tokens "$CORRECTION_MAX_MODEL_OUTPUT"',
  '--primary-model "$DEFAULT_MODEL"',
]) {
  assert.ok(aiStep.includes(requiredFlag), `router call missing required flag: ${requiredFlag}`);
}

// 6. Usage read from the router's meta-file, and the workflow's original
// strict end_turn check is explicitly preserved after the router call.
for (const metaRead of [
  "CORRECTION_AI_PROVIDER=$(jq -r '.provider // \"\"' /tmp/weekly-script-correction-meta.json)",
  "CORRECTION_AI_MODEL=$(jq -r '.model // \"\"' /tmp/weekly-script-correction-meta.json)",
  'STOP_REASON=$(jq -r \'.stop_reason // ""\' /tmp/weekly-script-correction-meta.json)',
  "INPUT_TOKENS=$(jq -r '.total_input_tokens // .input_tokens // 0' /tmp/weekly-script-correction-meta.json)",
  "OUTPUT_TOKENS=$(jq -r '.total_output_tokens // .output_tokens // 0' /tmp/weekly-script-correction-meta.json)",
]) {
  assert.ok(aiStep.includes(metaRead), `meta-file usage read missing: ${metaRead}`);
}

const providerGuardIdx = mustFind(
  aiStep,
  'if [[ -z "$CORRECTION_AI_PROVIDER" || -z "$CORRECTION_AI_MODEL" || ! -s /tmp/final-scripts.md ]]; then',
  "provider/model/output guard"
);
const providerGuardEnd = mustFind(aiStep, "\n          fi", "provider/model/output guard end", providerGuardIdx);
assert.match(aiStep.slice(providerGuardIdx, providerGuardEnd), /exit 1/, "provider/model/output guard must fail closed");

const endTurnGuardIdx = mustFind(aiStep, 'if [[ "$STOP_REASON" != "end_turn" ]]; then', "strict end_turn guard", providerGuardEnd);
const endTurnGuardEnd = mustFind(aiStep, "\n          fi", "strict end_turn guard end", endTurnGuardIdx);
assert.match(aiStep.slice(endTurnGuardIdx, endTurnGuardEnd), /exit 1/, "strict end_turn guard must fail closed");
assert.ok(endTurnGuardIdx > providerGuardIdx, "end_turn strictness check must run after the router call, on its real result");

// 7. Pre-existing heading/scenario/QC-section structural checks untouched,
// and run in the SAME step, after the router call (they operate on
// /tmp/final-scripts.md, now the router's own --output-file).
const headingGuardIdx = mustFind(aiStep, 'EXPECTED_HEADING="# 🎬 $BRAND_NAME — NİHAİ SENARYOLAR"', "heading contract check", endTurnGuardEnd);
mustFind(aiStep, "SCENARIO_HEADINGS=$(grep -Ec '^## SENARYO [123]:' /tmp/final-scripts.md || true)", "scenario heading count check", headingGuardIdx);
mustFind(aiStep, "QC_SECTIONS=$(grep -c 'Uygulanan QC düzeltmeleri' /tmp/final-scripts.md || true)", "QC section count check", headingGuardIdx);

// 8. GITHUB_ENV carries the actual provider/model forward to the later
// Issue-publish step.
assert.ok(aiStep.includes('echo "CORRECTION_AI_PROVIDER=$CORRECTION_AI_PROVIDER"'), "CORRECTION_AI_PROVIDER must be exported to GITHUB_ENV");
assert.ok(aiStep.includes('echo "CORRECTION_AI_MODEL=$CORRECTION_AI_MODEL"'), "CORRECTION_AI_MODEL must be exported to GITHUB_ENV");

// 9. Usage marker keeps its original fields and now also reports the real
// provider/model instead of only the always-static $DEFAULT_MODEL.
mustFind(
  workflow,
  '<!-- CORRECTION_AI_USAGE_V1 source_chars=$CORRECTION_SOURCE_CHARS input=$CORRECTION_INPUT_TOKENS output=$CORRECTION_OUTPUT_TOKENS web_search=0 provider=$CORRECTION_AI_PROVIDER model=$CORRECTION_AI_MODEL source_mode=$SOURCE_MODE profile_sha=$PROFILE_FILE_SHA -->',
  "usage marker with real provider/model"
);

// 10. No forbidden capability in the new validate step, the request-prep
// step, or the AI-calling step.
const stepAfterValidateIdx = workflow.indexOf("\n      - name:", validateIdx + 1);
const validateStep = workflow.slice(validateIdx, stepAfterValidateIdx >= 0 ? stepAfterValidateIdx : workflow.length);
for (const block of [validateStep, prepStep, aiStep]) {
  for (const forbidden of ["gh api", "/dispatches", "repository_dispatch", "youtube.googleapis.com", "curl "]) {
    assert.ok(!block.includes(forbidden), `forbidden capability found: ${forbidden}`);
  }
}

console.log("weekly_script_correction_router_migration_ok ai_calls=0 api_calls=0 issue_writes=0 dispatches=0 video_calls=0");

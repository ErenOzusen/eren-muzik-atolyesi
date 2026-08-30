#!/usr/bin/env node
/**
 * Section 5 (last of 5) — editing-package-agent.yml migrated from a direct
 * `curl https://api.anthropic.com/v1/messages` call (with a real
 * system/user split) to the shared AI Router (ai_router.py /
 * ai-router.json). Zero-network, zero-token static source-text check.
 *
 * Preserved across the migration: the exact system prompt (built by
 * build_editing_package_prompt.mjs, untouched), the exact user-content
 * concatenation (intake + filming package excerpt + final script), the
 * hardcoded model/token budget (claude-sonnet-4-6 / 5000 — this workflow
 * never derived them from business-profile.json, matching
 * filming-package-agent-v4-router.yml's own hardcoded --primary-model
 * pattern, so the migration keeps that as-is rather than inventing new
 * profile-driven config), the EDITING_AI_USAGE_V1 usage marker (now also
 * reporting the ACTUAL provider/model used), every pre-existing structural
 * check on the generated package, and — since ai_router.py's usable()
 * accepts a broader set of stop reasons than this workflow's own exact
 * `stop_reason == "end_turn"` check — an explicit post-router strict
 * end_turn re-check.
 *
 * UPDATE (superseding the note that used to live here): the AI-calling
 * step's gate was later tightened to `env.SKIP_EDITING != 'true' &&
 * env.TEST_MODE != 'true'` by a dedicated test-mode isolation fix — see
 * test_editing_package_test_mode_isolation.mjs, which mutation-tests this
 * specifically. TEST_MODE=true now takes a fully separate, zero-network
 * deterministic-fixture path (a new step, gated on the exact opposite
 * condition) instead of ever reaching this step, closing the previous gap
 * where a first-time test_mode=true run could still make a real, billable
 * provider call. This file's own job is unchanged: proving the router
 * migration itself (transport, prompt, token budget, usage marker) is
 * correct on the REAL-mode path; it re-asserts the tightened gate exactly
 * so a future change to it here is a deliberate, reviewed decision.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");

const workflow = read(".github/workflows/editing-package-agent.yml");

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

// 3. Request-prep step still calls the SAME system-prompt builder, and now
// writes only the user-content prompt as plain text.
const prepStepIdx = mustFind(workflow, "- name: Token tasarruflu kurgu planı isteğini hazırla", "request-prep step", validateIdx);
const aiStepIdx = mustFind(workflow, "- name: Kurgu paketini oluştur ve doğrula", "AI-calling step", prepStepIdx);
const prepStep = workflow.slice(prepStepIdx, aiStepIdx);

assert.ok(
  prepStep.includes("node .github/scripts/build_editing_package_prompt.mjs"),
  "system prompt must still come from the unchanged build_editing_package_prompt.mjs builder"
);
assert.ok(
  prepStep.includes("> /tmp/editing-package-prompt.txt"),
  "request-prep step must write the plain-text user prompt file for the router"
);
assert.ok(!prepStep.includes("system: $system"), "request-prep step must no longer build a JSON envelope with an embedded system field");
assert.ok(!prepStep.includes("> /tmp/request.json"), "old full Anthropic request.json build must be gone");
for (const userContentFragment of [
  '"Aşağıdaki kaynaklardan uygulanabilir kurgu paketi hazırla.\\n"',
  '"TESLİM KAYDI\\n\\n" + $intake',
  '"\\n\\nÇEKİM PAKETİNDEN GEREKLİ BÖLÜMLER\\n\\n" + $package',
  '"\\n\\nONAYLI NİHAİ SENARYO\\n\\n" + $final',
]) {
  assert.ok(prepStep.includes(userContentFragment), `user-content concatenation changed/lost: ${userContentFragment}`);
}

// 4. AI-calling step is gated on the tightened, test-mode-isolated
// condition (see test_editing_package_test_mode_isolation.mjs for the
// dedicated mutation coverage of this specific gate).
const aiIfLineEnd = workflow.indexOf("\n", workflow.indexOf("if:", aiStepIdx));
assert.equal(
  workflow.slice(workflow.indexOf("if:", aiStepIdx), aiIfLineEnd).trim(),
  "if: env.SKIP_EDITING != 'true' && env.TEST_MODE != 'true'",
  "AI-calling step must be gated on exactly env.SKIP_EDITING != 'true' && env.TEST_MODE != 'true'"
);

const nextStepAfterAiIdx = workflow.indexOf("\n      - name:", aiStepIdx + 1);
const aiStep = workflow.slice(aiStepIdx, nextStepAfterAiIdx >= 0 ? nextStepAfterAiIdx : workflow.length);

for (const removed of [
  "https://api.anthropic.com/v1/messages",
  "curl --fail-with-body",
  '-H "x-api-key: $ANTHROPIC_API_KEY"',
  "--data-binary @/tmp/request.json",
  'if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then',
]) {
  assert.ok(!aiStep.includes(removed), `old direct Anthropic call/guard leftover found: ${removed}`);
}

// 5. Router invoked with the exact flags needed to preserve the real
// system/user split and the pre-existing hardcoded model/token budget.
assert.match(aiStep, /python3 \.github\/scripts\/ai_router\.py \\/, "must call the shared router script");
for (const requiredFlag of [
  "--config .github/config/ai-router.json",
  "--system-file /tmp/system-prompt.txt",
  "--prompt-file /tmp/editing-package-prompt.txt",
  "--output-file /tmp/editing-package.md",
  "--meta-file /tmp/editing-package-meta.json",
  "--max-tokens 5000",
  "--primary-model claude-sonnet-4-6",
]) {
  assert.ok(aiStep.includes(requiredFlag), `router call missing required flag: ${requiredFlag}`);
}

// 6. Usage read from the router's meta-file, and the workflow's original
// strict end_turn check is explicitly preserved after the router call.
for (const metaRead of [
  "EDITING_AI_PROVIDER=$(jq -r '.provider // \"\"' /tmp/editing-package-meta.json)",
  "EDITING_AI_MODEL=$(jq -r '.model // \"\"' /tmp/editing-package-meta.json)",
  "STOP_REASON=$(jq -r '.stop_reason // empty' /tmp/editing-package-meta.json)",
  "INPUT_TOKENS=$(jq -r '.total_input_tokens // .input_tokens // 0' /tmp/editing-package-meta.json)",
  "OUTPUT_TOKENS=$(jq -r '.total_output_tokens // .output_tokens // 0' /tmp/editing-package-meta.json)",
]) {
  assert.ok(aiStep.includes(metaRead), `meta-file usage read missing: ${metaRead}`);
}

const providerGuardIdx = mustFind(
  aiStep,
  'if [[ -z "$EDITING_AI_PROVIDER" || -z "$EDITING_AI_MODEL" || ! -s /tmp/editing-package.md ]]; then',
  "provider/model/output guard"
);
const providerGuardEnd = mustFind(aiStep, "\n          fi", "provider/model/output guard end", providerGuardIdx);
assert.match(aiStep.slice(providerGuardIdx, providerGuardEnd), /exit 1/, "provider/model/output guard must fail closed");

const endTurnGuardIdx = mustFind(aiStep, 'if [[ "$STOP_REASON" != "end_turn" ]]; then', "strict end_turn guard", providerGuardEnd);
const endTurnGuardEnd = mustFind(aiStep, "\n          fi", "strict end_turn guard end", endTurnGuardIdx);
assert.match(aiStep.slice(endTurnGuardIdx, endTurnGuardEnd), /exit 1/, "strict end_turn guard must fail closed");
assert.ok(endTurnGuardIdx > providerGuardIdx, "end_turn strictness check must run after the router call, on its real result");

// 7. Pre-existing structural checks on the generated package (7 required
// section headings, exact section count, ham-video disclaimer, no false
// "I watched the video" claim, no false approval-pending claim, char
// limit) are all still enforced on /tmp/editing-package.md (now the
// router's own --output-file) -- since a later test-mode isolation fix
// extracted them into a shared script (validate_editing_package_output.sh,
// also used by the TEST_MODE fixture path so both are checked by the
// identical contract), the workflow itself now calls that script rather
// than inlining the checks; the checks themselves must still exist there.
const validatorScript = read(".github/scripts/validate_editing_package_output.sh");
assert.ok(
  aiStep.includes("bash .github/scripts/validate_editing_package_output.sh /tmp/editing-package.md"),
  "real AI step must call the shared output-contract validator"
);
for (const structuralCheck of [
  "REQUIRED_PATTERNS=(",
  "SECTION_COUNT=$(grep -Ec '^##[[:space:]]+[1-7]\\.' \"$TARGET_FILE\")",
  "Ham videonun görülmediği zorunlu uyarı eksik.",
  "Ajan ham videoyu izlemiş gibi yanlış iddia üretti.",
  "Ajan, onaylı kaynak için yanlış onay durumu üretti.",
  "OUTPUT_CHARS=$(wc -c < \"$TARGET_FILE\")",
]) {
  assert.ok(validatorScript.includes(structuralCheck), `pre-existing structural check lost from the shared validator: ${structuralCheck}`);
}

// 8. GITHUB_ENV carries the actual provider/model forward to the later
// content-prep/comment steps.
assert.ok(aiStep.includes('echo "EDITING_AI_PROVIDER=$EDITING_AI_PROVIDER"'), "EDITING_AI_PROVIDER must be exported to GITHUB_ENV");
assert.ok(aiStep.includes('echo "EDITING_AI_MODEL=$EDITING_AI_MODEL"'), "EDITING_AI_MODEL must be exported to GITHUB_ENV");

// 9. Usage marker keeps its original fields and now also reports the real
// provider/model.
mustFind(
  workflow,
  '<!-- EDITING_AI_USAGE_V1 test=$TEST_MODE provider=$EDITING_AI_PROVIDER model=$EDITING_AI_MODEL intake_chars=$INTAKE_CHARS package_chars=$PACKAGE_CHARS final_chars=$FINAL_CHARS input=$EDITING_INPUT_TOKENS output=$EDITING_OUTPUT_TOKENS web_search=0 output_chars=$EDITING_OUTPUT_CHARS -->',
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

console.log("editing_package_router_migration_ok ai_calls=0 api_calls=0 issue_writes=0 dispatches=0 video_calls=0");

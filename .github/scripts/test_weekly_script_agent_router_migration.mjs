#!/usr/bin/env node
/**
 * Section 5 — weekly-script-agent.yml migrated from a direct
 * `curl https://api.anthropic.com/v1/messages` call to the shared AI Router
 * (ai_router.py / ai-router.json). Zero-network, zero-token static
 * source-text check — never calls any AI/provider API.
 *
 * Preserved across the migration: the exact prompt+idea-list content sent
 * as the single user-role message (no system prompt existed before, none is
 * invented now), the business-profile-driven max token budget/model, the
 * usage marker (now reporting the ACTUAL provider/model used, not just the
 * requested primary model), the pre-existing QC-evidence/structural
 * validation Python block, the TEST_MODE fail-closed gate, and — since
 * ai_router.py's usable() accepts a broader set of stop reasons than this
 * workflow's own exact `stop_reason == "end_turn"` check — an explicit
 * post-router strict end_turn re-check.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");

const workflow = read(".github/workflows/weekly-script-agent.yml");

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

// 3. AI-calling step stays gated exactly by TEST_MODE, and no longer
// contains the old direct Anthropic call.
const aiStepIdx = mustFind(workflow, "- name: Claude ile tek çağrıda 3 senaryo üret", "AI-calling step", validateIdx);
const aiIfLineEnd = workflow.indexOf("\n", workflow.indexOf("if:", aiStepIdx));
assert.equal(
  workflow.slice(workflow.indexOf("if:", aiStepIdx), aiIfLineEnd).trim(),
  "if: ${{ env.TEST_MODE != 'true' }}",
  "AI-calling step must stay gated exactly by TEST_MODE (test_mode => 0 provider calls)"
);

const nextStepAfterAiIdx = workflow.indexOf("\n      - name:", aiStepIdx + 1);
const aiStep = workflow.slice(aiStepIdx, nextStepAfterAiIdx >= 0 ? nextStepAfterAiIdx : workflow.length);
const aiStepExecutable = aiStep
  .split("\n")
  .filter((line) => !line.trim().startsWith("#"))
  .join("\n");

for (const removed of [
  "https://api.anthropic.com/v1/messages",
  "curl --fail-with-body",
  '-H "x-api-key: $ANTHROPIC_API_KEY"',
]) {
  assert.ok(!aiStep.includes(removed), `old direct Anthropic call leftover found: ${removed}`);
}

// 4. Router invoked with the exact flags needed to preserve prompt content
// and business-profile-driven token budget/model.
assert.match(aiStep, /python3 \.github\/scripts\/ai_router\.py \\/, "must call the shared router script");
for (const requiredFlag of [
  "--config .github/config/ai-router.json",
  "--prompt-file /tmp/weekly-script-prompt.txt",
  "--output-file /tmp/scripts-raw.txt",
  "--meta-file /tmp/weekly-script-meta.json",
  '--max-tokens "$SCRIPT_MAX_MODEL_OUTPUT"',
  '--primary-model "$DEFAULT_MODEL"',
]) {
  assert.ok(aiStep.includes(requiredFlag), `router call missing required flag: ${requiredFlag}`);
}
assert.ok(
  !/--system-file\s+\S/.test(aiStepExecutable),
  "original call had no separate system prompt (single user-role message) — migration must not invent one"
);

// 5. The exact prompt content (rules, format, idea-list concatenation) must
// be unchanged — only the transport was swapped.
for (const promptFragment of [
  "Sen $BRAND_NAME için çalışan profesyonel video senaryo yazarısın.",
  "Sırayı değiştirme: Senaryo 1 = Fikir 1, Senaryo 2 = Fikir 2, Senaryo 3 = Fikir 3.",
  "## Senaryo 1: Başlık",
  'printf \'%s\\n\\nİLK ÜÇ İÇERİK FİKRİ:\\n\\n%s\' "$PROMPT" "$IDEAS" > /tmp/weekly-script-prompt.txt',
]) {
  assert.ok(aiStep.includes(promptFragment), `prompt content/shape changed or lost: ${promptFragment}`);
}

// 6. Usage read from the router's meta-file, and the workflow's original
// strict end_turn check is explicitly preserved after the router call.
for (const metaRead of [
  "SCRIPT_AI_PROVIDER=$(jq -r '.provider // \"\"' /tmp/weekly-script-meta.json)",
  "SCRIPT_AI_MODEL=$(jq -r '.model // \"\"' /tmp/weekly-script-meta.json)",
  "STOP_REASON=$(jq -r '.stop_reason // empty' /tmp/weekly-script-meta.json)",
  "INPUT_TOKENS=$(jq -r '.total_input_tokens // .input_tokens // 0' /tmp/weekly-script-meta.json)",
  "OUTPUT_TOKENS=$(jq -r '.total_output_tokens // .output_tokens // 0' /tmp/weekly-script-meta.json)",
]) {
  assert.ok(aiStep.includes(metaRead), `meta-file usage read missing: ${metaRead}`);
}

const providerGuardIdx = mustFind(
  aiStep,
  'if [ -z "$SCRIPT_AI_PROVIDER" ] || [ -z "$SCRIPT_AI_MODEL" ] || [ ! -s /tmp/scripts-raw.txt ]; then',
  "provider/model/output guard"
);
const providerGuardEnd = mustFind(aiStep, "\n          fi", "provider/model/output guard end", providerGuardIdx);
assert.match(aiStep.slice(providerGuardIdx, providerGuardEnd), /exit 1/, "provider/model/output guard must fail closed");

const endTurnGuardIdx = mustFind(aiStep, 'if [ "$STOP_REASON" != "end_turn" ]; then', "strict end_turn guard", providerGuardEnd);
const endTurnGuardEnd = mustFind(aiStep, "\n          fi", "strict end_turn guard end", endTurnGuardIdx);
assert.match(aiStep.slice(endTurnGuardIdx, endTurnGuardEnd), /exit 1/, "strict end_turn guard must fail closed");
assert.ok(endTurnGuardIdx > providerGuardIdx, "end_turn strictness check must run after the router call, on its real result");

// 7. GITHUB_ENV now also carries the actual provider/model forward to the
// later Issue-creation step.
assert.ok(aiStep.includes('echo "SCRIPT_AI_PROVIDER=$SCRIPT_AI_PROVIDER"'), "SCRIPT_AI_PROVIDER must be exported to GITHUB_ENV");
assert.ok(aiStep.includes('echo "SCRIPT_AI_MODEL=$SCRIPT_AI_MODEL"'), "SCRIPT_AI_MODEL must be exported to GITHUB_ENV");

// 8. Pre-existing QC-evidence / structural validation block untouched.
for (const qualityCheck of [
  'raise SystemExit(f"{scenario_count} senaryo başlığı eksik, tekrarlı veya sırasız.")',
  'raise SystemExit("Model çıktısı ayrılmış QC kanıt işaretini içeriyor.")',
  'raise SystemExit(f"Senaryo {scenario_number} için QC kanıtı eksik.")',
]) {
  assert.ok(workflow.includes(qualityCheck), `pre-existing quality check lost: ${qualityCheck}`);
}

// 9. Usage marker keeps its original fields and now reports the real
// provider/model instead of the always-static $DEFAULT_MODEL.
mustFind(
  workflow,
  '<!-- AGENT_USAGE_V1 agent=weekly-script provider=$SCRIPT_AI_PROVIDER model=$SCRIPT_AI_MODEL input=$SCRIPT_AI_INPUT output=$SCRIPT_AI_OUTPUT web_search=0 idea_chars=$SCRIPT_IDEA_CHARS source_issue=$SOURCE_ISSUE_NUMBER profile_sha=$PROFILE_FILE_SHA -->',
  "usage marker with real provider/model"
);

// 10. No forbidden capability in the new validate step or the AI-calling
// step.
const stepAfterValidateIdx = workflow.indexOf("\n      - name:", validateIdx + 1);
const validateStep = workflow.slice(validateIdx, stepAfterValidateIdx >= 0 ? stepAfterValidateIdx : workflow.length);
for (const block of [validateStep, aiStep]) {
  for (const forbidden of ["gh api", "/dispatches", "repository_dispatch", "youtube.googleapis.com", "curl "]) {
    assert.ok(!block.includes(forbidden), `forbidden capability found: ${forbidden}`);
  }
}

console.log("weekly_script_agent_router_migration_ok ai_calls=0 api_calls=0 issue_writes=0 dispatches=0 video_calls=0");

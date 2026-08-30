#!/usr/bin/env node
/**
 * Section 5 — weekly-content-research.yml migrated from a direct
 * `curl https://api.anthropic.com/v1/messages` call to the shared AI Router
 * (ai_router.py / ai-router.json), following the same pattern already used
 * by filming-package-agent-v4-router.yml. This is a zero-network,
 * zero-token static source-text check: it never calls any AI/provider API,
 * it only asserts the workflow's own source text has the right shape.
 *
 * What must be preserved across the migration (per the task's own
 * requirement list): the exact prompt content, the "no separate system
 * prompt" shape (single user-role message), the business-profile-driven
 * max token budget and model, the usage marker, the existing structural
 * quality checks, the TEST_MODE fail-closed gate, and — because
 * ai_router.py's own usable() accepts a broader set of stop reasons than
 * this workflow's original exact `stop_reason == "end_turn"` check — an
 * explicit post-router strict end_turn check so the migration does not
 * silently loosen acceptance behaviour.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");

const workflow = read(".github/workflows/weekly-content-research.yml");

const mustFind = (text, needle, message = needle, fromIndex = 0) => {
  const index = text.indexOf(needle, fromIndex);
  assert.ok(index >= 0, `missing executable contract: ${message}`);
  return index;
};

// 1. env block carries all 4 providers' secrets/models, mirroring the
// already-migrated filming-package-agent-v4-router.yml pattern — without
// this, migrating the AI call alone would give zero real fallback
// resilience (every non-Anthropic provider would be silently skipped as
// missing_api_key).
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

// 2. A local, zero-network router/config sanity step exists before any
// other step that could depend on it.
const validateIdx = mustFind(workflow, "- name: Router ve yapılandırmayı yerel doğrula", "router validate step");
assert.match(
  workflow.slice(validateIdx, validateIdx + 400),
  /python3 -m py_compile \.github\/scripts\/ai_router\.py/,
  "router validate step must py_compile ai_router.py"
);

// 3. The AI-calling step must be gated exactly as before (test_mode never
// invokes any provider at all — the whole step, router included, is
// skipped), and must no longer contain the old direct Anthropic call.
const aiStepIdx = mustFind(workflow, "- name: Kısa kaynak kodlarıyla tek Claude çağrısı yap", "AI-calling step", validateIdx);
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
  'curl --fail-with-body',
  '-H "x-api-key: $ANTHROPIC_API_KEY"',
]) {
  assert.ok(!aiStep.includes(removed), `old direct Anthropic call leftover found: ${removed}`);
}

// 4. The router is invoked with the exact flags needed to preserve prompt
// content, "no system prompt" shape, and business-profile-driven token
// budget/model.
assert.match(aiStep, /python3 \.github\/scripts\/ai_router\.py \\/, "must call the shared router script");
for (const requiredFlag of [
  "--config .github/config/ai-router.json",
  "--prompt-file /tmp/weekly-research-prompt.txt",
  "--output-file /tmp/weekly-report-raw.md",
  "--meta-file /tmp/weekly-research-meta.json",
  '--max-tokens "$MAX_OUTPUT_TOKENS"',
  '--primary-model "$DEFAULT_MODEL"',
]) {
  assert.ok(aiStep.includes(requiredFlag), `router call missing required flag: ${requiredFlag}`);
}
const aiStepExecutable = aiStep
  .split("\n")
  .filter((line) => !line.trim().startsWith("#"))
  .join("\n");
assert.ok(
  !/--system-file\s+\S/.test(aiStepExecutable),
  "original call had no separate system prompt (single user-role message) — migration must not invent one"
);

// 5. The prompt itself (the whole heredoc body) must be unchanged — the
// migration must only swap the transport, never the content sent to the
// model.
for (const promptFragment of [
  "içerik raporu hazırla. Web araması yapma; yalnızca verilen kayıtlara dayan.",
  "Kaynaklar gerçek URL yerine [S01], [S02] biçiminde kısa kimliklerle gösterilir.",
  "Tam $IDEA_COUNT somut fikir üret; en güçlü 3 fikri ilk sıraya koy.",
  "Rapor $REPORT_MAX_WORDS kelimeyi geçmesin",
  "KODLA TOPLANAN VERİLER:",
]) {
  assert.ok(aiStep.includes(promptFragment), `prompt content changed/lost: ${promptFragment}`);
}

// 6. Usage fields are read from the router's own meta-file (not a raw HTTP
// response body anymore), and the workflow's original strict end_turn
// check is preserved EXPLICITLY after the router call — ai_router.py's own
// usable() accepts a broader set of stop reasons, so without this
// re-assertion the migration would silently loosen acceptance behaviour.
for (const metaRead of [
  "PROVIDER=$(jq -r '.provider // \"\"' /tmp/weekly-research-meta.json)",
  "MODEL=$(jq -r '.model // \"\"' /tmp/weekly-research-meta.json)",
  "STOP_REASON=$(jq -r '.stop_reason // empty' /tmp/weekly-research-meta.json)",
  "INPUT_TOKENS=$(jq -r '.total_input_tokens // .input_tokens // 0' /tmp/weekly-research-meta.json)",
  "OUTPUT_TOKENS=$(jq -r '.total_output_tokens // .output_tokens // 0' /tmp/weekly-research-meta.json)",
]) {
  assert.ok(aiStep.includes(metaRead), `meta-file usage read missing: ${metaRead}`);
}

const providerGuardIdx = mustFind(
  aiStep,
  'if [ -z "$PROVIDER" ] || [ -z "$MODEL" ] || [ ! -s /tmp/weekly-report-raw.md ]; then',
  "provider/model/output guard"
);
const providerGuardEnd = mustFind(aiStep, "\n          fi", "provider/model/output guard end", providerGuardIdx);
assert.match(aiStep.slice(providerGuardIdx, providerGuardEnd), /exit 1/, "provider/model/output guard must fail closed");

const endTurnGuardIdx = mustFind(aiStep, 'if [ "$STOP_REASON" != "end_turn" ]; then', "strict end_turn guard", providerGuardEnd);
const endTurnGuardEnd = mustFind(aiStep, "\n          fi", "strict end_turn guard end", endTurnGuardIdx);
assert.match(aiStep.slice(endTurnGuardIdx, endTurnGuardEnd), /exit 1/, "strict end_turn guard must fail closed");
assert.ok(endTurnGuardIdx > providerGuardIdx, "end_turn strictness check must run after the router call, on its real result");

// 7. The pre-existing structural quality checks (required sections, exactly
// 5 numbered+ordered ideas, known source-id citations, no raw URLs) must be
// completely untouched by the migration.
for (const qualityCheck of [
  'raise SystemExit(f"Eksik rapor bölümleri: {missing}")',
  'raise SystemExit("Rapor tam ve sıralı 5 fikir içermiyor.")',
  'raise SystemExit(f"Bilinmeyen kaynak kimlikleri: {sorted(unknown_ids)}")',
  'raise SystemExit("Claude ham URL üretti; rapor yayımlanmadı.")',
]) {
  assert.ok(workflow.includes(qualityCheck), `pre-existing quality check lost: ${qualityCheck}`);
}

// 8. The usage marker keeps its original fields (agent/input/output/
// web_search/source_chars/source_count/profile_sha) and now also reports
// the ACTUAL provider/model used (which may differ from the requested
// primary model after a fallback) instead of the always-static
// $DEFAULT_MODEL, so the marker never claims a provider/model that did not
// really answer.
mustFind(
  workflow,
  '<!-- AGENT_USAGE_V1 agent=weekly-research provider=$PROVIDER model=$MODEL input=$INPUT_TOKENS output=$OUTPUT_TOKENS web_search=0 source_chars=$SOURCE_SIZE source_count=$SOURCE_COUNT profile_sha=$PROFILE_FILE_SHA -->',
  "usage marker with real provider/model"
);

// 9. No forbidden capability anywhere in the AI-calling step or the new
// validate step: no repo-dispatch, no YouTube/video calls, no raw curl to
// any provider (the router owns all outbound HTTP now).
for (const block of [workflow.slice(validateIdx, mustFind(workflow, "\n      - name:", "step after validate", validateIdx + 1)), aiStep]) {
  for (const forbidden of ["gh api", "/dispatches", "repository_dispatch", "youtube.googleapis.com", "curl "]) {
    assert.ok(!block.includes(forbidden), `forbidden capability found: ${forbidden}`);
  }
}

console.log("weekly_content_research_router_migration_ok ai_calls=0 api_calls=0 issue_writes=0 dispatches=0 video_calls=0");

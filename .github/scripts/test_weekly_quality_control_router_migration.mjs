#!/usr/bin/env node
/**
 * weekly-quality-control.yml migrated from a direct
 * `curl https://api.anthropic.com/v1/messages` call (with an inline
 * Anthropic-only `web_search_20260209` tools: payload) to the shared AI
 * Router (ai_router.py / ai-router.json), which now carries native
 * web-search support of its own. Zero-network, zero-token static
 * source-text check — never calls any AI/provider/web-search API.
 *
 * Preserved across the migration: the exact system-prompt text (domain
 * rules, evidence-chain rules, classification rules, required headings),
 * the exact user-prompt content (unchanged QC_KANIT_V1 extraction +
 * provided-sources.json + profile-context Python block), the
 * business-profile-driven token/web-search budget, the strict end_turn
 * re-check (ai_router.py's own usable() is looser), the KISMI->BELİRSİZ
 * normalization + heading/decision validation Python block, the
 * provided+web sources merge, final-report.md construction, the
 * QC_AI_USAGE_V1 usage marker, the TEST_MODE fail-closed gate (still
 * exactly 3 occurrences, matching test_quality_control_portability.mjs),
 * and the separate Issue-publish step.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");

const workflow = read(".github/workflows/weekly-quality-control.yml");
const routerSource = read(".github/scripts/ai_router.py");
const routerConfig = JSON.parse(read(".github/config/ai-router.json"));

const mustFind = (text, needle, message = needle, fromIndex = 0) => {
  const index = text.indexOf(needle, fromIndex);
  assert.ok(index >= 0, `missing executable contract: ${message}`);
  return index;
};

// 1. env block carries all 4 providers' secrets/models (fallback resilience
// is available whenever web search isn't the one thing being requested).
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

// 3. AI-calling step stays gated exactly by TEST_MODE, item (g): the old
// direct api.anthropic.com curl call is fully gone.
const aiStepIdx = mustFind(workflow, "- name: Araştırma kanıtlı tek geçişli Claude kalite kontrolü yap", "AI-calling step", validateIdx);
const aiIfLineEnd = workflow.indexOf("\n", workflow.indexOf("if:", aiStepIdx));
assert.equal(
  workflow.slice(workflow.indexOf("if:", aiStepIdx), aiIfLineEnd).trim(),
  "if: ${{ env.TEST_MODE != 'true' }}",
  "AI-calling step must stay gated exactly by TEST_MODE (test_mode => 0 provider/web-search calls)"
);

const nextStepAfterAiIdx = workflow.indexOf("\n      - name:", aiStepIdx + 1);
const aiStep = workflow.slice(aiStepIdx, nextStepAfterAiIdx >= 0 ? nextStepAfterAiIdx : workflow.length);

for (const removed of [
  "https://api.anthropic.com",
  "api.anthropic.com/v1/messages",
  "x-api-key: $ANTHROPIC_API_KEY",
  "curl --silent",
  'type: "web_search_20260209"',
]) {
  assert.ok(!workflow.includes(removed), `old direct Anthropic call/payload leftover found: ${removed}`);
}
assert.ok(!workflow.toLowerCase().includes("curl "), "no direct curl call may remain anywhere in the workflow");

// 4. Router invoked with the exact flags needed to preserve the
// business-profile-driven token budget/model AND the new web-search budget
// (item h: QC_MAX_WEB_SEARCHES correctly threaded to the router).
assert.match(aiStep, /python3 \.github\/scripts\/ai_router\.py \\/, "must call the shared router script");
for (const requiredFlag of [
  "--config .github/config/ai-router.json",
  "--prompt-file qc-prompt.txt",
  "--system-file system-prompt.txt",
  "--output-file raw-report.md",
  "--meta-file router-meta.json",
  '--max-tokens "$QC_MAX_MODEL_OUTPUT"',
  '--primary-model "$DEFAULT_MODEL"',
  '--web-search-max-uses "$QC_MAX_WEB_SEARCHES"',
  "--web-sources-file web-sources.json",
]) {
  assert.ok(aiStep.includes(requiredFlag), `router call missing required flag: ${requiredFlag}`);
}

// 5. QC_KANIT_V1 evidence-chain extraction and provided-sources.json
// construction: byte-identical Python block, untouched by the migration.
for (const evidenceCheck of [
  'r"<!--\\s*QC_KANIT_V1\\s*\\n(.*?)\\n-->"',
  'raise SystemExit(\n                  "Üç senaryoya ait QC_KANIT_V1 paketi bulunamadı; ücretli AI çağrısı yapılmayacak."',
  'raise SystemExit("QC kanıt paketleri eksik, tekrarlı veya sırasız.")',
  'Path("provided-sources.json").write_text(',
]) {
  assert.ok(workflow.includes(evidenceCheck), `QC_KANIT_V1 evidence-chain logic lost: ${evidenceCheck}`);
}

// 6. Script-character preflight limit preserved, still gates BEFORE any
// router/provider call.
const scriptCharsGuardIdx = mustFind(aiStep, 'if [ "$SCRIPT_CHARS" -gt "$QC_MAX_SCRIPT_CHARS" ]; then', "script-char limit guard");
const routerCallIdx = mustFind(aiStep, "python3 .github/scripts/ai_router.py \\", "router call", scriptCharsGuardIdx);
assert.ok(routerCallIdx > scriptCharsGuardIdx, "script-char limit must be checked BEFORE the router call, not after");

// 7. The exact system-prompt content (domain-rule binding, evidence rules,
// classification rules, required headings, report-end rules) is preserved
// verbatim -- only the transport (curl+jq payload -> router --system-file)
// changed. Cross-checked byte-for-byte against the pre-migration jq string
// concatenation during implementation; here we assert presence of the
// distinguishing fragments from each paragraph.
for (const promptFragment of [
  "için bağımsız ve kuşkucu bir kalite kontrol editörüsün.",
  "AMAÇ: Üç video senaryosunun yayın kararını etkileyen gerçek bilgi iddialarını doğrula;",
  "TAŞINAN KANIT: Her senaryonun sonundaki QC_KANIT_V1 paketi",
  "KAYNAK KURALI: Önce taşınan araştırma kanıtını kullan.",
  "mevcut web arama bütçesi dahilinde arama yapılabilir.",
  "resmi ve birincil kaynaklar, kamu kurumları, akademik veya mesleki kurumlar ve güvenilir uzman ya da meslek kuruluşlarıdır",
  "Kaynaklar çelişirse BELİRSİZ yaz. Kaynak uydurma.",
  "ALAN KURALLARI: Merkezi işletme profilinden gelen sektör doğrulama kurallarını uygula.",
  "$QC_DOMAIN_RULES_TEXT",
  "SINIFLANDIRMA: Sonuç yalnızca DOĞRU, YANLIŞ, YANILTICI, BELİRSİZ veya GÖRÜŞ olabilir.",
  "ZORUNLU BİÇİM: Her senaryo için sırasıyla # SENARYO 1/2/3,",
  "RAPOR SONU: Üç senaryodan sonra # GENEL TUTARLILIK KONTROLÜ",
  "GENEL KARAR: ✅ YAYINA HAZIR veya GENEL KARAR: ⚠️ DÜZELTME GEREKİYOR yaz;",
  "$QC_TARGET_REPORT_OUTPUT_TOKENS çıktı tokenının altında hedefle",
]) {
  assert.ok(aiStep.includes(promptFragment), `system-prompt content changed or lost: ${promptFragment}`);
}
mustFind(
  aiStep,
  "Aşağıdaki üç video senaryosunu tek geçişte denetle ve nihai kalite kontrol raporunu hazırla.",
  "user-prompt prefix text"
);

// 8. Usage read from the router's meta-file, and the workflow's original
// strict end_turn check is explicitly preserved after the router call
// (ai_router.py's own usable() is more lenient about stop_reason).
for (const metaRead of [
  "QC_AI_PROVIDER=$(jq -r '.provider // \"\"' router-meta.json)",
  "QC_AI_MODEL=$(jq -r '.model // \"\"' router-meta.json)",
  "STOP_REASON=$(jq -r '.stop_reason // empty' router-meta.json)",
  "INPUT_TOKENS=$(jq -r '.total_input_tokens // .input_tokens // 0' router-meta.json)",
  "OUTPUT_TOKENS=$(jq -r '.total_output_tokens // .output_tokens // 0' router-meta.json)",
  "WEB_SEARCHES=$(jq -r '.web_searches // 0' router-meta.json)",
]) {
  assert.ok(aiStep.includes(metaRead), `meta-file usage read missing: ${metaRead}`);
}

const providerGuardIdx = mustFind(
  aiStep,
  'if [ -z "$QC_AI_PROVIDER" ] || [ -z "$QC_AI_MODEL" ] || [ ! -s raw-report.md ]; then',
  "provider/model/report guard"
);
const providerGuardEnd = mustFind(aiStep, "\n          fi", "provider/model/report guard end", providerGuardIdx);
assert.match(aiStep.slice(providerGuardIdx, providerGuardEnd), /exit 1/, "provider/model/report guard must fail closed");

const endTurnGuardIdx = mustFind(aiStep, 'if [ "$STOP_REASON" != "end_turn" ]; then', "strict end_turn guard", providerGuardEnd);
const endTurnGuardEnd = mustFind(aiStep, "\n          fi", "strict end_turn guard end", endTurnGuardIdx);
assert.match(aiStep.slice(endTurnGuardIdx, endTurnGuardEnd), /exit 1/, "strict end_turn guard must fail closed");
assert.ok(endTurnGuardIdx > providerGuardIdx, "end_turn strictness check must run after the router call, on its real result");

// 9. Cost guard preflight (before spending any real provider token) and
// postflight (after the router call, before any downstream write) —
// item 10: same safe cost pattern already used by other router-migrated
// workflows, applied here rather than invented anew.
const preflightIdx = mustFind(aiStep, "Cost guard preflight: config gecerli.", "cost guard preflight check");
assert.ok(preflightIdx < routerCallIdx, "cost guard preflight must run before the router call");
const postflightIdx = mustFind(
  aiStep,
  "python3 .github/scripts/cost_guard.py \\\n            --meta-file router-meta.json \\\n            --config .github/config/cost-guard.json",
  "cost guard postflight call"
);
assert.ok(postflightIdx > endTurnGuardIdx, "cost guard postflight must run after the router call and the strict end_turn re-check");

// 10. Decision/heading validation Python block preserved byte-for-byte
// (KISMI->BELİRSİZ normalization, decision extraction, 3x required
// headings, 3x "# SENARYO" check).
for (const qualityCheck of [
  'r"(?:KISMI(?:\\s+DOĞRU)?|KISMEN\\s+DOĞRU)"',
  'raise SystemExit("Raporun genel karar satırı eksik veya geçersiz.")',
  'raise SystemExit("Rapor üç zorunlu senaryo başlığını içermiyor.")',
  '"## 1. İDDİA VE KANIT TABLOSU"',
  '"## 2. GERÇEK BİLGİ HATALARI"',
  '"## 3. HASSASİYET ÖNERİLERİ"',
  '"## 4. İÇERİK KALİTESİ"',
  '"## 5. SENARYO KARARI"',
  'raise SystemExit(f"Zorunlu başlık eksik veya tekrarlı: {heading}")',
]) {
  assert.ok(workflow.includes(qualityCheck), `decision/heading validation logic lost: ${qualityCheck}`);
}

// 11. provided-sources.json + router-produced web-sources.json merge
// preserved (item 9: the router's own web-sources file is used exactly
// like the pre-migration jq-derived one was).
mustFind(
  aiStep,
  "jq -s 'add | unique_by(.url)' \\\n            provided-sources.json web-sources.json > sources.json",
  "provided+web sources merge"
);
mustFind(aiStep, 'if [ "$SOURCE_COUNT" -lt 1 ]; then', "at-least-one-source guard");

// 12. final-report.md + QC_AI_USAGE_V1 usage marker preserved, now
// reporting the real provider/model actually used (same improvement
// already applied to the other router-migrated workflows).
mustFind(aiStep, "cp report-body.md final-report.md", "final-report.md assembly");
mustFind(
  aiStep,
  "<!-- QC_AI_USAGE_V1 provider=$QC_AI_PROVIDER model=$QC_AI_MODEL script_chars=$SCRIPT_CHARS provided_sources=$PROVIDED_SOURCE_COUNT input=$INPUT_TOKENS output=$OUTPUT_TOKENS web_search=$WEB_SEARCHES web_sources=$WEB_SOURCE_COUNT profile_sha=$PROFILE_FILE_SHA -->",
  "usage marker with real provider/model"
);

// 13. Issue-publish step untouched by the migration.
mustFind(workflow, "- name: Kalite kontrol raporunu issue olarak yayımla", "issue-publish step");

// 14. No forbidden capability in the new validate step or the AI-calling
// step (dispatch/YouTube capability must never appear here).
const stepAfterValidateIdx = workflow.indexOf("\n      - name:", validateIdx + 1);
const validateStep = workflow.slice(validateIdx, stepAfterValidateIdx >= 0 ? stepAfterValidateIdx : workflow.length);
for (const block of [validateStep, aiStep]) {
  for (const forbidden of ["gh api", "/dispatches", "repository_dispatch", "youtube.googleapis.com"]) {
    assert.ok(!block.includes(forbidden), `forbidden capability found: ${forbidden}`);
  }
}

// 15. TEST_MODE gate count unchanged (still exactly 3: source-fetch,
// AI-calling, issue-publish) — same invariant test_quality_control_
// portability.mjs's own section F already asserts; re-checked here so a
// future accidental extra TEST_MODE-gated step is caught by BOTH files.
assert.equal(
  (workflow.match(/if: \$\{\{ env\.TEST_MODE != 'true' \}\}/gu) ?? []).length,
  3,
  "adding router/cost-guard steps must not add a 4th TEST_MODE-gated step (inline them into the existing gated step instead)"
);

// 16. Router-side capability wiring: anthropic is the only web-search-
// capable provider configured, and the router source actually implements
// the native web_search_20260209 tool (full behavioral proof lives in
// test_ai_router.py / test_router_cost_guard_integration_scenarios.py —
// this is a lightweight cross-file sanity check).
assert.equal(routerConfig.providers.anthropic.supports_web_search, true);
for (const name of ["openai", "deepseek", "qwen"]) {
  assert.ok(
    !routerConfig.providers[name]?.supports_web_search,
    `${name} must not be marked supports_web_search (no such capability implemented for it)`
  );
}
assert.ok(routerSource.includes('"type": "web_search_20260209"'));
assert.ok(routerSource.includes("web_search_unsupported"));

// 17. This test itself performs no real AI/API/web-search/Issue/dispatch/
// video call: everything above is a static read of committed files and
// in-memory string/JSON assertions.

console.log(
  "weekly_quality_control_router_migration_ok ai_calls=0 api_calls=0 web_search=0 issue_writes=0 dispatches=0 video_calls=0"
);

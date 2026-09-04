#!/usr/bin/env node
/** Deterministic zero-token portability checks for Weekly Script Correction. */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const workflow = read(".github/workflows/weekly-script-correction.yml");
const smokeTest = read(".github/workflows/business-profile-smoke-test.yml");
const currentProfile = JSON.parse(read(".github/config/business-profile.json"));
const secondProfile = JSON.parse(read(".github/scripts/fixtures/second-business-profile.json"));
const normalizedWorkflow = workflow.toLocaleLowerCase("tr-TR");
const includesTerm = (text, term) => new RegExp(
  `(?<![\\p{L}\\p{N}_])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`,
  "iu",
).test(text);

const buildCorrectionContext = (profile) => [
  `Marka: ${profile.business.brand_name}`,
  `Faaliyet alanı: ${profile.business.category}`,
  `Hizmetler: ${profile.offer.services.join(", ")}`,
  `Mevcut ekipman: ${profile.offer.available_equipment.join(", ")}`,
  `İçerik konuları: ${profile.content.content_topics.join(", ")}`,
  `Ana CTA: ${profile.offer.primary_cta} — ${profile.offer.reservation_url}`,
  "SEKTÖREL KURALLAR:",
  ...profile.content.correction.domain_rules,
].join("\n");

const productionStep = (name) => {
  const start = workflow.indexOf(`- name: ${name}`);
  assert.notEqual(start, -1, `Workflow adımı bulunamadı: ${name}`);
  const next = workflow.indexOf("\n      - name:", start + 1);
  return workflow.slice(start, next === -1 ? workflow.length : next);
};

for (const hardCoded of ["akor", "tab", "nota", "riff", "bas gitar", "armoni"])
  assert.ok(!includesTerm(normalizedWorkflow, hardCoded), `Workflowta sektör hard-code'u kaldı: ${hardCoded}`);
assert.ok(workflow.includes("gerekiyorsa profile ve kaynak metne uygun somut alan bilgisi bulunsun."));

for (const binding of [
  ".business.brand_name",
  ".business.category",
  ".offer.services",
  ".offer.available_equipment",
  ".offer.reservation_url",
  ".offer.primary_cta",
  ".content.content_topics",
  ".content.correction.domain_rules",
])
  assert.ok(workflow.includes(binding), binding);
assert.ok(workflow.includes("$CORRECTION_DOMAIN_RULES_TEXT"));

const currentRules = currentProfile.content.correction.domain_rules;
const secondRules = secondProfile.content.correction.domain_rules;
for (const musicTerm of ["akor", "nota", "tab", "bas gitar", "armoni"])
  assert.ok(currentRules.some((rule) => rule.toLocaleLowerCase("tr-TR").includes(musicTerm)), musicTerm);
for (const musicTerm of ["akor", "tab", "nota", "riff", "bas gitar", "armoni"])
  assert.ok(!secondRules.some((rule) => rule.toLocaleLowerCase("tr-TR").includes(musicTerm)), musicTerm);

const currentContext = buildCorrectionContext(currentProfile);
const secondContext = buildCorrectionContext(secondProfile);
assert.notEqual(currentContext, secondContext, "Correction bağlamı profile göre değişmeli");
assert.ok(currentContext.includes(currentProfile.business.brand_name));
assert.ok(secondContext.includes(secondProfile.business.brand_name));
assert.ok(currentRules.every((rule) => currentContext.includes(rule)));
assert.ok(secondRules.every((rule) => secondContext.includes(rule)));
for (const musicTerm of ["akor", "tab", "nota", "riff", "bas gitar", "armoni"])
  assert.ok(!secondContext.toLocaleLowerCase("tr-TR").includes(musicTerm), musicTerm);

// Limits remain profile-owned. Production intentionally uses a smaller 2200-token
// ceiling because the router now rewrites only QC-blocked scenarios; the unrelated
// second-business fixture retains its independent 4500 value.
for (const binding of [
  ".content.correction.max_base_chars",
  ".content.correction.max_qc_chars",
  ".content.correction.max_final_check_chars",
  ".content.correction.max_total_input_chars",
  ".content.correction.max_model_output",
])
  assert.ok(workflow.includes(binding), binding);
for (const profile of [currentProfile, secondProfile]) {
  const correction = profile.content.correction;
  assert.equal(correction.max_base_chars, 24000);
  assert.equal(correction.max_qc_chars, 18000);
  assert.equal(correction.max_final_check_chars, 12000);
  assert.equal(correction.max_total_input_chars, 48000);
  assert.ok(Number.isInteger(correction.max_model_output) && correction.max_model_output > 0);
}
assert.equal(currentProfile.content.correction.max_model_output, 2200);
assert.equal(secondProfile.content.correction.max_model_output, 4500);
assert.ok(workflow.includes('--max-tokens "$CORRECTION_MAX_MODEL_OUTPUT"'));

for (const stepName of [
  "Kaynak senaryoları ve kalite raporunu bul",
  "Kaynakları deterministik olarak küçült ve doğrula",
  "Düzeltme isteğini hazırla",
  "AI Router ile senaryoları tek çağrıda düzelt",
  "Nihai senaryoları Issue olarak yayınla",
])
  assert.ok(productionStep(stepName).includes("if: ${{ env.TEST_MODE != 'true' }}"), stepName);
assert.ok(productionStep("Düzeltme ajanı profil bağlantısını sıfır-token ile test et").includes(
  "if: ${{ env.TEST_MODE == 'true' }}",
));

assert.ok(!workflow.includes("repository_dispatch:"));
assert.ok(!workflow.includes("workflow_run:"));
assert.ok(workflow.includes("ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}"));
for (const profile of [currentProfile, secondProfile]) {
  const serialized = JSON.stringify(profile).toLocaleLowerCase("tr-TR");
  for (const secretKey of ["anthropic_api_key", "github_token", "api_key", "secret_key"])
    assert.ok(!serialized.includes(secretKey), `Secret profile taşınmış: ${secretKey}`);
}

assert.ok(smokeTest.includes(".github/scripts/test_script_correction_portability.mjs"));
assert.ok(smokeTest.includes(".github/workflows/weekly-script-correction.yml"));
assert.ok(smokeTest.includes("node .github/scripts/test_script_correction_portability.mjs"));

console.log("script_correction_portability_ok ai_calls=0 api_calls=0 web_search=0 issue_writes=0 dispatches=0 video_calls=0 publications=0");

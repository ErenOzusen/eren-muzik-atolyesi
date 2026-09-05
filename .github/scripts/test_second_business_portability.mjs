#!/usr/bin/env node
/**
 * Zero-token, zero-network portability proof for a SECOND test business
 * (Nova Coffee — a fictional boutique coffee shop, deliberately unrelated
 * to Eren Müzik Atölyesi's music-education vertical) across the five core
 * pipeline agents.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const AGENT_WORKFLOWS = {
  "weekly-research": ".github/workflows/weekly-content-research.yml",
  "weekly-script": ".github/workflows/weekly-script-agent.yml",
  "quality-control": ".github/workflows/weekly-quality-control.yml",
  "script-correction": ".github/workflows/weekly-script-correction.yml",
  "final-technical-check": ".github/workflows/final-technical-check.yml",
};
const workflows = Object.fromEntries(
  Object.entries(AGENT_WORKFLOWS).map(([agent, relPath]) => [agent, read(relPath)]),
);
const currentProfile = JSON.parse(read(".github/config/business-profile.json"));
const novaProfile = JSON.parse(read(".github/scripts/fixtures/nova-coffee-business-profile.json"));

const EREN_FORBIDDEN_TERMS = [
  "Eren Müzik Atölyesi", "Eren Özüşen", "gitar", "piyano", "bas gitar", "müzik teorisi",
];
const NOVA_EXPECTED_TERMS = [
  "Nova Coffee", "Butik kahve / kafe", "Kahve demleme", "Cekirdek secimi",
  "Espresso", "Latte art", "Magazayi ziyaret et",
];
const EREN_FORBIDDEN_VALUES = [...EREN_FORBIDDEN_TERMS, currentProfile.offer.reservation_url];

const novaProfileSerialized = JSON.stringify(novaProfile);
for (const term of EREN_FORBIDDEN_VALUES) {
  assert.ok(
    !novaProfileSerialized.toLocaleLowerCase("tr-TR").includes(term.toLocaleLowerCase("tr-TR")),
    `Nova Coffee fixture'ına Eren'e özel değer sızmış: ${term}`,
  );
}
assert.notEqual(currentProfile.business.category, novaProfile.business.category);
assert.notEqual(currentProfile.business.brand_name, novaProfile.business.brand_name);

for (const [agent, workflow] of Object.entries(workflows)) {
  const normalized = workflow.toLocaleLowerCase("tr-TR");
  for (const term of EREN_FORBIDDEN_TERMS) {
    assert.ok(
      !normalized.includes(term.toLocaleLowerCase("tr-TR")),
      `${agent} (${AGENT_WORKFLOWS[agent]}) workflowunda Eren'e özel hard-code kaldı: ${term}`,
    );
  }
  assert.match(workflow, /\r?\n\s*test_mode:\r?\n/, `${agent}: workflow_dispatch.test_mode input eksik`);
  assert.ok(workflow.includes("TEST_MODE: ${{ inputs.test_mode || 'false' }}"), `${agent}: TEST_MODE env binding eksik`);
}

const CORE_PROFILE_BINDINGS = [".business.brand_name", ".content.content_topics"];
for (const [agent, workflow] of Object.entries(workflows)) {
  for (const binding of CORE_PROFILE_BINDINGS)
    assert.ok(workflow.includes(binding), `${agent}: eksik profil bağlantısı ${binding}`);
}
for (const agent of ["weekly-research", "quality-control", "script-correction", "final-technical-check"])
  assert.ok(workflows[agent].includes(".business.category"), `${agent}: eksik profil bağlantısı .business.category`);

const AGENT_SPECIFIC_BINDINGS = {
  "weekly-research": [".content.research.lookback_days", ".content.research.idea_count", ".offer.reservation_url"],
  "weekly-script": [".content.script.idea_count", ".content.script.target_min_words"],
  "quality-control": [".content.quality_control.domain_rules", ".content.quality_control.max_web_searches"],
  "script-correction": [".content.correction.domain_rules", ".content.correction.max_model_output"],
  "final-technical-check": [".content.final_technical_control.max_final_chars", ".content.final_technical_control.domain_rules"],
};
for (const [agent, bindings] of Object.entries(AGENT_SPECIFIC_BINDINGS)) {
  for (const binding of bindings)
    assert.ok(workflows[agent].includes(binding), `${agent}: eksik alan-özel profil bağlantısı ${binding}`);
}

const buildCoreContext = (profile) => [
  `Marka: ${profile.business.brand_name}`,
  `İşletme sahibi: ${profile.business.owner_display_name}`,
  `Faaliyet alanı: ${profile.business.category}`,
  `Hizmetler: ${profile.offer.services.join(", ")}`,
  `Mevcut ekipman: ${profile.offer.available_equipment.join(", ")}`,
  `İçerik konuları: ${profile.content.content_topics.join(", ")}`,
  `Birincil platform: ${profile.content.primary_platform}`,
  `İkincil biçimler: ${profile.content.secondary_formats.join(", ")}`,
  `Ana çağrı: ${profile.offer.primary_cta}`,
  `Rezervasyon: ${profile.offer.reservation_url}`,
  `Saat dilimi: ${profile.business.timezone}`,
].join("\n");
const currentContext = buildCoreContext(currentProfile);
const novaContext = buildCoreContext(novaProfile);
assert.notEqual(currentContext, novaContext, "Bağlam profile göre değişmeli");
for (const term of NOVA_EXPECTED_TERMS)
  assert.ok(novaContext.includes(term), `Nova Coffee bağlamında beklenen değer eksik: ${term}`);
const novaContextLower = novaContext.toLocaleLowerCase("tr-TR");
for (const term of EREN_FORBIDDEN_VALUES)
  assert.ok(!novaContextLower.includes(term.toLocaleLowerCase("tr-TR")), `Nova Coffee bağlamına Eren'e özel değer sızdı: ${term}`);
assert.ok(currentContext.includes(currentProfile.business.brand_name));
assert.ok(currentContext.includes(currentProfile.business.category));
for (const service of currentProfile.offer.services)
  assert.ok(currentContext.includes(service), `Eren bağlamında eksik hizmet: ${service}`);
for (const term of NOVA_EXPECTED_TERMS) {
  if (term === "Espresso") continue;
  assert.ok(!currentContext.includes(term), `Eren bağlamına Nova Coffee'ye özel değer sızdı: ${term}`);
}

const domainRuleSlices = {
  "quality-control": (profile) => profile.content.quality_control.domain_rules,
  "script-correction": (profile) => profile.content.correction.domain_rules,
  "final-technical-check": (profile) => profile.content.final_technical_control.domain_rules,
};
const musicTerms = ["akor", "nota", "riff", "bas gitar", "armoni", "tab"];
for (const [agent, getRules] of Object.entries(domainRuleSlices)) {
  const novaRules = getRules(novaProfile);
  assert.ok(novaRules.length > 0, `${agent}: Nova Coffee domain_rules boş`);
  for (const rule of novaRules) {
    const normalizedRule = rule.toLocaleLowerCase("tr-TR");
    for (const musicTerm of musicTerms)
      assert.ok(!normalizedRule.includes(musicTerm), `${agent}: Nova Coffee kuralına müzik terimi sızmış (${musicTerm}): ${rule}`);
  }
  const currentRuleSet = new Set(getRules(currentProfile));
  const overlap = novaRules.filter((rule) => currentRuleSet.has(rule));
  assert.equal(overlap.length, 0, `${agent}: Eren ve Nova Coffee domain_rules çakışmamalı`);
}

// Shared contracts stay aligned. Correction output is intentionally profile-owned:
// production is now 2200 because only QC-blocked scenarios are regenerated;
// Nova remains 4500 and therefore proves the workflow has no global hard-code.
for (const profile of [currentProfile, novaProfile]) {
  assert.equal(profile.content.quality_control.max_script_chars, 40000);
  assert.equal(profile.content.quality_control.max_web_searches, 1);
  assert.equal(profile.content.final_technical_control.max_final_chars, 24000);
  assert.equal(profile.content.script.target_min_words, 400);
  assert.equal(profile.content.research.idea_count, 5);
  assert.ok(Number.isInteger(profile.content.correction.max_model_output));
  assert.ok(profile.content.correction.max_model_output > 0);
}
assert.equal(currentProfile.content.correction.max_model_output, 2200);
assert.equal(novaProfile.content.correction.max_model_output, 4500);

const novaSerializedLower = novaProfileSerialized.toLocaleLowerCase("tr-TR");
for (const secretKey of ["anthropic_api_key", "github_token", "api_key", "secret_key", "password"])
  assert.ok(!novaSerializedLower.includes(secretKey), `Nova Coffee fixture'ında secret alan adı: ${secretKey}`);

console.log("second_business_portability_ok agents=5 ai_calls=0 api_calls=0 web_search=0 issue_writes=0 dispatches=0 video_calls=0 eren_leaks=0");

#!/usr/bin/env node
/**
 * Zero-token, zero-network portability proof for a SECOND test business
 * (Nova Coffee — a fictional boutique coffee shop, deliberately unrelated
 * to Eren Müzik Atölyesi's music-education vertical) across the five core
 * pipeline agents:
 *   - Weekly Research      (.github/workflows/weekly-content-research.yml)
 *   - Weekly Script        (.github/workflows/weekly-script-agent.yml)
 *   - Quality Control      (.github/workflows/weekly-quality-control.yml)
 *   - Script Correction    (.github/workflows/weekly-script-correction.yml)
 *   - Final Technical Check (.github/workflows/final-technical-check.yml)
 *
 * This complements (does not replace) test_quality_control_portability.mjs,
 * test_script_correction_portability.mjs, and
 * test_final_technical_decision_portability.mjs, which already prove
 * portability against fixtures/second-business-profile.json (a dental
 * clinic). Nova Coffee is a second, independently-chosen vertical (retail/
 * food service, not healthcare) — reinforcing that the pipeline generalizes
 * rather than happening to work for exactly one substitute example.
 *
 * Every check here is either:
 *   (a) a static source-text scan of the five workflow YAML files, or
 *   (b) an in-memory reconstruction of the same "$PROFILE_PATH -> jq ->
 *       $GITHUB_ENV" business-context binding each workflow's own
 *       "Merkezi işletme profilini doğrula ve yükle" step performs,
 *       applied to real JSON fixture data.
 * Nothing here calls a real AI provider, the network, gh, or any workflow.
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

// The exact Eren-specific values this test must never see leak into a
// second business's rendered context, nor find hard-coded in any of the
// five agents' own workflow source. The real production reservation URL is
// deliberately NOT hardcoded here as a string literal — repo_safety_scan.py
// forbids that exact literal outside its own small allowlist (business-
// profile.json, corsConfig.js, etc.), precisely so a stray copy can never
// become a real accidental fetch target. It's checked instead by reading
// it live from currentProfile.offer.reservation_url below (EREN_FORBIDDEN_VALUES),
// which proves the same thing — whatever the real URL currently is, it
// must not leak into Nova Coffee's context — without ever writing it out.
const EREN_FORBIDDEN_TERMS = [
  "Eren Müzik Atölyesi",
  "Eren Özüşen",
  "gitar",
  "piyano",
  "bas gitar",
  "müzik teorisi",
];

const NOVA_EXPECTED_TERMS = [
  "Nova Coffee",
  "Butik kahve / kafe",
  "Kahve demleme",
  "Cekirdek secimi",
  "Espresso",
  "Latte art",
  "Magazayi ziyaret et",
];

// Adds the real production reservation URL, read live from the actual Eren
// profile rather than hardcoded (see the comment on EREN_FORBIDDEN_TERMS
// above) — used only for the rendered-context leak checks (A, E), which
// operate on real string values already loaded from JSON, not on any
// literal written into this file's own source.
const EREN_FORBIDDEN_VALUES = [...EREN_FORBIDDEN_TERMS, currentProfile.offer.reservation_url];

// --- A) Nova Coffee fixture itself never mentions Eren -------------------

const novaProfileSerialized = JSON.stringify(novaProfile);
for (const term of EREN_FORBIDDEN_VALUES) {
  assert.ok(
    !novaProfileSerialized.toLocaleLowerCase("tr-TR").includes(term.toLocaleLowerCase("tr-TR")),
    `Nova Coffee fixture'ına Eren'e özel değer sızmış: ${term}`,
  );
}
assert.notEqual(currentProfile.business.category, novaProfile.business.category);
assert.notEqual(currentProfile.business.brand_name, novaProfile.business.brand_name);

// --- B) None of the five agent workflows hard-code an Eren-specific value:
// this is a structural guarantee — whichever profile is actually loaded at
// runtime, the AGENT SOURCE CODE itself carries no music-education-specific
// or Eren-specific literal, only profile-derived $VAR references. --------

for (const [agent, workflow] of Object.entries(workflows)) {
  const normalized = workflow.toLocaleLowerCase("tr-TR");
  for (const term of EREN_FORBIDDEN_TERMS) {
    assert.ok(
      !normalized.includes(term.toLocaleLowerCase("tr-TR")),
      `${agent} (${AGENT_WORKFLOWS[agent]}) workflowunda Eren'e özel hard-code kaldı: ${term}`,
    );
  }
}

// --- C) All five agents expose a zero-token, zero-side-effect TEST_MODE --

for (const [agent, workflow] of Object.entries(workflows)) {
  assert.match(workflow, /\r?\n\s*test_mode:\r?\n/, `${agent}: workflow_dispatch.test_mode input eksik`);
  assert.ok(
    workflow.includes("TEST_MODE: ${{ inputs.test_mode || 'false' }}"),
    `${agent}: TEST_MODE env binding eksik`,
  );
}

// --- D) All five agents bind the SAME core identity/context fields from
// $PROFILE_PATH (not a hard-coded business) — the exact mechanism every one
// of them uses in its "Merkezi işletme profilini doğrula ve yükle" step. --

// .business.category is universal EXCEPT weekly-script (which drives its
// prompt from content_topics/services instead of the raw category label) —
// verified directly against each workflow's own source rather than assumed.
const CORE_PROFILE_BINDINGS = [".business.brand_name", ".content.content_topics"];
for (const [agent, workflow] of Object.entries(workflows)) {
  for (const binding of CORE_PROFILE_BINDINGS) {
    assert.ok(workflow.includes(binding), `${agent}: eksik profil bağlantısı ${binding}`);
  }
}
for (const agent of ["weekly-research", "quality-control", "script-correction", "final-technical-check"]) {
  assert.ok(workflows[agent].includes(".business.category"), `${agent}: eksik profil bağlantısı .business.category`);
}

// Agent-specific extra bindings, confirming each agent also reads its own
// domain-specific slice of the profile (not just the shared identity core).
const AGENT_SPECIFIC_BINDINGS = {
  "weekly-research": [".content.research.lookback_days", ".content.research.idea_count", ".offer.reservation_url"],
  "weekly-script": [".content.script.idea_count", ".content.script.target_min_words"],
  "quality-control": [".content.quality_control.domain_rules", ".content.quality_control.max_web_searches"],
  "script-correction": [".content.correction.domain_rules", ".content.correction.max_model_output"],
  "final-technical-check": [
    ".content.final_technical_control.max_final_chars",
    ".content.final_technical_control.domain_rules",
  ],
};
for (const [agent, bindings] of Object.entries(AGENT_SPECIFIC_BINDINGS)) {
  for (const binding of bindings) {
    assert.ok(workflows[agent].includes(binding), `${agent}: eksik alan-özel profil bağlantısı ${binding}`);
  }
}

// --- E) Rendered context per agent: build the exact same identity context
// every one of these workflows assembles into $GITHUB_ENV, for BOTH the
// real Eren profile and the Nova Coffee fixture, then verify each contains
// only its own business's data. This is the concrete "does the value
// actually flow through and not leak" proof, not just a source scan. -----

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

// Nova Coffee's own values must be present in its own context.
for (const term of NOVA_EXPECTED_TERMS) {
  assert.ok(novaContext.includes(term), `Nova Coffee bağlamında beklenen değer eksik: ${term}`);
}

// None of Eren's forbidden values may appear in Nova Coffee's context.
const novaContextLower = novaContext.toLocaleLowerCase("tr-TR");
for (const term of EREN_FORBIDDEN_VALUES) {
  assert.ok(
    !novaContextLower.includes(term.toLocaleLowerCase("tr-TR")),
    `Nova Coffee bağlamına Eren'e özel değer sızdı: ${term}`,
  );
}

// Regression: Eren's own context must still carry Eren's real data
// (validates requirement 12 — the existing Eren flow is not broken by the
// mere existence of a second fixture).
assert.ok(currentContext.includes(currentProfile.business.brand_name));
assert.ok(currentContext.includes(currentProfile.business.category));
for (const service of currentProfile.offer.services) {
  assert.ok(currentContext.includes(service), `Eren bağlamında eksik hizmet: ${service}`);
}
// And conversely, none of Nova Coffee's coffee-specific values leak into
// Eren's own context.
for (const term of NOVA_EXPECTED_TERMS) {
  if (term === "Espresso") continue; // generic loanword, not Nova-exclusive; the other six are.
  assert.ok(!currentContext.includes(term), `Eren bağlamına Nova Coffee'ye özel değer sızdı: ${term}`);
}

// --- F) Domain rules never cross-contaminate between the two profiles ----
// (mirrors the existing per-agent portability tests' own cross-check,
// applied here specifically against the Nova Coffee fixture.)

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
    for (const musicTerm of musicTerms) {
      assert.ok(!normalizedRule.includes(musicTerm), `${agent}: Nova Coffee kuralına müzik terimi sızmış (${musicTerm}): ${rule}`);
    }
  }
  const currentRuleSet = new Set(getRules(currentProfile));
  const overlap = novaRules.filter((rule) => currentRuleSet.has(rule));
  assert.equal(overlap.length, 0, `${agent}: Eren ve Nova Coffee domain_rules çakışmamalı`);
}

// --- G) Numeric budgets/limits are identical across both profiles — only
// business-specific TEXT (brand, category, rules) should vary, never the
// cost/size contracts. -----------------------------------------------------

for (const profile of [currentProfile, novaProfile]) {
  assert.equal(profile.content.quality_control.max_script_chars, 40000);
  assert.equal(profile.content.quality_control.max_web_searches, 1);
  assert.equal(profile.content.correction.max_model_output, 4500);
  assert.equal(profile.content.final_technical_control.max_final_chars, 24000);
  assert.equal(profile.content.script.target_min_words, 400);
  assert.equal(profile.content.research.idea_count, 5);
}

// --- H) No secret material in the Nova Coffee fixture ---------------------

const novaSerializedLower = novaProfileSerialized.toLocaleLowerCase("tr-TR");
for (const secretKey of ["anthropic_api_key", "github_token", "api_key", "secret_key", "password"]) {
  assert.ok(!novaSerializedLower.includes(secretKey), `Nova Coffee fixture'ında secret alan adı: ${secretKey}`);
}

console.log(
  "second_business_portability_ok agents=5 ai_calls=0 api_calls=0 web_search=0 issue_writes=0 dispatches=0 video_calls=0 eren_leaks=0",
);

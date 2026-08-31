#!/usr/bin/env node
/**
 * Zero-token portability tests for the Weekly Quality Control agent.
 *
 * Confirms the QC system prompt contains no business-sector hard-codes and
 * instead sources sector-specific verification behaviour from the central
 * business profile (business.category, content.content_topics,
 * content.quality_control.domain_rules), while every non-sector contract
 * (evidence chain, decision classes, cost limits, output format) stays
 * unchanged.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const workflow = read(".github/workflows/weekly-quality-control.yml");
const smokeTest = read(".github/workflows/business-profile-smoke-test.yml");
const currentProfile = JSON.parse(read(".github/config/business-profile.json"));
const secondProfile = JSON.parse(read(".github/scripts/fixtures/second-business-profile.json"));
const normalizedWorkflow = workflow.toLocaleLowerCase("tr-TR");

const buildQcContext = (profile) => [
  `Marka: ${profile.business.brand_name}`,
  `İşletme sahibi: ${profile.business.owner_display_name}`,
  `Faaliyet alanı: ${profile.business.category}`,
  `Hizmetler: ${profile.offer.services.join(", ")}`,
  `Mevcut ekipman: ${profile.offer.available_equipment.join(", ")}`,
  `İçerik konuları: ${profile.content.content_topics.join(", ")}`,
  `Birincil platform: ${profile.content.primary_platform}`,
  `İkincil biçimler: ${profile.content.secondary_formats.join(", ")}`,
  "ALAN KURALLARI:",
  ...profile.content.quality_control.domain_rules,
].join("\n");

// --- A) No sector-specific hard-codes left in the runtime prompt ---------

for (const hardCoded of [
  "teknik müzik iddiası",
  "yerleşik müzik bilgisi",
  "müzik okulları",
  "resmi sanatçı",
  "eser kaynak",
  "sanatçı ve eser",
  "akor",
  "nota",
  "riff",
  "bas gitar",
  "armoni",
  "diş",
  "klinik",
]) {
  assert.ok(
    !normalizedWorkflow.includes(hardCoded.toLocaleLowerCase("tr-TR")),
    `Workflowta sektöre özel hard-code kaldı: ${hardCoded}`,
  );
}
for (const businessHardCode of ["eren müzik atölyesi", "eren özüşen", "erenozusen"])
  assert.ok(!normalizedWorkflow.includes(businessHardCode), businessHardCode);

// --- B) Prompt still sources business.category / content_topics / domain_rules ---

for (const profileBinding of [
  ".business.category",
  ".content.content_topics",
  ".content.quality_control.domain_rules",
  ".content.quality_control.max_script_chars",
  ".content.quality_control.max_model_output",
  ".content.quality_control.target_report_output",
  ".content.quality_control.max_web_searches",
]) {
  assert.ok(workflow.includes(profileBinding), profileBinding);
}

// domain_rules must be read from exactly one $PROFILE-scoped extraction point
// (never merged across two business profiles).
const domainRuleExtractions = workflow.match(/\.content\.quality_control\.domain_rules/gu) ?? [];
assert.equal(domainRuleExtractions.length, 1, "domain_rules tam olarak bir $PROFILE'dan okunmalı");

assert.ok(
  workflow.includes(
    "ALAN KURALLARI: Merkezi işletme profilinden gelen sektör doğrulama kurallarını uygula.",
  ),
);
// Router migration: domain_rules is threaded straight from the bash env
// var (QC_DOMAIN_RULES_TEXT) into the system-prompt heredoc — there is no
// separate jq --arg rename anymore (that layer no longer exists).
assert.ok(workflow.includes("$QC_DOMAIN_RULES_TEXT"));

// --- New generic (sector-independent) evidence and sourcing rules --------

assert.ok(
  workflow.includes(
    "Paketteki trend bulgusunu, senaryoda ayrıca yer alan ve ayrı doğrulama gerektiren başka bir alan iddiasının kanıtı gibi genişletme.",
  ),
);
assert.ok(
  workflow.includes(
    "Ardından merkezi işletme profilinin faaliyet alanı, içerik konuları ve alan kurallarını bağlam olarak kullan.",
  ),
);
assert.ok(workflow.includes("mevcut web arama bütçesi dahilinde arama yapılabilir."));
assert.ok(
  workflow.includes(
    "resmi ve birincil kaynaklar, kamu kurumları, akademik veya mesleki kurumlar ve güvenilir uzman ya da meslek kuruluşlarıdır",
  ),
);
assert.ok(workflow.includes("Kaynaklar çelişirse BELİRSİZ yaz."));
assert.ok(workflow.includes("Kaynak uydurma."));

// --- C) Eren profile domain_rules can still supply music verification ----

assert.ok(
  currentProfile.content.quality_control.domain_rules.some((rule) =>
    /akor|nota|riff|bas gitar/u.test(rule),
  ),
  "Eren profilinin domain_rules alanı müzik doğrulama kurallarını taşımıyor",
);
assert.equal(currentProfile.business.category, "Müzik eğitimi");

// --- D) Second business (Mavi Diş Kliniği) never sees Eren/music rules ---

const secondRules = secondProfile.content.quality_control.domain_rules;
for (const musicTerm of ["akor", "nota", "riff", "bas gitar", "armoni"]) {
  assert.ok(
    !secondRules.some((rule) => rule.toLocaleLowerCase("tr-TR").includes(musicTerm)),
    `İkinci işletme profiline müzik terimi sızdı: ${musicTerm}`,
  );
}
assert.ok(secondRules.some((rule) => /teshis|tedavi/iu.test(rule)));
assert.notEqual(currentProfile.business.category, secondProfile.business.category);

const currentRuleSet = new Set(currentProfile.content.quality_control.domain_rules);
const overlap = secondRules.filter((rule) => currentRuleSet.has(rule));
assert.equal(overlap.length, 0, "İki işletme profili arasında domain_rules çakışması olmamalı");

const currentContext = buildQcContext(currentProfile);
const secondContext = buildQcContext(secondProfile);
assert.notEqual(currentContext, secondContext, "QC bağlamı profile göre değişmeli");
assert.ok(currentContext.includes(currentProfile.business.brand_name));
assert.ok(currentContext.includes(currentProfile.business.category));
assert.ok(currentProfile.content.quality_control.domain_rules.every((rule) => currentContext.includes(rule)));
assert.ok(secondContext.includes(secondProfile.business.brand_name));
assert.ok(secondContext.includes(secondProfile.business.category));
assert.ok(secondRules.every((rule) => secondContext.includes(rule)));
for (const musicTerm of ["akor", "nota", "riff", "bas gitar", "armoni"])
  assert.ok(!secondContext.toLocaleLowerCase("tr-TR").includes(musicTerm), musicTerm);
for (const dentalTerm of ["teshis", "tedavi"])
  assert.ok(!currentContext.toLocaleLowerCase("tr-TR").includes(dentalTerm), dentalTerm);

// --- E) Web-search budget and cost limits unchanged, now threaded through
// the shared AI router instead of an inline Anthropic tools: payload. The
// exact web_search_20260209 payload SHAPE is ai_router.py's job now (see
// test_ai_router.py's web-search tests) -- this file's job is only to
// prove the WORKFLOW correctly threads the business-profile-driven budget
// into the router call, never a hard-coded number. ---------------------

assert.equal(currentProfile.content.quality_control.max_web_searches, 1);
assert.equal(secondProfile.content.quality_control.max_web_searches, 1);
for (const profile of [currentProfile, secondProfile]) {
  assert.equal(profile.content.quality_control.max_script_chars, 40000);
  assert.equal(profile.content.quality_control.max_model_output, 4500);
  assert.equal(profile.content.quality_control.target_report_output, 2500);
}
assert.ok(workflow.includes("python3 .github/scripts/ai_router.py"));
assert.ok(workflow.includes('--web-search-max-uses "$QC_MAX_WEB_SEARCHES"'));
assert.ok(workflow.includes('--max-tokens "$QC_MAX_MODEL_OUTPUT"'));
assert.ok(!workflow.includes("api.anthropic.com"), "the direct Anthropic endpoint must no longer be hard-coded in the workflow");

// --- F) Test-mode and secret safety remain unchanged ---------------------

assert.ok(workflow.includes("ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}"));
for (const profile of [currentProfile, secondProfile]) {
  const serialized = JSON.stringify(profile).toLocaleLowerCase("tr-TR");
  for (const secretKey of ["anthropic_api_key", "github_token", "api_key", "secret_key"])
    assert.ok(!serialized.includes(secretKey), `Secret profile taşınmış: ${secretKey}`);
}
assert.equal((workflow.match(/if: \$\{\{ env\.TEST_MODE != 'true' \}\}/gu) ?? []).length, 3);
assert.ok(workflow.includes("if: ${{ env.TEST_MODE == 'true' }}"));
assert.ok(!workflow.includes("repository_dispatch:"));
assert.ok(!workflow.includes("workflow_run:"));

// --- G) QC decision/output contract unchanged -----------------------------

for (const contract of [
  "QC_KANIT_V1",
  "Sonuç yalnızca DOĞRU, YANLIŞ, YANILTICI, BELİRSİZ veya GÖRÜŞ olabilir.",
  "# SENARYO 1/2/3",
  "## 1. İDDİA VE KANIT TABLOSU",
  "## 2. GERÇEK BİLGİ HATALARI",
  "## 3. HASSASİYET ÖNERİLERİ",
  "## 4. İÇERİK KALİTESİ",
  "## 5. SENARYO KARARI",
  "Her senaryoya yalnızca YAYINA HAZIR veya DÜZELTME GEREKİYOR kararı ver.",
  "# GENEL TUTARLILIK KONTROLÜ",
  "# ÖZET KARAR TABLOSU",
  "GENEL KARAR: ✅ YAYINA HAZIR",
  "GENEL KARAR: ⚠️ DÜZELTME GEREKİYOR",
  "QC_AI_USAGE_V1",
]) {
  assert.ok(workflow.includes(contract), contract);
}

// --- H) This test itself performs no real AI/API/web-search/Issue/dispatch/video
// calls: everything above is a static read of committed files and in-memory
// JSON/string assertions, nothing here executes curl/gh/anthropic or the
// workflow itself.

// --- Smoke-test wiring -----------------------------------------------------

assert.ok(smokeTest.includes(".github/scripts/test_quality_control_portability.mjs"));
assert.ok(smokeTest.includes("node .github/scripts/test_quality_control_portability.mjs"));

console.log(
  "quality_control_portability_ok ai_calls=0 api_calls=0 web_search=0 issue_writes=0 dispatches=0 video_calls=0",
);

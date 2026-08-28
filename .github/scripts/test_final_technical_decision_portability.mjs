#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIX_DECISION,
  LEGACY_READY_DECISION,
  READY_DECISION,
  parseFinalTechnicalDecision,
} from "./final_technical_decision_contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/final-technical-check.yml"),
  "utf8",
);
const profiles = [
  path.join(root, ".github/config/business-profile.json"),
  path.join(root, ".github/scripts/fixtures/second-business-profile.json"),
].map((profilePath) => JSON.parse(fs.readFileSync(profilePath, "utf8")));

assert.equal(READY_DECISION, "GENEL KARAR: ✅ ONAYA HAZIR");
for (const profile of profiles) {
  const report = `# 🔍 ${profile.business.brand_name} — SON TEKNİK KONTROL\n\n${READY_DECISION}`;
  assert.equal(parseFinalTechnicalDecision(report), "ready");
  assert.ok(report.includes(profile.business.brand_name));
  assert.ok(!report.includes("EREN ONAYINA HAZIR"));
}

assert.equal(
  parseFinalTechnicalDecision(`# Historical rapor\n\n${LEGACY_READY_DECISION}`),
  "ready",
);
assert.equal(parseFinalTechnicalDecision(`# Düzeltme raporu\n\n${FIX_DECISION}`), "fix");
assert.throws(
  () => parseFinalTechnicalDecision(`${READY_DECISION}\nsonradan eklenen metin`),
  /son satırı değil/,
);

for (const profileBinding of [
  "business.brand_name",
  "business.owner_display_name",
  "business.category",
  "content.content_topics",
  "content.final_technical_control",
]) {
  assert.ok(workflow.includes(profileBinding), profileBinding);
}
assert.ok(workflow.includes("GENEL KARAR: ✅ ONAYA HAZIR"));
assert.ok(!workflow.includes("EREN ONAYINA HAZIR"));
assert.ok(workflow.includes("final_technical_decision_contract.mjs"));
for (const label of ["son-kontrol-gecti", "duzeltme-gerekiyor", "eren-onayi-bekliyor"]) {
  assert.ok(workflow.includes(`"${label}"`), label);
}

// Main owner approval label migration Faz 1 — dual-write of the pending label on the
// "Nihai Senaryolar" issue when the decision is "ready", dual-remove of both pending
// labels regardless of decision. The "duzeltme-gerekiyor" label itself is untouched.
assert.ok(workflow.includes('"owner-approval-pending"'), "owner-approval-pending");
assert.ok(
  workflow.includes('FINAL_LABEL_GENERIC="owner-approval-pending"'),
  "FINAL_LABEL_GENERIC dual-write ataması eksik",
);
assert.ok(
  workflow.includes('--remove-label "owner-approval-pending"'),
  "owner-approval-pending temizlenmiyor",
);
assert.ok(
  workflow.includes('--add-label "$FINAL_LABEL" --add-label "$FINAL_LABEL_GENERIC"'),
  "ready kararında dual-add eksik",
);

console.log(
  "final_technical_decision_portability_ok ai_calls=0 api_calls=0 issue_writes=0 video_calls=0",
);

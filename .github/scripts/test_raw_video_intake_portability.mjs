#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/raw-video-intake-gate.yml"),
  "utf8",
);
const current = JSON.parse(
  fs.readFileSync(path.join(root, ".github/config/business-profile.json"), "utf8"),
);
const second = JSON.parse(
  fs.readFileSync(
    path.join(root, ".github/scripts/fixtures/second-business-profile.json"),
    "utf8",
  ),
);

function portableIdentity(profile) {
  return {
    heading: `# 📥 ${profile.business.brand_name} — HAM VİDEO TESLİMİ`,
    owner: profile.business.owner_display_name,
    githubOwner: profile.business.github_owner,
    timezone: profile.business.timezone,
  };
}

function isAuthorized(runActor, profile) {
  return runActor === profile.business.github_owner;
}

const currentIdentity = portableIdentity(current);
assert.equal(currentIdentity.heading, "# 📥 Eren Müzik Atölyesi — HAM VİDEO TESLİMİ");
assert.equal(currentIdentity.owner, "Eren Özüşen");
assert.equal(currentIdentity.githubOwner, "ErenOzusen");
assert.equal(currentIdentity.timezone, "Europe/Istanbul");

const secondIdentity = portableIdentity(second);
assert.equal(secondIdentity.heading, "# 📥 Mavi Dis Klinigi — HAM VİDEO TESLİMİ");
assert.equal(secondIdentity.owner, "Klinik Yoneticisi");
assert.equal(secondIdentity.githubOwner, "mavi-dis-demo");
assert.equal(secondIdentity.timezone, "Europe/Istanbul");
assert.equal(isAuthorized("mavi-dis-demo", second), true);
assert.equal(isAuthorized("yetkisiz-kullanici", second), false);

for (const binding of [
  ".business.brand_name",
  ".business.owner_display_name",
  ".business.github_owner",
  ".business.timezone",
]) {
  assert.ok(workflow.includes(binding), binding);
}
assert.ok(workflow.includes('[[ "$RUN_ACTOR" != "$AUTHORIZED_GITHUB_OWNER" ]]'));
assert.ok(workflow.includes('TZ="$BUSINESS_TIMEZONE"'));
assert.ok(workflow.includes('echo "# 📥 $BRAND_NAME — HAM VİDEO TESLİMİ"'));
assert.ok(workflow.includes('echo "**Yetkili işletme sahibi:** $OWNER_NAME"'));

for (const forbidden of [
  "EREN MÜZİK ATÖLYESİ",
  "repo sahibi Eren",
  "Eren tarafından",
  "Eren'in nihai yayın onayı",
]) {
  assert.ok(!workflow.includes(forbidden), forbidden);
}

for (const securityContract of [
  'any(.name == "eren-onayli")',
  'any(.name == "cekime-hazir")',
  '"ham-video-teslim"',
  '"kurgu-bekliyor"',
  '"ham-video-teslim-alindi"',
  "<!-- raw-video-intake-version: 1 -->",
  "https?://|www\\.|drive\\.google|dropbox\\.",
  "token|key|signature|auth",
  '"Çekim Paketi - Nihai Senaryolar #"*',
  "Nihai Senaryolar #[0-9]+",
]) {
  assert.ok(workflow.includes(securityContract), securityContract);
}

console.log(
  "raw_video_intake_portability_ok ai_calls=0 api_calls=0 issue_writes=0 video_calls=0",
);

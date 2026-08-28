#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const businessConfig = read(".github/workflows/business-config-agent.yml");
const filmingHandoff = read(".github/workflows/filming-handoff-gate.yml");
const currentProfile = JSON.parse(read(".github/config/business-profile.json"));
const secondProfile = JSON.parse(read(".github/scripts/fixtures/second-business-profile.json"));

assert.ok(!businessConfig.includes("repo sahibi Eren"));
assert.ok(
  businessConfig.includes(
    "yalnızca işletme profilinde yetkilendirilen GitHub hesabı çalıştırabilir",
  ),
);
assert.ok(!filmingHandoff.includes("Eren tarafından açıkça verildi"));
assert.ok(
  filmingHandoff.includes("Başlatma komutu: Yetkili işletme sahibi tarafından açıkça verildi"),
);

for (const contract of [
  "CONFIG_OWNER=$(jq -er '.business.github_owner",
  "NORMALIZED_RUN_ACTOR=",
  "NORMALIZED_CONFIG_OWNER=",
  "LC_ALL=C tr '[:upper:]' '[:lower:]'",
  '[[ "$NORMALIZED_RUN_ACTOR" != "$NORMALIZED_CONFIG_OWNER" ]]',
  "validate_business_config.py",
  "BUSINESS_CONFIG_USAGE_V1",
]) {
  assert.ok(businessConfig.includes(contract), contract);
}

for (const forbidden of [
  "REPOSITORY_OWNER:",
  "github.repository_owner",
  '[[ "$RUN_ACTOR" != "$REPOSITORY_OWNER" ]]',
  '[[ "$CONFIG_OWNER" != "$REPOSITORY_OWNER" ]]',
  "yetkili repo sahibi",
]) {
  assert.ok(!businessConfig.includes(forbidden), forbidden);
}

const normalizeGithubLogin = (value) => value.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
const isAuthorized = (actor, configuredOwner, repositoryOwner) => {
  void repositoryOwner;
  return normalizeGithubLogin(actor) === normalizeGithubLogin(configuredOwner);
};

assert.equal(isAuthorized("ErenOzusen", currentProfile.business.github_owner, "organization-name"), true);
assert.equal(isAuthorized("erenozusen", currentProfile.business.github_owner, "organization-name"), true);
assert.equal(isAuthorized("MAVI-DIS-DEMO", secondProfile.business.github_owner, "another-org"), true);
assert.equal(isAuthorized("unauthorized-user", currentProfile.business.github_owner, "organization-name"), false);

const checkoutIndex = businessConfig.indexOf("uses: actions/checkout@v4");
const authorizationIndex = businessConfig.indexOf(
  '[[ "$NORMALIZED_RUN_ACTOR" != "$NORMALIZED_CONFIG_OWNER" ]]',
);
const firstExternalWriteIndex = Math.min(
  ...[businessConfig.indexOf('>> "$GITHUB_STEP_SUMMARY"'), businessConfig.indexOf("gh label create")]
    .filter((index) => index >= 0),
);
assert.ok(checkoutIndex >= 0);
assert.ok(authorizationIndex > checkoutIndex);
assert.ok(authorizationIndex < firstExternalWriteIndex);

for (const contract of [
  'EXPECTED_OWNER=$(jq -r \'.business.github_owner\' "$PROFILE")',
  '[[ "$COMMENT_AUTHOR" != "$EXPECTED_OWNER" ]]',
  "for REQUIRED in eren-onayli cekime-hazir uretime-secildi",
  // Main owner approval label migration Faz 1 — read-both for eren-onayli inside the
  // loop, without changing the loop header string above (kept for backward compat).
  'if [[ "$REQUIRED" == "eren-onayli" ]]; then',
  "grep -qxE 'eren-onayli|owner-approved' /tmp/labels.txt",
  "FILMING_HANDOFF_V1",
  "VIDEO_ORCHESTRATOR_V1",
  "TEST HANDOFF ",
  "TEST ÇEKİMİ BAŞLAT ",
  "ÇEKİMİ BAŞLAT ",
  "paid_generation_allowed == false",
  "dispatch_enabled == false",
  "test_mode:true",
  "test_mode:false",
]) {
  assert.ok(filmingHandoff.includes(contract), contract);
}

assert.equal(currentProfile.business.github_owner, "ErenOzusen");
assert.equal(secondProfile.business.github_owner, "mavi-dis-demo");
assert.notEqual(currentProfile.business.brand_name, secondProfile.business.brand_name);

console.log(
  "runtime_message_portability_ok ai_calls=0 api_calls=0 issue_writes=0 dispatches=0 video_calls=0",
);

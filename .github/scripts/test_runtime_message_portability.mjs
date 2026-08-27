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
assert.ok(businessConfig.includes("yalnızca yetkili repo sahibi çalıştırabilir"));
assert.ok(!filmingHandoff.includes("Eren tarafından açıkça verildi"));
assert.ok(
  filmingHandoff.includes("Başlatma komutu: Yetkili işletme sahibi tarafından açıkça verildi"),
);

for (const contract of [
  '[[ "$RUN_ACTOR" != "$REPOSITORY_OWNER" ]]',
  '[[ "$CONFIG_OWNER" != "$REPOSITORY_OWNER" ]]',
  ".business.github_owner",
  "validate_business_config.py",
  "BUSINESS_CONFIG_USAGE_V1",
]) {
  assert.ok(businessConfig.includes(contract), contract);
}

for (const contract of [
  'EXPECTED_OWNER=$(jq -r \'.business.github_owner\' "$PROFILE")',
  '[[ "$COMMENT_AUTHOR" != "$EXPECTED_OWNER" ]]',
  "for REQUIRED in eren-onayli cekime-hazir uretime-secildi",
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

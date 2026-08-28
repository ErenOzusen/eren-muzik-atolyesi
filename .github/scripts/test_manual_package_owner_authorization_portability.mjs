#!/usr/bin/env node
/**
 * Zero-token portability tests for the four manual package agents' authorization model.
 *
 * Verifies that editing-package-agent.yml, subtitle-package-agent.yml,
 * thumbnail-package-agent.yml and youtube-publication-package-agent.yml all authorize
 * their run actor against business.github_owner (read from the central business
 * profile) instead of github.repository_owner, using the identical case-insensitive
 * contract, and that the check runs before any Issue read, AI/API call, or Issue/label
 * write.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const WORKFLOW_PATHS = [
  ".github/workflows/editing-package-agent.yml",
  ".github/workflows/subtitle-package-agent.yml",
  ".github/workflows/thumbnail-package-agent.yml",
  ".github/workflows/youtube-publication-package-agent.yml",
];

const currentProfile = JSON.parse(read(".github/config/business-profile.json"));
const secondProfile = JSON.parse(read(".github/scripts/fixtures/second-business-profile.json"));

// 1-2-4: business.github_owner is read via jq -er, and compared against the actor;
// github.repository_owner is completely removed from the authorization decision.
const REQUIRED_CONTRACT = [
  "CONFIG_OWNER=$(jq -er '.business.github_owner | select(type == \"string\" and length > 0)' \\",
  ".github/config/business-profile.json)",
  'NORMALIZED_RUN_ACTOR=$(printf \'%s\' "$RUN_ACTOR" | LC_ALL=C tr \'[:upper:]\' \'[:lower:]\')',
  'NORMALIZED_CONFIG_OWNER=$(printf \'%s\' "$CONFIG_OWNER" | LC_ALL=C tr \'[:upper:]\' \'[:lower:]\')',
  'if [[ "$NORMALIZED_RUN_ACTOR" != "$NORMALIZED_CONFIG_OWNER" ]]; then',
  "Bu ajanı yalnızca işletme profilinde yetkilendirilen GitHub hesabı çalıştırabilir.",
];

const FORBIDDEN_CONTRACT = [
  "REPOSITORY_OWNER:",
  "github.repository_owner",
  '[[ "$RUN_ACTOR" != "$REPOSITORY_OWNER" ]]',
  "yalnızca repo sahibi çalıştırabilir",
];

for (const workflowPath of WORKFLOW_PATHS) {
  const workflow = read(workflowPath);

  for (const contract of REQUIRED_CONTRACT) {
    assert.ok(workflow.includes(contract), `${workflowPath}: eksik sözleşme parçası: ${contract}`);
  }
  for (const forbidden of FORBIDDEN_CONTRACT) {
    assert.ok(!workflow.includes(forbidden), `${workflowPath}: yasaklı repository_owner kalıntısı: ${forbidden}`);
  }

  // 5: authorization must run before any Issue read, AI/API call, or Issue/label write.
  const authIndex = workflow.indexOf('if [[ "$NORMALIZED_RUN_ACTOR" != "$NORMALIZED_CONFIG_OWNER" ]]; then');
  assert.ok(authIndex > 0, `${workflowPath}: authorization kontrolü bulunamadı`);

  const checkoutIndex = workflow.indexOf("uses: actions/checkout@v4");
  assert.ok(checkoutIndex >= 0, `${workflowPath}: checkout adımı bulunamadı`);
  assert.ok(authIndex > checkoutIndex, `${workflowPath}: authorization checkout'tan önce olamaz`);

  const externallyEffectfulMarkers = [
    "gh issue view",
    "gh issue list",
    "gh label create",
    "gh issue create",
    "gh issue edit",
    "curl --fail-with-body",
    "python3 .github/scripts/build_",
  ];
  for (const marker of externallyEffectfulMarkers) {
    const markerIndex = workflow.indexOf(marker);
    if (markerIndex === -1) continue;
    assert.ok(
      authIndex < markerIndex,
      `${workflowPath}: authorization '${marker}' adımından önce gelmiyor (auth@${authIndex} >= marker@${markerIndex})`,
    );
  }

  console.log(`ok authorization contract: ${workflowPath}`);
}

// 7: all four workflows share the exact same authorization contract text.
const workflowBodies = WORKFLOW_PATHS.map((workflowPath) => {
  const workflow = read(workflowPath);
  const start = workflow.indexOf("CONFIG_OWNER=$(jq -er");
  const end = workflow.indexOf("if [[ \"$TEST_MODE\" != \"true\" && \"$TEST_MODE\" != \"false\" ]]; then");
  assert.ok(start >= 0 && end > start, `${workflowPath}: authorization bloğu sınırlandırılamadı`);
  return workflow.slice(start, end);
});
for (let index = 1; index < workflowBodies.length; index += 1) {
  assert.equal(
    workflowBodies[index],
    workflowBodies[0],
    `${WORKFLOW_PATHS[index]}: authorization sözleşmesi ${WORKFLOW_PATHS[0]} ile birebir aynı değil`,
  );
}
console.log("ok: dört workflow aynı authorization sözleşmesini kullanıyor");

// 3 & 6: case-insensitive comparison, including an organization-repository scenario
// where the actor's login differs in case from business.github_owner, and the actual
// repository owner (an org name, unrelated to business.github_owner) plays no role.
const normalizeGithubLogin = (value) => value.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
const isAuthorized = (actor, configuredOwner, repositoryOwner) => {
  void repositoryOwner; // github.repository_owner must never affect the decision.
  return normalizeGithubLogin(actor) === normalizeGithubLogin(configuredOwner);
};

assert.equal(isAuthorized("ErenOzusen", currentProfile.business.github_owner, "some-org"), true);
assert.equal(isAuthorized("erenozusen", currentProfile.business.github_owner, "some-org"), true);
assert.equal(isAuthorized("EREN OZUSEN".replace(" ", ""), currentProfile.business.github_owner, "some-org"), true);
assert.equal(isAuthorized("MAVI-DIS-DEMO", secondProfile.business.github_owner, "another-org"), true);
assert.equal(isAuthorized("mavi-dis-demo", secondProfile.business.github_owner, "another-org"), true);
// Organization repository scenario: repository_owner is the org, not the authorized
// person/account — authorization must still key off business.github_owner alone.
assert.equal(isAuthorized(currentProfile.business.github_owner, currentProfile.business.github_owner, "acme-org"), true);
assert.equal(isAuthorized("unauthorized-user", currentProfile.business.github_owner, currentProfile.business.github_owner), false);
assert.equal(isAuthorized(secondProfile.business.github_owner, currentProfile.business.github_owner, "acme-org"), false);

assert.equal(currentProfile.business.github_owner, "ErenOzusen");
assert.equal(secondProfile.business.github_owner, "mavi-dis-demo");
assert.notEqual(currentProfile.business.github_owner, secondProfile.business.github_owner);

// 7 (schema stability): schema_version and required root keys of the business profile
// must not have changed as part of this authorization portability work.
for (const profile of [currentProfile, secondProfile]) {
  assert.equal(profile.schema_version, 1);
  assert.equal(typeof profile.business.github_owner, "string");
  assert.ok(profile.business.github_owner.length > 0);
}

console.log(
  "manual_package_owner_authorization_portability_ok ai_calls=0 api_calls=0 issue_writes=0 dispatches=0 video_calls=0",
);

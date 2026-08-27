#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const workflow = read(".github/workflows/eren-approval-gate.yml");
const current = JSON.parse(read(".github/config/business-profile.json"));
const second = JSON.parse(read(".github/scripts/fixtures/second-business-profile.json"));

const normalize = (value) => value.replace(/\s+/gu, "").toLocaleLowerCase("tr-TR");
for (const profile of [current, second]) {
  assert.ok(normalize(profile.approval.production_command));
  assert.ok(normalize(profile.approval.test_command));
  assert.notEqual(
    normalize(profile.approval.production_command),
    normalize(profile.approval.test_command),
  );
}
assert.equal(normalize(current.approval.production_command), normalize("ONAYLIYORUM"));
assert.equal(normalize(current.approval.test_command), normalize("TEST ONAYLIYORUM"));
assert.equal(normalize(second.approval.production_command), normalize("YAYINA HAZIR"));
assert.equal(normalize(second.approval.test_command), normalize("TEST YAYINA HAZIR"));

const jobFilter = workflow.match(/jobs:\s*\n\s+approve-content:\s*\n\s+if: >-\s*\n([\s\S]*?)\n\s+runs-on:/u)?.[1];
assert.ok(jobFilter);
assert.ok(jobFilter.includes("github.event.issue.pull_request == null"));
assert.ok(jobFilter.includes("startsWith(github.event.issue.title, 'Nihai Senaryolar')"));
assert.ok(!jobFilter.includes("ONAYLIYORUM"));
assert.ok(!jobFilter.includes("TEST ONAYLIYORUM"));
assert.ok(!jobFilter.includes("github.event.comment.body =="));

for (const binding of [
  ".business.owner_display_name",
  ".business.github_owner",
  ".approval.production_command",
  ".approval.test_command",
  ".approval.required",
  ".approval.allow_publication_without_owner_approval",
  '[[ "$COMMENT_AUTHOR" != "$EXPECTED_OWNER" ]]',
  '[[ "$APPROVAL_REQUIRED" != "true" || "$ALLOW_UNAPPROVED" != "false" ]]',
  '[[ "$NORMALIZED_COMMENT" != "$NORMALIZED_PRODUCTION"',
  '[[ "$NORMALIZED_COMMENT" == "$NORMALIZED_TEST" ]]',
]) {
  assert.ok(workflow.includes(binding), binding);
}

const testBranch = workflow.match(
  /if \[\[ "\$NORMALIZED_COMMENT" == "\$NORMALIZED_TEST" \]\]; then([\s\S]*?)\n\s+fi/u,
)?.[1];
assert.ok(testBranch);
assert.ok(!testBranch.includes("gh issue edit"));
assert.ok(!testBranch.includes("gh issue comment"));
assert.ok(!testBranch.includes("gh label create"));
assert.ok(testBranch.includes("Issue\/etiket değişikliği: yapılmadı"));

for (const contract of ["eren-onayli", "eren-onayi-bekliyor", "EREN_APPROVAL_V2", "cekime-hazir"]) {
  assert.ok(workflow.includes(contract), contract);
}
for (const visibleHardCode of [
  "name: Eren Onay Kapısı",
  "Eren onayını",
  "Eren onayı",
  "Eren tarafından",
]) {
  assert.ok(!workflow.includes(visibleHardCode), visibleHardCode);
}

console.log(
  "owner_approval_portability_ok ai_calls=0 api_calls=0 issue_writes=0 dispatches=0 video_calls=0",
);

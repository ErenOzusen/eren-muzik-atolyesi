#!/usr/bin/env node
/** Zero-token portability checks for the YouTube publication approval gate. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readText = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");
const readJson = (relativePath) => JSON.parse(readText(relativePath));
const normalizeCommand = (value) => value.toUpperCase().replaceAll(/\s/g, "");

const workflow = readText(".github/workflows/youtube-publication-approval-gate.yml");
const current = readJson(".github/config/business-profile.json");
const second = readJson(".github/scripts/fixtures/second-business-profile.json");

for (const field of [
  ".business.github_owner",
  ".business.owner_display_name",
  ".approval.production_command",
  ".approval.test_command",
]) {
  assert.ok(workflow.includes(field), `Workflow profil alanını okumuyor: ${field}`);
}

for (const check of [
  '[[ "$COMMENT_AUTHOR" != "$EXPECTED_OWNER" ]]',
  '[[ "$NORMALIZED_COMMENT" != "$NORMALIZED_TEST_COMMAND" ]]',
  '[[ "$NORMALIZED_COMMENT" != "$NORMALIZED_PRODUCTION_COMMAND" ]]',
]) {
  assert.ok(workflow.includes(check), `Dinamik güvenlik kontrolü eksik: ${check}`);
}

assert.ok(!workflow.includes("github.event.comment.user.login == github.repository_owner"));
assert.ok(!workflow.includes('"TESTONAYLIYORUM"'));
assert.ok(!workflow.includes('"ONAYLIYORUM"'));

assert.equal(normalizeCommand(current.approval.production_command), "ONAYLIYORUM");
assert.equal(normalizeCommand(current.approval.test_command), "TESTONAYLIYORUM");
assert.notEqual(second.approval.production_command, current.approval.production_command);
assert.notEqual(second.approval.test_command, current.approval.test_command);
assert.equal(normalizeCommand(second.approval.production_command), "YAYINAHAZIR");
assert.equal(normalizeCommand(second.approval.test_command), "TESTYAYINAHAZIR");

console.log("youtube_publication_approval_portability_ok ai_calls=0 api_calls=0 video_calls=0");

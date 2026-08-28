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

// Publication approval label migration Faz 1 — dual-write + read-both.
// Legacy labels are NOT removed from production in this package; only the generic
// twin is added alongside them.

// Pending check must accept legacy OR generic (covers scenarios A, B, C: legacy-only,
// generic-only, or both present on the Issue).
assert.ok(
  workflow.includes(
    'any(.name == "eren-yayin-onayi-bekliyor" or .name == "publication-approval-pending")',
  ),
  "pending kontrolü legacy VEYA generic'i kabul etmiyor",
);

// Already-approved idempotency check must accept legacy OR generic (scenario D).
assert.ok(
  workflow.includes(
    'any(.name == "eren-yayin-onayli" or .name == "publication-approved")',
  ),
  "onaylanmış kontrolü legacy VEYA generic'i kabul etmiyor",
);

// Approval must still create/add the legacy label (legacy production is NOT stopped
// in this package) and must now also create/add the generic label, in the same
// approval block.
for (const contract of [
  'gh label create "eren-yayin-onayli"',
  'gh label create "publication-approved"',
  '--add-label "eren-yayin-onayli"',
  '--add-label "publication-approved"',
]) {
  assert.ok(workflow.includes(contract), `Onay bloğunda eksik: ${contract}`);
}

// Both pending labels must be cleared on approval (dual-remove), not just the legacy one.
for (const contract of [
  '--remove-label "eren-yayin-onayi-bekliyor"',
  '--remove-label "publication-approval-pending"',
]) {
  assert.ok(workflow.includes(contract), `Pending temizleme eksik: ${contract}`);
}

// Scope guard: the next-phase main approval chain labels must not be touched by this
// package.
for (const outOfScope of [
  '"owner-approved"',
  '"owner-approval-pending"',
  'gh label create "eren-onayli"',
  'gh label create "eren-onayi-bekliyor"',
]) {
  assert.ok(!workflow.includes(outOfScope), `Kapsam dışı label bu pakette değişmiş: ${outOfScope}`);
}

console.log("youtube_publication_approval_portability_ok ai_calls=0 api_calls=0 video_calls=0");

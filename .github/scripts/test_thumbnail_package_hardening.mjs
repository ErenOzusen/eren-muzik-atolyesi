#!/usr/bin/env node
/**
 * Section 2/3 — thumbnail-package-agent.yml hardening: shared persistence
 * (MUTATE -> REFETCH -> VERIFY -> SUCCESS), legacy+generic dual-write for
 * the package's own identity/ready labels, dual-read of the upstream
 * subtitle-package identity label, the approval-pending torn-state fix,
 * and no duplicate inline implementation left in the workflow.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
const stripComments = (text) =>
  text.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");

const workflow = stripComments(read(".github/workflows/thumbnail-package-agent.yml"));
const persistScript = stripComments(read(".github/scripts/persist_thumbnail_package_labels.sh"));

const mustFind = (text, needle, message = needle, fromIndex = 0) => {
  const index = text.indexOf(needle, fromIndex);
  assert.ok(index >= 0, `missing executable contract: ${message}`);
  return index;
};
const countOccurrences = (text, needle) => text.split(needle).length - 1;

for (const forbiddenInWorkflow of [
  'gh label create "thumbnail-paketi"',
  'gh label create "thumbnail-package"',
  '--add-label "thumbnail-paketi"',
  '--label "thumbnail-paketi"',
]) {
  assert.ok(!workflow.includes(forbiddenInWorkflow), `workflow must not duplicate shared persistence logic inline: ${forbiddenInWorkflow}`);
}
assert.equal(
  countOccurrences(workflow, "bash .github/scripts/persist_thumbnail_package_labels.sh"),
  1,
  "the shared persistence script must be invoked from exactly one call site"
);

assert.match(workflow, /any\(\.name == "altyazi-paketi" or \.name == "subtitle-package"\)/, "must dual-read subtitle package identity");

for (const label of ["thumbnail-paketi", "thumbnail-paketi-hazir", "thumbnail-package", "thumbnail-package-ready"]) {
  assert.equal(countOccurrences(persistScript, `gh label create "${label}"`), 1, `shared script must create ${label} exactly once`);
}
assert.ok(!persistScript.includes('--remove-label "thumbnail-paketi"'));
assert.ok(!persistScript.includes('--remove-label "thumbnail-paketi-hazir"'));

mustFind(
  persistScript,
  'ISSUE_LABELS=("thumbnail-paketi" "thumbnail-package" "eren-onayi-bekliyor" "owner-approval-pending")',
  "real-mode label set includes BOTH pending labels together"
);
assert.ok(
  !persistScript.includes('gh issue edit "$THUMBNAIL_NUMBER" --add-label "owner-approval-pending"'),
  "must not add the generic pending label via a separate follow-up call (torn-state risk)"
);

const createOrEditIdx = mustFind(persistScript, "if [[ -n \"$EXISTING_NUMBER\" ]]; then", "create-or-edit branch");
const refetchIdx = mustFind(persistScript, "/tmp/thumbnail-labels-after.txt", "thumbnail refetch", createOrEditIdx);
const verifyLoopIdx = mustFind(persistScript, 'for REQUIRED_PRESENT in "${ISSUE_LABELS[@]}"; do', "identity verify loop", refetchIdx);
const verifyLoopEnd = mustFind(persistScript, "done", "verify loop end", verifyLoopIdx);
assert.match(persistScript.slice(verifyLoopIdx, verifyLoopEnd), /exit 1/);

const subtitleMutateIdx = mustFind(persistScript, 'if [[ "$TEST_MODE" == "false" && -n "$SUBTITLE_NUMBER" ]]; then', "subtitle ready-state mutation gate", verifyLoopEnd);
const subtitleRefetchIdx = mustFind(persistScript, "/tmp/subtitle-ready-labels-after.txt", "subtitle refetch", subtitleMutateIdx);
const subtitleVerifyIdx = mustFind(persistScript, "for REQUIRED_PRESENT in thumbnail-paketi-hazir thumbnail-package-ready; do", "subtitle verify loop", subtitleRefetchIdx);
const subtitleVerifyEnd = mustFind(persistScript, "done", "subtitle verify loop end", subtitleVerifyIdx);
assert.match(persistScript.slice(subtitleVerifyIdx, subtitleVerifyEnd), /exit 1/);

const urlLookupIdx = mustFind(
  persistScript,
  'THUMBNAIL_URL=$(gh issue view "$THUMBNAIL_NUMBER" --json url --jq \'.url\')',
  "thumbnail URL lookup",
  verifyLoopEnd
);
const successExportIdx = mustFind(persistScript, "THUMBNAIL_URL=$THUMBNAIL_URL", "success export", subtitleVerifyEnd);
assert.ok(
  createOrEditIdx < refetchIdx &&
    refetchIdx < verifyLoopIdx &&
    verifyLoopIdx < urlLookupIdx &&
    urlLookupIdx < subtitleMutateIdx &&
    subtitleMutateIdx < subtitleRefetchIdx &&
    subtitleRefetchIdx < subtitleVerifyIdx &&
    subtitleVerifyIdx < successExportIdx,
  "must follow MUTATE -> REFETCH -> VERIFY -> MUTATE -> REFETCH -> VERIFY -> SUCCESS, in that exact order"
);

const persistStepIdx = mustFind(workflow, "- name: Thumbnail paketi etiketlerini kalıcı hale getir", "persistence step");
const commentStepIdx = mustFind(workflow, "- name: Thumbnail hazırlık paketi yorumunu ve özetini yaz", "comment/summary step", persistStepIdx);
assert.ok(persistStepIdx < commentStepIdx);

for (const [guardCondition, closingFi, message] of [
  ['if [[ "$NORMALIZED_RUN_ACTOR" != "$NORMALIZED_CONFIG_OWNER" ]]; then', "\n          fi", "actor authorization guard"],
  ['if [[ "$TEST_MODE" != "true" && "$TEST_MODE" != "false" ]]; then', "\n          fi", "test_mode strict validation guard"],
  ['if ! jq -e \'.labels | any(.name == "altyazi-paketi" or .name == "subtitle-package")\' \\', "\n          fi", "subtitle-package dual-read source guard"],
  ['if ! jq -e \'.labels | any(.name == "eren-onayli" or .name == "owner-approved")\' \\', "\n          fi", "owner-approval required-label guard"],
]) {
  const guardIdx = mustFind(workflow, guardCondition, message);
  const guardEndIdx = mustFind(workflow, closingFi, `${message} end`, guardIdx);
  assert.match(workflow.slice(guardIdx, guardEndIdx), /exit 1/, `${message} must fail closed`);
}

const persistStepConditionIdx = mustFind(workflow, "- name: Thumbnail paketi etiketlerini kalıcı hale getir", "persistence step (condition check)");
const persistStepConditionLineEnd = workflow.indexOf("\n", workflow.indexOf("if:", persistStepConditionIdx));
assert.equal(
  workflow.slice(workflow.indexOf("if:", persistStepConditionIdx), persistStepConditionLineEnd).trim(),
  "if: env.SKIP_THUMBNAIL != 'true'",
  "persistence step must be gated on exactly env.SKIP_THUMBNAIL != 'true', never bypassed"
);

const aiStepIdx = mustFind(workflow, "- name: Thumbnail hazırlık paketini üret ve doğrula", "generation-calling step");
const aiStepConditionLineEnd = workflow.indexOf("\n", workflow.indexOf("if:", aiStepIdx));
assert.equal(
  workflow.slice(workflow.indexOf("if:", aiStepIdx), aiStepConditionLineEnd).trim(),
  "if: env.SKIP_THUMBNAIL != 'true'",
  "generation step must remain gated on exactly env.SKIP_THUMBNAIL != 'true'"
);

const persistenceStepEndIdx = mustFind(workflow, "\n      - name:", "persistence step end", persistStepIdx + 1);
const persistenceStepBlock = workflow.slice(persistStepIdx, persistenceStepEndIdx);
for (const forbidden of ["gh api", "curl ", "/dispatches", "repository_dispatch", "ANTHROPIC_API_KEY", "youtube.googleapis.com"]) {
  assert.ok(!persistenceStepBlock.includes(forbidden), `persistence step gained forbidden capability: ${forbidden}`);
  assert.ok(!persistScript.includes(forbidden), `shared script gained forbidden capability: ${forbidden}`);
}

console.log("thumbnail_package_hardening_ok ai_calls=0 api_calls=0 image_calls=0 issue_writes=0 dispatches=0 video_calls=0");

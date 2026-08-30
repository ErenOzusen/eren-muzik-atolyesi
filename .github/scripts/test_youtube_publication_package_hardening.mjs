#!/usr/bin/env node
/**
 * Section 2/3 — youtube-publication-package-agent.yml hardening: shared
 * persistence (MUTATE -> REFETCH -> VERIFY -> SUCCESS), legacy+generic
 * dual-write for the package's own identity/ready labels, dual-read of the
 * upstream thumbnail-package identity label, the approval-pending
 * torn-state fix, and — specific to this workflow — an explicit proof that
 * the shared script and persistence step never gain any YouTube
 * upload/publish/video-provider capability.
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

const workflow = stripComments(read(".github/workflows/youtube-publication-package-agent.yml"));
const persistScript = stripComments(read(".github/scripts/persist_youtube_publication_package_labels.sh"));

const mustFind = (text, needle, message = needle, fromIndex = 0) => {
  const index = text.indexOf(needle, fromIndex);
  assert.ok(index >= 0, `missing executable contract: ${message}`);
  return index;
};
const countOccurrences = (text, needle) => text.split(needle).length - 1;

for (const forbiddenInWorkflow of [
  'gh label create "youtube-yayin-paketi"',
  'gh label create "youtube-publication-package"',
  '--add-label "youtube-yayin-paketi"',
  '--label "youtube-yayin-paketi"',
]) {
  assert.ok(!workflow.includes(forbiddenInWorkflow), `workflow must not duplicate shared persistence logic inline: ${forbiddenInWorkflow}`);
}
assert.equal(
  countOccurrences(workflow, "bash .github/scripts/persist_youtube_publication_package_labels.sh"),
  1,
  "the shared persistence script must be invoked from exactly one call site"
);

assert.match(workflow, /any\(\.name == "thumbnail-paketi" or \.name == "thumbnail-package"\)/, "must dual-read thumbnail package identity");

for (const label of ["youtube-yayin-paketi", "youtube-yayin-paketi-hazir", "youtube-publication-package", "youtube-publication-package-ready"]) {
  assert.equal(countOccurrences(persistScript, `gh label create "${label}"`), 1, `shared script must create ${label} exactly once`);
}
assert.ok(!persistScript.includes('--remove-label "youtube-yayin-paketi"'));
assert.ok(!persistScript.includes('--remove-label "youtube-yayin-paketi-hazir"'));

mustFind(
  persistScript,
  'ISSUE_LABELS=("youtube-yayin-paketi" "youtube-publication-package" "eren-yayin-onayi-bekliyor" "publication-approval-pending")',
  "real-mode label set includes BOTH pending labels together"
);
assert.ok(
  !persistScript.includes('gh issue edit "$YOUTUBE_NUMBER" --add-label "publication-approval-pending"'),
  "must not add the generic pending label via a separate follow-up call (torn-state risk)"
);

const createOrEditIdx = mustFind(persistScript, "if [[ -n \"$EXISTING_NUMBER\" ]]; then", "create-or-edit branch");
const refetchIdx = mustFind(persistScript, "/tmp/youtube-labels-after.txt", "youtube refetch", createOrEditIdx);
const verifyLoopIdx = mustFind(persistScript, 'for REQUIRED_PRESENT in "${ISSUE_LABELS[@]}"; do', "identity verify loop", refetchIdx);
const verifyLoopEnd = mustFind(persistScript, "done", "verify loop end", verifyLoopIdx);
assert.match(persistScript.slice(verifyLoopIdx, verifyLoopEnd), /exit 1/);

const thumbnailMutateIdx = mustFind(persistScript, 'if [[ "$TEST_MODE" == "false" && -n "$THUMBNAIL_NUMBER" ]]; then', "thumbnail ready-state mutation gate", verifyLoopEnd);
const thumbnailRefetchIdx = mustFind(persistScript, "/tmp/thumbnail-ready-labels-after.txt", "thumbnail refetch", thumbnailMutateIdx);
const thumbnailVerifyIdx = mustFind(persistScript, "for REQUIRED_PRESENT in youtube-yayin-paketi-hazir youtube-publication-package-ready; do", "thumbnail verify loop", thumbnailRefetchIdx);
const thumbnailVerifyEnd = mustFind(persistScript, "done", "thumbnail verify loop end", thumbnailVerifyIdx);
assert.match(persistScript.slice(thumbnailVerifyIdx, thumbnailVerifyEnd), /exit 1/);

const urlLookupIdx = mustFind(
  persistScript,
  'YOUTUBE_URL=$(gh issue view "$YOUTUBE_NUMBER" --json url --jq \'.url\')',
  "youtube URL lookup",
  verifyLoopEnd
);
const successExportIdx = mustFind(persistScript, "YOUTUBE_URL=$YOUTUBE_URL", "success export", thumbnailVerifyEnd);
assert.ok(
  createOrEditIdx < refetchIdx &&
    refetchIdx < verifyLoopIdx &&
    verifyLoopIdx < urlLookupIdx &&
    urlLookupIdx < thumbnailMutateIdx &&
    thumbnailMutateIdx < thumbnailRefetchIdx &&
    thumbnailRefetchIdx < thumbnailVerifyIdx &&
    thumbnailVerifyIdx < successExportIdx,
  "must follow MUTATE -> REFETCH -> VERIFY -> MUTATE -> REFETCH -> VERIFY -> SUCCESS, in that exact order"
);

const persistStepIdx = mustFind(workflow, "- name: YouTube yayın paketi etiketlerini kalıcı hale getir", "persistence step");
const commentStepIdx = mustFind(workflow, "- name: YouTube yayın paketi yorumunu ve özetini yaz", "comment/summary step", persistStepIdx);
assert.ok(persistStepIdx < commentStepIdx);

for (const [guardCondition, closingFi, message] of [
  ['if [[ "$NORMALIZED_RUN_ACTOR" != "$NORMALIZED_CONFIG_OWNER" ]]; then', "\n          fi", "actor authorization guard"],
  ['if [[ "$TEST_MODE" != "true" && "$TEST_MODE" != "false" ]]; then', "\n          fi", "test_mode strict validation guard"],
  ['if ! jq -e \'.labels | any(.name == "thumbnail-paketi" or .name == "thumbnail-package")\' \\', "\n          fi", "thumbnail-package dual-read source guard"],
  ['if ! jq -e \'.labels | any(.name == "eren-onayli" or .name == "owner-approved")\' \\', "\n          fi", "owner-approval required-label guard"],
]) {
  const guardIdx = mustFind(workflow, guardCondition, message);
  const guardEndIdx = mustFind(workflow, closingFi, `${message} end`, guardIdx);
  assert.match(workflow.slice(guardIdx, guardEndIdx), /exit 1/, `${message} must fail closed`);
}

const persistStepConditionIdx = mustFind(workflow, "- name: YouTube yayın paketi etiketlerini kalıcı hale getir", "persistence step (condition check)");
const persistStepConditionLineEnd = workflow.indexOf("\n", workflow.indexOf("if:", persistStepConditionIdx));
assert.equal(
  workflow.slice(workflow.indexOf("if:", persistStepConditionIdx), persistStepConditionLineEnd).trim(),
  "if: env.SKIP_YOUTUBE != 'true'",
  "persistence step must be gated on exactly env.SKIP_YOUTUBE != 'true', never bypassed"
);

const aiStepIdx = mustFind(workflow, "- name: YouTube yayın paketini üret ve doğrula", "generation-calling step");
const aiStepConditionLineEnd = workflow.indexOf("\n", workflow.indexOf("if:", aiStepIdx));
assert.equal(
  workflow.slice(workflow.indexOf("if:", aiStepIdx), aiStepConditionLineEnd).trim(),
  "if: env.SKIP_YOUTUBE != 'true'",
  "generation step must remain gated on exactly env.SKIP_YOUTUBE != 'true'"
);

// This workflow's whole purpose is preparing metadata WITHOUT ever
// uploading or publishing — prove that stays true for the persistence
// layer specifically (the step/script this hardening pass touched).
const persistenceStepEndIdx = mustFind(workflow, "\n      - name:", "persistence step end", persistStepIdx + 1);
const persistenceStepBlock = workflow.slice(persistStepIdx, persistenceStepEndIdx);
for (const forbidden of [
  "gh api",
  "curl ",
  "/dispatches",
  "repository_dispatch",
  "ANTHROPIC_API_KEY",
  "youtube.googleapis.com",
  "googleapis.com/upload",
  "video_orchestrator.py",
]) {
  assert.ok(!persistenceStepBlock.includes(forbidden), `persistence step gained forbidden capability: ${forbidden}`);
  assert.ok(!persistScript.includes(forbidden), `shared script gained forbidden capability: ${forbidden}`);
}

console.log("youtube_publication_package_hardening_ok ai_calls=0 api_calls=0 issue_writes=0 dispatches=0 video_calls=0 youtube_calls=0 uploads=0 publications=0");

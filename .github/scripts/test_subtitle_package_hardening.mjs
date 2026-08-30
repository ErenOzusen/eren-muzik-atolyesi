#!/usr/bin/env node
/**
 * Section 2/3 — subtitle-package-agent.yml hardening: shared persistence
 * (MUTATE -> REFETCH -> VERIFY -> SUCCESS), legacy+generic dual-write for
 * the package's own identity/ready labels, dual-read of the upstream
 * editing-package labels, the approval-pending torn-state fix (both
 * pending labels added in the SAME mutation, not a separate follow-up
 * call), and no duplicate inline implementation left in the workflow.
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

const workflow = stripComments(read(".github/workflows/subtitle-package-agent.yml"));
const persistScript = stripComments(read(".github/scripts/persist_subtitle_package_labels.sh"));

const mustFind = (text, needle, message = needle, fromIndex = 0) => {
  const index = text.indexOf(needle, fromIndex);
  assert.ok(index >= 0, `missing executable contract: ${message}`);
  return index;
};
const countOccurrences = (text, needle) => text.split(needle).length - 1;

// 1. No duplicate inline implementation, exactly one shared-script call.
for (const forbiddenInWorkflow of [
  'gh label create "altyazi-paketi"',
  'gh label create "subtitle-package"',
  '--add-label "altyazi-paketi"',
  '--label "altyazi-paketi"',
]) {
  assert.ok(!workflow.includes(forbiddenInWorkflow), `workflow must not duplicate shared persistence logic inline: ${forbiddenInWorkflow}`);
}
assert.equal(
  countOccurrences(workflow, "bash .github/scripts/persist_subtitle_package_labels.sh"),
  1,
  "the shared persistence script must be invoked from exactly one call site"
);

// 2. Dual-read of the upstream editing-package identity/ready labels.
assert.match(workflow, /any\(\.name == "kurgu-paketi" or \.name == "editing-package"\)/, "must dual-read editing package identity");
assert.match(workflow, /any\(\.name == "kurgu-plani-hazir" or \.name == "editing-package-ready"\)/, "must dual-read editing package ready-state");

// 3. Shared script: legacy + generic dual-write for identity/ready labels.
for (const label of ["altyazi-paketi", "altyazi-paketi-hazir", "subtitle-package", "subtitle-package-ready"]) {
  assert.equal(countOccurrences(persistScript, `gh label create "${label}"`), 1, `shared script must create ${label} exactly once`);
}
assert.ok(!persistScript.includes('--remove-label "altyazi-paketi"'));
assert.ok(!persistScript.includes('--remove-label "altyazi-paketi-hazir"'));

// 4. Approval-pending torn-state fix: both pending labels added in ONE
// mutation call (the ISSUE_LABELS array used for create/edit), not a
// separate follow-up gh issue edit call.
const realModeLabelSetIdx = mustFind(
  persistScript,
  'ISSUE_LABELS=("altyazi-paketi" "subtitle-package" "eren-onayi-bekliyor" "owner-approval-pending")',
  "real-mode label set includes BOTH pending labels together"
);
assert.ok(realModeLabelSetIdx >= 0);
// The old torn-state pattern (a second, separate mutation call adding only
// the generic pending label after the fact) must be gone.
assert.ok(
  !persistScript.includes('gh issue edit "$SUBTITLE_NUMBER" --add-label "owner-approval-pending"'),
  "must not add the generic pending label via a separate follow-up call (torn-state risk)"
);

// 5. MUTATE -> REFETCH -> VERIFY -> SUCCESS ordering.
const createOrEditIdx = mustFind(persistScript, "if [[ -n \"$EXISTING_NUMBER\" ]]; then", "create-or-edit branch");
const refetchIdx = mustFind(persistScript, "/tmp/subtitle-labels-after.txt", "subtitle refetch", createOrEditIdx);
const verifyLoopIdx = mustFind(persistScript, 'for REQUIRED_PRESENT in "${ISSUE_LABELS[@]}"; do', "identity verify loop", refetchIdx);
const verifyLoopEnd = mustFind(persistScript, "done", "verify loop end", verifyLoopIdx);
assert.match(persistScript.slice(verifyLoopIdx, verifyLoopEnd), /exit 1/);

const editingMutateIdx = mustFind(persistScript, 'if [[ "$TEST_MODE" == "false" && -n "$EDITING_NUMBER" ]]; then', "editing ready-state mutation gate", verifyLoopEnd);
const editingRefetchIdx = mustFind(persistScript, "/tmp/editing-ready-labels-after.txt", "editing refetch", editingMutateIdx);
const editingVerifyIdx = mustFind(persistScript, "for REQUIRED_PRESENT in altyazi-paketi-hazir subtitle-package-ready; do", "editing verify loop", editingRefetchIdx);
const editingVerifyEnd = mustFind(persistScript, "done", "editing verify loop end", editingVerifyIdx);
assert.match(persistScript.slice(editingVerifyIdx, editingVerifyEnd), /exit 1/);

const urlLookupIdx = mustFind(
  persistScript,
  'SUBTITLE_URL=$(gh issue view "$SUBTITLE_NUMBER" --json url --jq \'.url\')',
  "subtitle URL lookup",
  verifyLoopEnd
);
const successExportIdx = mustFind(persistScript, "SUBTITLE_URL=$SUBTITLE_URL", "success export", editingVerifyEnd);
assert.ok(
  createOrEditIdx < refetchIdx &&
    refetchIdx < verifyLoopIdx &&
    verifyLoopIdx < urlLookupIdx &&
    urlLookupIdx < editingMutateIdx &&
    editingMutateIdx < editingRefetchIdx &&
    editingRefetchIdx < editingVerifyIdx &&
    editingVerifyIdx < successExportIdx,
  "must follow MUTATE -> REFETCH -> VERIFY -> MUTATE -> REFETCH -> VERIFY -> SUCCESS, in that exact order"
);

// 6. Comment/summary step runs AFTER the persistence step.
const persistStepIdx = mustFind(workflow, "- name: Altyazı paketi etiketlerini kalıcı hale getir", "persistence step");
const commentStepIdx = mustFind(workflow, "- name: Altyazı hazırlık paketi yorumunu ve özetini yaz", "comment/summary step", persistStepIdx);
assert.ok(persistStepIdx < commentStepIdx);

// 7. Pre-existing guards untouched — each checked as an executable
// if/exit pair (indentation-specific closing "fi"), not a bare substring.
for (const [guardCondition, closingFi, message] of [
  ['if [[ "$NORMALIZED_RUN_ACTOR" != "$NORMALIZED_CONFIG_OWNER" ]]; then', "\n          fi", "actor authorization guard"],
  ['if [[ "$TEST_MODE" != "true" && "$TEST_MODE" != "false" ]]; then', "\n          fi", "test_mode strict validation guard"],
  ['if ! jq -e \'.labels | any(.name == "kurgu-paketi" or .name == "editing-package")\' \\', "\n          fi", "editing-package dual-read source guard"],
  ['if ! jq -e \'.labels | any(.name == "eren-onayli" or .name == "owner-approved")\' \\', "\n          fi", "owner-approval required-label guard"],
]) {
  const guardIdx = mustFind(workflow, guardCondition, message);
  const guardEndIdx = mustFind(workflow, closingFi, `${message} end`, guardIdx);
  assert.match(workflow.slice(guardIdx, guardEndIdx), /exit 1/, `${message} must fail closed`);
}
assert.ok(workflow.includes('"TEST Kurgu Paketi - Çekim Paketi #"'), "test-mode title-family contract missing");

// 7b. Persistence step and AI-calling step must both remain gated on
// exactly the original condition — not bypassed, not opened to test_mode.
const persistStepConditionIdx = mustFind(workflow, "- name: Altyazı paketi etiketlerini kalıcı hale getir", "persistence step (condition check)");
const persistStepConditionLineEnd = workflow.indexOf("\n", workflow.indexOf("if:", persistStepConditionIdx));
assert.equal(
  workflow.slice(workflow.indexOf("if:", persistStepConditionIdx), persistStepConditionLineEnd).trim(),
  "if: env.SKIP_SUBTITLE != 'true'",
  "persistence step must be gated on exactly env.SKIP_SUBTITLE != 'true', never bypassed"
);

const aiStepIdx = mustFind(workflow, "- name: Altyazı hazırlık paketini üret ve doğrula", "AI/generation-calling step");
const aiStepConditionLineEnd = workflow.indexOf("\n", workflow.indexOf("if:", aiStepIdx));
assert.equal(
  workflow.slice(workflow.indexOf("if:", aiStepIdx), aiStepConditionLineEnd).trim(),
  "if: env.SKIP_SUBTITLE != 'true'",
  "generation step must remain gated on exactly env.SKIP_SUBTITLE != 'true'"
);

// 8. Forbidden capability scan.
const persistenceStepEndIdx = mustFind(workflow, "\n      - name:", "persistence step end", persistStepIdx + 1);
const persistenceStepBlock = workflow.slice(persistStepIdx, persistenceStepEndIdx);
for (const forbidden of ["gh api", "curl ", "/dispatches", "repository_dispatch", "ANTHROPIC_API_KEY", "youtube.googleapis.com"]) {
  assert.ok(!persistenceStepBlock.includes(forbidden), `persistence step gained forbidden capability: ${forbidden}`);
  assert.ok(!persistScript.includes(forbidden), `shared script gained forbidden capability: ${forbidden}`);
}

console.log("subtitle_package_hardening_ok ai_calls=0 api_calls=0 issue_writes=0 dispatches=0 video_calls=0");

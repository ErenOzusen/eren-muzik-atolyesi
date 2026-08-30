#!/usr/bin/env node
/**
 * Section 2/3 — editing-package-agent.yml hardening: shared persistence
 * (MUTATE -> REFETCH -> VERIFY -> SUCCESS), legacy+generic dual-write for
 * the package's own identity/ready labels, and no duplicate inline
 * implementation left in the workflow.
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

const workflow = stripComments(read(".github/workflows/editing-package-agent.yml"));
const persistScript = stripComments(read(".github/scripts/persist_editing_package_labels.sh"));

const mustFind = (text, needle, message = needle, fromIndex = 0) => {
  const index = text.indexOf(needle, fromIndex);
  assert.ok(index >= 0, `missing executable contract: ${message}`);
  return index;
};
const countOccurrences = (text, needle) => text.split(needle).length - 1;

// ---------------------------------------------------------------------
// 1. No duplicate inline implementation: raw mutation verbs must exist
// ONLY in the shared script, and it must be invoked exactly once.
// ---------------------------------------------------------------------
for (const forbiddenInWorkflow of [
  'gh label create "kurgu-paketi"',
  'gh label create "editing-package"',
  '--add-label "kurgu-paketi"',
  '--label "kurgu-paketi"',
]) {
  assert.ok(!workflow.includes(forbiddenInWorkflow), `workflow must not duplicate shared persistence logic inline: ${forbiddenInWorkflow}`);
}
assert.equal(
  countOccurrences(workflow, "bash .github/scripts/persist_editing_package_labels.sh"),
  1,
  "the shared persistence script must be invoked from exactly one call site"
);

// ---------------------------------------------------------------------
// 2. Shared script: legacy + generic dual-write for identity and ready
// labels, both in the SAME mutation call.
// ---------------------------------------------------------------------
for (const label of ["kurgu-paketi", "kurgu-plani-hazir", "editing-package", "editing-package-ready"]) {
  assert.equal(
    countOccurrences(persistScript, `gh label create "${label}"`),
    1,
    `shared script must create ${label} exactly once`
  );
}
assert.ok(!persistScript.includes('--remove-label "kurgu-paketi"'), "must never remove the legacy identity label");
assert.ok(!persistScript.includes('--remove-label "kurgu-plani-hazir"'), "must never remove the legacy ready label");

const realModeBranchIdx = mustFind(persistScript, 'ISSUE_LABELS=("kurgu-paketi" "editing-package" "kurgu-plani-hazir" "editing-package-ready")', "real-mode dual identity+ready label set");
const testModeBranchIdx = mustFind(persistScript, 'ISSUE_LABELS=("kurgu-paketi" "editing-package" "sistem-testi")', "test-mode dual identity label set");
assert.ok(testModeBranchIdx < realModeBranchIdx, "test-mode branch must be evaluated before real-mode branch (if/else order)");

// ---------------------------------------------------------------------
// 3. MUTATE -> REFETCH -> VERIFY -> SUCCESS ordering.
// ---------------------------------------------------------------------
const createOrEditIdx = mustFind(persistScript, "if [[ -n \"$EXISTING_NUMBER\" ]]; then", "create-or-edit branch");
const refetchIdx = mustFind(persistScript, "/tmp/editing-labels-after.txt", "editing package refetch", createOrEditIdx);
const verifyLoopIdx = mustFind(persistScript, 'for REQUIRED_PRESENT in "${ISSUE_LABELS[@]}"; do', "identity verify loop", refetchIdx);
const verifyLoopEnd = mustFind(persistScript, "done", "verify loop end", verifyLoopIdx);
assert.match(persistScript.slice(verifyLoopIdx, verifyLoopEnd), /exit 1/, "identity verification must fail closed");

const intakeMutateIdx = mustFind(persistScript, 'if [[ "$TEST_MODE" == "false" && -n "$INTAKE_NUMBER" ]]; then', "intake ready-state mutation gate", verifyLoopEnd);
const intakeRefetchIdx = mustFind(persistScript, "/tmp/intake-labels-after.txt", "intake refetch", intakeMutateIdx);
const intakeVerifyIdx = mustFind(persistScript, "for REQUIRED_PRESENT in kurgu-plani-hazir editing-package-ready; do", "intake verify loop", intakeRefetchIdx);
const intakeVerifyEnd = mustFind(persistScript, "done", "intake verify loop end", intakeVerifyIdx);
assert.match(persistScript.slice(intakeVerifyIdx, intakeVerifyEnd), /exit 1/, "intake ready-state verification must fail closed");

// The EDITING_URL lookup itself must happen AFTER identity verification —
// not just the final GITHUB_ENV export block. Moving this line earlier
// (e.g. right after create/edit, before the identity verify loop) would
// let a caller observe/act on a URL whose labels were never confirmed.
const urlLookupIdx = mustFind(
  persistScript,
  'EDITING_URL=$(gh issue view "$EDITING_NUMBER" --json url --jq \'.url\')',
  "editing URL lookup",
  verifyLoopEnd
);
const successExportIdx = mustFind(persistScript, "EDITING_URL=$EDITING_URL", "success export", intakeVerifyEnd);
assert.ok(
  createOrEditIdx < refetchIdx &&
    refetchIdx < verifyLoopIdx &&
    verifyLoopIdx < urlLookupIdx &&
    urlLookupIdx < intakeMutateIdx &&
    intakeMutateIdx < intakeRefetchIdx &&
    intakeRefetchIdx < intakeVerifyIdx &&
    intakeVerifyIdx < successExportIdx,
  "must follow MUTATE -> REFETCH -> VERIFY (identity) -> URL lookup -> MUTATE -> REFETCH -> VERIFY (ready) -> SUCCESS, in that exact order"
);

// ---------------------------------------------------------------------
// 4. Comment/summary step in the workflow runs AFTER the persistence step.
// ---------------------------------------------------------------------
const persistStepIdx = mustFind(workflow, "- name: Kurgu paketi etiketlerini kalıcı hale getir", "persistence step");
const commentStepIdx = mustFind(workflow, "- name: Kurgu paketi hazırlandı yorumunu ve özetini yaz", "comment/summary step", persistStepIdx);
assert.ok(persistStepIdx < commentStepIdx, "comment/summary step must come after the persistence step");

// ---------------------------------------------------------------------
// 5. Pre-existing safety guards untouched: actor auth, test_mode strict
// validation, source/title/state/label checks, stale/ambiguous rejection.
// Each is checked as an executable if/exit pair, not a bare substring —
// a mutation that deletes the guard's body but leaves an unrelated
// variable-name mention elsewhere in the file must still be caught.
// ---------------------------------------------------------------------
// Each closing "fi" is located via its exact indentation level (not a bare
// "fi" substring search, which can false-match inside words like
// "profilinde") — same disambiguation technique used elsewhere in this
// project's workflow tests.
for (const [guardCondition, closingFi, message] of [
  ['if [[ "$NORMALIZED_RUN_ACTOR" != "$NORMALIZED_CONFIG_OWNER" ]]; then', "\n          fi", "actor authorization guard"],
  ['if [[ "$TEST_MODE" != "true" && "$TEST_MODE" != "false" ]]; then', "\n          fi", "test_mode strict validation guard"],
  ['if ! jq -e \'.labels | any(.name == "ham-video-teslim")\' \\', "\n            fi", "ham-video-teslim source label guard"],
  ['if ! jq -e \'.labels | any(.name == "kurgu-bekliyor")\' \\', "\n            fi", "kurgu-bekliyor state guard"],
  ['if ! jq -e \'.labels | any(.name == "eren-onayli" or .name == "owner-approved")\' \\', "\n          fi", "owner-approval required-label guard"],
]) {
  const guardIdx = mustFind(workflow, guardCondition, message);
  const guardEndIdx = mustFind(workflow, closingFi, `${message} end`, guardIdx);
  assert.match(workflow.slice(guardIdx, guardEndIdx), /exit 1/, `${message} must fail closed`);
}

for (const contract of ['"Çekim Paketi - Nihai Senaryolar #"', '"Ham Video Teslimi - Çekim Paketi #"']) {
  assert.ok(workflow.includes(contract), `pre-existing title-family contract missing: ${contract}`);
}

// ---------------------------------------------------------------------
// 5b. The persistence step and the AI-calling step must both still be
// gated on the exact original condition — not bypassed (if: false-style
// disabling) and not opened up to run in test_mode.
// ---------------------------------------------------------------------
const persistStepConditionIdx = mustFind(workflow, "- name: Kurgu paketi etiketlerini kalıcı hale getir", "persistence step (condition check)");
const persistStepConditionLineEnd = workflow.indexOf("\n", workflow.indexOf("if:", persistStepConditionIdx));
assert.equal(
  workflow.slice(workflow.indexOf("if:", persistStepConditionIdx), persistStepConditionLineEnd).trim(),
  "if: env.SKIP_EDITING != 'true'",
  "persistence step must be gated on exactly env.SKIP_EDITING != 'true', never bypassed"
);

// The AI-calling step now additionally requires TEST_MODE != 'true' (a
// dedicated, mutation-tested test-mode isolation fix — see
// test_editing_package_test_mode_isolation.mjs — closed a real gap where
// SKIP_EDITING alone did not make the AI step unreachable on a first
// test_mode=true run). This is a strictly TIGHTER condition than before,
// not a bypass or widening, so this check is updated to match rather than
// weakened.
const aiStepIdx = mustFind(workflow, "- name: Kurgu paketini oluştur ve doğrula", "AI-calling step");
const aiStepConditionLineEnd = workflow.indexOf("\n", workflow.indexOf("if:", aiStepIdx));
assert.equal(
  workflow.slice(workflow.indexOf("if:", aiStepIdx), aiStepConditionLineEnd).trim(),
  "if: env.SKIP_EDITING != 'true' && env.TEST_MODE != 'true'",
  "AI-calling step must be gated on exactly env.SKIP_EDITING != 'true' && env.TEST_MODE != 'true' — never reachable in test_mode, and never bypassed"
);

// ---------------------------------------------------------------------
// 6. Forbidden capability scan on the shared script and the persistence
// step's own block — no AI/provider/video/dispatch capability.
// ---------------------------------------------------------------------
const persistenceStepEndIdx = mustFind(workflow, "\n      - name:", "persistence step end", persistStepIdx + 1);
const persistenceStepBlock = workflow.slice(persistStepIdx, persistenceStepEndIdx);
for (const forbidden of [
  "gh api",
  "curl ",
  "/dispatches",
  "repository_dispatch",
  "ANTHROPIC_API_KEY",
  "youtube.googleapis.com",
  "video_orchestrator.py",
]) {
  assert.ok(!persistenceStepBlock.includes(forbidden), `persistence step gained forbidden capability: ${forbidden}`);
  assert.ok(!persistScript.includes(forbidden), `shared script gained forbidden capability: ${forbidden}`);
}

console.log("editing_package_hardening_ok ai_calls=0 api_calls=0 issue_writes=0 dispatches=0 video_calls=0");

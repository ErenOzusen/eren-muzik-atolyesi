#!/usr/bin/env node
/** Deterministic zero-network checks for the filming-package live_label_validation path. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) =>
  readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
const stripComments = (text) => text
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

const writer = stripComments(read(".github/workflows/filming-package-agent-v4-router.yml"));
const persistScript = stripComments(read(".github/scripts/persist_filming_package_labels.sh"));

const mustInclude = (text, needle, message = needle) => {
  assert.ok(text.includes(needle), `missing contract: ${message}`);
};
const mustFind = (text, needle, message = needle, fromIndex = 0) => {
  const index = text.indexOf(needle, fromIndex);
  assert.ok(index >= 0, `missing executable contract: ${message}`);
  return index;
};
const countOccurrences = (text, needle) => text.split(needle).length - 1;

// ===========================================================================
// 12. No duplicated label-write implementation: the raw mutation verbs must
// exist ONLY in the shared script, never inline in the workflow.
// ===========================================================================
for (const forbiddenInWorkflow of [
  'gh label create "cekim-paketi"',
  'gh label create "cekim-paketi-hazir"',
  'gh label create "filming-package"',
  'gh label create "filming-package-ready"',
  '--add-label "cekim-paketi"',
  '--label "cekim-paketi"',
  '--add-label "cekim-paketi-hazir"',
]) {
  assert.ok(
    !writer.includes(forbiddenInWorkflow),
    `workflow must not duplicate shared persistence logic inline: ${forbiddenInWorkflow}`,
  );
}
assert.equal(
  countOccurrences(writer, "bash .github/scripts/persist_filming_package_labels.sh"),
  1,
  "the shared persistence script must be invoked from exactly one call site",
);

// ===========================================================================
// D. Shared persistence implementation itself.
// ===========================================================================
for (const label of ["cekim-paketi", "cekim-paketi-hazir", "filming-package", "filming-package-ready"]) {
  assert.equal(
    countOccurrences(persistScript, `gh label create "${label}"`),
    1,
    `shared script must create ${label} exactly once`,
  );
}
assert.ok(!persistScript.includes(`--remove-label "cekim-paketi"`), "shared script must never remove legacy labels");
assert.ok(!persistScript.includes(`--remove-label "cekim-paketi-hazir"`), "shared script must never remove legacy labels");

// 7. Identity dual-write, both branches, same mutation.
mustInclude(
  persistScript,
  'gh issue edit "$EXISTING_NUMBER"',
  "shared script must update the existing package issue when EXISTING_NUMBER is set",
);
const identityEditIdx = mustFind(persistScript, 'gh issue edit "$EXISTING_NUMBER"', "existing-issue identity edit");
const identityEditBlockEnd = mustFind(persistScript, "PACKAGE_URL=", "identity edit block end", identityEditIdx);
mustInclude(
  persistScript.slice(identityEditIdx, identityEditBlockEnd),
  '--add-label "cekim-paketi"',
  "existing-issue branch must add legacy identity label",
);
mustInclude(
  persistScript.slice(identityEditIdx, identityEditBlockEnd),
  '--add-label "filming-package"',
  "existing-issue branch must add generic identity label in the same mutation",
);
mustInclude(persistScript, '--label "cekim-paketi"', "new-issue branch must create with legacy identity label");
mustInclude(persistScript, '--label "filming-package"', "new-issue branch must create with generic identity label");

// 8. Ready-state dual-write, same mutation.
const readyEditIdx = mustFind(
  persistScript,
  'gh issue edit "$FINAL_NUMBER"',
  "root ready-state edit",
  identityEditBlockEnd,
);
const readyEditLineEnd = persistScript.indexOf("\n\n", readyEditIdx);
mustInclude(
  persistScript.slice(readyEditIdx, readyEditLineEnd),
  '--add-label "cekim-paketi-hazir"',
  "root edit must add legacy ready label",
);
mustInclude(
  persistScript.slice(readyEditIdx, readyEditLineEnd),
  '--add-label "filming-package-ready"',
  "root edit must add generic ready label in the same mutation",
);

// 9. Package labels re-fetched and verified before the root mutation begins.
const packageRefetchIdx = mustFind(
  persistScript,
  "/tmp/package-labels-after.txt",
  "package label re-fetch",
  identityEditBlockEnd,
);
const packageVerifyLoopIdx = mustFind(
  persistScript,
  "for REQUIRED_PRESENT in cekim-paketi filming-package; do",
  "package identity verification loop",
  packageRefetchIdx,
);
const packageVerifyLoopEnd = mustFind(persistScript, "done", "package verification loop end", packageVerifyLoopIdx);
mustInclude(persistScript.slice(packageVerifyLoopIdx, packageVerifyLoopEnd), "exit 1", "package verification must fail closed");
assert.ok(
  packageVerifyLoopEnd < readyEditIdx,
  "package identity must be fully verified before the root ready-state mutation begins",
);

// 10. Root labels re-fetched and verified.
const rootRefetchIdx = mustFind(persistScript, "/tmp/root-labels-after.txt", "root label re-fetch", readyEditIdx);
const rootVerifyLoopIdx = mustFind(
  persistScript,
  "for REQUIRED_PRESENT in cekim-paketi-hazir filming-package-ready; do",
  "root ready-state verification loop",
  rootRefetchIdx,
);
const rootVerifyLoopEnd = mustFind(persistScript, "done", "root verification loop end", rootVerifyLoopIdx);
mustInclude(persistScript.slice(rootVerifyLoopIdx, rootVerifyLoopEnd), "exit 1", "root verification must fail closed");
assert.ok(!persistScript.includes("|| true"), "shared script must not suppress any failure with || true");

// 11. Success signal (GITHUB_ENV write) occurs only after both verifications.
const successWriteIdx = mustFind(persistScript, "PACKAGE_URL=$PACKAGE_URL", "success output", rootVerifyLoopEnd);
assert.ok(
  packageVerifyLoopEnd < readyEditIdx &&
    readyEditIdx < rootRefetchIdx &&
    rootRefetchIdx < rootVerifyLoopIdx &&
    rootVerifyLoopIdx < rootVerifyLoopEnd &&
    rootVerifyLoopEnd < successWriteIdx,
  "shared script must: write identity, verify identity, write ready-state, verify ready-state, THEN signal success",
);

// ===========================================================================
// E. Validation-mode guards in the workflow.
// ===========================================================================

// live_label_validation input exists, boolean, default false.
mustInclude(writer, "live_label_validation:");
const inputBlockIdx = mustFind(writer, "live_label_validation:", "live_label_validation input declaration");
const inputBlockEnd = writer.indexOf("\n\n", inputBlockIdx);
mustInclude(writer.slice(inputBlockIdx, inputBlockEnd), "default: false", "live_label_validation must default to false");
mustInclude(writer.slice(inputBlockIdx, inputBlockEnd), "type: boolean", "live_label_validation must be a boolean input");
mustInclude(writer, "LIVE_LABEL_VALIDATION: ${{ inputs.live_label_validation || 'false' }}");

// 3. live_label_validation requires test_mode=true — explicit reject guard, fail closed.
const rejectGuardIdx = mustFind(
  writer,
  `if [[ "$TEST_MODE" != "true" && "$LIVE_LABEL_VALIDATION" == "true" ]]; then`,
  "test_mode=false + live_label_validation=true reject guard",
);
const rejectGuardEnd = mustFind(writer, "fi", "reject guard end", rejectGuardIdx);
mustInclude(writer.slice(rejectGuardIdx, rejectGuardEnd), "exit 1", "reject guard must fail closed");

// 4. Explicit fixture required — no auto-discovery when live_label_validation=true.
const liveBranchIdx = mustFind(
  writer,
  `if [[ "$LIVE_LABEL_VALIDATION" == "true" ]]; then`,
  "live_label_validation branch inside test_mode",
  rejectGuardEnd,
);
const liveBranchElseIdx = mustFind(writer, "else", "live_label_validation branch else", liveBranchIdx);
const liveBranchBlock = writer.slice(liveBranchIdx, liveBranchElseIdx);
mustInclude(liveBranchBlock, `if [[ -z "$FINAL_NUMBER" ]]; then`, "must check for an explicit issue number");
mustInclude(liveBranchBlock, "exit 1", "missing explicit issue number must fail closed");
assert.ok(
  !liveBranchBlock.includes("gh issue list"),
  "live_label_validation must never auto-discover a sistem-testi issue",
);

// Open-state + synthetic marker checks, inside the sistem-testi-verified branch.
const sistemTestiCheckIdx = mustFind(
  writer,
  "if ! grep -qx 'sistem-testi' /tmp/final-labels.txt; then",
  "sistem-testi guard (shared by all test_mode paths)",
);
const liveExtraChecksIdx = mustFind(
  writer,
  `if [[ "$LIVE_LABEL_VALIDATION" == "true" ]]; then`,
  "live_label_validation extra fixture-safety checks",
  sistemTestiCheckIdx,
);
// The outer if/fi is indented 12 spaces; its two inner if/fi guards are
// indented 14 spaces — search specifically for the outer closing "fi" so
// nested inner closes are not mistaken for the block's own end.
const liveExtraChecksEnd = mustFind(writer, "\n            fi", "live extra checks end (outer fi)", liveExtraChecksIdx);
const liveExtraChecksBlock = writer.slice(liveExtraChecksIdx, liveExtraChecksEnd);
mustInclude(liveExtraChecksBlock, 'if [[ "$FINAL_STATE" != "OPEN" ]]; then', "must require the fixture to be open");
mustInclude(
  liveExtraChecksBlock,
  "<!-- LIVE_FILMING_PACKAGE_LABEL_VALIDATION_FIXTURE v1 -->",
  "must require the unmistakable synthetic validation marker",
);
assert.equal(
  (liveExtraChecksBlock.match(/exit 1/g) ?? []).length,
  2,
  "both the open-state check and the marker check must fail closed",
);

// ===========================================================================
// 1/2/5/6. Real mode still reaches shared persistence; ordinary test_mode
// remains no-write; validation mode cannot reach the AI router or any
// provider call.
// ===========================================================================

const persistenceStepIdx = mustFind(
  writer,
  "- name: Çekim paketi etiketlerini kalıcı hale getir",
  "shared persistence step",
);
const persistenceIfIdx = mustFind(writer, "if:", "shared persistence step condition", persistenceStepIdx);
const persistenceIfLineEnd = writer.indexOf("\n", persistenceIfIdx);
const persistenceIfLine = writer.slice(persistenceIfIdx, persistenceIfLineEnd);
mustInclude(persistenceIfLine, "env.TEST_MODE != 'true' && env.SKIP_PACKAGE != 'true'", "real-mode branch must still reach shared persistence");
mustInclude(persistenceIfLine, "env.LIVE_LABEL_VALIDATION == 'true'", "validation-mode branch must reach shared persistence");
mustInclude(persistenceIfLine, "||", "the two branches must be joined with OR, not AND");

// The AI router step's own gate is untouched — still real-mode only, which is
// structurally unreachable whenever live_label_validation requires TEST_MODE=true.
const aiRouterStepIdx = mustFind(writer, "- name: AI Router ile çekim paketini oluştur", "AI router step");
const aiRouterIfIdx = mustFind(writer, "if:", "AI router step condition", aiRouterStepIdx);
const aiRouterIfLineEnd = writer.indexOf("\n", aiRouterIfIdx);
const aiRouterIfLine = writer.slice(aiRouterIfIdx, aiRouterIfLineEnd);
assert.equal(
  aiRouterIfLine.trim(),
  "if: env.TEST_MODE != 'true' && env.SKIP_PACKAGE != 'true'",
  "AI router step condition must remain exactly real-mode-only, unmodified by this feature",
);
assert.ok(!aiRouterIfLine.includes("LIVE_LABEL_VALIDATION"), "AI router step must never be reachable via live_label_validation");

// ===========================================================================
// D1 FIX. The persistence-invocation step itself must be scoped and proven
// isolated — not just the shared script or the validation-body step. This
// closes a mutation-tested gap: a `gh api .../dispatches` call appended right
// after the shared-script invocation, inside this exact step, previously
// escaped both this file and test_filming_package_label_migration_phase1.mjs.
// ===========================================================================
const persistenceStepEndIdx = mustFind(
  writer,
  "\n      - name:",
  "persistence step end (next sibling step)",
  persistenceStepIdx + 1,
);
const persistenceStepBlock = writer.slice(persistenceStepIdx, persistenceStepEndIdx);

// 3/4. The step must invoke the shared script, exactly once.
assert.equal(
  countOccurrences(persistenceStepBlock, "bash .github/scripts/persist_filming_package_labels.sh"),
  1,
  "persistence step must invoke the shared script exactly once",
);

// 6. The step's `run:` value must be EXACTLY the single shared-script
// invocation — no `&&`/`;`/`||` chaining on the same line, and no conversion
// to a multi-line `run: |` block that could smuggle in a second command.
// Pinning the literal line itself (not just its content) catches both a
// same-line append and a structural change to a multi-line block.
const runLineIdx = mustFind(persistenceStepBlock, "run:", "persistence step run: line");
const runLineEnd = persistenceStepBlock.indexOf("\n", runLineIdx);
const runLine = persistenceStepBlock.slice(runLineIdx, runLineEnd === -1 ? undefined : runLineEnd);
assert.equal(
  runLine.trim(),
  "run: bash .github/scripts/persist_filming_package_labels.sh",
  "persistence step must run exactly one command — the shared script invocation, nothing chained or appended",
);
for (const chainOperator of ["&&", "||", ";"]) {
  assert.ok(
    !runLine.includes(chainOperator),
    `persistence step run: line must not chain a second command with ${chainOperator}`,
  );
}

// 5. No forbidden capability anywhere in this step's own block (if:, env:,
// and run: all covered) — scoped specifically to this step, not the whole file.
for (const forbidden of [
  "gh api",
  "curl ",
  "/dispatches",
  "repository_dispatch",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "youtube.googleapis.com",
  "video_orchestrator.py",
]) {
  assert.ok(
    !persistenceStepBlock.includes(forbidden),
    `persistence invocation step gained forbidden capability: ${forbidden}`,
  );
}

// ===========================================================================
// E1 FIX. The generic Nihai-Senaryolar title-family fail-closed guard must
// still exist, and must be evaluated upstream of (before) the persistence
// step — including before the live_label_validation-specific extra checks —
// so the validation write path can never reach persistence without it having
// already run. This is a regression-test addition only; no new
// validation-specific title requirement is introduced into production code.
// ===========================================================================
const titleGuardIdx = mustFind(
  writer,
  'if [[ "$FINAL_TITLE" != Nihai\\ Senaryolar* ]]; then',
  "generic Nihai Senaryolar title-family guard",
);
const titleGuardEndIdx = mustFind(writer, "fi", "title guard end", titleGuardIdx);
mustInclude(writer.slice(titleGuardIdx, titleGuardEndIdx), "exit 1", "title-family guard must fail closed");
assert.ok(
  titleGuardIdx < liveExtraChecksIdx,
  "title-family guard must be evaluated before the live_label_validation-specific extra fixture checks",
);
assert.ok(
  titleGuardIdx < persistenceStepIdx,
  "title-family guard must be evaluated upstream of the shared persistence step in every mode",
);

// 6. The deterministic validation-body step and the shared script must contain
// no AI/video/YouTube/provider/dispatch capability whatsoever.
const validationBodyStepIdx = mustFind(
  writer,
  "- name: Canlı doğrulama için deterministik paket içeriği oluştur",
  "deterministic validation body step",
);
const validationBodyStepEnd = mustFind(writer, "- name:", "validation body step end", validationBodyStepIdx + 1);
const validationBodyStepBlock = writer.slice(validationBodyStepIdx, validationBodyStepEnd);
for (const forbidden of [
  "ai_router.py",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "DASHSCOPE_API_KEY",
  "workflow_dispatch",
  "repository_dispatch",
  "/dispatches",
  "gh api",
  "curl ",
  "youtube.googleapis.com",
  "video_orchestrator.py",
]) {
  assert.ok(!validationBodyStepBlock.includes(forbidden), `validation body step must not contain: ${forbidden}`);
  assert.ok(!persistScript.includes(forbidden), `shared persistence script must not contain: ${forbidden}`);
}

// The validation body must clearly self-identify as synthetic.
for (const marker of ["LIVE VALIDATION FIXTURE", "NOT REAL CONTENT", "NO AI", "NO VIDEO", "NO PUBLICATION"]) {
  mustInclude(validationBodyStepBlock, marker, `validation body must clearly state: ${marker}`);
}

// ===========================================================================
// 11 (workflow side). Both comment/summary steps occur after the shared
// persistence step, never before.
// ===========================================================================
const realCommentStepIdx = mustFind(
  writer,
  "- name: Gerçek üretim onayı yorumunu ve özetini yaz",
  "real-mode comment step",
  persistenceStepIdx,
);
const validationCommentStepIdx = mustFind(
  writer,
  "- name: Canlı doğrulama yorumunu ve özetini yaz",
  "validation-mode comment step",
  persistenceStepIdx,
);
assert.ok(
  persistenceStepIdx < realCommentStepIdx,
  "real-mode comment step must come after the shared persistence step",
);
assert.ok(
  persistenceStepIdx < validationCommentStepIdx,
  "validation-mode comment step must come after the shared persistence step",
);

console.log(
  "filming_package_live_label_validation_ok network=0 ai_calls=0 video_calls=0 youtube_calls=0 issue_writes=0 dispatches=0",
);

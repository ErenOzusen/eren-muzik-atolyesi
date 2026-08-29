#!/usr/bin/env node
/** Deterministic zero-network checks for Production Selection label migration Phase 1. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");
const stripComments = (text) => text
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

const writer = stripComments(read(".github/workflows/eren-production-selection-gate.yml"));
const handoff = stripComments(read(".github/workflows/filming-handoff-gate.yml"));
const filming = stripComments(read(".github/workflows/filming-package-agent-v4-router.yml"));

const mustInclude = (text, needle, message = needle) => {
  assert.ok(text.includes(needle), `missing contract: ${message}`);
};

const mustFind = (text, needle, message = needle, fromIndex = 0) => {
  const index = text.indexOf(needle, fromIndex);
  assert.ok(index >= 0, `missing executable contract: ${message}`);
  return index;
};

// Writer retains owner approval dual-read and all production safety gates.
for (const contract of [
  "grep -qxE 'eren-onayli|owner-approved' /tmp/labels.txt",
  "grep -qx 'cekime-hazir' /tmp/labels.txt",
  "grep -qx 'duzeltme-gerekiyor' /tmp/labels.txt",
  '[[ "$ISSUE_TITLE" != Nihai\\ Senaryolar* ]]',
  'grep -Eiq "^##[[:space:]]+SENARYO[[:space:]]+$SELECTED',
  "FILMING_HANDOFF_V1",
  'grep -qx \'sistem-testi\' /tmp/labels.txt',
]) mustInclude(writer, contract);

// Test selection exits without reaching the first mutation.
const testModeIdx = writer.indexOf('if [[ "$TEST_MODE" == "true" ]]');
const testExitIdx = writer.indexOf("exit 0", testModeIdx);
const firstMutationIdx = Math.min(
  ...["gh label create", "gh issue edit", "gh issue comment"]
    .map((command) => writer.indexOf(command))
    .filter((index) => index >= 0),
);
assert.ok(testModeIdx >= 0 && testExitIdx > testModeIdx && testExitIdx < firstMutationIdx);
const productionSystemTestGuardIdx = writer.indexOf(
  'if grep -qx \'sistem-testi\' /tmp/labels.txt; then',
  testExitIdx,
);
assert.ok(productionSystemTestGuardIdx > testExitIdx && productionSystemTestGuardIdx < firstMutationIdx);

// Writer creates both namespaces deterministically and dual-writes selected state.
for (const contract of [
  'LEGACY_LABEL="uretim-senaryo-$N"',
  'GENERIC_LABEL="production-scenario-$N"',
  '--description "Selected production scenario $N"',
  'gh label create "uretime-secildi"',
  'gh label create "production-selected"',
  '--description "A final scenario has been selected for production"',
  '--add-label "uretime-secildi"',
  '--add-label "production-selected"',
  '--add-label "uretim-senaryo-$SELECTED"',
  '--add-label "production-scenario-$SELECTED"',
  'REMOVE_ARGS+=(--remove-label "$LEGACY_LABEL")',
  'REMOVE_ARGS+=(--remove-label "$GENERIC_LABEL")',
]) mustInclude(writer, contract);

// Each N cleanup batches the legacy/generic pair into one issue-edit operation.
const cleanupLoopIdx = mustFind(writer, "for N in 1 2 3; do", "scenario cleanup loop");
const cleanupEndIdx = mustFind(writer, 'gh label create "uretime-secildi"', "post-cleanup state label", cleanupLoopIdx);
const cleanupBlock = writer.slice(cleanupLoopIdx, cleanupEndIdx);
assert.equal((cleanupBlock.match(/REMOVE_ARGS=\(\)/g) ?? []).length, 1);
assert.equal((cleanupBlock.match(/REMOVE_ARGS\+=\(--remove-label "\$LEGACY_LABEL"\)/g) ?? []).length, 1);
assert.equal((cleanupBlock.match(/REMOVE_ARGS\+=\(--remove-label "\$GENERIC_LABEL"\)/g) ?? []).length, 1);
assert.equal(
  (cleanupBlock.match(/gh issue edit "\$ISSUE_NUMBER"/g) ?? []).length,
  1,
  "cleanup loop must contain exactly one issue-edit call per iteration",
);
mustInclude(
  cleanupBlock,
  'gh issue edit "$ISSUE_NUMBER" "${REMOVE_ARGS[@]}" > /dev/null',
  "batched cleanup call",
);
assert.ok(!cleanupBlock.includes('gh issue edit "$ISSUE_NUMBER" --remove-label'));
assert.ok(!cleanupBlock.includes("|| true"), "cleanup failures must not be suppressed");
assert.equal(
  (cleanupBlock.match(/gh label create "\$(?:LEGACY|GENERIC)_LABEL"/g) ?? []).length,
  2,
  "cleanup loop may define only the legacy/generic scenario labels",
);
assert.equal(
  (cleanupBlock.match(/--force/g) ?? []).length,
  2,
  "cleanup loop must not introduce extra --force behavior",
);
assert.ok(!cleanupBlock.includes("--add-label"), "cleanup loop must not add unrelated labels");
for (const removalArg of [...cleanupBlock.matchAll(/--remove-label\s+"([^"]+)"/g)].map((match) => match[1])) {
  assert.ok(
    removalArg === "$LEGACY_LABEL" || removalArg === "$GENERIC_LABEL",
    `cleanup can remove an unrelated label: ${removalArg}`,
  );
}

const finalFetchIdx = writer.indexOf("/tmp/labels-after-selection.txt");
const addSelectedIdx = writer.indexOf('--add-label "production-scenario-$SELECTED"');
const presentVerifyIdx = writer.indexOf("for REQUIRED_PRESENT in", addSelectedIdx);
const absentVerifyIdx = writer.indexOf("for REQUIRED_ABSENT in", presentVerifyIdx);
assert.ok(addSelectedIdx < finalFetchIdx && finalFetchIdx < presentVerifyIdx && presentVerifyIdx < absentVerifyIdx);
for (const required of [
  "uretime-secildi",
  "production-selected",
  '"uretim-senaryo-$SELECTED"',
  '"production-scenario-$SELECTED"',
]) mustInclude(writer.slice(presentVerifyIdx, absentVerifyIdx), required);
for (const namespace of ['"uretim-senaryo-$N"', '"production-scenario-$N"']) {
  mustInclude(writer.slice(absentVerifyIdx), namespace);
}

// The selection gate remains comment-triggered, zero-provider, and non-dispatching.
for (const forbidden of [
  "workflow_dispatch",
  "repository_dispatch",
  "/dispatches",
  "gh api",
  "curl ",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "youtube.googleapis.com",
  "video_orchestrator.py",
]) assert.ok(!writer.includes(forbidden), `selection writer gained forbidden capability: ${forbidden}`);

function verifyReader(reader, labelsPath, resolvedName) {
  for (const contract of [
    `grep -qxE 'eren-onayli|owner-approved' ${labelsPath}`,
    "for REQUIRED in eren-onayli cekime-hazir uretime-secildi",
    `grep -qxE 'uretime-secildi|production-selected' ${labelsPath}`,
    `grep -qx 'duzeltme-gerekiyor' ${labelsPath}`,
    `grep -E '^uretim-senaryo-[123]$' ${labelsPath}`,
    `grep -E '^production-scenario-[123]$' ${labelsPath}`,
    "FILMING_HANDOFF_V1",
  ]) mustInclude(reader, contract);

  const multipleGuard = 'if [[ "${#LEGACY_SELECTION_LABELS[@]}" -gt 1 || "${#GENERIC_SELECTION_LABELS[@]}" -gt 1 ]]; then';
  const missingGuard = 'if [[ "${#LEGACY_SELECTION_LABELS[@]}" -eq 0 && "${#GENERIC_SELECTION_LABELS[@]}" -eq 0 ]]; then';
  const mismatchGuard = 'if [[ -n "$LEGACY_SCENARIO" && -n "$GENERIC_SCENARIO" && "$LEGACY_SCENARIO" != "$GENERIC_SCENARIO" ]]; then';
  const resolution = `${resolvedName}="\${LEGACY_SCENARIO:-$GENERIC_SCENARIO}"`;
  const expectedCheck = `if [[ "$${resolvedName}" != "$EXPECTED_SCENARIO" ]]; then`;

  const multipleIdx = mustFind(reader, multipleGuard, `${resolvedName} multiple-label guard`);
  const missingIdx = mustFind(reader, missingGuard, `${resolvedName} missing-both guard`, multipleIdx);
  const legacyAssignmentIdx = mustFind(reader, 'LEGACY_SCENARIO=""', "legacy scenario initialization", missingIdx);
  const mismatchIdx = mustFind(reader, mismatchGuard, `${resolvedName} mismatch guard`, legacyAssignmentIdx);
  const resolutionIdx = mustFind(reader, resolution, `${resolvedName} fallback resolution`, mismatchIdx);
  const expectedIdx = mustFind(reader, expectedCheck, `${resolvedName} expected-scenario check`, resolutionIdx);

  assert.ok(multipleIdx < missingIdx && missingIdx < legacyAssignmentIdx);
  assert.ok(legacyAssignmentIdx < mismatchIdx && mismatchIdx < resolutionIdx && resolutionIdx < expectedIdx);
  assert.ok(multipleGuard.includes('-gt 1 || "${#GENERIC_SELECTION_LABELS[@]}" -gt 1'));
  assert.ok(missingGuard.includes('-eq 0 && "${#GENERIC_SELECTION_LABELS[@]}" -eq 0'));
  assert.ok(!missingGuard.includes(" || "), "missing-both guard must use logical AND");
  assert.ok(
    mismatchGuard.includes('-n "$LEGACY_SCENARIO" && -n "$GENERIC_SCENARIO" &&'),
    "mismatch rejection must require both namespaces",
  );
  assert.ok(!mismatchGuard.includes(" || "), "mismatch guard must not use logical OR");

  for (const [guardIdx, nextIdx, label] of [
    [multipleIdx, missingIdx, "multiple-label"],
    [missingIdx, legacyAssignmentIdx, "missing-both"],
    [mismatchIdx, resolutionIdx, "mismatched-dual"],
  ]) {
    const guardBlock = reader.slice(guardIdx, nextIdx);
    assert.ok(guardBlock.includes("exit 1"), `${resolvedName} ${label} guard must fail closed`);
  }
}

verifyReader(handoff, "/tmp/labels.txt", "ACTUAL_SCENARIO");
verifyReader(filming, "/tmp/final-labels.txt", "SELECTED_SCENARIO");
mustInclude(handoff, '[[ "$ACTUAL_SCENARIO" != "$EXPECTED_SCENARIO" ]]');
mustInclude(filming, '[[ "$SELECTED_SCENARIO" != "$EXPECTED_SCENARIO" ]]');

// Model the exact logical label-resolution contract for both readers.
function resolveScenario(labels) {
  const legacy = labels.filter((label) => /^uretim-senaryo-[123]$/.test(label));
  const generic = labels.filter((label) => /^production-scenario-[123]$/.test(label));
  if (legacy.length > 1 || generic.length > 1 || (legacy.length === 0 && generic.length === 0)) {
    return null;
  }
  const legacyNumber = legacy[0]?.at(-1) ?? "";
  const genericNumber = generic[0]?.at(-1) ?? "";
  if (legacyNumber && genericNumber && legacyNumber !== genericNumber) return null;
  return legacyNumber || genericNumber;
}

assert.equal(resolveScenario(["uretim-senaryo-1"]), "1");
assert.equal(resolveScenario(["production-scenario-2"]), "2");
assert.equal(resolveScenario(["uretim-senaryo-3", "production-scenario-3"]), "3");
assert.equal(resolveScenario([]), null);
assert.equal(resolveScenario(["uretim-senaryo-1", "uretim-senaryo-2"]), null);
assert.equal(resolveScenario(["production-scenario-1", "production-scenario-2"]), null);
assert.equal(resolveScenario(["uretim-senaryo-1", "production-scenario-2"]), null);

// Completed approval migrations remain isolated from this label slice.
const ownerGate = read(".github/workflows/eren-approval-gate.yml");
const ownerInvalidation = read(".github/workflows/approval-invalidation-gate.yml");
const publicationGate = read(".github/workflows/youtube-publication-approval-gate.yml");
const publicationInvalidation = read(".github/workflows/publication-approval-invalidation-gate.yml");
for (const untouched of [ownerGate, ownerInvalidation, publicationGate, publicationInvalidation]) {
  assert.ok(!untouched.includes("production-selected"));
  assert.ok(!untouched.includes("production-scenario-"));
}
mustInclude(ownerGate, "grep -qxE 'eren-onayli|owner-approved'");
mustInclude(ownerInvalidation, "owner-approval-pending");
mustInclude(publicationGate, 'any(.name == "eren-yayin-onayli" or .name == "publication-approved")');
mustInclude(publicationInvalidation, "publication-approval-pending");

console.log(
  "production_selection_label_migration_phase1_ok network=0 ai_calls=0 api_calls=0 issue_writes=0 dispatches=0 video_calls=0",
);

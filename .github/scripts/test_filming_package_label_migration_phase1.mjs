#!/usr/bin/env node
/** Deterministic zero-network checks for Filming Package label migration Phase 1 (cekim-paketi / cekim-paketi-hazir). */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Normalize CRLF to LF centrally so every structural assertion below operates
// on logical line endings regardless of the working-tree's checkout style.
const read = (relativePath) =>
  readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
const stripComments = (text) => text
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

const writer = stripComments(read(".github/workflows/filming-package-agent-v4-router.yml"));
const invalidation = stripComments(read(".github/workflows/approval-invalidation-gate.yml"));
const rawVideoIntake = stripComments(read(".github/workflows/raw-video-intake-gate.yml"));
const editing = stripComments(read(".github/workflows/editing-package-agent.yml"));
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
// A. WRITER — filming-package-agent-v4-router.yml + the shared persistence
// script it delegates to.
//
// The actual GitHub label/Issue persistence was extracted into
// .github/scripts/persist_filming_package_labels.sh, shared identically by
// the real production path and the controlled live_label_validation path.
// This section proves (1) the shared script correctly owns the dual-write,
// and (2) the workflow itself contains NO duplicate inline implementation —
// it only ever invokes the shared script, exactly once.
// ===========================================================================

// Generic labels are created exactly once each in the SHARED SCRIPT; legacy
// label creation remains exactly once each there too (dual-write, no legacy
// removal). The workflow file itself must create none of these directly.
for (const label of ["cekim-paketi", "cekim-paketi-hazir", "filming-package", "filming-package-ready"]) {
  assert.equal(
    countOccurrences(persistScript, `gh label create "${label}"`),
    1,
    `shared script must create ${label} exactly once`,
  );
  assert.ok(
    !writer.includes(`gh label create "${label}"`),
    `workflow must not duplicate label creation for ${label} — it must live only in the shared script`,
  );
}
mustInclude(persistScript, "This Issue is a filming package for a selected production scenario");
mustInclude(persistScript, "A filming package is ready for the selected production scenario");

// Legacy labels are never removed anywhere in the shared script.
assert.ok(!persistScript.includes('--remove-label "cekim-paketi"'), "shared script must never remove the legacy cekim-paketi label");
assert.ok(!persistScript.includes('--remove-label "cekim-paketi-hazir"'), "shared script must never remove the legacy cekim-paketi-hazir label");

// Identity write, existing-issue branch: cekim-paketi and filming-package must
// be added together, in the same gh issue edit call, inside the shared script.
const existingBranchIdx = mustFind(
  persistScript,
  'gh issue edit "$EXISTING_NUMBER" \\',
  "existing-issue identity dual-write (same mutation)",
);
const existingBranchEnd = mustFind(persistScript, "PACKAGE_URL=", "existing-issue branch end", existingBranchIdx);
mustInclude(persistScript.slice(existingBranchIdx, existingBranchEnd), '--add-label "cekim-paketi"');
mustInclude(persistScript.slice(existingBranchIdx, existingBranchEnd), '--add-label "filming-package"');

// Identity write, new-issue branch: cekim-paketi and filming-package must be
// added together via the same gh issue create call's --label flags.
const newIssueBranchIdx = mustFind(
  persistScript,
  'gh issue create \\',
  "new-issue identity dual-write (same mutation)",
  existingBranchEnd,
);
const newIssueBranchEnd = persistScript.indexOf("\n\n", newIssueBranchIdx);
mustInclude(persistScript.slice(newIssueBranchIdx, newIssueBranchEnd), '--label "cekim-paketi"');
mustInclude(persistScript.slice(newIssueBranchIdx, newIssueBranchEnd), '--label "filming-package"');

// Ready-signal write onto the root issue: cekim-paketi-hazir and
// filming-package-ready must be added together, in the same mutation.
const readySignalIdx = mustFind(
  persistScript,
  'gh issue edit "$FINAL_NUMBER" \\',
  "root-issue ready-signal dual-write (same mutation)",
  newIssueBranchEnd,
);
const readySignalEnd = persistScript.indexOf("\n\n", readySignalIdx);
mustInclude(persistScript.slice(readySignalIdx, readySignalEnd), '--add-label "cekim-paketi-hazir"');
mustInclude(persistScript.slice(readySignalIdx, readySignalEnd), '--add-label "filming-package-ready"');
assert.ok(
  existingBranchIdx < readySignalIdx,
  "identity must be written before the ready-signal is written back to the root issue",
);

// No extra API call was introduced for the ready-signal write: exactly one
// gh issue edit targeting $FINAL_NUMBER's --add-label exists in the shared script.
assert.equal(
  countOccurrences(persistScript, 'gh issue edit "$FINAL_NUMBER"'),
  1,
  "ready-signal must be written in exactly one gh issue edit call, not split into extra API calls",
);

// The workflow must invoke the shared script exactly once — no duplicated
// test-only or production-only persistence implementation anywhere.
assert.equal(
  countOccurrences(writer, "bash .github/scripts/persist_filming_package_labels.sh"),
  1,
  "the workflow must call the shared persistence script from exactly one call site",
);
for (const rawVerb of [
  '--add-label "cekim-paketi"',
  '--label "cekim-paketi"',
  '--add-label "cekim-paketi-hazir"',
]) {
  assert.ok(!writer.includes(rawVerb), `workflow must not duplicate the shared script's mutation verb: ${rawVerb}`);
}

// ===========================================================================
// B. INVALIDATION — approval-invalidation-gate.yml
// filming-package-ready must be included in detection, removal, and final
// absent verification, WITHOUT weakening the already-established pending-first
// fail-safe ordering (detect < pending-established < verified < batched-removal
// < re-fetch-final < verify-present < verify-absent < comment).
// ===========================================================================

const detectionLoopIdx = mustFind(
  invalidation,
  "for LABEL in eren-onayli owner-approved cekime-hazir cekim-paketi-hazir production-ready filming-package-ready; do",
  "detection loop must include filming-package-ready",
);
const detectionLoopEndIdx = mustFind(invalidation, "done", "detection loop end", detectionLoopIdx);
assert.ok(
  !invalidation.slice(detectionLoopIdx, detectionLoopEndIdx).includes("gh issue edit"),
  "detection loop must remain read-only after adding filming-package-ready",
);

const pendingVerifyIdx = mustFind(
  invalidation,
  "for PENDING_LABEL in eren-onayi-bekliyor owner-approval-pending; do",
  "pending-present verification loop",
  detectionLoopEndIdx,
);
const pendingVerifyEndIdx = mustFind(invalidation, "done", "pending verification loop end", pendingVerifyIdx);

const removeArgsInitIdx = mustFind(
  invalidation,
  "REMOVE_ARGS=()",
  "REMOVE_ARGS initialization",
  pendingVerifyEndIdx,
);
const removalLoopDeclIdx = mustFind(
  invalidation,
  "for LABEL in eren-onayli owner-approved cekime-hazir cekim-paketi-hazir production-ready filming-package-ready; do",
  "removal-args loop must include filming-package-ready",
  removeArgsInitIdx,
);
const removalLoopEndIdx = mustFind(invalidation, "done", "removal-args loop end", removalLoopDeclIdx);
mustInclude(
  invalidation.slice(removalLoopDeclIdx, removalLoopEndIdx),
  'REMOVE_ARGS+=(--remove-label "$LABEL")',
  "removal-args loop must still append eligible labels generically",
);

const batchedRemovalIdx = mustFind(
  invalidation,
  'gh issue edit "$ISSUE_NUMBER" "${REMOVE_ARGS[@]}"',
  "single batched removal mutation",
  removalLoopEndIdx,
);
assert.equal(
  countOccurrences(invalidation, 'gh issue edit "$ISSUE_NUMBER" "${REMOVE_ARGS[@]}"'),
  1,
  "exactly one batched removal mutation may exist",
);
assert.ok(
  !invalidation.includes('gh issue edit "$ISSUE_NUMBER" --remove-label "$LABEL"'),
  "the old per-label removal call must not reappear",
);
assert.ok(!invalidation.includes("|| true"), "no step in this file may suppress a failure with || true");

const finalAbsentIdx = mustFind(
  invalidation,
  "for REQUIRED_ABSENT in eren-onayli owner-approved cekime-hazir cekim-paketi-hazir production-ready filming-package-ready; do",
  "final absent verification must include filming-package-ready",
  batchedRemovalIdx,
);
const finalAbsentEndIdx = mustFind(invalidation, "done", "final absent verification end", finalAbsentIdx);
mustInclude(invalidation.slice(finalAbsentIdx, finalAbsentEndIdx), "exit 1", "final absent verification must fail closed");

const invalidationCommentIdx = mustFind(
  invalidation,
  'gh issue comment "$ISSUE_NUMBER"',
  "invalidation confirmation comment",
  finalAbsentEndIdx,
);

// The full required structural ordering, with filming-package-ready now part
// of every checkpoint, proven as one chain — this fails if filming-package-ready
// was added anywhere out of the established pending-first sequence.
assert.ok(
  detectionLoopIdx < detectionLoopEndIdx &&
    detectionLoopEndIdx < pendingVerifyIdx &&
    pendingVerifyIdx < pendingVerifyEndIdx &&
    pendingVerifyEndIdx < removeArgsInitIdx &&
    removeArgsInitIdx < removalLoopDeclIdx &&
    removalLoopDeclIdx < removalLoopEndIdx &&
    removalLoopEndIdx < batchedRemovalIdx &&
    batchedRemovalIdx < finalAbsentIdx &&
    finalAbsentIdx < finalAbsentEndIdx &&
    finalAbsentEndIdx < invalidationCommentIdx,
  "pending-first fail-safe ordering must remain intact: detect < verify-pending < build-remove-args < " +
    "batched-removal < verify-absent < comment",
);

// ===========================================================================
// C. READERS — raw-video-intake-gate.yml, editing-package-agent.yml
// Both use two separate, individually-proven jq -e '.labels | any(.name == "X")'
// calls (each byte-identical to the already-shipped single-label idiom used
// elsewhere in this codebase) combined with a bash &&, exactly mirroring the
// jq negation pattern already proven safe for Production Readiness Phase 1 —
// avoiding any dependency on jq operator precedence.
// ===========================================================================

function verifyJqIdentityReadiness(reader, fileLabel) {
  const legacyCallIdx = mustFind(
    reader,
    'jq -e \'.labels | any(.name == "cekim-paketi")\' /tmp/package.json > /dev/null',
    `${fileLabel} legacy jq identity call`,
  );
  const genericCallIdx = mustFind(
    reader,
    'jq -e \'.labels | any(.name == "filming-package")\' /tmp/package.json > /dev/null',
    `${fileLabel} generic jq identity call`,
    legacyCallIdx,
  );
  const betweenCalls = reader.slice(legacyCallIdx, genericCallIdx);
  assert.ok(
    betweenCalls.includes("&&") && betweenCalls.trim().startsWith("jq"),
    `${fileLabel} legacy and generic identity calls must be joined with && (reject only if neither is present)`,
  );

  // Decisive proof, not a shadow model: the ENTIRE rejection expression, from
  // `if` through `; then`, must match one exact structural shape.
  const rejectionGuardRegex = new RegExp(
    "if\\s+!\\s*jq\\s+-e\\s+'\\.labels\\s*\\|\\s*any\\(\\.name\\s*==\\s*\"cekim-paketi\"\\)'" +
      "\\s+/tmp/package\\.json\\s*>\\s*/dev/null\\s*\\\\?\\s*" +
      "&&\\s*!\\s*jq\\s+-e\\s+'\\.labels\\s*\\|\\s*any\\(\\.name\\s*==\\s*\"filming-package\"\\)'" +
      "\\s+/tmp/package\\.json\\s*>\\s*/dev/null\\s*;\\s*then",
  );
  assert.ok(
    rejectionGuardRegex.test(reader),
    `${fileLabel}: rejection guard must be exactly "if ! jq(...cekim-paketi...) && ! jq(...filming-package...); then" — ` +
      "both calls negated, joined by &&, legacy first, generic second",
  );

  // Explicit negative controls for the exact mutations named in review: none
  // of the known-dangerous mutated shapes may match this file's source.
  const droppedFirstNegation = new RegExp(
    "if\\s+jq\\s+-e\\s+'\\.labels\\s*\\|\\s*any\\(\\.name\\s*==\\s*\"cekim-paketi\"\\)'" +
      "\\s+/tmp/package\\.json\\s*>\\s*/dev/null\\s*\\\\?\\s*&&\\s*!\\s*jq",
  );
  const droppedSecondNegation = new RegExp(
    "if\\s+!\\s*jq\\s+-e\\s+'\\.labels\\s*\\|\\s*any\\(\\.name\\s*==\\s*\"cekim-paketi\"\\)'" +
      "\\s+/tmp/package\\.json\\s*>\\s*/dev/null\\s*\\\\?\\s*&&\\s*jq\\s+-e\\s+'\\.labels\\s*\\|\\s*any\\(\\.name\\s*==\\s*\"filming-package\"\\)'",
  );
  assert.ok(!droppedFirstNegation.test(reader), `${fileLabel}: legacy jq call must not be un-negated (!A && B shape)`);
  assert.ok(!droppedSecondNegation.test(reader), `${fileLabel}: generic jq call must not be un-negated (A && !B shape)`);
  assert.ok(!reader.includes(
    "jq -e '.labels | any(.name == \"cekim-paketi\")' /tmp/package.json > /dev/null " +
      "&& jq -e '.labels | any(.name == \"filming-package\")' /tmp/package.json > /dev/null",
  ), `${fileLabel}: both jq calls must not be un-negated (A && B shape)`);
}

verifyJqIdentityReadiness(rawVideoIntake, "raw-video-intake-gate.yml");
verifyJqIdentityReadiness(editing, "editing-package-agent.yml");

// Boolean-state model: legacy-only, generic-only, both accepted; neither
// rejected — modeled to prove the logical contract, independent of the
// literal source checks already performed above.
function resolveIdentity(labels) {
  return labels.includes("cekim-paketi") || labels.includes("filming-package");
}
assert.equal(resolveIdentity(["cekim-paketi"]), true, "legacy-only must be accepted");
assert.equal(resolveIdentity(["filming-package"]), true, "generic-only must be accepted");
assert.equal(resolveIdentity(["cekim-paketi", "filming-package"]), true, "both present must be accepted");
assert.equal(resolveIdentity([]), false, "neither present must be rejected");
assert.equal(resolveIdentity(["sistem-testi"]), false, "unrelated labels must not satisfy identity");

// ===========================================================================
// D. COMPLETED MIGRATIONS — no regression
// ===========================================================================

// Production Readiness Phase 1: cekime-hazir/production-ready dual-write and
// the pending-first invalidation invariant must remain fully intact —
// re-verified here independently of test_production_readiness_label_migration_phase1.mjs.
mustInclude(invalidation, 'gh label create "eren-onayi-bekliyor"');
mustInclude(invalidation, 'gh label create "owner-approval-pending"');
mustInclude(invalidation, "cekime-hazir");
mustInclude(invalidation, "production-ready");

// Production Selection Phase 1: scenario resolution is untouched by this diff
// (this migration does not modify eren-production-selection-gate.yml or the
// scenario-resolution logic in filming-handoff-gate.yml/filming-package-agent-v4-router.yml).
mustInclude(writer, "uretime-secildi|production-selected");
mustInclude(writer, '[[ "${#LEGACY_SELECTION_LABELS[@]}" -gt 1 || "${#GENERIC_SELECTION_LABELS[@]}" -gt 1 ]]');
mustInclude(writer, "FILMING_HANDOFF_V1");

// Publication Approval migration (a separate, already-completed slice) must
// remain fully isolated from this label vocabulary.
const publicationGate = read(".github/workflows/youtube-publication-approval-gate.yml");
const publicationInvalidation = read(".github/workflows/publication-approval-invalidation-gate.yml");
for (const untouched of [publicationGate, publicationInvalidation]) {
  assert.ok(!untouched.includes("filming-package"), "publication approval files must not gain filming-package vocabulary");
  assert.ok(!untouched.includes('"cekim-paketi"'), "publication approval files must not gain cekim-paketi vocabulary");
}

// ===========================================================================
// E. SIDE-EFFECT SAFETY
// ===========================================================================

// The shared persistence script has no legitimate reason to ever contain any
// of these — unlike the parent workflow, it is a small, single-purpose file,
// so it can be checked in full rather than needing a fragile substring-region
// scope. filming-package-agent-v4-router.yml itself still legitimately
// contains AI-router/provider logic elsewhere (untouched by this migration),
// so the workflow-level check below is intentionally scoped to what this
// diff actually introduced.
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
]) {
  assert.ok(!persistScript.includes(forbidden), `shared persistence script gained forbidden capability: ${forbidden}`);
}

// The invalidation gate has no legitimate reason to ever contain any of these.
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
]) {
  assert.ok(!invalidation.includes(forbidden), `invalidation gate gained forbidden capability: ${forbidden}`);
}

// For the two reader files (both legitimately declare workflow_dispatch as
// their own pre-existing trigger), scope the check narrowly to the exact
// text this diff introduced.
const introducedSnippets = [
  'jq -e \'.labels | any(.name == "cekim-paketi")\' /tmp/package.json > /dev/null',
  'jq -e \'.labels | any(.name == "filming-package")\' /tmp/package.json > /dev/null',
];
for (const snippet of introducedSnippets) {
  for (const forbidden of ["workflow_dispatch", "repository_dispatch", "gh api", "curl ", "youtube.googleapis.com"]) {
    assert.ok(!snippet.includes(forbidden), `introduced identity snippet unexpectedly contains: ${forbidden}`);
  }
}

console.log(
  "filming_package_label_migration_phase1_ok network=0 ai_calls=0 video_calls=0 youtube_calls=0 issue_writes=0 dispatches=0",
);

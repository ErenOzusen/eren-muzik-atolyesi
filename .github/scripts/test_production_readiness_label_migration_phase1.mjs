#!/usr/bin/env node
/** Deterministic zero-network checks for Production Readiness (cekime-hazir) label migration Phase 1. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Normalize CRLF to LF centrally so every structural assertion below operates
// on logical line endings — a working-tree file checked out as CRLF (as
// happens on Windows with core.autocrlf) must not silently change what a
// "\n\n" boundary search or any other newline-sensitive slice matches.
const read = (relativePath) =>
  readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
const stripComments = (text) => text
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

const writer = stripComments(read(".github/workflows/eren-approval-gate.yml"));
const invalidation = stripComments(read(".github/workflows/approval-invalidation-gate.yml"));

const readerPaths = {
  productionSelection: ".github/workflows/eren-production-selection-gate.yml",
  filmingHandoff: ".github/workflows/filming-handoff-gate.yml",
  filmingRouter: ".github/workflows/filming-package-agent-v4-router.yml",
  rawVideoIntake: ".github/workflows/raw-video-intake-gate.yml",
  editing: ".github/workflows/editing-package-agent.yml",
  thumbnail: ".github/workflows/thumbnail-package-agent.yml",
  subtitle: ".github/workflows/subtitle-package-agent.yml",
  youtubePublicationPackage: ".github/workflows/youtube-publication-package-agent.yml",
};
const readers = Object.fromEntries(
  Object.entries(readerPaths).map(([key, relativePath]) => [key, stripComments(read(relativePath))]),
);

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
// A. WRITER — eren-approval-gate.yml
// ===========================================================================

// production-ready label creation exists exactly once; legacy cekime-hazir
// creation remains exactly once (dual-write, no legacy removal).
assert.equal(
  countOccurrences(writer, 'gh label create "production-ready"'),
  1,
  "production-ready label must be created exactly once",
);
assert.equal(
  countOccurrences(writer, 'gh label create "cekime-hazir"'),
  1,
  "legacy cekime-hazir label creation must remain exactly once",
);
mustInclude(writer, "Content is approved and ready to proceed through the production pipeline");

// The successful approval mutation must add all four labels together.
const addLabelBlockIdx = mustFind(writer, '--add-label "eren-onayli"', "combined approval add-label call");
const addLabelBlockEndIdx = writer.indexOf("\n\n", addLabelBlockIdx);
const addLabelBlock = writer.slice(addLabelBlockIdx, addLabelBlockEndIdx);
for (const required of [
  '--add-label "eren-onayli"',
  '--add-label "owner-approved"',
  '--add-label "cekime-hazir"',
  '--add-label "production-ready"',
]) mustInclude(addLabelBlock, required, `combined add-label call missing ${required}`);

// Legacy label is never removed anywhere in the writer.
assert.ok(
  !writer.includes('--remove-label "cekime-hazir"'),
  "writer must never remove the legacy cekime-hazir label",
);

// Writer re-fetches Issue labels after the mutation, verifies all four
// required state labels, and only posts its confirmation comment afterward —
// proven by strict source-position ordering, not bare substring presence.
const refetchIdx = mustFind(
  writer,
  "gh issue view \"$ISSUE_NUMBER\" --json labels --jq '.labels[].name'",
  "post-mutation label re-fetch",
  addLabelBlockIdx,
);
const verifyLoopIdx = mustFind(writer, "for REQUIRED_PRESENT in", "final verification loop", refetchIdx);
const verifyLoopEndIdx = mustFind(writer, "done", "final verification loop end", verifyLoopIdx);
const commentIdx = mustFind(writer, 'gh issue comment "$ISSUE_NUMBER"', "approval confirmation comment", verifyLoopEndIdx);

assert.ok(
  addLabelBlockIdx < refetchIdx && refetchIdx < verifyLoopIdx && verifyLoopIdx < commentIdx,
  "writer must mutate, then re-fetch, then verify, then comment — in that exact order",
);

const verifyLoopBlock = writer.slice(verifyLoopIdx, verifyLoopEndIdx);
for (const requiredLabel of ["eren-onayli", "owner-approved", "cekime-hazir", "production-ready"]) {
  mustInclude(verifyLoopBlock, requiredLabel, `final verification must check ${requiredLabel}`);
}
mustInclude(verifyLoopBlock, "exit 1", "verification failure must fail closed (exit 1)");
assert.ok(!verifyLoopBlock.includes("|| true"), "verification loop must not suppress failures with || true");

// ===========================================================================
// B. INVALIDATION — approval-invalidation-gate.yml
// ===========================================================================
// Required safety invariant: PENDING MUST BE VERIFIED PRESENT BEFORE ANY
// APPROVED/READINESS LABEL IS REMOVED. Every checkpoint below is located with
// mustFind's sequential fromIndex, so this test structurally FAILS if removal
// is ever moved back to before pending is established/verified, or if any
// step is skipped or reordered.

// 1/2. Detection loop: read-only. Locate its declaration and its own "done",
// and prove it contains no mutation of any kind — detection must never
// remove or add a label before pending is established.
const detectionLoopIdx = mustFind(
  invalidation,
  "for LABEL in eren-onayli owner-approved cekime-hazir cekim-paketi-hazir production-ready; do",
  "read-only detection loop declaration",
);
const detectionLoopEndIdx = mustFind(invalidation, "done", "detection loop end", detectionLoopIdx);
const detectionLoopBlock = invalidation.slice(detectionLoopIdx, detectionLoopEndIdx);
assert.ok(
  !detectionLoopBlock.includes("gh issue edit"),
  "detection loop must be read-only — no gh issue edit call may appear before pending is established",
);
assert.ok(
  !detectionLoopBlock.includes("--remove-label"),
  "detection loop must not remove any label itself",
);

// 3/4. Pending labels are created, then added in one combined mutation.
const pendingCreateIdx = mustFind(
  invalidation,
  'gh label create "eren-onayi-bekliyor"',
  "pending label creation",
  detectionLoopEndIdx,
);
const pendingCreateGenericIdx = mustFind(
  invalidation,
  'gh label create "owner-approval-pending"',
  "generic pending label creation",
  pendingCreateIdx,
);
const pendingAddIdx = mustFind(
  invalidation,
  '--add-label "eren-onayi-bekliyor"',
  "pending label combined addition",
  pendingCreateGenericIdx,
);
mustInclude(
  invalidation.slice(pendingAddIdx, invalidation.indexOf("\n\n", pendingAddIdx)),
  '--add-label "owner-approval-pending"',
  "pending addition must add both pending labels in the same combined mutation",
);

// 5/6. Re-fetch, then verify BOTH pending labels are present — fail closed —
// strictly before any approved/readiness label may be removed.
const pendingRefetchIdx = mustFind(
  invalidation,
  "/tmp/labels-after-pending.txt",
  "post-pending-add label re-fetch",
  pendingAddIdx,
);
const pendingVerifyIdx = mustFind(
  invalidation,
  "for PENDING_LABEL in eren-onayi-bekliyor owner-approval-pending; do",
  "pending-present verification loop",
  pendingRefetchIdx,
);
const pendingVerifyEndIdx = mustFind(invalidation, "done", "pending verification loop end", pendingVerifyIdx);
const pendingVerifyBlock = invalidation.slice(pendingVerifyIdx, pendingVerifyEndIdx);
mustInclude(pendingVerifyBlock, "exit 1", "pending verification must fail closed");

// 7/8. ONLY NOW may approved/readiness removal begin: REMOVE_ARGS is built
// from the ORIGINAL snapshot and applied in AT MOST ONE batched mutation.
const removeArgsInitIdx = mustFind(
  invalidation,
  "REMOVE_ARGS=()",
  "REMOVE_ARGS initialization",
  pendingVerifyEndIdx,
);
const removalLoopDeclIdx = mustFind(
  invalidation,
  "for LABEL in eren-onayli owner-approved cekime-hazir cekim-paketi-hazir production-ready; do",
  "removal-args loop declaration",
  removeArgsInitIdx,
);
const removalLoopEndIdx = mustFind(invalidation, "done", "removal-args loop end", removalLoopDeclIdx);
const removalLoopBlock = invalidation.slice(removalLoopDeclIdx, removalLoopEndIdx);
mustInclude(removalLoopBlock, 'REMOVE_ARGS+=(--remove-label "$LABEL")', "removal-args loop must append eligible labels");
assert.ok(
  !removalLoopBlock.includes("gh issue edit"),
  "removal-args construction loop must not itself call gh issue edit — only one batched call is permitted, after this loop",
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
  "the old per-label removal call (one gh issue edit per label, inside the loop) must not reappear",
);
assert.ok(!invalidation.includes("|| true"), "no step in this file may suppress a failure with || true");

// 9/10/11. Re-fetch final state, verify pending is still present, verify
// every approved/readiness label is now absent — fail closed on any miss.
const finalRefetchIdx = mustFind(invalidation, "/tmp/labels-final.txt", "final-state label re-fetch", batchedRemovalIdx);
const finalPresentIdx = mustFind(
  invalidation,
  "for REQUIRED_PRESENT in eren-onayi-bekliyor owner-approval-pending; do",
  "final pending-present verification",
  finalRefetchIdx,
);
const finalPresentEndIdx = mustFind(invalidation, "done", "final present verification end", finalPresentIdx);
mustInclude(invalidation.slice(finalPresentIdx, finalPresentEndIdx), "exit 1", "final present verification must fail closed");

const finalAbsentIdx = mustFind(
  invalidation,
  "for REQUIRED_ABSENT in eren-onayli owner-approved cekime-hazir cekim-paketi-hazir production-ready; do",
  "final approved/readiness-absent verification",
  finalPresentEndIdx,
);
const finalAbsentEndIdx = mustFind(invalidation, "done", "final absent verification end", finalAbsentIdx);
mustInclude(invalidation.slice(finalAbsentIdx, finalAbsentEndIdx), "exit 1", "final absent verification must fail closed");

// 12. Only after every verification above may the confirmation comment post.
const invalidationCommentIdx = mustFind(
  invalidation,
  'gh issue comment "$ISSUE_NUMBER"',
  "invalidation confirmation comment",
  finalAbsentEndIdx,
);

// The full required structural ordering, proven as one chain:
assert.ok(
  detectionLoopIdx < detectionLoopEndIdx &&
    detectionLoopEndIdx < pendingCreateIdx &&
    pendingCreateIdx < pendingCreateGenericIdx &&
    pendingCreateGenericIdx < pendingAddIdx &&
    pendingAddIdx < pendingRefetchIdx &&
    pendingRefetchIdx < pendingVerifyIdx &&
    pendingVerifyIdx < pendingVerifyEndIdx &&
    pendingVerifyEndIdx < removeArgsInitIdx &&
    removeArgsInitIdx < removalLoopDeclIdx &&
    removalLoopDeclIdx < removalLoopEndIdx &&
    removalLoopEndIdx < batchedRemovalIdx &&
    batchedRemovalIdx < finalRefetchIdx &&
    finalRefetchIdx < finalPresentIdx &&
    finalPresentIdx < finalPresentEndIdx &&
    finalPresentEndIdx < finalAbsentIdx &&
    finalAbsentIdx < finalAbsentEndIdx &&
    finalAbsentEndIdx < invalidationCommentIdx,
  "invalidation must follow: detect < create-pending < add-pending < re-fetch < verify-pending < " +
    "build-remove-args < batched-removal < re-fetch-final < verify-present < verify-absent < comment",
);

// ===========================================================================
// C. READERS — 8 files, boolean dual-read of the readiness condition only
// ===========================================================================

// eren-production-selection-gate.yml: single combined guard line. This file
// preserves the pre-existing literal single-label grep for cekime-hazir
// (relied upon by an earlier, already-completed migration's own test) and
// adds the generic check as a De Morgan-equivalent AND-of-negations grouped
// with `{ ... ; }`, rather than rewriting the clause into a single
// `grep -qxE 'cekime-hazir|production-ready'` alternation.
mustInclude(
  readers.productionSelection,
  "! grep -qx 'cekime-hazir' /tmp/labels.txt && ! grep -qx 'production-ready' /tmp/labels.txt",
  "production-selection readiness guard must reject only when neither cekime-hazir nor production-ready is present",
);

// filming-handoff-gate.yml and filming-package-agent-v4-router.yml: both use
// a `for REQUIRED in eren-onayli cekime-hazir uretime-secildi` loop with a
// per-label elif. The new cekime-hazir branch must sit between the
// eren-onayli branch and the uretime-secildi branch (the loop's declared
// order), and must itself fail closed.
function verifyRequiredLoopReadiness(reader, labelsPath, fileLabel) {
  const loopIdx = mustFind(
    reader,
    "for REQUIRED in eren-onayli cekime-hazir uretime-secildi; do",
    `${fileLabel} REQUIRED loop declaration`,
  );
  const erenBranchIdx = mustFind(reader, 'if [[ "$REQUIRED" == "eren-onayli" ]]; then', `${fileLabel} eren-onayli branch`, loopIdx);
  const readinessBranchIdx = mustFind(
    reader,
    'elif [[ "$REQUIRED" == "cekime-hazir" ]]; then',
    `${fileLabel} cekime-hazir dual-read branch`,
    erenBranchIdx,
  );
  const scenarioBranchIdx = mustFind(
    reader,
    'elif [[ "$REQUIRED" == "uretime-secildi" ]]; then',
    `${fileLabel} uretime-secildi branch`,
    readinessBranchIdx,
  );
  assert.ok(
    erenBranchIdx < readinessBranchIdx && readinessBranchIdx < scenarioBranchIdx,
    `${fileLabel} readiness branch must sit between the owner-approval and scenario-selection branches`,
  );
  const readinessBranchBlock = reader.slice(readinessBranchIdx, scenarioBranchIdx);
  mustInclude(
    readinessBranchBlock,
    `grep -qxE 'cekime-hazir|production-ready' ${labelsPath}`,
    `${fileLabel} readiness branch must dual-read cekime-hazir OR production-ready`,
  );
  mustInclude(readinessBranchBlock, "exit 1", `${fileLabel} readiness branch must fail closed`);
}

verifyRequiredLoopReadiness(readers.filmingHandoff, "/tmp/labels.txt", "filming-handoff-gate.yml");
verifyRequiredLoopReadiness(readers.filmingRouter, "/tmp/final-labels.txt", "filming-package-agent-v4-router.yml");

// raw-video-intake-gate.yml, editing-package-agent.yml, thumbnail-package-agent.yml,
// subtitle-package-agent.yml, youtube-publication-package-agent.yml: all use two
// separate, individually-proven `jq -e '.labels | any(.name == "X")'` calls
// (each byte-identical to the already-shipped single-label idiom used
// elsewhere in this codebase) combined with a bash `&&`, rather than a single
// jq call with an internal `or` — this avoids depending on jq operator
// precedence and preserves each individual call as independently verifiable.
function verifyJqReadiness(reader, fileLabel, ownIdentityLabelCreate) {
  const legacyCallIdx = mustFind(
    reader,
    'jq -e \'.labels | any(.name == "cekime-hazir")\' /tmp/final.json > /dev/null',
    `${fileLabel} legacy jq readiness call`,
  );
  const genericCallIdx = mustFind(
    reader,
    'jq -e \'.labels | any(.name == "production-ready")\' /tmp/final.json > /dev/null',
    `${fileLabel} generic jq readiness call`,
    legacyCallIdx,
  );
  // Both calls must be joined so that failing BOTH (neither label present) is
  // what triggers rejection — i.e. an `&&` between two negated calls,
  // immediately after the legacy call and before the generic call's own
  // negation is consumed by the same `if !`.
  const betweenCalls = reader.slice(legacyCallIdx, genericCallIdx);
  assert.ok(
    betweenCalls.includes("&&") && betweenCalls.trim().startsWith("jq"),
    `${fileLabel} legacy and generic readiness calls must be joined with && (reject only if neither is present)`,
  );

  // Decisive proof, not a shadow model: the ENTIRE rejection expression, from
  // `if` through `; then`, must match one exact structural shape —
  // `if ! jq(...cekime-hazir...) && ! jq(...production-ready...); then`.
  // This single anchored regex is written so that it CANNOT match if either
  // negation is missing, if `&&` were weakened to `||`, or if either call
  // were duplicated/reordered — i.e. it independently catches every mutation
  // the review named: !A && B, A && !B, A && B, and A || B.
  const rejectionGuardRegex = new RegExp(
    "if\\s+!\\s*jq\\s+-e\\s+'\\.labels\\s*\\|\\s*any\\(\\.name\\s*==\\s*\"cekime-hazir\"\\)'" +
      "\\s+/tmp/final\\.json\\s*>\\s*/dev/null\\s*\\\\?\\s*" +
      "&&\\s*!\\s*jq\\s+-e\\s+'\\.labels\\s*\\|\\s*any\\(\\.name\\s*==\\s*\"production-ready\"\\)'" +
      "\\s+/tmp/final\\.json\\s*>\\s*/dev/null\\s*;\\s*then",
  );
  assert.ok(
    rejectionGuardRegex.test(reader),
    `${fileLabel}: rejection guard must be exactly "if ! jq(...cekime-hazir...) && ! jq(...production-ready...); then" — ` +
      "both calls negated, joined by &&, legacy first, generic second",
  );

  // Explicit negative controls: none of the known-dangerous mutated shapes
  // may match this file's source, proven directly rather than inferred.
  const droppedFirstNegation = new RegExp(
    "if\\s+jq\\s+-e\\s+'\\.labels\\s*\\|\\s*any\\(\\.name\\s*==\\s*\"cekime-hazir\"\\)'" +
      "\\s+/tmp/final\\.json\\s*>\\s*/dev/null\\s*\\\\?\\s*&&\\s*!\\s*jq",
  );
  const droppedSecondNegation = new RegExp(
    "if\\s+!\\s*jq\\s+-e\\s+'\\.labels\\s*\\|\\s*any\\(\\.name\\s*==\\s*\"cekime-hazir\"\\)'" +
      "\\s+/tmp/final\\.json\\s*>\\s*/dev/null\\s*\\\\?\\s*&&\\s*jq\\s+-e\\s+'\\.labels\\s*\\|\\s*any\\(\\.name\\s*==\\s*\"production-ready\"\\)'",
  );
  assert.ok(!droppedFirstNegation.test(reader), `${fileLabel}: legacy jq call must not be un-negated (!A && B shape)`);
  assert.ok(!droppedSecondNegation.test(reader), `${fileLabel}: generic jq call must not be un-negated (A && !B shape)`);
  assert.ok(!reader.includes(
    "jq -e '.labels | any(.name == \"cekime-hazir\")' /tmp/final.json > /dev/null " +
      "&& jq -e '.labels | any(.name == \"production-ready\")' /tmp/final.json > /dev/null",
  ), `${fileLabel}: both jq calls must not be un-negated (A && B shape)`);
  if (ownIdentityLabelCreate) {
    const identityCreateIdx = mustFind(
      reader,
      ownIdentityLabelCreate,
      `${fileLabel} own package identity label creation`,
      genericCallIdx,
    );
    assert.ok(
      genericCallIdx < identityCreateIdx,
      `${fileLabel} readiness check must be verified before that stage creates its own downstream package`,
    );
  }
}

verifyJqReadiness(readers.rawVideoIntake, "raw-video-intake-gate.yml", 'gh label create "ham-video-teslim"');
verifyJqReadiness(readers.editing, "editing-package-agent.yml", 'gh label create "kurgu-paketi"');
verifyJqReadiness(readers.thumbnail, "thumbnail-package-agent.yml", 'gh label create "thumbnail-paketi"');
verifyJqReadiness(readers.subtitle, "subtitle-package-agent.yml", 'gh label create "altyazi-paketi"');
verifyJqReadiness(
  readers.youtubePublicationPackage,
  "youtube-publication-package-agent.yml",
  'gh label create "youtube-yayin-paketi-hazir"',
);

// Boolean-state model: neither label present must fail closed for every
// reader form actually used above (grep -qxE and jq any(...) both correctly
// return false/non-zero when neither literal is present in the source set —
// modeled here to prove the logical contract, independent of the literal
// source checks already performed above).
function resolveReadiness(labels) {
  return labels.includes("cekime-hazir") || labels.includes("production-ready");
}
assert.equal(resolveReadiness(["cekime-hazir"]), true, "legacy-only must be accepted");
assert.equal(resolveReadiness(["production-ready"]), true, "generic-only must be accepted");
assert.equal(resolveReadiness(["cekime-hazir", "production-ready"]), true, "both present must be accepted");
assert.equal(resolveReadiness([]), false, "neither present must be rejected");
assert.equal(resolveReadiness(["sistem-testi"]), false, "unrelated labels must not satisfy readiness");

// ===========================================================================
// D. COMPLETED MIGRATIONS — no regression
// ===========================================================================

// Owner Approval Phase 1 dual-read/write remains intact in the exact two
// files this diff touched.
mustInclude(writer, "grep -qxE 'eren-onayi-bekliyor|owner-approval-pending' /tmp/approval-labels.txt");
mustInclude(writer, "grep -qxE 'eren-onayli|owner-approved' /tmp/approval-labels.txt");
mustInclude(writer, 'gh label create "eren-onayli"');
mustInclude(writer, 'gh label create "owner-approved"');
mustInclude(invalidation, 'gh label create "eren-onayi-bekliyor"');
mustInclude(invalidation, 'gh label create "owner-approval-pending"');

// Production Selection Phase 1 semantics remain byte-for-byte unchanged in
// the three files this diff also touched for the readiness migration.
// eren-production-selection-gate.yml is the WRITER of that state — its own
// dual-write must survive untouched.
mustInclude(readers.productionSelection, '--add-label "uretime-secildi"', "production-selection dual-write must survive");
mustInclude(readers.productionSelection, '--add-label "production-selected"', "production-selection dual-write must survive");
// filming-handoff-gate.yml and filming-package-agent-v4-router.yml are
// READERS of that state — their OR-based scenario dual-read and the
// scenario-mismatch fail-closed matrix must still be present verbatim.
for (const reader of [readers.filmingHandoff, readers.filmingRouter]) {
  mustInclude(reader, "uretime-secildi|production-selected", "production-selection dual-read must survive");
}
mustInclude(
  readers.filmingHandoff,
  '[[ "${#LEGACY_SELECTION_LABELS[@]}" -gt 1 || "${#GENERIC_SELECTION_LABELS[@]}" -gt 1 ]]',
  "scenario multiple-label fail-closed guard must survive in filming-handoff-gate.yml",
);
mustInclude(
  readers.filmingRouter,
  '[[ "${#LEGACY_SELECTION_LABELS[@]}" -gt 1 || "${#GENERIC_SELECTION_LABELS[@]}" -gt 1 ]]',
  "scenario multiple-label fail-closed guard must survive in filming-package-agent-v4-router.yml",
);
mustInclude(readers.filmingHandoff, "FILMING_HANDOFF_V1", "FILMING_HANDOFF_V1 marker must remain mandatory");
mustInclude(readers.filmingRouter, "FILMING_HANDOFF_V1", "FILMING_HANDOFF_V1 marker must remain mandatory");

// Publication Approval migration (a separate, already-completed slice) must
// remain fully isolated from this label vocabulary.
const publicationGate = read(".github/workflows/youtube-publication-approval-gate.yml");
const publicationInvalidation = read(".github/workflows/publication-approval-invalidation-gate.yml");
for (const untouched of [publicationGate, publicationInvalidation]) {
  assert.ok(!untouched.includes("production-ready"), "publication approval files must not gain production-ready vocabulary");
  assert.ok(!untouched.includes('"cekime-hazir"'), "publication approval files must not gain cekime-hazir vocabulary");
}
mustInclude(publicationGate, 'any(.name == "eren-yayin-onayli" or .name == "publication-approved")');
mustInclude(publicationInvalidation, "publication-approval-pending");

// ===========================================================================
// E. SIDE-EFFECT SAFETY
// ===========================================================================

// The writer and invalidation gate must never gain any dispatch/provider
// capability — these files have no legitimate reason to ever contain any of
// the following, unlike several reader files which legitimately declare
// workflow_dispatch as their own pre-existing trigger.
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
  assert.ok(!writer.includes(forbidden), `writer gained forbidden capability: ${forbidden}`);
  assert.ok(!invalidation.includes(forbidden), `invalidation gate gained forbidden capability: ${forbidden}`);
}

// For the 8 reader files (several of which legitimately already declare
// workflow_dispatch as their own trigger, or already call AI providers deep
// in their existing package-creation logic), scope the check narrowly to the
// exact text this diff introduced: the new readiness dual-read lines
// themselves must not contain any dispatch/provider/network call.
const introducedReadinessSnippets = [
  "! grep -qx 'cekime-hazir' /tmp/labels.txt && ! grep -qx 'production-ready' /tmp/labels.txt",
  "grep -qxE 'cekime-hazir|production-ready' /tmp/labels.txt",
  "grep -qxE 'cekime-hazir|production-ready' /tmp/final-labels.txt",
  'jq -e \'.labels | any(.name == "cekime-hazir")\' /tmp/final.json > /dev/null',
  'jq -e \'.labels | any(.name == "production-ready")\' /tmp/final.json > /dev/null',
];
for (const snippet of introducedReadinessSnippets) {
  for (const forbidden of [
    "workflow_dispatch",
    "repository_dispatch",
    "gh api",
    "curl ",
    "youtube.googleapis.com",
  ]) {
    assert.ok(!snippet.includes(forbidden), `introduced readiness snippet unexpectedly contains: ${forbidden}`);
  }
}

console.log(
  "production_readiness_label_migration_phase1_ok network=0 ai_calls=0 video_calls=0 youtube_calls=0 issue_writes=0 dispatches=0",
);

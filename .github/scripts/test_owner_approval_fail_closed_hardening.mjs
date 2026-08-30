#!/usr/bin/env node
/**
 * Section E — eren-approval-gate.yml fail-closed hardening.
 *
 * Closes the audit gap where the pending-label removal (`|| true`) had no
 * verification: if it silently failed, the Issue could end up both
 * "approved" and "pending" at the same time, and nothing would catch it.
 * This test proves the MUTATE -> REFETCH -> VERIFY EXACT FINAL STATE ->
 * SUCCESS standard (the same one used by the filming-package shared
 * persistence script) is actually followed here: after the label mutation,
 * the workflow must re-fetch the issue and fail closed unless BOTH the
 * required labels are present AND the pending/blocking labels are absent.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
const stripComments = (text) =>
  text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

const rawWorkflow = read(".github/workflows/eren-approval-gate.yml");
const workflow = stripComments(rawWorkflow);

const mustFind = (text, needle, message = needle, fromIndex = 0) => {
  const index = text.indexOf(needle, fromIndex);
  assert.ok(index >= 0, `missing executable contract: ${message}`);
  return index;
};

// 1. The mutation step exists: add all four approval/ready labels together.
const addLabelsIdx = mustFind(
  workflow,
  'gh issue edit "$ISSUE_NUMBER" \\\n            --add-label "eren-onayli"',
  "combined add-label mutation for all four approval/ready labels"
);
const addLabelsBlockEnd = mustFind(
  workflow,
  '--add-label "production-ready"',
  "add-label call end (last label)",
  addLabelsIdx
) + '--add-label "production-ready"'.length;
const addLabelsBlock = workflow.slice(addLabelsIdx, addLabelsBlockEnd);
for (const label of ["eren-onayli", "owner-approved", "cekime-hazir", "production-ready"]) {
  assert.ok(addLabelsBlock.includes(`--add-label "${label}"`), `add mutation must include ${label}`);
}

// 2. REFETCH happens after the mutation, into the same file the rest of
// this test scopes its checks against.
const refetchIdx = mustFind(
  workflow,
  'gh issue view "$ISSUE_NUMBER" --json labels --jq \'.labels[].name\' \\\n            > /tmp/approval-labels-after.txt',
  "refetch of the issue's labels after mutation",
  addLabelsBlockEnd
);

// 3. VERIFY PRESENT: all four required labels must be confirmed present
// against the refetched state (not just assumed from the mutation call's
// own exit code).
const presentLoopIdx = mustFind(
  workflow,
  "for REQUIRED_PRESENT in eren-onayli owner-approved cekime-hazir production-ready; do",
  "presence-verification loop",
  refetchIdx
);
const presentLoopEnd = mustFind(workflow, "done", "presence loop end", presentLoopIdx);
const presentLoopBlock = workflow.slice(presentLoopIdx, presentLoopEnd);
assert.match(presentLoopBlock, /approval-labels-after\.txt/, "presence check must read the REFETCHED file, not the pre-mutation one");
assert.match(presentLoopBlock, /exit 1/, "presence verification must fail closed");
// Exact condition line — not just substring presence — so a neutered
// always-false guard (e.g. "if false && ! grep ...") cannot slip past a
// looser check that only confirms the fragments exist somewhere nearby.
assert.match(
  presentLoopBlock,
  /if\s*!\s*grep\s+-qx\s+"\$REQUIRED_PRESENT"\s+\/tmp\/approval-labels-after\.txt;\s*then/,
  "presence verification's condition must be exactly this check, not a weakened/neutered variant"
);

// 4. VERIFY ABSENT — the actual fix: pending/blocking labels must be
// confirmed ABSENT from the same refetched state, fail-closed otherwise.
// This is what closes the "approved + pending at once" gap.
const absentLoopIdx = mustFind(
  workflow,
  "for REQUIRED_ABSENT in eren-onayi-bekliyor owner-approval-pending duzeltme-gerekiyor; do",
  "absence-verification loop (the fail-closed fix)",
  presentLoopEnd
);
const absentLoopEnd = mustFind(workflow, "done", "absence loop end", absentLoopIdx);
const absentLoopBlock = workflow.slice(absentLoopIdx, absentLoopEnd);
assert.match(absentLoopBlock, /approval-labels-after\.txt/, "absence check must read the REFETCHED file");
assert.match(absentLoopBlock, /grep -qx "\$REQUIRED_ABSENT"/, "must actually check for presence-to-reject, not just look busy");
assert.match(absentLoopBlock, /exit 1/, "absence verification must fail closed");
// Exact condition line — rejects a neutered always-false guard (e.g.
// "if false && grep -qx ..."), which would otherwise still contain every
// substring the looser checks above are satisfied by, while never actually
// firing. This is exactly the "mixed approved+pending state accepted"
// mutation this test is required to catch.
assert.match(
  absentLoopBlock,
  /if\s*grep\s+-qx\s+"\$REQUIRED_ABSENT"\s+\/tmp\/approval-labels-after\.txt;\s*then/,
  "absence verification's condition must be exactly this check, not a weakened/neutered variant"
);

for (const requiredAbsentLabel of ["eren-onayi-bekliyor", "owner-approval-pending", "duzeltme-gerekiyor"]) {
  assert.ok(absentLoopBlock.includes(requiredAbsentLabel), `absence check must cover ${requiredAbsentLabel}`);
}

// 5. Ordering: mutation -> refetch -> verify-present -> verify-absent ->
// (only then) success comment/summary.
const successCommentIdx = mustFind(
  workflow,
  'gh issue comment "$ISSUE_NUMBER" --body "$(cat <<MESSAGE',
  "success comment",
  absentLoopEnd
);
assert.ok(
  addLabelsIdx < refetchIdx &&
    refetchIdx < presentLoopIdx &&
    presentLoopIdx < absentLoopIdx &&
    absentLoopIdx < successCommentIdx,
  "must follow MUTATE -> REFETCH -> VERIFY PRESENT -> VERIFY ABSENT -> SUCCESS, in that exact order"
);

// 6. The pending-label removal call itself may still tolerate "already
// absent" as non-fatal (`|| true`) — that is fine BECAUSE the absence
// verification above is what's actually load-bearing now, not this call's
// own exit code. But it must still be attempted (not silently skipped).
mustFind(
  rawWorkflow,
  '--remove-label "eren-onayi-bekliyor"',
  "pending-label removal must still be attempted"
);
mustFind(
  rawWorkflow,
  '--remove-label "owner-approval-pending"',
  "generic pending-label removal must still be attempted"
);

// 7. Backward compatibility: dual-write/dual-read for legacy + generic
// labels must still be intact (unchanged by this hardening).
for (const contract of [
  'grep -qxE \'eren-onayi-bekliyor|owner-approval-pending\' /tmp/approval-labels.txt',
  'grep -qxE \'eren-onayli|owner-approved\' /tmp/approval-labels.txt',
  'gh label create "eren-onayli"',
  'gh label create "owner-approved"',
  'gh label create "cekime-hazir"',
  'gh label create "production-ready"',
]) {
  assert.ok(workflow.includes(contract), `legacy/generic compatibility contract missing: ${contract}`);
}

console.log(
  "owner_approval_fail_closed_hardening_ok ai_calls=0 api_calls=0 issue_writes=0 dispatches=0 video_calls=0"
);

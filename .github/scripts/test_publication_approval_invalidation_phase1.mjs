#!/usr/bin/env node
/**
 * Deterministic zero-network checks for Publication Approval Invalidation Phase 1.
 *
 * This test enforces the fail-safe transition design: an already-approved publication
 * Issue must never be observable with approved labels removed AND no pending state.
 *
 * Hardening in this revision (test-only, workflow unchanged):
 *  - All assertions run against a COMMENT-STRIPPED copy of the workflow (full-line YAML
 *    and Bash comments removed), so a guard/mutation that only exists inside a comment
 *    (or a guard that was moved below a mutation, leaving a stale commented-out copy
 *    above it) cannot satisfy any check.
 *  - `ensure_label_exists` is proven to be defined exactly once and invoked EXACTLY
 *    twice, each time with a literal (non-variable) argument matching one of the two
 *    permitted pending labels, in a fixed order. A third invocation, a swapped literal,
 *    or a variable/dynamic first argument all fail the test.
 *  - Every `--add-label` / `--remove-label` / `gh label create` argument in the script is
 *    resolved — literal arguments must be in the permitted set directly; variable
 *    arguments (`$LABEL`, `$NAME`, ...) are traced back to their source (`for ... in ...`
 *    loop or, for `$NAME`, the already-verified `ensure_label_exists` call sites) and
 *    every value that variable could hold must also be in the permitted set. This closes
 *    the dynamic-mutation bypass a purely literal-string scan would miss.
 *  - The safety/notification comment (`gh issue comment`) is proven to occur strictly
 *    after the final-state re-fetch and both its presence/absence verification loops.
 *
 * Ordering-sensitive checks compare source positions (string indices), never bare
 * substring presence, so a guard accidentally moved below a mutation fails the test.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPath = path.join(root, ".github/workflows/publication-approval-invalidation-gate.yml");
const rawWorkflow = readFileSync(workflowPath, "utf8");

// ---------------------------------------------------------------------------
// Comment stripping (Node built-ins only, zero network, zero dependencies).
// Removes any line whose trimmed content starts with '#' — this covers both
// top-level YAML comments and Bash comment-only lines inside the `run:` block
// (including phase-marker comments, which must therefore NOT be relied upon by
// any assertion below). Inline trailing comments after real code are left
// untouched — this file does not use them, and stripping them safely would
// require a real shell/YAML parser, which this test deliberately avoids.
// ---------------------------------------------------------------------------
function stripFullLineComments(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

const workflow = stripFullLineComments(rawWorkflow);

// Sanity: comment stripping must have actually removed something (proves the
// phase-marker comments exist AND that stripping is active, not a no-op).
assert.ok(rawWorkflow.length > workflow.length, "comment stripping did not remove any line");
assert.ok(!workflow.includes("PHASE 1"), "stripping failed to remove comment markers");

function must(needle, label, fromIndex = 0) {
  const i = workflow.indexOf(needle, fromIndex);
  assert.ok(i >= 0, `${label ?? needle} not found in executable content (from index ${fromIndex})`);
  return i;
}

// ---------------------------------------------------------------------------
// 1. Trigger is only `issues: edited`.
// ---------------------------------------------------------------------------
assert.match(workflow, /^on:\s*\n\s+issues:\s*\n\s+types:\s*\n\s+- edited\s*$/m);

// ---------------------------------------------------------------------------
// Locate the first mutation-capable command. Everything that must run "before
// any mutation" is asserted to occur strictly before this index.
// ---------------------------------------------------------------------------
const firstMutationIdx = Math.min(
  ...["gh issue edit", "gh label create", "gh issue comment"]
    .map((s) => workflow.indexOf(s))
    .filter((i) => i >= 0),
);
assert.ok(firstMutationIdx > 0, "could not locate any mutation command to anchor ordering checks");

// 2. github.event.changes.body != null required before mutations.
const bodyChangeIdx = must("github.event.changes.body != null", "body-change guard");
assert.ok(bodyChangeIdx < firstMutationIdx, "body-change guard must precede first mutation");

// 3. Pull requests excluded before mutations.
const prExclusionIdx = must("github.event.issue.pull_request == null", "PR exclusion");
assert.ok(prExclusionIdx < firstMutationIdx, "PR exclusion must precede first mutation");

// 4. Exact production title prefix guard occurs before mutations.
const titleGuardIdx = must(
  "startsWith(github.event.issue.title, 'YouTube Yayın Paketi - Thumbnail Paketi #')",
  "production title guard",
);
assert.ok(titleGuardIdx < firstMutationIdx, "title guard must precede first mutation");
const stepsIdx = must("steps:", "steps: block");
assert.ok(bodyChangeIdx < stepsIdx && prExclusionIdx < stepsIdx && titleGuardIdx < stepsIdx);

// 5. Issue is fetched before mutation.
const issueViewIdx = must('gh issue view "$ISSUE_NUMBER" --json labels,url', "initial issue fetch");
assert.ok(issueViewIdx < firstMutationIdx, "issue must be fetched before any mutation");

// 6. youtube-yayin-paketi guard occurs before mutation, using the fetched labels.
const ytPackageGuardIdx = must("if ! grep -qx 'youtube-yayin-paketi'", "youtube-yayin-paketi guard");
assert.ok(ytPackageGuardIdx < firstMutationIdx, "youtube-yayin-paketi guard must precede mutation");
assert.ok(ytPackageGuardIdx > issueViewIdx, "youtube-yayin-paketi guard must run after the issue is fetched");

// 7. sistem-testi exclusion occurs before mutation.
const sistemTestiIdx = must("grep -qx 'sistem-testi'", "sistem-testi exclusion");
assert.ok(sistemTestiIdx < firstMutationIdx, "sistem-testi exclusion must precede mutation");

// 8. No-approved-state early exit occurs before mutation.
const hadApprovalExitIdx = must(
  '[[ "$HAD_PUBLICATION_APPROVAL" != "true" ]]',
  "no-prior-approval early exit",
);
assert.ok(hadApprovalExitIdx < firstMutationIdx, "no-prior-approval early exit must precede mutation");

// ---------------------------------------------------------------------------
// 9 & 10. BOTH pending labels are prepared AND added before approved labels are
// removed. 26. No `--force` is used while preparing the pending labels.
// ---------------------------------------------------------------------------
const ensureLegacyPendingIdx = must(
  'ensure_label_exists "eren-yayin-onayi-bekliyor"',
  "legacy pending label prepared",
);
const ensureGenericPendingIdx = must(
  'ensure_label_exists "publication-approval-pending"',
  "generic pending label prepared",
);
const addLegacyPendingIdx = must('--add-label "eren-yayin-onayi-bekliyor"', "legacy pending label added");
const addGenericPendingIdx = must(
  '--add-label "publication-approval-pending"',
  "generic pending label added",
);
const pendingVerifyGuardIdx = must("Pending durumu doğrulanamadı", "pending-state verification guard");

const removalCallIdx = must(
  'gh issue edit "$ISSUE_NUMBER" "${REMOVE_ARGS[@]}"',
  "approved-label removal mutation",
  pendingVerifyGuardIdx,
);

for (const [name, i] of [
  ["legacy pending preparation", ensureLegacyPendingIdx],
  ["generic pending preparation", ensureGenericPendingIdx],
  ["legacy pending addition", addLegacyPendingIdx],
  ["generic pending addition", addGenericPendingIdx],
  ["pending-state verification", pendingVerifyGuardIdx],
]) {
  assert.ok(i < removalCallIdx, `${name} must occur before the approved-label removal mutation`);
}
assert.ok(ensureLegacyPendingIdx < addLegacyPendingIdx, "legacy pending must be prepared before it is added");
assert.ok(ensureGenericPendingIdx < addLegacyPendingIdx, "generic pending must be prepared before labels are added");
assert.ok(addLegacyPendingIdx < pendingVerifyGuardIdx, "pending labels must be added before verification");

const pendingPrepBlock = workflow.slice(0, addGenericPendingIdx);
assert.ok(!pendingPrepBlock.includes("--force"), "pending-label preparation must not use --force");

// ---------------------------------------------------------------------------
// 1 & 4 (MEDIUM #1 / #4). ensure_label_exists: defined exactly once, invoked
// EXACTLY twice, each with a literal argument, in the required order, and no
// dynamic/variable invocation is permitted.
// ---------------------------------------------------------------------------
const ensureLines = workflow.split("\n").filter((line) => line.includes("ensure_label_exists"));
const definitionLines = ensureLines.filter((line) => /ensure_label_exists\(\)\s*\{/.test(line));
assert.equal(definitionLines.length, 1, "ensure_label_exists must be defined exactly once");

const invocationLines = ensureLines.filter((line) => !/ensure_label_exists\(\)\s*\{/.test(line));
assert.equal(
  invocationLines.length,
  2,
  `ensure_label_exists must be invoked exactly twice; found ${invocationLines.length}`,
);

const expectedInvocationOrder = ["eren-yayin-onayi-bekliyor", "publication-approval-pending"];
invocationLines.forEach((line, i) => {
  assert.ok(
    !/ensure_label_exists\s+\$/.test(line),
    `invocation #${i + 1} must not use a dynamic variable argument: ${line.trim()}`,
  );
  const m = line.match(/ensure_label_exists\s+"([^"]*)"/);
  assert.ok(m, `invocation #${i + 1} does not use a literal quoted first argument: ${line.trim()}`);
  assert.equal(
    m[1],
    expectedInvocationOrder[i],
    `invocation #${i + 1} must be exactly "${expectedInvocationOrder[i]}", found "${m[1]}"`,
  );
});

// ---------------------------------------------------------------------------
// 11-13. eren-yayin-onayli / publication-approved / yayina-hazir removal is
// independently verified (each name checked on its own).
// ---------------------------------------------------------------------------
const removalDeclIdx = must(
  "for LABEL in eren-yayin-onayli publication-approved yayina-hazir; do",
  "approved-label removal-args loop",
  pendingVerifyGuardIdx, // the second occurrence — the first is PHASE 1's read-only check
);
const removalDeclLine = workflow.slice(removalDeclIdx, workflow.indexOf("\n", removalDeclIdx));
for (const label of ["eren-yayin-onayli", "publication-approved", "yayina-hazir"]) {
  assert.ok(
    removalDeclLine.includes(label),
    `${label} is not independently present in the removal-args declaration`,
  );
}
// Exactly these three, in this order, and no fourth value smuggled into the same loop.
const removalDeclList = removalDeclLine.match(/for LABEL in ([^;]+); do/)[1].trim().split(/\s+/);
assert.deepEqual(
  removalDeclList,
  ["eren-yayin-onayli", "publication-approved", "yayina-hazir"],
  "removal-args loop must declare exactly these three labels, in this order, and no others",
);
assert.ok(
  workflow.includes('REMOVE_ARGS+=(--remove-label "$LABEL")'),
  "removal-args construction must use --remove-label",
);
assert.ok(
  workflow.slice(removalDeclIdx, removalCallIdx).includes("/tmp/publication-labels.txt"),
  "removal loop must consult the pre-mutation label snapshot",
);

// ---------------------------------------------------------------------------
// MEDIUM #5 (hardened). Every label-mutation argument in the script — literal
// or variable — must resolve to one of the five permitted publication-state
// labels, on the correct side (add vs remove). Variable arguments are traced
// back to their declaring `for ... in ...` loop; every value that loop could
// ever produce must itself be permitted. `$NAME` inside ensure_label_exists is
// accepted only because its two call sites were just proven, above, to be
// restricted to exactly the two permitted pending labels.
// ---------------------------------------------------------------------------
const PERMITTED_ADD = new Set(["eren-yayin-onayi-bekliyor", "publication-approval-pending"]);
const PERMITTED_REMOVE = new Set(["eren-yayin-onayli", "publication-approved", "yayina-hazir"]);
const PERMITTED_ANY = new Set([...PERMITTED_ADD, ...PERMITTED_REMOVE]);

const forLoopDeclarations = [...workflow.matchAll(/for\s+(\w+)\s+in\s+([^;]+);\s*do/g)].map((m) => ({
  varName: m[1],
  values: m[2].trim().split(/\s+/),
}));

function extractFlagArgs(flagPattern) {
  return [...workflow.matchAll(new RegExp(`${flagPattern}\\s+"([^"]+)"`, "g"))].map((m) => m[1]);
}

function resolveLabelArg(arg, contextLabel, permittedSet) {
  if (!arg.startsWith("$")) {
    assert.ok(permittedSet.has(arg), `${contextLabel} uses a literal label outside the permitted set: ${arg}`);
    return;
  }
  const varName = arg.slice(1);
  if (varName === "NAME") {
    // Bound exclusively by the two already-verified ensure_label_exists call sites.
    return;
  }
  const decl = forLoopDeclarations.find((d) => d.varName === varName);
  assert.ok(decl, `${contextLabel} uses variable $${varName} whose source for-loop could not be located`);
  for (const value of decl.values) {
    assert.ok(
      permittedSet.has(value),
      `${contextLabel} variable $${varName} can resolve to an unpermitted label via its for-loop: ${value}`,
    );
  }
}

for (const arg of extractFlagArgs("--add-label")) resolveLabelArg(arg, "--add-label", PERMITTED_ADD);
for (const arg of extractFlagArgs("--remove-label")) resolveLabelArg(arg, "--remove-label", PERMITTED_REMOVE);

// gh label create must appear exactly once, and only ever create via the bound
// $NAME parameter (whose only possible values were already proven above).
const labelCreateOccurrences = extractFlagArgs("gh label create");
assert.equal(labelCreateOccurrences.length, 1, "gh label create must appear exactly once in the script");
assert.equal(
  labelCreateOccurrences[0],
  "$NAME",
  "gh label create must only ever use the function's bound $NAME parameter",
);

// No bulk/replace label flag, and youtube-yayin-paketi is never removed.
assert.ok(
  !workflow.includes('--remove-label "youtube-yayin-paketi"'),
  "youtube-yayin-paketi must never be removed",
);
assert.ok(!workflow.includes("--label "), "no bare --label flag (bulk replace) may be used");

// Cross-check: every literal label mentioned anywhere in an add/remove/create
// context belongs to the five-label set (belt-and-braces on top of the
// per-flag checks above).
for (const arg of [
  ...extractFlagArgs("--add-label"),
  ...extractFlagArgs("--remove-label"),
  ...extractFlagArgs("gh label create"),
]) {
  if (arg.startsWith("$")) continue; // already resolved above
  assert.ok(PERMITTED_ANY.has(arg), `unexpected label literal used in a mutation context: ${arg}`);
}

// ---------------------------------------------------------------------------
// 17-19. Minimum permissions; per-Issue concurrency; cancel-in-progress: false.
// ---------------------------------------------------------------------------
const permissionsMatch = workflow.match(/^permissions:\s*\n((?:\s+\S+:\s*\S+\s*\n)+)/m);
assert.ok(permissionsMatch, "permissions block not found");
assert.ok(!permissionsMatch[1].includes("contents:"), "unnecessary contents: permission must be removed");
assert.ok(permissionsMatch[1].includes("issues: write"), "issues: write permission is required");

assert.ok(
  workflow.includes("group: publication-approval-invalidation-${{ github.event.issue.number }}"),
  "per-Issue concurrency group missing",
);
assert.ok(workflow.includes("cancel-in-progress: false"), "cancel-in-progress: false is required");

// ---------------------------------------------------------------------------
// 20-22. No dispatch or cross-workflow trigger chain.
// ---------------------------------------------------------------------------
for (const forbidden of [
  "workflow_dispatch",
  "repository_dispatch",
  "workflow_run",
  "workflow_call",
  "actions/workflows/",
  "/dispatches",
]) {
  assert.ok(!workflow.includes(forbidden), `forbidden dispatch/trigger capability found: ${forbidden}`);
}

// ---------------------------------------------------------------------------
// 23-25. No YouTube/publication API, no external API call, no AI/video call.
// ---------------------------------------------------------------------------
for (const forbidden of [
  "gh api",
  "curl ",
  "wget ",
  "youtube.googleapis.com",
  "googleapis.com/upload",
  "videos.insert",
  "publishAt",
  "privacyStatus",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "RUNWAY_API_KEY",
  "ai_router.py",
  "video_orchestrator.py",
]) {
  assert.ok(!workflow.includes(forbidden), `forbidden runtime capability found: ${forbidden}`);
}

// ---------------------------------------------------------------------------
// 27 + MEDIUM #3. Final-state verification exists AND the safety/notification
// comment is proven to occur strictly after it (both presence and absence).
// ---------------------------------------------------------------------------
const finalFetchIdx = must("/tmp/publication-labels-final.txt", "final-state label fetch", removalCallIdx);
assert.ok(finalFetchIdx > removalCallIdx, "final-state fetch must happen after the removal mutation");

const requiredPresentIdx = must(
  "for REQUIRED_PRESENT in youtube-yayin-paketi eren-yayin-onayi-bekliyor publication-approval-pending; do",
  "final-state presence verification",
);
const requiredAbsentIdx = must(
  "for REQUIRED_ABSENT in eren-yayin-onayli publication-approved yayina-hazir; do",
  "final-state absence verification",
);
assert.ok(requiredPresentIdx > finalFetchIdx, "presence verification must use the post-removal fetch");
assert.ok(requiredAbsentIdx > finalFetchIdx, "absence verification must use the post-removal fetch");

const requiredAbsentBlockEndIdx = workflow.indexOf("done", requiredAbsentIdx) + "done".length;
const commentCallIdx = must('gh issue comment "$ISSUE_NUMBER"', "safety comment", requiredAbsentBlockEndIdx);
assert.ok(
  commentCallIdx > finalFetchIdx,
  "the safety comment must be posted after the final-state re-fetch",
);
assert.ok(
  commentCallIdx > requiredPresentIdx,
  "the safety comment must be posted after REQUIRED_PRESENT verification",
);
assert.ok(
  commentCallIdx > requiredAbsentBlockEndIdx,
  "the safety comment must be posted after REQUIRED_ABSENT verification completes",
);

console.log(
  "publication_approval_invalidation_phase1_ok network=0 ai_calls=0 api_calls=0 issue_writes=0 dispatches=0 uploads=0 publications=0 video_calls=0",
);

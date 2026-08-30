#!/usr/bin/env node
/**
 * TEST_MODE isolation for editing-package-agent.yml.
 *
 * Answers, with an executable check rather than an assumption: "If
 * TEST_MODE=true is run for the very first time (no cached output, so
 * SKIP_EDITING=false), can any real/billable AI or provider call happen?"
 * The answer this test enforces is NO.
 *
 * TEST_MODE and SKIP_EDITING are deliberately two separate concerns here:
 *   - TEST_MODE  -> is any real external side effect / provider reachable?
 *   - SKIP_EDITING -> idempotency only (a fresh package for these exact
 *     source bytes already exists, so don't rebuild it) -- true in EITHER
 *     mode, and never a substitute for TEST_MODE's isolation.
 *
 * Zero-network, zero-token static source-text check (never executes the
 * workflow). See also validate_editing_package_test_mode_isolation
 * mutation battery (scratch-only) for proof each of the 8 named mutants
 * actually gets caught.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");

const workflow = read(".github/workflows/editing-package-agent.yml");
const persistScript = read(".github/scripts/persist_editing_package_labels.sh");
const validatorScript = read(".github/scripts/validate_editing_package_output.sh");

const mustFind = (text, needle, message = needle, fromIndex = 0) => {
  const index = text.indexOf(needle, fromIndex);
  assert.ok(index >= 0, `missing executable contract: ${message}`);
  return index;
};

const exactIfCondition = (text, stepName, fromIndex = 0) => {
  const stepIdx = mustFind(text, `- name: ${stepName}`, `step: ${stepName}`, fromIndex);
  const ifLineEnd = text.indexOf("\n", text.indexOf("if:", stepIdx));
  return { stepIdx, condition: text.slice(text.indexOf("if:", stepIdx), ifLineEnd).trim() };
};

const stepBlock = (text, stepName, fromIndex = 0) => {
  const stepIdx = mustFind(text, `- name: ${stepName}`, `step: ${stepName}`, fromIndex);
  const nextStepIdx = text.indexOf("\n      - name:", stepIdx + 1);
  return { stepIdx, block: text.slice(stepIdx, nextStepIdx >= 0 ? nextStepIdx : text.length) };
};

// ---------------------------------------------------------------------
// 1. Every AI/provider-reachable step requires TEST_MODE != 'true'
// EXACTLY -- not SKIP_EDITING alone, not a widened OR condition.
// ---------------------------------------------------------------------
const aiGatedSteps = [
  "Token tasarruflu kurgu planı isteğini hazırla",
  "Cost guard ön kontrolü (preflight)",
  "Kurgu paketini oluştur ve doğrula",
];
for (const stepName of aiGatedSteps) {
  const { condition } = exactIfCondition(workflow, stepName);
  assert.equal(
    condition,
    "if: env.SKIP_EDITING != 'true' && env.TEST_MODE != 'true'",
    `${stepName} must require BOTH SKIP_EDITING!='true' AND TEST_MODE!='true' -- TEST_MODE is what makes it AI-unreachable in test mode, SKIP_EDITING alone is not enough`
  );
}

// ---------------------------------------------------------------------
// 2. The test-mode fixture step exists, is gated on the exact opposite
// TEST_MODE condition, and is the ONLY place TEST_MODE=true output comes
// from.
// ---------------------------------------------------------------------
const fixtureStepName = "Kurgu paketi test modu fixture'ını üret ve doğrula";
const { condition: fixtureCondition, stepIdx: fixtureStepIdx } = exactIfCondition(workflow, fixtureStepName);
assert.equal(
  fixtureCondition,
  "if: env.SKIP_EDITING != 'true' && env.TEST_MODE == 'true'",
  "fixture step must be gated on exactly SKIP_EDITING!='true' && TEST_MODE=='true'"
);

const { block: fixtureBlock } = stepBlock(workflow, fixtureStepName);

// ---------------------------------------------------------------------
// 3. The fixture step contains ZERO AI/provider/cost-guard/dispatch/
// write capability -- it may only write a local temp file and run the
// shared, zero-network output-contract validator against it.
// ---------------------------------------------------------------------
for (const forbidden of [
  "ai_router.py",
  "cost_guard.py",
  "curl ",
  "gh issue",
  "gh api",
  "/dispatches",
  "repository_dispatch",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "DASHSCOPE_API_KEY",
  "youtube.googleapis.com",
]) {
  assert.ok(!fixtureBlock.includes(forbidden), `fixture step gained forbidden capability: ${forbidden}`);
}

// The fixture must never read the REAL extracted source (proves it can't
// have been swapped for "use real source in test mode too").
for (const realSourceFile of ["/tmp/package-excerpt.md", "/tmp/final-clean.md", "/tmp/intake.md", "/tmp/system-prompt.txt", "/tmp/editing-package-prompt.txt"]) {
  assert.ok(!fixtureBlock.includes(realSourceFile), `fixture step must not read real extracted source: ${realSourceFile}`);
}

// ---------------------------------------------------------------------
// 4. Fixture integrity marker: written INSIDE the actual heredoc content
// (not merely present somewhere in the step's text -- a mutation could
// delete the marker from the written file while leaving the grep check's
// own literal string untouched, which a bare substring-anywhere check
// would miss entirely), and its presence is verified at runtime before
// anything downstream trusts it.
// ---------------------------------------------------------------------
const markerLiteral = "EDITING_TEST_MODE_FIXTURE_V1";
const heredocStartIdx = mustFind(fixtureBlock, "<<'FIXTURE'", "fixture heredoc start");
const heredocEndIdx = mustFind(fixtureBlock, "\n          FIXTURE\n", "fixture heredoc end", heredocStartIdx);
const heredocContent = fixtureBlock.slice(heredocStartIdx, heredocEndIdx);
assert.ok(
  heredocContent.includes(markerLiteral),
  `fixture marker must be written INSIDE the heredoc content that becomes the actual file, not just present elsewhere in the step: ${markerLiteral}`
);

const grepCheckIdx = mustFind(fixtureBlock, "grep -Fq \"", "fixture marker presence check", heredocEndIdx);
const grepCheckQuoteEnd = fixtureBlock.indexOf('"', grepCheckIdx + "grep -Fq \"".length);
assert.equal(
  fixtureBlock.slice(grepCheckIdx + "grep -Fq \"".length, grepCheckQuoteEnd),
  markerLiteral,
  "the runtime marker-presence check must grep for the EXACT SAME literal that is actually written into the heredoc"
);
assert.match(fixtureBlock, /grep -Fq "EDITING_TEST_MODE_FIXTURE_V1"[\s\S]{0,200}exit 1/, "missing fixture marker must fail closed");

// ---------------------------------------------------------------------
// 5. The fixture is validated by the exact same shared contract script
// the real AI output is validated by -- proving it represents the real
// contract, not a separate, potentially-looser copy.
// ---------------------------------------------------------------------
const sharedValidatorCall = "bash .github/scripts/validate_editing_package_output.sh /tmp/editing-package.md";
mustFind(fixtureBlock, sharedValidatorCall, "fixture step must call the shared output-contract validator");

const { block: realStepBlock } = stepBlock(workflow, "Kurgu paketini oluştur ve doğrula");
mustFind(realStepBlock, sharedValidatorCall, "real AI step must call the same shared output-contract validator");
assert.ok(!realStepBlock.includes("REQUIRED_PATTERNS="), "real AI step must not keep its own separate copy of the contract checks");

// The shared script itself must actually exist and implement the 7
// required section patterns + disclaimer + anti-false-claim + char-limit
// checks (not an empty stub).
for (const requiredCheck of [
  "Kaynak.*Dosya",
  "Ana Video.*Kurgu",
  "ham video.*görülmeden|ham görüntü.*görülmeden",
  "izledim|inceledim",
  "onay",
  "28000",
]) {
  assert.ok(validatorScript.includes(requiredCheck) || new RegExp(requiredCheck).test(validatorScript), `shared validator missing check: ${requiredCheck}`);
}

// ---------------------------------------------------------------------
// 6. The fixture step never fabricates real usage data: provider/model
// are literal, unambiguous non-real markers, and token counts are
// literal 0, not read from any router meta-file.
// ---------------------------------------------------------------------
mustFind(fixtureBlock, "EDITING_AI_PROVIDER=test-mode-fixture", "fixture must not claim a real provider name");
mustFind(fixtureBlock, "EDITING_AI_MODEL=test-mode-fixture", "fixture must not claim a real model name");
mustFind(fixtureBlock, "EDITING_INPUT_TOKENS=0", "fixture must not fabricate input token usage");
mustFind(fixtureBlock, "EDITING_OUTPUT_TOKENS=0", "fixture must not fabricate output token usage");
assert.ok(!fixtureBlock.includes("editing-package-meta.json"), "fixture step must not read/write a router meta-file (no real usage exists to record)");

// ---------------------------------------------------------------------
// 7. Production writes to the REAL source issues stay closed in test
// mode -- the workflow's own already-established TEST_MODE=="false"
// gates around commenting on the real intake issue, and the shared
// persistence script's own gate around mutating the real intake issue's
// ready-state labels.
// ---------------------------------------------------------------------
const { block: commentStepBlock } = stepBlock(workflow, "Kurgu paketi hazırlandı yorumunu ve özetini yaz");
const productionCommentGuardIdx = mustFind(commentStepBlock, 'if [[ "$TEST_MODE" == "false" ]]; then', "production intake-comment guard");
const productionCommentGuardEnd = mustFind(commentStepBlock, "\n          fi", "production intake-comment guard end", productionCommentGuardIdx);
mustFind(commentStepBlock, 'gh issue comment "$INTAKE_NUMBER"', "intake comment call", productionCommentGuardIdx);
assert.ok(
  commentStepBlock.indexOf('gh issue comment "$INTAKE_NUMBER"', productionCommentGuardIdx) < productionCommentGuardEnd,
  "the real intake-issue comment call must be INSIDE the TEST_MODE=='false' guard, not after/outside it"
);

mustFind(persistScript, 'if [[ "$TEST_MODE" == "false" && -n "$INTAKE_NUMBER" ]]; then', "persistence script's own real-intake-mutation guard");

console.log("editing_package_test_mode_isolation_ok ai_calls=0 provider_calls=0 cost_guard_calls=0 paid_api=0 video_calls=0 youtube_calls=0 repository_dispatch=0 production_issue_mutation=0");

#!/usr/bin/env node
/**
 * Section 11 — single CI master gate (.github/workflows/ci.yml). Zero-
 * network, zero-token static source-text check: never executes the
 * workflow, only asserts its own source text has the right shape.
 *
 * Verifies: triggers on push-to-main and every pull_request; workflow-level
 * permissions are read-only (contents: read) with no job anywhere
 * elevating to issues/contents write (this gate must never write an
 * Issue); all 4 jobs exist with their required steps (frontend lint/test/
 * build, backend test with an ephemeral MongoDB — no MONGODB_URI secret
 * referenced, automation Python+Node test loop, repo safety diff-check +
 * hardcoded-credential scan); and no forbidden capability anywhere in the
 * file (no real AI/provider call, no video/YouTube call, no repo-dispatch).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");

const workflow = read(".github/workflows/ci.yml");

const mustFind = (text, needle, message = needle, fromIndex = 0) => {
  const index = text.indexOf(needle, fromIndex);
  assert.ok(index >= 0, `missing executable contract: ${message}`);
  return index;
};

// 1. Triggers: push to main, and every pull_request (no branch filter that
// would silently exempt PRs targeting a different base).
mustFind(workflow, '"on":', "on: trigger block");
mustFind(workflow, "push:\n    branches: [main]", "push-to-main trigger");
mustFind(workflow, "pull_request:", "pull_request trigger");

// 2. Workflow-level permissions are read-only, and no job anywhere
// elevates beyond that — this gate must never write an Issue or contents.
const permsIdx = mustFind(workflow, "\npermissions:\n  contents: read\n", "workflow-level read-only permissions");
for (const forbidden of ["issues: write", "contents: write", "pull-requests: write", "actions: write"]) {
  assert.ok(!workflow.includes(forbidden), `CI gate must stay read-only; found: ${forbidden}`);
}

const jobsIdx = mustFind(workflow, "\njobs:\n", "jobs block", permsIdx);
const jobsBlock = workflow.slice(jobsIdx);

// 3. All 4 required jobs exist with their essential steps.
const frontendIdx = mustFind(jobsBlock, "  frontend:", "frontend job");
const backendIdx = mustFind(jobsBlock, "  backend:", "backend job", frontendIdx);
const automationIdx = mustFind(jobsBlock, "  automation-tests:", "automation-tests job", backendIdx);
const safetyIdx = mustFind(jobsBlock, "  repo-safety-checks:", "repo-safety-checks job", automationIdx);

const frontendJob = jobsBlock.slice(frontendIdx, backendIdx);
for (const step of ["npm ci", "npm run lint", "npm test", "npm run build"]) {
  assert.ok(frontendJob.includes(step), `frontend job missing step: ${step}`);
}

const backendJob = jobsBlock.slice(backendIdx, automationIdx);
assert.ok(backendJob.includes("working-directory: server"), "backend job must run in server/");
assert.ok(backendJob.includes("npm ci"), "backend job must install deps");
assert.ok(backendJob.includes("npm test"), "backend job must run tests");
// No production/real Mongo secret referenced -- the backend's own test
// suite provisions a disposable mongodb-memory-server instance itself.
for (const forbidden of ["MONGODB_URI", "secrets.MONGODB"]) {
  assert.ok(!backendJob.includes(forbidden), `backend CI job must not reference a real Mongo secret: ${forbidden}`);
}

const automationJob = jobsBlock.slice(automationIdx, safetyIdx);
assert.ok(automationJob.includes("setup-python@v5"), "automation-tests job must set up Python");
assert.ok(automationJob.includes('find .github/scripts -maxdepth 1'), "automation-tests job must discover every test_*.py/test_*.mjs file");
assert.ok(automationJob.includes("python3 \"$f\""), "automation-tests job must run each Python test");
assert.ok(automationJob.includes('node "$f"'), "automation-tests job must run each Node test");
assert.ok(automationJob.includes("exit 1"), "automation-tests job must fail closed on any test failure");

const safetyJob = jobsBlock.slice(safetyIdx);
assert.ok(safetyJob.includes("fetch-depth: 0"), "repo-safety-checks job needs full history for git diff --check against the merge base");
assert.ok(safetyJob.includes("git diff --check"), "repo-safety-checks job must run git diff --check");
assert.ok(safetyJob.includes("python3 .github/scripts/repo_safety_scan.py"), "repo-safety-checks job must run the hardcoded-credential scanner");

// 4. No forbidden capability anywhere in the whole file: this gate itself
// must never make a real AI/provider/video/YouTube call or dispatch
// another workflow.
for (const forbidden of [
  "api.anthropic.com",
  "api.openai.com",
  "youtube.googleapis.com",
  "gh api",
  "/dispatches",
  "repository_dispatch",
  "ANTHROPIC_API_KEY",
  "issue create",
  "issue edit",
]) {
  assert.ok(!workflow.includes(forbidden), `CI gate gained a forbidden capability: ${forbidden}`);
}

console.log("ci_master_gate_ok ai_calls=0 api_calls=0 issue_writes=0 dispatches=0 video_calls=0");

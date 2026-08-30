#!/usr/bin/env node
/**
 * Section 4 — Cost Guard wired into the filming-package AI Router path.
 * Verifies: preflight (before the AI call) validates the cost-guard config
 * before any paid call happens; postflight (after the AI call) runs
 * cost_guard.py against the real router meta-file and fails the workflow
 * closed on any limit violation, strictly before the package
 * Issue/labels/comment steps run.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
const stripComments = (text) => text.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");

const workflow = stripComments(read(".github/workflows/filming-package-agent-v4-router.yml"));

const mustFind = (text, needle, message = needle, fromIndex = 0) => {
  const index = text.indexOf(needle, fromIndex);
  assert.ok(index >= 0, `missing executable contract: ${message}`);
  return index;
};

// 1. Preflight step exists, gated the same way as the AI-calling step, and
// comes BEFORE it.
const preflightIdx = mustFind(workflow, "- name: Cost guard ön kontrolü (preflight)", "preflight step");
const preflightIfLineEnd = workflow.indexOf("\n", workflow.indexOf("if:", preflightIdx));
assert.equal(
  workflow.slice(workflow.indexOf("if:", preflightIdx), preflightIfLineEnd).trim(),
  "if: env.TEST_MODE != 'true' && env.SKIP_PACKAGE != 'true'",
  "preflight must be gated exactly like the AI-calling step"
);
assert.match(
  workflow.slice(preflightIdx, preflightIdx + 1000),
  /cost-guard\.json/,
  "preflight must validate the real cost-guard config"
);

const aiStepIdx = mustFind(workflow, "- name: AI Router ile çekim paketini oluştur", "AI router step", preflightIdx);
assert.ok(preflightIdx < aiStepIdx, "preflight must run BEFORE the AI-calling step");

// 2. Postflight step exists, gated the same way, and comes AFTER the AI
// call but BEFORE the quality-contract/package-creation steps.
const postflightIdx = mustFind(workflow, "- name: Cost guard kullanım doğrulaması (postflight)", "postflight step", aiStepIdx);
const postflightIfLineEnd = workflow.indexOf("\n", workflow.indexOf("if:", postflightIdx));
assert.equal(
  workflow.slice(workflow.indexOf("if:", postflightIdx), postflightIfLineEnd).trim(),
  "if: env.TEST_MODE != 'true' && env.SKIP_PACKAGE != 'true'",
  "postflight must be gated exactly like the AI-calling step"
);
assert.ok(aiStepIdx < postflightIdx, "postflight must run AFTER the AI-calling step");

const postflightBlockEnd = mustFind(workflow, "\n      - name:", "postflight step end", postflightIdx + 1);
const postflightBlock = workflow.slice(postflightIdx, postflightBlockEnd);
assert.match(postflightBlock, /python3 \.github\/scripts\/cost_guard\.py/, "postflight must actually invoke cost_guard.py");
assert.match(postflightBlock, /--meta-file \/tmp\/filming-router-meta\.json/, "postflight must check THIS run's real meta-file, not a stale one");
assert.match(postflightBlock, /--config \.github\/config\/cost-guard\.json/, "postflight must use the real cost-guard config");
assert.match(postflightBlock, /set -euo pipefail/, "postflight step must fail closed (non-zero cost_guard.py exit must abort the job)");

const qualityStepIdx = mustFind(workflow, "- name: Çekim paketi kalite sözleşmesini doğrula", "quality-contract step", postflightBlockEnd);
assert.ok(postflightIdx < qualityStepIdx, "postflight must run before the quality/package-creation steps that follow");

// 3. The preflight/postflight steps must not themselves make any real
// AI/provider/video/publish call — only read/validate local config + the
// meta-file this same job already produced.
for (const block of [workflow.slice(preflightIdx, aiStepIdx), postflightBlock]) {
  for (const forbidden of ["curl ", "gh api", "/dispatches", "repository_dispatch", "youtube.googleapis.com", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) {
    assert.ok(!block.includes(forbidden), `cost-guard step gained forbidden capability: ${forbidden}`);
  }
}

console.log("cost_guard_router_integration_ok ai_calls=0 api_calls=0 issue_writes=0 dispatches=0 video_calls=0");

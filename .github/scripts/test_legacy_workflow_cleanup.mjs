#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const legacyV3 = path.join(root, ".github/workflows/filming-package-agent-v3.yml.yml");
const historicalDuplicate = path.join(root, "filming-package-agent (1).yml");
const canonicalPath = path.join(
  root,
  ".github/workflows/filming-package-agent-v4-router.yml",
);
const handoffPath = path.join(root, ".github/workflows/filming-handoff-gate.yml");

assert.equal(fs.existsSync(legacyV3), false);
assert.equal(fs.existsSync(historicalDuplicate), false);
assert.equal(fs.existsSync(canonicalPath), true);

const canonical = fs.readFileSync(canonicalPath, "utf8");
const handoff = fs.readFileSync(handoffPath, "utf8");
const workflowDirectory = path.join(root, ".github/workflows");
for (const name of fs.readdirSync(workflowDirectory)) {
  const filePath = path.join(workflowDirectory, name);
  if (!fs.statSync(filePath).isFile()) continue;
  const workflow = fs.readFileSync(filePath, "utf8");
  assert.ok(!workflow.includes("filming-package-agent-v3.yml.yml"), name);
  assert.ok(!workflow.includes("filming-package-agent (1).yml"), name);
}

const dispatchTargets = [
  ...handoff.matchAll(/actions\/workflows\/([^/"\s]+)\/dispatches/g),
].map((match) => match[1]);
assert.deepEqual(dispatchTargets, [
  "filming-package-agent-v4-router.yml",
  "filming-package-agent-v4-router.yml",
]);

for (const contract of [
  "name: Çekim Paketi Ajanı — AI Router",
  "for REQUIRED in eren-onayli cekime-hazir uretime-secildi",
  "FILMING_HANDOFF_V1",
  "build_filming_package_prompt.mjs",
  ".github/config/business-profile.json",
  ".github/config/ai-router.json",
  ".github/config/contracts/filming-package.json",
  "env.TEST_MODE != 'true'",
]) {
  assert.ok(canonical.includes(contract), contract);
}

for (const contract of [
  "FILMING_HANDOFF_V1",
  "VIDEO_ORCHESTRATOR_V1",
  "TEST HANDOFF ",
  "TEST ÇEKİMİ BAŞLAT ",
  "ÇEKİMİ BAŞLAT ",
  "paid_generation_allowed == false",
  "dispatch_enabled == false",
]) {
  assert.ok(handoff.includes(contract), contract);
}

console.log(
  "legacy_workflow_cleanup_ok ai_calls=0 api_calls=0 issue_writes=0 dispatches=0 video_calls=0",
);

#!/usr/bin/env node
/**
 * Production/content-output layer AI-architecture consolidation audit —
 * treats editing-package-agent.yml, subtitle-package-agent.yml,
 * thumbnail-package-agent.yml and youtube-publication-package-agent.yml as
 * ONE group, exactly as they were reviewed together.
 *
 * AUDIT FINDING this file encodes as an executable, always-run contract
 * (not just a report, so a future regression in ANY of the 4 is caught
 * here even if a workflow-specific test is ever weakened or removed):
 *
 *   - editing-package-agent.yml is the ONLY one of the 4 that calls an
 *     LLM at all. It already goes exclusively through the shared
 *     ai_router.py / ai-router.json router — no direct curl/provider
 *     call, no repeated provider/model-selection logic, no bespoke
 *     fallback — and already has cost-guard preflight/postflight wired
 *     the same way as every other router-migrated workflow. It requests
 *     zero web search (its task — turning an already owner-approved,
 *     already QC-verified script into an editing plan — never needed live
 *     web verification). No migration was needed or performed on this
 *     workflow in this audit; see test_editing_package_router_migration.mjs
 *     and test_cost_guard_router_integration_phase2.mjs for the full
 *     transport/cost-guard-level proof this file's own checks summarize.
 *
 *   - subtitle-package-agent.yml, thumbnail-package-agent.yml and
 *     youtube-publication-package-agent.yml are deterministic Python
 *     builders (build_subtitle_package.py / build_thumbnail_package.py /
 *     build_youtube_package.py) with ZERO AI/LLM capability in any mode —
 *     no provider API key, no router reference, no curl to any provider
 *     endpoint anywhere in the workflow OR its builder script. No
 *     migration applies to them; forcing a router connection onto a
 *     workflow with no AI call would be a new, unrequested product
 *     feature, not a consolidation.
 *
 * Zero-network, zero-token static source-text check — never calls any
 * AI/provider/web-search API, reads no secret.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");

const PROVIDER_PATTERNS = [
  "curl ",
  "api.anthropic.com",
  "api.openai.com",
  "api.deepseek.com",
  "dashscope",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "DASHSCOPE_API_KEY",
];

// --- 1. editing-package-agent.yml: the one workflow in this group that
// DOES call an LLM — must do so exclusively via the shared router. -------

const editingWorkflow = read(".github/workflows/editing-package-agent.yml");

assert.ok(
  editingWorkflow.includes("python3 .github/scripts/ai_router.py"),
  "editing-package-agent.yml must call the shared AI router"
);
for (const pattern of ["curl ", "api.anthropic.com", "api.openai.com", "api.deepseek.com", "dashscope"]) {
  assert.ok(
    !editingWorkflow.includes(pattern),
    `editing-package-agent.yml must have zero direct provider/network call — found forbidden pattern: ${pattern}`
  );
}
assert.ok(
  !editingWorkflow.includes("--web-search-max-uses") && !editingWorkflow.includes("--web-sources-file"),
  "editing-package-agent.yml must never request web search from the router (its task never needed live web verification)"
);
assert.match(
  editingWorkflow,
  /web_search=0/,
  "editing-package-agent.yml's usage marker must keep reporting web_search=0"
);
assert.ok(
  editingWorkflow.includes("- name: Cost guard ön kontrolü (preflight)"),
  "editing-package-agent.yml must have a cost-guard preflight step before spending any real provider token"
);
assert.match(
  editingWorkflow,
  /python3 \.github\/scripts\/cost_guard\.py \\\s*\n\s*--meta-file \/tmp\/editing-package-meta\.json \\\s*\n\s*--config \.github\/config\/cost-guard\.json/,
  "editing-package-agent.yml's cost-guard postflight must check THIS run's real meta-file against the real config"
);

// --- 2. subtitle/thumbnail/youtube: deterministic builders, zero AI in
// any mode — checked in BOTH the workflow YAML and its builder script. ---

const zeroAiTargets = [
  {
    name: "subtitle-package-agent.yml",
    workflow: ".github/workflows/subtitle-package-agent.yml",
    builder: ".github/scripts/build_subtitle_package.py",
    usageMarker: "SUBTITLE_USAGE_V1",
  },
  {
    name: "thumbnail-package-agent.yml",
    workflow: ".github/workflows/thumbnail-package-agent.yml",
    builder: ".github/scripts/build_thumbnail_package.py",
    usageMarker: "THUMBNAIL_USAGE_V1",
  },
  {
    name: "youtube-publication-package-agent.yml",
    workflow: ".github/workflows/youtube-publication-package-agent.yml",
    builder: ".github/scripts/build_youtube_package.py",
    usageMarker: "YOUTUBE_USAGE_V1",
  },
];

for (const target of zeroAiTargets) {
  const workflow = read(target.workflow);
  const builder = read(target.builder);

  for (const source of [workflow, builder]) {
    for (const pattern of [...PROVIDER_PATTERNS, "ai_router.py", "ai-router.json"]) {
      assert.ok(
        !source.includes(pattern),
        `${target.name}: must have ZERO AI capability — found forbidden pattern in ${source === workflow ? "workflow" : "builder script"}: ${pattern}`
      );
    }
  }

  assert.match(
    workflow,
    new RegExp(`${target.usageMarker}[^\\n]*\\binput=0\\b[^\\n]*\\boutput=0\\b[^\\n]*\\bweb_search=0\\b`),
    `${target.name}: usage marker must self-report zero AI usage`
  );
}

// --- 3. This audit test itself performs no real AI/API/web-search/Issue/
// dispatch/video call — everything above is a static read of committed
// files and in-memory string assertions.

console.log(
  "production_ai_consolidation_audit_ok ai_calls=0 api_calls=0 web_search=0 issue_writes=0 dispatches=0 video_calls=0"
);

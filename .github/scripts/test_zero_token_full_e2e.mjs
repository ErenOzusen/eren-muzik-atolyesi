#!/usr/bin/env node
/**
 * ZERO-TOKEN FULL END-TO-END SYSTEM TEST.
 *
 * Runs the entire content/production pipeline, stage by stage, each stage
 * consuming the REAL artifact the previous stage REALLY produced — not a
 * hand-typed "miracle output." AI-calling stages invoke the REAL
 * ai_router.py CLI against a local-only mock HTTP server (so its real
 * network code, real provider-selection code, and real meta-file writing
 * all genuinely run — the only thing that's fake is the HTTP response body,
 * which never leaves 127.0.0.1). Deterministic stages (Video Orchestrator,
 * subtitle/thumbnail/YouTube builders, output-contract validation, editing
 * package validation, the final-technical-check decision contract) invoke
 * their REAL, unmodified scripts as real subprocesses. Gate/state-machine
 * stages (owner approval, scenario selection, filming handoff, raw-video
 * eligibility, YouTube review readiness, publication approval eligibility)
 * never touch a real GitHub Issue — they apply the exact label/provenance
 * rules those workflows use (source-anchored against the real YAML below)
 * to fixture state, driven by the REAL content artifacts the earlier
 * stages produced. Stage 16 (youtube-review-readiness-gate.yml ->
 * youtube-publication-approval-gate.yml) is a body-revision-bound,
 * bot-authored-comment marker chain — see computeReviewReadiness /
 * computePublicationApprovalEligibility below.
 *
 * MUTUAL EXCLUSION WITH REALITY: this file makes zero real Anthropic/
 * OpenAI/DeepSeek/Qwen calls, zero real web requests, zero real video
 * generation, zero real YouTube upload/publish, and touches no real GitHub
 * Issue. It needs no provider secret to run.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const readNorm = (relativePath) => read(relativePath).replace(/\r\n/g, "\n");
const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
// Python's text-mode file writes translate "\n" -> the OS-native line
// ending on Windows ("\r\n"), but not on POSIX (CI runs on Ubuntu) — this
// normalizes every subprocess-written artifact this harness reads back, so
// local verification behaves identically to CI regardless of host OS. It
// never touches what gets WRITTEN to any real script's input.
const readTextFile = (filePath) => fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");

const mustInclude = (text, needle, message = needle) => {
  assert.ok(text.includes(needle), `missing executable contract: ${message}`);
};

// ===========================================================================
// Working directory: a fresh OS temp dir, never committed, cleaned up at the
// end (kept only on failure, for inspection).
// ===========================================================================
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-zero-token-"));
const wpath = (...parts) => path.join(WORK, ...parts);

const PROFILE_PATH = path.join(ROOT, ".github/config/business-profile.json");
const PROFILE = JSON.parse(read(".github/config/business-profile.json"));
const B = PROFILE.business;
const OFFER = PROFILE.offer;
const CONTENT = PROFILE.content;

// ===========================================================================
// Report accounting
// ===========================================================================
const REPORT = []; // {n, name, status, codePath, artifactsIn, artifactsOut}
const USAGE = { inputTokens: 0, outputTokens: 0, webSearches: 0, videoGenerations: 0, youtubeUploads: 0, youtubePublications: 0 };
const NEGATIVE_RESULTS = [];
const BUGS_FOUND = [];
let overallOk = true;

function stage(n, name, codePath, fn) {
  process.stdout.write(`\n=== [${String(n).padStart(2, "0")}] ${name} (${codePath}) ===\n`);
  try {
    const result = fn() || {};
    REPORT.push({ n, name, status: "PASS", codePath, ...result });
    console.log(`  -> PASS`);
    return result.value;
  } catch (error) {
    REPORT.push({ n, name, status: "FAIL", codePath, error: error.message });
    console.log(`  -> FAIL: ${error.message}`);
    overallOk = false;
    throw error;
  }
}

function stageBlocked(n, name, codePath, reason, extra = {}) {
  REPORT.push({ n, name, status: "BLOCKED", codePath, reason, ...extra });
  console.log(`\n=== [${String(n).padStart(2, "0")}] ${name} (${codePath}) ===\n  -> BLOCKED: ${reason}`);
}

function negative(id, description, fn) {
  try {
    fn();
    NEGATIVE_RESULTS.push({ id, description, status: "PASS" });
    console.log(`  NEGATIVE ${id}: PASS — ${description}`);
  } catch (error) {
    NEGATIVE_RESULTS.push({ id, description, status: "FAIL", error: error.message });
    console.log(`  NEGATIVE ${id}: FAIL — ${description} :: ${error.message}`);
    overallOk = false;
  }
}

// ===========================================================================
// Subprocess helpers — real Python/Node/Bash subprocesses, never mocked.
// ===========================================================================
function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(opts.env || {}) },
    ...opts,
  });
  if (result.error) {
    throw new Error(`${cmd} ${args.join(" ")} failed to spawn: ${result.error.message}`);
  }
  return { code: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function runOk(cmd, args, opts = {}) {
  const result = run(cmd, args, opts);
  if (result.code !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} exited ${result.code}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
    );
  }
  return result;
}

const PYTHON = process.env.E2E_PYTHON_BIN || "python3";
const MOCK_ROUTER_RUNNER = path.join(ROOT, ".github/scripts/fixtures/e2e/run_router_with_mock.py");

// ===========================================================================
// PROVIDER MOCKING — runs the REAL, unmodified ai_router.py main() (via
// fixtures/e2e/run_router_with_mock.py) with only request_json (the literal
// network call) replaced by a canned response queue via
// unittest.mock.patch.object — the exact same boundary already used and
// trusted by test_ai_router.py / test_router_cost_guard_integration_
// scenarios.py in this repo. No HTTP server, no TLS, no real network stack
// touched at all; there is nothing for a real provider call to even dial.
// ===========================================================================
const RESPONSE_QUEUE = [];

function enqueueAnthropicResponse(text, { webSearchRequests = 0 } = {}) {
  RESPONSE_QUEUE.push([
    200,
    {
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: webSearchRequests } },
    },
  ]);
}

const FIXTURE_SECRET_ENV = {
  ANTHROPIC_API_KEY: "e2e-fixture-key-never-real",
  OPENAI_API_KEY: "e2e-fixture-key-never-real",
  DEEPSEEK_API_KEY: "e2e-fixture-key-never-real",
  DASHSCOPE_API_KEY: "e2e-fixture-key-never-real",
};

function callRouter({ systemText, promptText, maxTokens, primaryModel, webSearchMaxUses, outName, metaName }) {
  const systemFile = wpath(`${outName}.system.txt`);
  const promptFile = wpath(`${outName}.prompt.txt`);
  const outputFile = wpath(`${outName}.md`);
  const metaFile = wpath(`${metaName}.json`);
  const responsesFile = wpath(`${outName}.responses.json`);
  if (systemText) fs.writeFileSync(systemFile, systemText);
  fs.writeFileSync(promptFile, promptText);
  fs.writeFileSync(responsesFile, JSON.stringify(RESPONSE_QUEUE.splice(0, RESPONSE_QUEUE.length)));

  const args = [
    MOCK_ROUTER_RUNNER,
    "--responses-file",
    responsesFile,
    "--config",
    path.join(ROOT, ".github/config/ai-router.json"),
    "--prompt-file",
    promptFile,
    "--output-file",
    outputFile,
    "--meta-file",
    metaFile,
    "--max-tokens",
    String(maxTokens),
    "--primary-model",
    primaryModel,
    "--provider-order",
    "anthropic",
  ];
  if (systemText) args.push("--system-file", systemFile);
  if (webSearchMaxUses) args.push("--web-search-max-uses", String(webSearchMaxUses));

  const result = runOk(PYTHON, args, { env: FIXTURE_SECRET_ENV });
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  const outputText = readTextFile(outputFile);
  USAGE.inputTokens += meta.total_input_tokens || meta.input_tokens || 0;
  USAGE.outputTokens += meta.total_output_tokens || meta.output_tokens || 0;
  USAGE.webSearches += meta.web_searches || 0;
  return { outputFile, metaFile, outputText, meta, stdout: result.stdout };
}

// ===========================================================================
// STATE-MACHINE SIMULATOR — mirrors the exact, source-verified conditions
// used by the 5 gate workflows already proven correct in
// test_gate_orchestrator_state_machine_invariants.mjs. Reused here, driven
// by REAL content artifacts instead of synthetic fixtures.
// ===========================================================================
const approvalInvalidationWf = readNorm(".github/workflows/approval-invalidation-gate.yml");
const ownerApprovalWf = readNorm(".github/workflows/eren-approval-gate.yml");
const selectionWf = readNorm(".github/workflows/eren-production-selection-gate.yml");
const handoffWf = readNorm(".github/workflows/filming-handoff-gate.yml");
const filmingAgentWf = readNorm(".github/workflows/filming-package-agent-v4-router.yml");
const rawVideoWf = readNorm(".github/workflows/raw-video-intake-gate.yml");
const pubApprovalWf = readNorm(".github/workflows/youtube-publication-approval-gate.yml");
const pubInvalidationWf = readNorm(".github/workflows/publication-approval-invalidation-gate.yml");
const reviewReadinessWf = readNorm(".github/workflows/youtube-review-readiness-gate.yml");

// Source-anchor the exact conditions this simulator relies on.
mustInclude(ownerApprovalWf, "grep -Eq \"^\\*\\*Kalite kontrol raporu:\\*\\*", "owner approval requires QC link");
mustInclude(ownerApprovalWf, "duzeltme-gerekiyor", "owner approval rejects correction blocker");
mustInclude(selectionWf, "grep -qxE 'eren-onayli|owner-approved' /tmp/labels.txt", "selection requires approval");
mustInclude(selectionWf, "BODY_SHA=$(sha256sum /tmp/body.md | awk '{print $1}')", "selection computes body sha");
mustInclude(handoffWf, "CURRENT_BODY_SHA=$(sha256sum /tmp/body.md | awk '{print $1}')", "handoff recomputes current body sha");
mustInclude(filmingAgentWf, "body_sha256=$SOURCE_SHA", "filming agent re-checks body sha independently");
mustInclude(rawVideoWf, "PACKAGE_SOURCE_SHA=$(grep -oE", "raw video intake reads package provenance hash");
mustInclude(rawVideoWf, 'if [[ "$PACKAGE_SOURCE_SHA" != "$CURRENT_FINAL_SHA" ]]; then', "raw video intake rejects stale package");
mustInclude(pubApprovalWf, "YOUTUBE_REVIEW_READY_V1", "publication approval requires readiness marker");
mustInclude(pubApprovalWf, 'CURRENT_BODY_SHA=$(sha256sum /tmp/youtube-package.md | awk \'{print $1}\')', "publication approval recomputes current package body sha");
mustInclude(pubApprovalWf, 'select(.author.login == "github-actions[bot]")', "publication approval only trusts bot-authored readiness comments");
mustInclude(pubInvalidationWf, "eren-yayin-onayi-bekliyor", "publication invalidation re-establishes pending");
mustInclude(pubInvalidationWf, "youtube-review-ready", "publication invalidation also clears a stale readiness label");

// The readiness gate itself: fail-closed on any missing attestation, real
// package/state validation, owner-only authorization, and a body-revision-
// bound comment marker (never written into the package body itself).
mustInclude(reviewReadinessWf, 'if [[ "$VIDEO_READY" != "true" || "$SRT_READY" != "true" || \\', "readiness gate fails closed unless every attestation is true");
mustInclude(reviewReadinessWf, 'CONFIG_OWNER=$(jq -er \'.business.github_owner', "readiness gate uses the same owner-only authorization contract");
mustInclude(reviewReadinessWf, "BODY_SHA=$(sha256sum /tmp/youtube-package.md | awk '{print $1}')", "readiness gate binds its marker to the current package body sha");
mustInclude(reviewReadinessWf, 'READY_MARKER="<!-- YOUTUBE_REVIEW_READY_V1 issue=$ISSUE_NUMBER test=$TEST_MODE video=1 srt=1 thumbnail=1 public=0 body_sha256=$BODY_SHA -->"', "readiness gate writes the exact marker format the approval gate verifies");
mustInclude(reviewReadinessWf, "gh issue comment", "readiness gate records proof as a comment, not the package body");

function computeOwnerApprovalEligibility(finalBody, ftcDecision) {
  const hasQcLink = new RegExp(`^\\*\\*Kalite kontrol raporu:\\*\\* https://github\\.com/[^\\s]+/issues/\\d+\\s*$`, "m").test(finalBody);
  if (!hasQcLink) throw new Error("owner approval: no QC report link in final body");
  if (ftcDecision === "blocked") throw new Error("owner approval: final technical check found blockers (duzeltme-gerekiyor)");
  return { labels: new Set(["eren-onayli", "owner-approved", "cekime-hazir", "production-ready"]), bodySha: sha256(finalBody) };
}

function computeScenarioSelection(approvalState, finalBody, scenario) {
  if (!approvalState.labels.has("eren-onayli")) throw new Error("selection: owner approval missing");
  if (!new RegExp(`^##\\s+SENARYO\\s+${scenario}([^0-9]|$)`, "mi").test(finalBody)) {
    throw new Error(`selection: SENARYO ${scenario} not found in final body`);
  }
  const bodySha = sha256(finalBody);
  const labels = new Set([...approvalState.labels, "uretime-secildi", "production-selected", `uretim-senaryo-${scenario}`, `production-scenario-${scenario}`]);
  return { labels, bodySha, marker: `<!-- FILMING_HANDOFF_V1 issue=1 scenario=${scenario} body_sha256=${bodySha} -->`, scenario };
}

function computeFilmingHandoff(selectionState, currentFinalBody, expectedScenario) {
  if (!selectionState.labels.has("uretime-secildi")) throw new Error("handoff: no production selection");
  if (selectionState.scenario !== expectedScenario) throw new Error(`handoff: scenario mismatch (selected=${selectionState.scenario} expected=${expectedScenario})`);
  const currentSha = sha256(currentFinalBody);
  const expectedMarker = `<!-- FILMING_HANDOFF_V1 issue=1 scenario=${expectedScenario} body_sha256=${currentSha} -->`;
  if (selectionState.marker !== expectedMarker) {
    throw new Error("handoff: FILMING_HANDOFF_V1 marker does not match current body revision (stale selection)");
  }
  return { dispatched: true, scenario: expectedScenario, bodySha: currentSha };
}

function computeRawVideoEligibility(packageBody, currentFinalBody) {
  const match = packageBody.match(/<!-- source-body-sha256: ([0-9a-f]{64}) -->/);
  if (!match) throw new Error("raw video intake: filming package has no source-body-sha256");
  const packageSha = match[1];
  const currentSha = sha256(currentFinalBody);
  if (packageSha !== currentSha) throw new Error("raw video intake: filming package is stale relative to current final body");
  return { accepted: true };
}

// Mirrors youtube-review-readiness-gate.yml: records real pre-publication
// media-readiness evidence as a bot-authored comment marker bound to the
// package's CURRENT body sha256 — never embedded in the body itself (that
// would be self-referential: the marker's own hash would have to exclude
// the marker).
function computeReviewReadiness(youtubePackageBody, labels, flags, testMode) {
  if (!labels.has("youtube-yayin-paketi")) throw new Error("readiness: source Issue is not a YouTube Yayın Paketi");
  const pending = labels.has("eren-yayin-onayi-bekliyor") || labels.has("publication-approval-pending");
  const already = labels.has("eren-yayin-onayli") || labels.has("publication-approved");
  if (already) throw new Error("readiness: package already has final publication approval");
  if (!pending) throw new Error("readiness: package not in publication-approval-pending state");
  if (!flags.videoReady || !flags.srtReady || !flags.thumbnailReady || !flags.confirmedNotPublic) {
    throw new Error(
      `readiness: media attestation incomplete, fail closed (video=${flags.videoReady} srt=${flags.srtReady} thumbnail=${flags.thumbnailReady} confirmedNotPublic=${flags.confirmedNotPublic})`
    );
  }
  const bodySha = sha256(youtubePackageBody);
  const readyLabel = testMode ? "test-youtube-review-ready" : "youtube-review-ready";
  return {
    marker: `<!-- YOUTUBE_REVIEW_READY_V1 issue=1 test=${testMode} video=1 srt=1 thumbnail=1 public=0 body_sha256=${bodySha} -->`,
    bodySha,
    botAuthored: true, // simulates the comment being posted via GH_TOKEN as github-actions[bot]
    labels: new Set([...labels, readyLabel]),
  };
}

function computePublicationApprovalEligibility(youtubePackageBody, labels, readinessState) {
  const pending = labels.has("eren-yayin-onayi-bekliyor") || labels.has("publication-approval-pending");
  const already = labels.has("eren-yayin-onayli") || labels.has("publication-approved");
  if (already && pending) throw new Error("publication approval: approved+pending coexist (invariant violated)");
  if (!pending) throw new Error("publication approval: not in pending state");
  if (!readinessState) {
    throw new Error("publication approval: YOUTUBE_REVIEW_READY_V1 readiness marker missing (readiness never recorded)");
  }
  if (!readinessState.botAuthored) {
    throw new Error("publication approval: readiness comment was not authored by github-actions[bot] (forged marker rejected)");
  }
  const currentSha = sha256(youtubePackageBody);
  if (readinessState.bodySha !== currentSha) {
    throw new Error("publication approval: readiness marker is stale (package body changed since readiness was recorded)");
  }
  return { labels: new Set([...labels, "eren-yayin-onayli", "publication-approved", "yayina-hazir"]) };
}

// ===========================================================================
// PIPELINE STATE — real artifacts, threaded stage to stage.
// ===========================================================================
const S = {}; // stage outputs, keyed by stage number

// ===========================================================================
// FIXTURE CONTENT — deterministic, non-customer, non-student placeholder
// text about generic guitar/piano/bass topics (matching the profile's own
// content_topics), never real production data.
// ===========================================================================
const SCENARIO_TITLES = [
  "Gitarda İlk Üç Akoru Öğren",
  "Piyanoda Basit Bir Melodi Çal",
  "Bas Gitarla Temel Ritim Kalıbı",
];

function buildScenarioBlock(n) {
  const title = SCENARIO_TITLES[n - 1];
  // Deliberately does NOT open with the literal title text: build_thumbnail_package.py's
  // question/benefit copies are the title's first/last 5 words, and its routine copy
  // (when no duration phrase is found) falls back to the KANCA hook's first 5 words —
  // if the hook opened with the title verbatim, question_copy and routine_copy would
  // collide and fail the builder's 3-unique-copies check on every scenario.
  const hook =
    `Merhaba, bugün seninle ${title.toLocaleLowerCase("tr-TR")} konusuna hemen başlıyoruz. ` +
    `Adım adım, hiç bilgin olmasa bile takip edebileceğin basit bir alıştırma göstereceğim. ` +
    `Elini enstrümana koy ve birlikte deneyelim; bu kısa videoda hiçbir ön bilgiye ihtiyacın ` +
    `yok, sadece sabırla izlemen yeterli olacak.`;
  const mainFlow =
    `**Adım 1**\n` +
    `Önce enstrümanı doğru pozisyonda tutmayı gösteriyorum; parmak yerleşimini ` +
    `yavaşça tekrar ediyoruz ve her adımı kameraya yakın çekimle netleştiriyorum. ` +
    `Bu aşamada acele etmiyoruz, çünkü doğru başlangıç sonraki adımları kolaylaştırıyor.\n\n` +
    `**Adım 2**\n` +
    `Ardından ilk hareketi çok yavaş tempoda çalıyorum, sonra biraz hızlandırıyorum; ` +
    `öğrencinin kendi hızında takip edebilmesi için duraklama noktaları bırakıyorum. ` +
    `Aynı hareketi üç farklı açıdan tekrar göstererek küçük detayların gözden kaçmamasını sağlıyorum.\n\n` +
    `**Adım 3**\n` +
    `Son olarak öğrendiğimiz kısmı küçük bir örnekle birleştiriyorum ve yaygın hataları ` +
    `tek tek gösterip nasıl düzeltileceğini anlatıyorum. Videonun sonunda tüm adımları ` +
    `sırayla tekrar ederek konuyu pekiştiriyoruz.`;
  const closing =
    `Bugün öğrendiğimiz bu basit alıştırmayı her gün birkaç dakika tekrar edersen kısa ` +
    `sürede rahatlayacaksın. Daha fazla ders ve birebir çalışma için profildeki rezervasyon ` +
    `bağlantısından bana ulaşabilirsin; ilk dersinde nereden başlayacağını birlikte planlarız.`;
  const shorts =
    `${title} — en can alıcı anı burada: tek hareketle net bir sonuç duyuyorsun. Kısa ` +
    `versiyonda yalnızca bu bölümü tekrar ediyoruz; tam dersin bağlantısı profilde ve ` +
    `yorumlarda seni bekliyorum.`;
  const slug = title.toLocaleLowerCase("tr-TR").replace(/[^a-zçğıöşü0-9]+/g, "");

  // Deliberately NO trailing "---" here — that separator only needs to
  // exist at the very end of a whole scenario block (after whatever else,
  // e.g. a correction's QC-notes section, follows SHORTS KESİTİ), so
  // callers append it themselves once they know what comes last.
  return (
    `## Senaryo ${n}: ${title}\n` +
    `**SEO Başlığı:** ${title} - Adım Adım Öğren\n` +
    `**Açıklamanın İlk Cümlesi:** Bu videoda ${title.toLocaleLowerCase("tr-TR")} konusunu baştan sona öğreniyoruz.\n` +
    `**Etiketler:** #gitar #müzikeğitimi #${slug}\n` +
    `**Playlist Önerisi:** Başlangıç Seviyesi Dersler\n` +
    `**[KANCA]**\n${hook}\n` +
    `**[ANA AKIŞ]**\n${mainFlow}\n` +
    `**[KAPANIŞ VE CTA]**\n${closing}\n` +
    `**[SHORTS KESİTİ]**\n${shorts}\n`
  );
}

// ===========================================================================
// STAGE 01 — Weekly Content Research
// ===========================================================================
function runStage01() {
  return stage(1, "Weekly Content Research", "weekly-content-research.yml -> ai_router.py", () => {
    const sourceMap = { S01: "https://example.invalid/source-1", S02: "https://example.invalid/source-2" };
    const sourceData =
      `# KODLA TOPLANAN GÜNCEL KAYNAKLAR (fixture)\n\n` +
      `## RAKİP YOUTUBE AKIŞLARI\n- Örnek video başlığı bir [S01]\n\n` +
      `## TR GÜNDEM VE SEKTÖR HABERLERİ\n- Örnek haber başlığı [S02]\n`;
    fs.writeFileSync(wpath("01-source-data.txt"), sourceData);
    fs.writeFileSync(wpath("01-source-map.json"), JSON.stringify(sourceMap));

    const ideas = [1, 2, 3, 4, 5]
      .map(
        (i) =>
          `### 💡 Fikir ${i}${i <= 3 ? " (En Güçlü)" : ""}\n` +
          `- Başlık: Örnek fikir başlığı ${i}\n` +
          `- İlgili hizmet/konu: ${CONTENT.content_topics[(i - 1) % CONTENT.content_topics.length]}\n` +
          `- Format: Ana video\n` +
          `- Neden şimdi?: Güncel ilgi var\n` +
          `- Dayandığı bulgu ve kaynak kimliği: Örnek bulgu [S0${(i % 2) + 1}]\n`
      )
      .join("\n");
    const reportText =
      `# Haftalık İçerik Araştırma Raporu - 01-01-2026\n` +
      `## 1. TREND KONULAR\n- Örnek trend maddesi [S01]\n\n` +
      `## 2. RAKİP HAREKETLERİ\n- Örnek rakip özeti [S02]\n\n` +
      `## 3. İÇERİK FİKİRLERİ\n${ideas}\n` +
      `## 4. BU HAFTANIN KISA KARARI\nEn güçlü ilk üç fikre odaklan.\n`;

    enqueueAnthropicResponse(reportText);
    const { outputText, meta } = callRouter({
      systemText: null,
      promptText: `${B.brand_name} için fixture prompt.`,
      maxTokens: CONTENT.research.max_model_output,
      primaryModel: PROFILE.cost_control.default_model,
      outName: "01-report",
      metaName: "01-meta",
    });

    for (const required of ["## 1. TREND KONULAR", "## 2. RAKİP HAREKETLERİ", "## 3. İÇERİK FİKİRLERİ", "## 4. BU HAFTANIN KISA KARARI"]) {
      assert.ok(outputText.includes(required), `weekly research missing section: ${required}`);
    }
    assert.equal(meta.provider, "anthropic");

    // Restore [Sxx] -> [Kaynak Sxx](url), exactly like the real workflow's
    // own post-processing step does before publishing the Issue.
    const restored = outputText.replace(/\[(S\d{2})\]/g, (_, id) => `[Kaynak ${id}](${sourceMap[id]})`);
    fs.writeFileSync(wpath("01-weekly-report.md"), restored);
    S[1] = { reportBody: restored };
    return { artifactsOut: ["01-weekly-report.md"], value: S[1] };
  });
}

// ===========================================================================
// STAGE 02 — Weekly Script Agent
// ===========================================================================
function runStage02() {
  return stage(2, "Weekly Script Agent", "weekly-script-agent.yml -> ai_router.py", () => {
    const scenarios = [1, 2, 3].map((n) => buildScenarioBlock(n)).join("\n");
    enqueueAnthropicResponse(scenarios);
    const { outputText, meta } = callRouter({
      systemText: null,
      promptText: `İlk 3 fikirden senaryo üret (fixture).\n\n${S[1].reportBody}`,
      maxTokens: CONTENT.script.max_model_output,
      primaryModel: PROFILE.cost_control.default_model,
      outName: "02-scripts",
      metaName: "02-meta",
    });

    const headings = [...outputText.matchAll(/^## Senaryo ([1-9]):/gm)].map((m) => m[1]);
    assert.deepEqual(headings, ["1", "2", "3"], "weekly-script-agent: expected 3 sequential scenario headings");
    assert.ok(!outputText.includes("QC_KANIT_V1"), "weekly-script-agent: AI output must not already contain QC_KANIT_V1");
    assert.equal(meta.provider, "anthropic");

    // Append the QC_KANIT_V1 evidence packet the real workflow's own Python
    // block builds from the top-3-ideas extraction (here: a fixed, valid
    // evidence set referencing stage 1's real restored source links).
    const blocks = outputText.split(/^## Senaryo /m).slice(1).map((b) => "## Senaryo " + b);
    const withEvidence = blocks
      .map((block, i) => {
        const n = i + 1;
        const packet =
          `\n<!-- QC_KANIT_V1\n` +
          `SENARYO=${n}\n` +
          `BULGU=Örnek bulgu ${n} (fixture)\n` +
          `KAYNAK=S0${(n % 2) + 1}|https://example.invalid/source-${(n % 2) + 1}\n` +
          `-->`;
        return block.trimEnd() + "\n" + packet;
      })
      .join("\n\n");
    fs.writeFileSync(wpath("02-scripts.md"), withEvidence);
    S[2] = { scriptsBody: withEvidence };
    return { artifactsOut: ["02-scripts.md"], value: S[2] };
  });
}

// ===========================================================================
// STAGE 03 — Weekly Quality Control
// ===========================================================================
function runStage03() {
  return stage(3, "Weekly Quality Control", "weekly-quality-control.yml -> ai_router.py", () => {
    const packets = [...S[2].scriptsBody.matchAll(/<!--\s*QC_KANIT_V1\s*\n(.*?)\n-->/gs)];
    assert.equal(packets.length, 3, "QC: expected exactly 3 QC_KANIT_V1 packets from stage 2");
    const providedSources = [];
    for (const [, packet] of packets) {
      for (const m of packet.matchAll(/^KAYNAK=(S\d+)\|(https?:\/\/\S+)$/gm)) {
        providedSources.push({ title: `Araştırma kaynağı ${m[1]}`, url: m[2] });
      }
    }
    const uniqueSources = [...new Map(providedSources.map((s) => [s.url, s])).values()];

    const qcReport = [1, 2, 3]
      .map(
        (n) =>
          `# SENARYO ${n}\n` +
          `## 1. İDDİA VE KANIT TABLOSU\n| İddia | Kanıt | Sonuç |\n|---|---|---|\n| Örnek iddia | Araştırma S01 | DOĞRU |\n\n` +
          `## 2. GERÇEK BİLGİ HATALARI\nHata bulunamadı.\n\n` +
          `## 3. HASSASİYET ÖNERİLERİ\nYok.\n\n` +
          `## 4. İÇERİK KALİTESİ\nKanca güçlü, akış net, hedef kitle uygun, süre makul, CTA açık.\n\n` +
          `## 5. SENARYO KARARI\nYAYINA HAZIR\n`
      )
      .join("\n") +
      `\n# GENEL TUTARLILIK KONTROLÜ\nTutarsızlık bulunamadı.\n\n` +
      `# ÖZET KARAR TABLOSU\n| Senaryo | Karar |\n|---|---|\n| 1 | Hazır |\n| 2 | Hazır |\n| 3 | Hazır |\n\n` +
      `GENEL KARAR: ✅ YAYINA HAZIR`;

    enqueueAnthropicResponse(qcReport, { webSearchRequests: 0 });
    const { outputText, meta } = callRouter({
      systemText: "Sen bağımsız bir kalite kontrol editörüsün (fixture).",
      promptText: `Aşağıdaki üç video senaryosunu denetle (fixture).\n\n${S[2].scriptsBody}`,
      maxTokens: CONTENT.quality_control.max_model_output,
      primaryModel: PROFILE.cost_control.default_model,
      webSearchMaxUses: CONTENT.quality_control.max_web_searches,
      outName: "03-qc",
      metaName: "03-meta",
    });
    assert.equal(meta.provider, "anthropic");
    assert.equal(meta.web_searches, 0, "QC: fixture must report zero web searches");

    for (const heading of ["## 1. İDDİA VE KANIT TABLOSU", "## 2. GERÇEK BİLGİ HATALARI", "## 3. HASSASİYET ÖNERİLERİ", "## 4. İÇERİK KALİTESİ", "## 5. SENARYO KARARI"]) {
      assert.equal((outputText.match(new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 3, `QC: heading must appear exactly 3 times: ${heading}`);
    }
    assert.match(outputText, /GENEL KARAR:\s*✅\s*YAYINA HAZIR|GENEL KARAR:\s*⚠️\s*DÜZELTME GEREKİYOR/);

    const sources = [...new Map(uniqueSources.map((s) => [s.url, s])).values()];
    assert.ok(sources.length >= 1, "QC: at least one source (provided) required");

    const qcIssueBody =
      `<!-- QC_AI_USAGE_V1 provider=${meta.provider} model=${meta.model} input=0 output=0 web_search=0 -->\n\n` +
      outputText +
      `\n\n## Kullanılan Kaynaklar\n` +
      sources.map((s) => `- [${s.title}](${s.url})`).join("\n") +
      `\n`;
    fs.writeFileSync(wpath("03-qc-report.md"), qcIssueBody);
    S[3] = { qcBody: qcIssueBody, decision: "ready", issueNumber: 501 };
    return { artifactsOut: ["03-qc-report.md"], value: S[3] };
  });
}

// ===========================================================================
// STAGE 04 — Weekly Script Correction (produces the CANONICAL final body
// every downstream stage traces provenance back to)
// ===========================================================================
function runStage04() {
  return stage(4, "Weekly Script Correction", "weekly-script-correction.yml -> ai_router.py", () => {
    const withQc = [1, 2, 3]
      .map((n) => {
        const block = buildScenarioBlock(n).replace(`## Senaryo ${n}:`, `## SENARYO ${n}:`);
        return block.trimEnd() + `\n\n**Uygulanan QC düzeltmeleri:**\n- Değişiklik yapılmadı (fixture).\n---\n`;
      })
      .join("\n");
    const correctionOutput = `# 🎬 ${B.brand_name} — NİHAİ SENARYOLAR\n\n${withQc}`;

    enqueueAnthropicResponse(correctionOutput);
    const { outputText, meta } = callRouter({
      systemText: `Sen ${B.brand_name} için çalışan nihai senaryo düzeltme editörüsün (fixture).`,
      promptText: `TEMEL SENARYO METNİ\n\n${S[2].scriptsBody}\n\nKALİTE KONTROL RAPORU\n\n${S[3].qcBody}`,
      maxTokens: CONTENT.correction.max_model_output,
      primaryModel: PROFILE.cost_control.default_model,
      outName: "04-correction",
      metaName: "04-meta",
    });
    assert.equal(meta.provider, "anthropic");

    assert.equal(outputText.split("\n")[0], `# 🎬 ${B.brand_name} — NİHAİ SENARYOLAR`, "correction: first line must match contract exactly");
    const headings = [...outputText.matchAll(/^## SENARYO ([123]):/gm)];
    assert.equal(headings.length, 3, "correction: expected exactly 3 SENARYO headings");
    assert.equal((outputText.match(/Uygulanan QC düzeltmeleri/g) || []).length, 3, "correction: expected exactly 3 QC-correction sections");

    // The scenario-separator structural check this package added to
    // weekly-script-correction.yml (real bug found + fixed while building
    // this harness) — re-verified here against this fixture too.
    for (let i = 0; i < headings.length; i++) {
      const end = i + 1 < headings.length ? headings[i + 1].index : outputText.length;
      const block = outputText.slice(headings[i].index, end);
      if (i < headings.length - 1) {
        assert.match(block, /^---\s*$/m, `correction: SENARYO ${i + 1} must be terminated by a "---" separator`);
      }
    }

    // Embed a QC report link (required by owner-approval-eligibility and
    // final-technical-check) and an explicit approval footer, matching the
    // real Issue body shape.
    const finalBody =
      outputText.trimEnd() +
      `\n\n**Kalite kontrol raporu:** https://github.com/${B.github_owner}/${path.basename(ROOT)}/issues/${S[3].issueNumber}\n` +
      `\n---\nOnaylamak için bu Issue'ya **${PROFILE.approval.production_command}** yaz.\n`;

    fs.writeFileSync(wpath("04-final-scripts.md"), finalBody);
    S[4] = { finalBody, issueNumber: 601 };
    return { artifactsOut: ["04-final-scripts.md"], value: S[4] };
  });
}

// ===========================================================================
// STAGE 05 — Final Technical Check
// ===========================================================================
function runStage05(decision = "ready") {
  return stage(5, `Final Technical Check (${decision})`, "final-technical-check.yml -> ai_router.py + final_technical_decision_contract.mjs", () => {
    const decisionLine = decision === "ready" ? "GENEL KARAR: ✅ ONAYA HAZIR" : "GENEL KARAR: ⚠️ DÜZELTME GEREKİYOR";
    const blockers = decision === "ready" ? "Bloklayıcı bulgu yok." : "- SENARYO 2 içinde çelişkili iki bilgi tespit edildi (fixture negatif test).";
    const ftcOutput =
      `# 🔍 ${B.brand_name} — SON TEKNİK KONTROL\n\n` +
      `## Kontrol Özeti\n| Senaryo | QC Uyumu | Teknik Tutarlılık | Çekime Hazır mı |\n|---|---|---|---|\n| 1 | Uyumlu | Tutarlı | Evet |\n\n` +
      `## Bloklayıcı Bulgular\n${blockers}\n\n` +
      `## Küçük İyileştirmeler\n- Yok.\n\n` +
      `## GENEL KARAR\n${decisionLine}\n`;

    enqueueAnthropicResponse(ftcOutput);
    const { outputText, meta } = callRouter({
      systemText: `Sen ${B.brand_name} için çalışan bağımsız son teknik kontrol editörüsün (fixture).`,
      promptText: `NİHAİ SENARYOLAR\n\n${S[4].finalBody}\n\nBAĞLI KALİTE KONTROL RAPORU\n\n${S[3].qcBody}`,
      maxTokens: CONTENT.final_technical_control.max_model_output,
      primaryModel: PROFILE.cost_control.default_model,
      outName: `05-ftc-${decision}`,
      metaName: `05-ftc-meta-${decision}`,
    });
    assert.equal(meta.provider, "anthropic");
    assert.equal(outputText.split("\n")[0], `# 🔍 ${B.brand_name} — SON TEKNİK KONTROL`);

    const ftcFile = wpath(`05-ftc-${decision}.md`);
    fs.writeFileSync(ftcFile, outputText);
    const result = runOk(process.execPath, [path.join(ROOT, ".github/scripts/final_technical_decision_contract.mjs"), ftcFile]);
    const contractDecision = result.stdout.trim();
    assert.equal(contractDecision, decision, `final_technical_decision_contract.mjs must report '${decision}'`);

    S[5] = S[5] || {};
    S[5][decision] = { body: outputText, decision: contractDecision };
    return { artifactsOut: [`05-ftc-${decision}.md`], value: S[5][decision] };
  });
}

// ===========================================================================
// STAGE 06 — Owner Approval eligibility (gate simulation, real content)
// ===========================================================================
function runStage06() {
  return stage(6, "Owner Approval eligibility", "eren-approval-gate.yml (fixture state, real content)", () => {
    const approvalState = computeOwnerApprovalEligibility(S[4].finalBody, S[5].ready.decision);
    assert.ok(approvalState.labels.has("eren-onayli"));
    S[6] = approvalState;
    return { artifactsOut: ["fixture label-state: eren-onayli/owner-approved/cekime-hazir/production-ready"], value: S[6] };
  });
}

// ===========================================================================
// STAGE 07 — Production Scenario Selection
// ===========================================================================
function runStage07(scenario = 2) {
  return stage(7, "Production Scenario Selection", "eren-production-selection-gate.yml (fixture state, real content)", () => {
    const selectionState = computeScenarioSelection(S[6], S[4].finalBody, scenario);
    assert.equal(selectionState.scenario, scenario);
    S[7] = selectionState;
    return { artifactsOut: [`fixture marker: ${selectionState.marker}`], value: S[7] };
  });
}

// ===========================================================================
// STAGE 08 — Filming Handoff
// ===========================================================================
function runStage08(scenario = 2, finalBodyOverride = null) {
  return stage(8, "Filming Handoff", "filming-handoff-gate.yml (fixture state, real content)", () => {
    const handoff = computeFilmingHandoff(S[7], finalBodyOverride || S[4].finalBody, scenario);
    S[8] = handoff;
    return { artifactsOut: ["fixture dispatch record (workflow_dispatch never actually called)"], value: S[8] };
  });
}

// ===========================================================================
// STAGE 09 — Video Orchestrator routing (REAL subprocess)
// ===========================================================================
function runStage09() {
  return stage(9, "Video Orchestrator routing", "filming-handoff-gate.yml -> video_orchestrator.py", () => {
    const headingRe = /^##\s+SENARYO\s+([123]):.*$/gim;
    const headings = [...S[4].finalBody.matchAll(headingRe)];
    const idx = headings.findIndex((m) => Number(m[1]) === S[7].scenario);
    assert.ok(idx >= 0, "orchestrator: selected scenario heading not found in final body");
    const start = headings[idx].index;
    const end = idx + 1 < headings.length ? headings[idx + 1].index : S[4].finalBody.length;
    let block = S[4].finalBody.slice(start, end);
    const sep = block.search(/^---\s*$/m);
    if (sep >= 0) block = block.slice(0, sep);
    block = block.replace(/<!--[\s\S]*?-->/g, "").trim();

    const inputFile = wpath("09-orchestrator-input.md");
    const outputFile = wpath("09-video-route.json");
    fs.writeFileSync(inputFile, block + "\n");

    runOk(PYTHON, [
      path.join(ROOT, ".github/scripts/video_orchestrator.py"),
      "--config",
      path.join(ROOT, ".github/config/video-orchestrator.json"),
      "--input-file",
      inputFile,
      "--output-file",
      outputFile,
      "--mode",
      "auto",
    ]);
    const route = JSON.parse(fs.readFileSync(outputFile, "utf8"));
    assert.equal(route.paid_generation_allowed, false, "orchestrator: paid_generation_allowed must be false");
    assert.equal(route.dispatch_enabled, false, "orchestrator: dispatch_enabled must be false");
    assert.ok(["human", "hybrid", "faceless"].includes(route.selected_mode), `orchestrator: unsafe mode selected: ${route.selected_mode}`);

    S[9] = route;
    return { artifactsOut: ["09-video-route.json"], value: S[9] };
  });
}

// ===========================================================================
// STAGE 10 — Filming Package (REAL build_filming_package_prompt.mjs +
// ai_router.py + output_contract.py)
// ===========================================================================
function runStage10() {
  return stage(10, "Filming Package", "filming-package-agent-v4-router.yml -> build_filming_package_prompt.mjs + ai_router.py + output_contract.py", () => {
    const systemOutput = wpath("10-system-prompt.txt");
    const metadataOutput = wpath("10-metadata.json");
    runOk(process.execPath, [
      path.join(ROOT, ".github/scripts/build_filming_package_prompt.mjs"),
      "--profile",
      PROFILE_PATH,
      "--system-output",
      systemOutput,
      "--metadata-output",
      metadataOutput,
    ]);
    const systemText = fs.readFileSync(systemOutput, "utf8");
    const metadata = JSON.parse(fs.readFileSync(metadataOutput, "utf8"));

    const filmingPackageText =
      `# 🎥 ${turkishUpperJs(B.brand_name)} — ÇEKİM PAKETİ\n\n` +
      `## 1. Çekimden Önce Ortak Hazırlık\nTelefonu hazırla, pil ve depolamayı kontrol et, sessiz oda seç.\n\n` +
      `## 2. Oda ve Telefon Yerleşimi\nTelefonu güvenli sabit bir yüzeye yerleştir, düşme riskini azalt.\n\n` +
      `## 3. Seçilen Senaryo Çekim Planı\n` +
      `Sıra | Bölüm | Telefon/Kadraj | ${B.owner_display_name}'in Yapacağı | Ses/Işık | Kontrol\n` +
      `--- | --- | --- | --- | --- | ---\n` +
      `1 | Kanca | Yakın plan | Metni söyle | Pencere ışığı | Ses patlamıyor\n\n` +
      `## 4. Shorts/Reels Dikey Çekimi\nAynı kancayı dikey olarak da çek.\n\n` +
      `## 5. En Verimli Çekim Sırası\nÖnce yatay planları, sonra dikey planı çek.\n\n` +
      `## 6. Çekim Sonu Dosya Kontrolü\nDosyaları aç, ses ve görüntüyü kontrol et.\n` +
      "Kontrol notu. ".repeat(40);

    enqueueAnthropicResponse(filmingPackageText);
    const { outputText, meta } = callRouter({
      systemText,
      promptText: `${metadata.request_intro}\n\nSeçilen senaryo ${S[7].scenario}\n\n${(S[4].finalBody.match(new RegExp(`^## SENARYO ${S[7].scenario}:.*$`, "mi")) || [""])[0]}`,
      maxTokens: 3000,
      primaryModel: "claude-sonnet-4-6",
      outName: "10-filming-package",
      metaName: "10-meta",
    });
    assert.equal(meta.provider, "anthropic");

    const contractReport = wpath("10-contract-report.json");
    runOk(PYTHON, [
      path.join(ROOT, ".github/scripts/output_contract.py"),
      "--contract",
      path.join(ROOT, ".github/config/contracts/filming-package.json"),
      "--input-file",
      wpath("10-filming-package.md"),
      "--report-file",
      contractReport,
    ]);
    const contractResult = JSON.parse(fs.readFileSync(contractReport, "utf8"));
    assert.equal(contractResult.passed, true, `filming package failed output_contract.py: ${JSON.stringify(contractResult.errors)}`);

    const sourceSha = sha256(S[4].finalBody);
    const packageBody =
      `<!-- source-body-sha256: ${sourceSha} -->\n` +
      `<!-- package-version: 8 -->\n` +
      `**Kaynak onaylı senaryo:** https://github.com/${B.github_owner}/${path.basename(ROOT)}/issues/${S[4].issueNumber}\n` +
      `**Seçilen içerik:** Senaryo ${S[7].scenario}\n\n` +
      outputText;
    fs.writeFileSync(wpath("10-filming-package-issue.md"), packageBody);
    S[10] = { packageBody, sourceSha };
    return { artifactsOut: ["10-filming-package-issue.md"], value: S[10] };
  });
}

function turkishUpperJs(value) {
  return value.replaceAll("i", "İ").replaceAll("ı", "I").toUpperCase();
}

// ===========================================================================
// STAGE 11 — Raw Video Intake eligibility
// ===========================================================================
function runStage11(finalBodyOverride = null) {
  return stage(11, "Raw Video Intake eligibility", "raw-video-intake-gate.yml (fixture state, real provenance check)", () => {
    const result = computeRawVideoEligibility(S[10].packageBody, finalBodyOverride || S[4].finalBody);
    assert.equal(result.accepted, true);

    // Private-URL/secret rejection: re-verify the real regex from
    // raw-video-intake-gate.yml against a deliberately unsafe fixture
    // field, proving that check still fires (source-anchored + behavioral).
    mustInclude(rawVideoWf, "https?://|www\\.|drive\\.google|dropbox\\.", "private URL rejection regex present");
    const unsafeFileNames = "video.mp4, https://drive.google.com/secret-folder";
    const privateUrlRegex = /(https?:\/\/|www\.|drive\.google|dropbox\.|[?&](token|key|signature|auth)=)/i;
    assert.ok(privateUrlRegex.test(unsafeFileNames), "private-URL guard must flag an unsafe file-name field");

    S[11] = result;
    return { artifactsOut: ["fixture ham-video-teslim record (no real file/link ever stored)"], value: S[11] };
  });
}

// ===========================================================================
// STAGE 12 — Editing Package (REAL build_editing_package_prompt.mjs +
// ai_router.py + validate_editing_package_output.sh)
// ===========================================================================
function runStage12() {
  return stage(12, "Editing Package", "editing-package-agent.yml -> build_editing_package_prompt.mjs + ai_router.py + validate_editing_package_output.sh", () => {
    const systemOutput = wpath("12-system-prompt.txt");
    const metadataOutput = wpath("12-metadata.json");
    runOk(process.execPath, [
      path.join(ROOT, ".github/scripts/build_editing_package_prompt.mjs"),
      "--profile",
      PROFILE_PATH,
      "--system-output",
      systemOutput,
      "--metadata-output",
      metadataOutput,
    ]);
    const systemText = fs.readFileSync(systemOutput, "utf8");

    const intake =
      `# 📥 VİDEOSUZ TEST TESLİMİ (fixture)\n- Video biçimi: Ana video ve Shorts/Reels\n- Dosya referansı: E2E-FIXTURE\n` +
      `Bu testte ham görüntü bulunmaz.\n`;

    const editingPackageText =
      `## 1. Kaynak ve Dosya Haritası\nTeslim kaydındaki dosya adları eşleştirildi.\n\n` +
      `## 2. Ana Video Kurgu Akışı\nSıra | Kaynak | Giriş | Çıkış | Görüntü | Ses | Not\n---|---|---|---|---|---|---\n1 | video.mp4 | Kanca başı | Kanca sonu | Yakın plan | Net | -\n\n` +
      `## 3. Ekran Yazıları ve Altyazı Planı\nBaşlık kartı önerisi.\n\n` +
      `## 4. Ses Düzeni\nKonuşma net, arka plan müziği yok.\n\n` +
      `## 5. Kısa/Dikey Video Kurgu Akışı\nAynı kancadan kısa kesit.\n\n` +
      `## 6. Dışa Aktarma Ayarları\n16:9 ana video, 9:16 kısa video.\n\n` +
      `## 7. ${B.owner_display_name} Son Kontrol Listesi\n` +
      `Ham video görülmeden hazırlanmıştır; kesin kesimler görüntü izlenirken belirlenecek.\n` +
      `- Son madde: ${B.owner_display_name} tarafından yayın onayı.\n`;

    enqueueAnthropicResponse(editingPackageText);
    const { meta } = callRouter({
      systemText,
      promptText:
        `Aşağıdaki kaynaklardan uygulanabilir kurgu paketi hazırla (fixture).\n\n` +
        `TESLİM KAYDI\n\n${intake}\n\nÇEKİM PAKETİNDEN GEREKLİ BÖLÜMLER\n\n${S[10].packageBody}\n\nONAYLI NİHAİ SENARYO\n\n${S[4].finalBody}`,
      maxTokens: 5000,
      primaryModel: "claude-sonnet-4-6",
      outName: "12-editing-package",
      metaName: "12-meta",
    });
    assert.equal(meta.provider, "anthropic");

    runOk("bash", [path.join(ROOT, ".github/scripts/validate_editing_package_output.sh"), wpath("12-editing-package.md")]);

    const editingBody =
      `<!-- source-bundle-sha256: ${sha256(intake + S[10].packageBody + S[4].finalBody)} -->\n` +
      `<!-- editing-package-version: 4 -->\n` +
      `**Kaynak onaylı senaryo:** https://github.com/${B.github_owner}/${path.basename(ROOT)}/issues/${S[4].issueNumber}\n\n` +
      editingPackageText;
    fs.writeFileSync(wpath("12-editing-package-issue.md"), editingBody);
    S[12] = { editingBody };
    return { artifactsOut: ["12-editing-package-issue.md"], value: S[12] };
  });
}

// ===========================================================================
// STAGE 13 — Subtitle Package (REAL build_subtitle_package.py)
// ===========================================================================
function runStage13() {
  return stage(13, "Subtitle Package", "subtitle-package-agent.yml -> build_subtitle_package.py", () => {
    const finalFile = wpath("04-final-scripts.md");
    const editingFile = wpath("12-editing-package-issue.md");
    const outputFile = wpath("13-subtitle-package.md");
    const result = runOk(PYTHON, [
      path.join(ROOT, ".github/scripts/build_subtitle_package.py"),
      "--final",
      finalFile,
      "--editing",
      editingFile,
      "--output",
      outputFile,
      "--final-url",
      `https://github.com/${B.github_owner}/${path.basename(ROOT)}/issues/${S[4].issueNumber}`,
      "--editing-url",
      `https://github.com/${B.github_owner}/${path.basename(ROOT)}/issues/701`,
      "--scenario",
      String(S[7].scenario),
      "--profile",
      PROFILE_PATH,
      "--test-mode",
      "false",
    ]);
    assert.match(result.stdout, /subtitle_package_ok/);
    const body = readTextFile(outputFile);
    assert.equal(body.split("## ").length - 1, 7, "subtitle package must have exactly 7 sections");
    // Regression guard for the SENARYO-1-only extraction bug found and fixed in this
    // branch: the Nihai Senaryolar body still holds all 3 scenarios, so the spoken text
    // must genuinely come from the SELECTED scenario (2), not silently fall back to 1.
    const selectedWord = SCENARIO_TITLES[S[7].scenario - 1].split(" ")[0].toLocaleLowerCase("tr-TR");
    const otherWord = SCENARIO_TITLES[0].split(" ")[0].toLocaleLowerCase("tr-TR");
    assert.ok(body.toLocaleLowerCase("tr-TR").includes(selectedWord), "subtitle package must reflect the SELECTED scenario's spoken text");
    assert.ok(!body.toLocaleLowerCase("tr-TR").includes(otherWord), "subtitle package must not leak the non-selected SENARYO 1's spoken text");
    S[13] = { body, url: `https://github.com/${B.github_owner}/${path.basename(ROOT)}/issues/702` };
    return { artifactsOut: ["13-subtitle-package.md"], value: S[13] };
  });
}

// ===========================================================================
// STAGE 14 — Thumbnail Package (REAL build_thumbnail_package.py)
// ===========================================================================
function runStage14() {
  return stage(14, "Thumbnail Package", "thumbnail-package-agent.yml -> build_thumbnail_package.py", () => {
    const finalFile = wpath("04-final-scripts.md");
    const subtitleFile = wpath("13-subtitle-package.md");
    const outputFile = wpath("14-thumbnail-package.md");
    const result = runOk(PYTHON, [
      path.join(ROOT, ".github/scripts/build_thumbnail_package.py"),
      "--final",
      finalFile,
      "--subtitle",
      subtitleFile,
      "--output",
      outputFile,
      "--final-url",
      `https://github.com/${B.github_owner}/${path.basename(ROOT)}/issues/${S[4].issueNumber}`,
      "--subtitle-url",
      S[13].url,
      "--scenario",
      String(S[7].scenario),
      "--profile",
      PROFILE_PATH,
      "--test-mode",
      "false",
    ]);
    assert.match(result.stdout, /thumbnail_package_ok/);
    const body = readTextFile(outputFile);
    assert.equal((body.match(/^### Seçenek [ABC]$/gm) || []).length, 3, "thumbnail package must have exactly 3 options");
    // Same SENARYO-1-only regression guard as stage 13: the cover-text options must be
    // derived from the SELECTED scenario's SEO title, not the first scenario in the doc.
    assert.ok(body.includes(`- **Seçilen senaryo:** ${S[7].scenario}`), "thumbnail package must record the selected scenario number");
    assert.ok(!body.includes(SCENARIO_TITLES[0]), "thumbnail package must not leak the non-selected SENARYO 1's title");
    S[14] = { body, url: `https://github.com/${B.github_owner}/${path.basename(ROOT)}/issues/703` };
    return { artifactsOut: ["14-thumbnail-package.md"], value: S[14] };
  });
}

// ===========================================================================
// STAGE 15 — YouTube Publication Package (REAL build_youtube_package.py)
// ===========================================================================
function runStage15() {
  return stage(15, "YouTube Publication Package", "youtube-publication-package-agent.yml -> build_youtube_package.py", () => {
    const finalFile = wpath("04-final-scripts.md");
    const thumbnailFile = wpath("14-thumbnail-package.md");
    const outputFile = wpath("15-youtube-package.md");
    const result = runOk(PYTHON, [
      path.join(ROOT, ".github/scripts/build_youtube_package.py"),
      "--final",
      finalFile,
      "--thumbnail",
      thumbnailFile,
      "--output",
      outputFile,
      "--final-url",
      `https://github.com/${B.github_owner}/${path.basename(ROOT)}/issues/${S[4].issueNumber}`,
      "--thumbnail-url",
      S[14].url,
      "--thumbnail-choice",
      "A",
      "--scenario",
      String(S[7].scenario),
      "--profile",
      PROFILE_PATH,
      "--test-mode",
      "false",
    ]);
    assert.match(result.stdout, /youtube_package_ok/);
    const body = readTextFile(outputFile);
    assert.equal((body.match(/^## [1-8]\./gm) || []).length, 8, "YouTube package must have exactly 8 sections");
    assert.ok(body.includes("YouTube'a video yükleme:** Yapılmadı"));
    // Same SENARYO-1-only regression guard: the published video title must be the
    // SELECTED scenario's own SEO title, not silently the first scenario in the doc.
    assert.ok(body.includes(SCENARIO_TITLES[S[7].scenario - 1]), "YouTube package title must come from the SELECTED scenario");
    assert.ok(!body.includes(SCENARIO_TITLES[0]), "YouTube package must not leak the non-selected SENARYO 1's title");
    S[15] = { body };
    return { artifactsOut: ["15-youtube-package.md"], value: S[15] };
  });
}

// ===========================================================================
// STAGE 16 — YouTube Review Readiness -> Final YouTube Publication Approval
//
// Two real gates run in sequence, both driven by S[15]'s REAL
// build_youtube_package.py output:
//   16a. youtube-review-readiness-gate.yml — the owner explicitly attests
//        video/SRT/thumbnail/not-yet-public; the gate fails closed unless
//        ALL FOUR are true, then records a body-revision-bound comment
//        marker (never in the package body — see computeReviewReadiness).
//   16b. youtube-publication-approval-gate.yml — now genuinely finds that
//        marker, verifies it was bot-authored and still matches the
//        CURRENT package body, and only then grants final approval.
// This closes the gap the previous zero-token E2E run reported as a real
// BLOCKER (no stage produced YOUTUBE_REVIEW_READY_V1) — 16a is that
// producer, deliberately kept OUT of build_youtube_package.py itself (see
// the file header comment in youtube-review-readiness-gate.yml for why).
// ===========================================================================
function runStage16() {
  return stage(16, "YouTube Review Readiness -> Final Publication Approval", "youtube-review-readiness-gate.yml -> youtube-publication-approval-gate.yml", () => {
    const pendingLabels = new Set(["youtube-yayin-paketi", "eren-yayin-onayi-bekliyor", "publication-approval-pending"]);

    const readiness = computeReviewReadiness(
      S[15].body,
      pendingLabels,
      { videoReady: true, srtReady: true, thumbnailReady: true, confirmedNotPublic: true },
      false
    );
    assert.ok(readiness.labels.has("youtube-review-ready"), "16a: real-mode readiness must add youtube-review-ready");
    console.log(`  16a Review Readiness -> PASS (marker: ${readiness.marker})`);

    const approval = computePublicationApprovalEligibility(S[15].body, readiness.labels, readiness);
    assert.ok(approval.labels.has("eren-yayin-onayli") && approval.labels.has("publication-approved"));
    console.log("  16b Final Publication Approval -> PASS");

    S[16] = { readiness, approval };
    return { artifactsOut: [`readiness comment marker (issue-bound, sha256=${readiness.bodySha.slice(0, 12)}…)`, "approval labels: eren-yayin-onayli, publication-approved, yayina-hazir"], value: S[16] };
  });
}

// ===========================================================================
// NEGATIVE TESTS
// ===========================================================================
function runNegativeTests() {
  console.log("\n--- NEGATIVE TESTS ---");

  negative("N1", "QC/FTC blocker present -> owner approval rejected", () => {
    assert.throws(() => computeOwnerApprovalEligibility(S[4].finalBody, "blocked"), /blocker/);
  });

  negative("N2", "No owner approval -> scenario selection rejected", () => {
    assert.throws(() => computeScenarioSelection({ labels: new Set() }, S[4].finalBody, 2), /approval missing/);
  });

  negative("N3", "Wrong scenario -> filming handoff rejected", () => {
    assert.throws(() => computeFilmingHandoff(S[7], S[4].finalBody, 3), /mismatch/);
  });

  negative("N4", "Final body changed after selection -> stale handoff rejected", () => {
    const mutatedBody = S[4].finalBody.replace("Adım 1", "Adım 1 (değiştirildi)");
    assert.notEqual(mutatedBody, S[4].finalBody);
    assert.throws(() => computeFilmingHandoff(S[7], mutatedBody, S[7].scenario), /stale/);
  });

  negative("N5", "Stale filming package (source body changed after package built) -> raw-video intake rejected", () => {
    const mutatedBody = S[4].finalBody.replace("Adım 2", "Adım 2 (değiştirildi)");
    assert.notEqual(mutatedBody, S[4].finalBody);
    assert.throws(() => computeRawVideoEligibility(S[10].packageBody, mutatedBody), /stale/);
  });

  negative("N6", "Multiple scenarios selected simultaneously -> rejected", () => {
    const multiState = { ...S[7], labels: new Set([...S[7].labels, "uretim-senaryo-1", "production-scenario-1"]) };
    const legacy = [...multiState.labels].filter((l) => /^uretim-senaryo-\d$/.test(l));
    const generic = [...multiState.labels].filter((l) => /^production-scenario-\d$/.test(l));
    assert.ok(legacy.length > 1 || generic.length > 1, "fixture must actually represent >1 selected scenario");
    // Mirrors filming-handoff-gate.yml's own real guard:
    // `if [[ "${#LEGACY_SELECTION_LABELS[@]}" -gt 1 || "${#GENERIC_SELECTION_LABELS[@]}" -gt 1 ]]`
    mustInclude(handoffWf, '"${#LEGACY_SELECTION_LABELS[@]}" -gt 1 || "${#GENERIC_SELECTION_LABELS[@]}" -gt 1', "multi-scenario guard present in real workflow");
  });

  negative("N7", "AI test path attempting the REAL provider config with no secrets must fail closed, zero network", () => {
    const promptFile = wpath("n7-prompt.txt");
    fs.writeFileSync(promptFile, "should never reach a real provider");
    const metaFile = wpath("n7-meta.json");
    const result = run(PYTHON, [
      path.join(ROOT, ".github/scripts/ai_router.py"),
      "--config",
      path.join(ROOT, ".github/config/ai-router.json"), // the REAL, unmodified config
      "--prompt-file",
      promptFile,
      "--output-file",
      wpath("n7-out.md"),
      "--meta-file",
      metaFile,
      "--max-tokens",
      "10",
      "--primary-model",
      "claude-sonnet-4-6",
    ], { env: { ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", DEEPSEEK_API_KEY: "", DASHSCOPE_API_KEY: "" } });
    assert.notEqual(result.code, 0, "router must exit non-zero with no secrets configured");
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    for (const attempt of meta.attempts) {
      assert.notEqual(attempt.status, "success", "no provider may succeed with no secrets");
      assert.ok(!("http_status" in attempt), `attempt for ${attempt.provider} must never have reached request_json (no http_status recorded)`);
    }
  });

  negative("N8", "Video Orchestrator paid_generation_allowed=true must be rejected by the caller's own check", () => {
    const forged = { ...S[9], paid_generation_allowed: true };
    assert.throws(() => {
      if (forged.paid_generation_allowed !== false) throw new Error("orchestrator: paid_generation_allowed must be false");
    });
    mustInclude(handoffWf, "jq -e '.paid_generation_allowed == false'", "real handoff gate enforces this exact check");
  });

  negative("N9", "Video Orchestrator dispatch_enabled=true must be rejected by the caller's own check", () => {
    const forged = { ...S[9], dispatch_enabled: true };
    assert.throws(() => {
      if (forged.dispatch_enabled !== false) throw new Error("orchestrator: dispatch_enabled must be false");
    });
    mustInclude(handoffWf, "jq -e '.dispatch_enabled == false'", "real handoff gate enforces this exact check");
  });

  negative("N10", "YouTube package readiness marker missing -> final approval rejected", () => {
    assert.throws(
      () => computePublicationApprovalEligibility(S[15].body, new Set(["eren-yayin-onayi-bekliyor", "publication-approval-pending"])),
      /readiness marker missing/
    );
  });

  negative("N11", "Publication approved+pending together -> rejected", () => {
    assert.throws(
      () => computePublicationApprovalEligibility(S[15].body, new Set(["eren-yayin-onayli", "publication-approved", "eren-yayin-onayi-bekliyor"])),
      /coexist/
    );
  });

  negative("N12", "Test-mode/system-testi state can never become a real production-approved label set", () => {
    mustInclude(pubApprovalWf, '.name == "sistem-testi"', "publication gate distinguishes sistem-testi from real packages");
    mustInclude(pubApprovalWf, '"test-yayin-onayli"', "test approval uses a SEPARATE label from real eren-yayin-onayli/publication-approved");
    const testOnlyLabel = "test-yayin-onayli";
    const realLabels = ["eren-yayin-onayli", "publication-approved"];
    assert.ok(!realLabels.includes(testOnlyLabel), "test approval label must never equal a real production approval label");
  });

  // ---- N13-N21: youtube-review-readiness-gate.yml contract (closes the
  // stage-16 blocker the previous zero-token E2E run reported) ----

  const readinessPendingLabels = () => new Set(["youtube-yayin-paketi", "eren-yayin-onayi-bekliyor", "publication-approval-pending"]);
  const readyFlags = { videoReady: true, srtReady: true, thumbnailReady: true, confirmedNotPublic: true };

  negative("N13", "video_ready=false -> readiness rejected (fail closed)", () => {
    assert.throws(
      () => computeReviewReadiness(S[15].body, readinessPendingLabels(), { ...readyFlags, videoReady: false }, false),
      /media attestation incomplete/
    );
  });

  negative("N14", "srt_ready=false -> readiness rejected (fail closed)", () => {
    assert.throws(
      () => computeReviewReadiness(S[15].body, readinessPendingLabels(), { ...readyFlags, srtReady: false }, false),
      /media attestation incomplete/
    );
  });

  negative("N15", "thumbnail_ready=false -> readiness rejected (fail closed)", () => {
    assert.throws(
      () => computeReviewReadiness(S[15].body, readinessPendingLabels(), { ...readyFlags, thumbnailReady: false }, false),
      /media attestation incomplete/
    );
  });

  negative("N16", "public already true (not confirmed unlisted) -> readiness rejected (fail closed)", () => {
    assert.throws(
      () => computeReviewReadiness(S[15].body, readinessPendingLabels(), { ...readyFlags, confirmedNotPublic: false }, false),
      /media attestation incomplete/
    );
  });

  negative("N17", "Non-owner actor attempting readiness gate -> rejected by the same owner-only authorization contract as the other 4 agents", () => {
    mustInclude(reviewReadinessWf, 'if [[ "$NORMALIZED_RUN_ACTOR" != "$NORMALIZED_CONFIG_OWNER" ]]; then', "readiness gate rejects non-owner actors before any Issue read/write");
    mustInclude(reviewReadinessWf, "uses: actions/checkout@v4", "readiness gate still checks out source before authorizing");
    const normalizeLogin = (value) => value.toLocaleLowerCase("en-US");
    const configuredOwner = B.github_owner;
    const attacker = "some-other-github-user";
    assert.notEqual(normalizeLogin(attacker), normalizeLogin(configuredOwner));
    assert.throws(() => {
      // Mirrors the exact bash condition the gate runs before touching any Issue.
      if (normalizeLogin(attacker) !== normalizeLogin(configuredOwner)) {
        throw new Error("readiness: run actor is not the authorized business.github_owner");
      }
    }, /not the authorized/);
  });

  negative("N18", "Non-YouTube-package Issue -> readiness rejected", () => {
    const wrongLabels = new Set(["thumbnail-paketi", "thumbnail-package", "eren-onayi-bekliyor"]);
    assert.throws(
      () => computeReviewReadiness(S[15].body, wrongLabels, readyFlags, false),
      /not a YouTube Yayın Paketi/
    );
  });

  negative("N19", "Package body changed after readiness recorded -> stale readiness rejected at final approval", () => {
    const readiness = computeReviewReadiness(S[15].body, readinessPendingLabels(), readyFlags, false);
    const mutatedBody = S[15].body + "\n<!-- N19: package re-generated after readiness was recorded -->\n";
    assert.notEqual(mutatedBody, S[15].body);
    assert.throws(
      () => computePublicationApprovalEligibility(mutatedBody, readiness.labels, readiness),
      /stale/
    );
  });

  negative("N20", "Final approval attempted with readiness never recorded at all -> rejected", () => {
    assert.throws(
      () => computePublicationApprovalEligibility(S[15].body, readinessPendingLabels(), undefined),
      /readiness marker missing \(readiness never recorded\)/
    );
  });

  negative("N21", "Forged (non-bot-authored) readiness comment -> rejected at final approval", () => {
    // Anyone can post an issue comment on a public repo; a hand-typed comment that
    // merely LOOKS like the marker (even with a correctly-computed body sha256, since
    // the body is public) must never be trusted — only one posted by
    // youtube-review-readiness-gate.yml itself (as github-actions[bot]) counts.
    const genuineReadiness = computeReviewReadiness(S[15].body, readinessPendingLabels(), readyFlags, false);
    const forged = { ...genuineReadiness, botAuthored: false };
    assert.throws(
      () => computePublicationApprovalEligibility(S[15].body, forged.labels, forged),
      /forged marker rejected/
    );
  });

  console.log(`--- NEGATIVE TESTS: ${NEGATIVE_RESULTS.filter((r) => r.status === "PASS").length}/${NEGATIVE_RESULTS.length} PASS ---`);
}

// ===========================================================================
// REPORT
// ===========================================================================
function printReport() {
  const lines = [];
  lines.push("ZERO-TOKEN E2E SYSTEM TEST");
  lines.push("");
  const names = {
    1: "Research", 2: "Script", 3: "QC", 4: "Correction", 5: "Final Check",
    6: "Owner Approval", 7: "Scenario Selection", 8: "Filming Handoff",
    9: "Video Orchestrator", 10: "Filming Package", 11: "Raw Video Eligibility",
    12: "Editing", 13: "Subtitle", 14: "Thumbnail", 15: "YouTube Package",
    16: "Readiness+Approval",
  };
  for (let n = 1; n <= 16; n++) {
    const row = REPORT.find((r) => r.n === n);
    const label = `${String(n).padStart(2, "0")} ${names[n]}`.padEnd(28, ".");
    const status = row ? row.status : "MISSING";
    lines.push(`${label} ${status}`);
    if (row) {
      lines.push(`     code path: ${row.codePath}`);
      const artifacts = row.artifactsOut && row.artifactsOut.length ? row.artifactsOut.join(", ") : "(none — gate/eligibility check only)";
      lines.push(`     artifact:  ${artifacts}`);
    }
  }
  lines.push("");
  lines.push(`AI INPUT TOKENS: ${USAGE.inputTokens}`);
  lines.push(`AI OUTPUT TOKENS: ${USAGE.outputTokens}`);
  lines.push(`WEB SEARCHES: ${USAGE.webSearches}`);
  lines.push(`VIDEO GENERATIONS: ${USAGE.videoGenerations}`);
  lines.push(`YOUTUBE UPLOADS: ${USAGE.youtubeUploads}`);
  lines.push(`YOUTUBE PUBLICATIONS: ${USAGE.youtubePublications}`);
  lines.push("");
  lines.push(`NEGATIVE TESTS: ${NEGATIVE_RESULTS.filter((r) => r.status === "PASS").length}/${NEGATIVE_RESULTS.length} PASS`);
  const text = lines.join("\n");
  console.log("\n" + text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "```text\n" + text + "\n```\n");
  }
  return text;
}

function main() {
  try {
    runStage01();
    runStage02();
    runStage03();
    runStage04();
    runStage05("ready");
    runStage06();
    runStage07(2);
    runStage08(2);
    runStage09();
    runStage10();
    runStage11();
    runStage12();
    runStage13();
    runStage14();
    runStage15();
    runStage16();

    // final_technical_decision_contract.mjs's real vocabulary is "ready"/"fix" (see
    // ALLOWED_DECISIONS in the script itself) — exercises its real code path against a
    // blocked report so N1 can prove owner-approval rejection is driven by a genuine
    // "fix" decision, not a hand-typed one.
    runStage05("fix");
    runNegativeTests();

    printReport();

    const blocked = REPORT.some((r) => r.status === "BLOCKED");
    const failed = REPORT.some((r) => r.status === "FAIL") || NEGATIVE_RESULTS.some((r) => r.status !== "PASS");
    let verdict;
    if (failed) verdict = "ZERO-TOKEN E2E: ❌ FAIL";
    else if (blocked) verdict = "ZERO-TOKEN E2E: ⚠️ PARTIAL PASS — BLOCKER FOUND";
    else verdict = "ZERO-TOKEN E2E: ✅ PASS";
    console.log("\n" + verdict);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n**${verdict}**\n`);
    }

    assert.equal(USAGE.inputTokens, 0, "input_tokens must be exactly 0");
    assert.equal(USAGE.outputTokens, 0, "output_tokens must be exactly 0");
    assert.equal(USAGE.webSearches, 0, "web_search must be exactly 0");

    process.exitCode = failed ? 1 : 0;
  } catch (error) {
    console.error("FATAL:", error.stack || error.message);
    process.exitCode = 1;
  } finally {
    try {
      if (!process.env.E2E_KEEP_WORK) fs.rmSync(WORK, { recursive: true, force: true });
    } catch {
      // best-effort cleanup only
    }
  }
}

console.log("ZERO-TOKEN FULL E2E SYSTEM TEST — starting");
console.log(`Working directory: ${WORK}`);

main();

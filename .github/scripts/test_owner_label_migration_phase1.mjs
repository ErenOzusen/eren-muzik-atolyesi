#!/usr/bin/env node
/**
 * Zero-token portability tests for the Main Owner Approval Label Migration — Faz 1.
 *
 * Verifies, repository-wide, that the eren-onayli/eren-onayi-bekliyor approval chain
 * has been extended with a generic owner-approved/owner-approval-pending twin
 * (dual-write + read-both) across every workflow the audit identified as a
 * producer/consumer, without removing legacy production, without creating a new
 * functional gate out of the subtitle/thumbnail status-only usage, and without
 * disturbing the separately-migrated publication (eren-yayin- / publication- prefixed)
 * chain, business-profile.json's schema, or any unrelated generic label.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// The 12 workflows confirmed, both by the prior audit and by a fresh repo-wide grep
// performed before implementation, to touch the main eren-onayli / eren-onayi-bekliyor
// approval chain. youtube-publication-approval-gate.yml is deliberately excluded — it
// belongs to the separately-migrated publication chain, checked in section 6 below.
const TARGET_WORKFLOWS = [
  "eren-approval-gate.yml",
  "weekly-script-correction.yml",
  "final-technical-check.yml",
  "approval-invalidation-gate.yml",
  "eren-production-selection-gate.yml",
  "filming-handoff-gate.yml",
  "filming-package-agent-v4-router.yml",
  "raw-video-intake-gate.yml",
  "editing-package-agent.yml",
  "subtitle-package-agent.yml",
  "thumbnail-package-agent.yml",
  "youtube-publication-package-agent.yml",
];

const workflows = Object.fromEntries(
  TARGET_WORKFLOWS.map((name) => [name, read(`.github/workflows/${name}`)]),
);

// ---------------------------------------------------------------------------
// 1. Dual-write producers.
// ---------------------------------------------------------------------------

// Approved (eren-onayli -> owner-approved) is produced only by eren-approval-gate.yml.
{
  const w = workflows["eren-approval-gate.yml"];
  for (const contract of [
    'gh label create "eren-onayli"',
    'gh label create "owner-approved"',
    '--add-label "eren-onayli"',
    '--add-label "owner-approved"',
  ]) {
    assert.ok(w.includes(contract), `eren-approval-gate.yml dual-write approved eksik: ${contract}`);
  }
}

// Pending (eren-onayi-bekliyor -> owner-approval-pending) is produced by
// weekly-script-correction.yml, final-technical-check.yml and
// approval-invalidation-gate.yml (functional, on Nihai Senaryolar), and by
// subtitle-package-agent.yml / thumbnail-package-agent.yml (status-only, on their
// own output issues).
for (const name of [
  "weekly-script-correction.yml",
  "final-technical-check.yml",
  "approval-invalidation-gate.yml",
  "subtitle-package-agent.yml",
  "thumbnail-package-agent.yml",
]) {
  const w = workflows[name];
  assert.ok(w.includes('gh label create "eren-onayi-bekliyor"'), `${name}: legacy pending create eksik`);
  assert.ok(w.includes('gh label create "owner-approval-pending"'), `${name}: generic pending create eksik`);
}

// ---------------------------------------------------------------------------
// 2. Read-both consumers.
// ---------------------------------------------------------------------------
const JQ_READ_BOTH = 'any(.name == "eren-onayli" or .name == "owner-approved")';
for (const name of [
  "raw-video-intake-gate.yml",
  "editing-package-agent.yml",
  "subtitle-package-agent.yml",
  "thumbnail-package-agent.yml",
  "youtube-publication-package-agent.yml",
]) {
  assert.ok(workflows[name].includes(JQ_READ_BOTH), `${name}: jq read-both eksik`);
}

assert.ok(
  workflows["eren-production-selection-gate.yml"].includes("grep -qxE 'eren-onayli|owner-approved'"),
  "eren-production-selection-gate.yml: grep read-both eksik",
);

for (const name of ["filming-handoff-gate.yml", "filming-package-agent-v4-router.yml"]) {
  const w = workflows[name];
  assert.ok(
    w.includes('for REQUIRED in eren-onayli cekime-hazir uretime-secildi'),
    `${name}: mevcut sözleşme loop başlığı korunmalıydı (backward-compat testleri buna bağlı)`,
  );
  assert.ok(w.includes('if [[ "$REQUIRED" == "eren-onayli" ]]; then'), `${name}: loop case-split eksik`);
  assert.ok(
    /grep -qxE 'eren-onayli\|owner-approved' \/tmp\/(final-)?labels\.txt/.test(w),
    `${name}: loop read-both eksik`,
  );
}

{
  const w = workflows["eren-approval-gate.yml"];
  assert.ok(
    w.includes("grep -qxE 'eren-onayi-bekliyor|owner-approval-pending'"),
    "eren-approval-gate.yml: pending read-both eksik",
  );
  assert.ok(
    w.includes("grep -qxE 'eren-onayli|owner-approved'"),
    "eren-approval-gate.yml: approved read-both eksik",
  );
}

// ---------------------------------------------------------------------------
// 3. Repository-wide regression scan: no target workflow may still contain a
//    stale legacy-only form of the approved check.
// ---------------------------------------------------------------------------
const STALE_APPROVED_JQ = /any\(\.name == "eren-onayli"\)/;
const STALE_APPROVED_GREP = /grep -qx 'eren-onayli' \/tmp\/labels\.txt/;
for (const [name, content] of Object.entries(workflows)) {
  assert.ok(!STALE_APPROVED_JQ.test(content), `${name}: hâlâ eski tek-isimli jq kontrolü içeriyor`);
  assert.ok(!STALE_APPROVED_GREP.test(content), `${name}: hâlâ eski tek-isimli grep kontrolü içeriyor`);
}

// ---------------------------------------------------------------------------
// 4. Invalidation gate: dual-remove (both approved labels) + dual-write (both
//    pending labels), triggered regardless of whether the Issue held only the
//    legacy approved label.
// ---------------------------------------------------------------------------
{
  const w = workflows["approval-invalidation-gate.yml"];
  assert.ok(
    w.includes("for LABEL in eren-onayli owner-approved cekime-hazir cekim-paketi-hazir"),
    "invalidation: dual-remove listesine owner-approved eklenmemiş",
  );
  assert.ok(
    w.includes('--add-label "eren-onayi-bekliyor"') && w.includes('--add-label "owner-approval-pending"'),
    "invalidation: dual-write eksik",
  );
}

// ---------------------------------------------------------------------------
// 5. Subtitle/thumbnail: eren-onayi-bekliyor / owner-approval-pending usage on
//    their OWN output issues must remain status-only. No workflow anywhere in this
//    package may read either label back in jq `any(...)` form — that would mean a
//    new functional gate was created, which this package must not do.
// ---------------------------------------------------------------------------
const PENDING_JQ_READ = /any\(\.name == "(eren-onayi-bekliyor|owner-approval-pending)"/;
for (const [name, content] of Object.entries(workflows)) {
  assert.ok(
    !PENDING_JQ_READ.test(content),
    `${name}: eren-onayi-bekliyor/owner-approval-pending jq ile okunuyor — yeni bir fonksiyonel kapı oluşturulmuş olabilir`,
  );
}
// The two UI-only producers must add the generic label only to their OWN new/updated
// issue, not wire it as a precondition for any downstream workflow.
assert.ok(
  workflows["subtitle-package-agent.yml"].includes(
    'gh issue edit "$SUBTITLE_NUMBER" --add-label "owner-approval-pending"',
  ),
  "subtitle-package-agent.yml: generic status label kendi Issue'una eklenmiyor",
);
assert.ok(
  workflows["thumbnail-package-agent.yml"].includes(
    'gh issue edit "$THUMBNAIL_NUMBER" --add-label "owner-approval-pending"',
  ),
  "thumbnail-package-agent.yml: generic status label kendi Issue'una eklenmiyor",
);
// ---------------------------------------------------------------------------
// 6. Publication label migration (previous package) must be completely untouched.
// ---------------------------------------------------------------------------
{
  const approvalGate = read(".github/workflows/youtube-publication-approval-gate.yml");
  for (const notExpected of ['"owner-approved"', '"owner-approval-pending"']) {
    assert.ok(
      !approvalGate.includes(notExpected),
      `youtube-publication-approval-gate.yml: bu paketin label'ı sızmış: ${notExpected}`,
    );
  }
  for (const stillExpected of [
    'any(.name == "eren-yayin-onayi-bekliyor" or .name == "publication-approval-pending")',
    'any(.name == "eren-yayin-onayli" or .name == "publication-approved")',
    'gh label create "publication-approved"',
    '--remove-label "publication-approval-pending"',
  ]) {
    assert.ok(
      approvalGate.includes(stillExpected),
      `youtube-publication-approval-gate.yml: önceki paketin işi bozulmuş: ${stillExpected}`,
    );
  }

  const youtubePackageAgent = workflows["youtube-publication-package-agent.yml"];
  for (const stillExpected of ['"eren-yayin-onayi-bekliyor"', '"publication-approval-pending"']) {
    assert.ok(
      youtubePackageAgent.includes(stillExpected),
      `youtube-publication-package-agent.yml: önceki paketin işi bozulmuş: ${stillExpected}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 7. business-profile.json schema untouched: no new label-related config field,
//    schema_version unchanged, labels never leak into config.
// ---------------------------------------------------------------------------
{
  const current = JSON.parse(read(".github/config/business-profile.json"));
  const second = JSON.parse(read(".github/scripts/fixtures/second-business-profile.json"));
  for (const profile of [current, second]) {
    assert.equal(profile.schema_version, 1);
  }
  const rawCurrent = read(".github/config/business-profile.json");
  const rawSecond = read(".github/scripts/fixtures/second-business-profile.json");
  for (const forbidden of ["owner-approved", "owner-approval-pending"]) {
    assert.ok(!rawCurrent.includes(forbidden), `business-profile.json içine label sızmış: ${forbidden}`);
    assert.ok(!rawSecond.includes(forbidden), `second-business-profile.json içine label sızmış: ${forbidden}`);
  }
}

// ---------------------------------------------------------------------------
// 8. Other generic labels (unrelated to this migration) must remain exactly as
//    they were.
// ---------------------------------------------------------------------------
const OTHER_GENERIC_LABELS = {
  "eren-production-selection-gate.yml": ["cekime-hazir", "uretime-secildi", "uretim-senaryo-"],
  "filming-handoff-gate.yml": ["cekime-hazir", "uretime-secildi"],
  "filming-package-agent-v4-router.yml": ["cekime-hazir", "uretime-secildi", "cekim-paketi", "cekim-paketi-hazir"],
  "raw-video-intake-gate.yml": ["cekime-hazir", "ham-video-teslim", "kurgu-bekliyor", "ham-video-teslim-alindi"],
  "editing-package-agent.yml": ["kurgu-paketi", "kurgu-plani-hazir", "sistem-testi"],
  "subtitle-package-agent.yml": ["altyazi-paketi", "altyazi-paketi-hazir", "sistem-testi"],
  "thumbnail-package-agent.yml": ["thumbnail-paketi", "thumbnail-paketi-hazir", "sistem-testi"],
  "youtube-publication-package-agent.yml": ["youtube-yayin-paketi", "youtube-yayin-paketi-hazir", "sistem-testi"],
  "final-technical-check.yml": ["son-kontrol-gecti", "duzeltme-gerekiyor"],
  "approval-invalidation-gate.yml": ["cekime-hazir", "cekim-paketi-hazir"],
};
for (const [name, labels] of Object.entries(OTHER_GENERIC_LABELS)) {
  for (const label of labels) {
    assert.ok(workflows[name].includes(label), `${name}: kapsam dışı generic label kayboldu: ${label}`);
  }
}

console.log(
  "owner_label_migration_phase1_ok ai_calls=0 api_calls=0 issue_writes=0 dispatches=0 video_calls=0",
);

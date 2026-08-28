#!/usr/bin/env node
/** Zero-token portability tests for the editing-package prompt. */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadProfile,
  renderMetadata,
  renderSystemPrompt,
} from "./build_editing_package_prompt.mjs";


const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..", "..");
const workflowPath = join(repoRoot, ".github", "workflows", "editing-package-agent.yml");


async function assertProfile(profilePath, expected, forbidden) {
  const profile = await loadProfile(profilePath);
  const rendered = `${renderSystemPrompt(profile)}\n${JSON.stringify(renderMetadata(profile))}`;
  for (const value of expected) {
    assert.ok(rendered.includes(value), `Beklenen profil değeri promptta yok: ${value}`);
  }
  for (const value of forbidden) {
    assert.ok(!rendered.includes(value), `Başka işletmeye ait değer promptta kaldı: ${value}`);
  }
  assert.ok(rendered.includes("çekim paketini"), "Genel 'çekim paketini' ifadesi promptta yok");
  assert.ok(!rendered.includes("telefonla çekim paketini"), "Cihaz-özel 'telefonla çekim paketini' ifadesi promptta kaldı");
  console.log(`ok editing prompt profile: ${profilePath}`);
}


await assertProfile(
  join(repoRoot, ".github", "config", "business-profile.json"),
  ["EREN MÜZİK ATÖLYESİ", "Eren Özüşen", "Müzik eğitimi", "Telefon", "Elektro gitar", "Bas amfisi", "Piyano", "YouTube Shorts", "Instagram Reels", "16:9", "9:16"],
  ["Mavi Dis Klinigi", "Klinik kamera"],
);
await assertProfile(
  join(scriptDir, "fixtures", "second-business-profile.json"),
  ["MAVİ DİS KLİNİGİ", "Klinik Yoneticisi", "Agiz ve dis sagligi", "Klinik kamera", "Muayene uniti", "Aydinlatma paneli", "YouTube Shorts", "Instagram Reels", "16:9", "9:16"],
  ["Eren Müzik Atölyesi", "EREN MÜZİK ATÖLYESİ", "Eren", "Elektro gitar", "Bas amfisi"],
);

const workflow = await readFile(workflowPath, "utf8");
assert.ok(workflow.includes("build_editing_package_prompt.mjs"));
assert.ok(workflow.includes("business-profile.json"));
for (const hardCoded of ["Eren Müzik Atölyesi", "EREN MÜZİK ATÖLYESİ", "Eren'in Son Kontrol Listesi"]) {
  assert.ok(!workflow.includes(hardCoded), `Workflowta kurgu prompt hard-code'u kaldı: ${hardCoded}`);
}

console.log("editing_prompt_portability_ok ai_calls=0 api_calls=0 video_calls=0");

#!/usr/bin/env node
/** Zero-token portability tests for the filming-package prompt. */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  loadProfile,
  renderMetadata,
  renderSystemPrompt,
} from "./build_filming_package_prompt.mjs";


const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..", "..");
const workflowPath = join(repoRoot, ".github", "workflows", "filming-package-agent-v4-router.yml");


async function assertProfile(profilePath, expected, forbidden) {
  const profile = await loadProfile(profilePath);
  const rendered = `${renderSystemPrompt(profile)}\n${JSON.stringify(renderMetadata(profile))}`;
  for (const value of expected) {
    assert.ok(rendered.includes(value), `Beklenen profile değeri promptta yok: ${value}`);
  }
  for (const value of forbidden) {
    assert.ok(!rendered.includes(value), `Başka işletmeye ait değer promptta kaldı: ${value}`);
  }
  console.log(`ok prompt profile: ${profilePath}`);
}


await assertProfile(
  join(repoRoot, ".github", "config", "business-profile.json"),
  ["EREN MÜZİK ATÖLYESİ", "Eren Özüşen", "Müzik eğitimi", "Telefon", "Elektro gitar", "Bas amfisi", "Piyano"],
  ["Mavi Dis Klinigi", "Klinik kamera"],
);
await assertProfile(
  join(scriptDir, "fixtures", "second-business-profile.json"),
  ["MAVİ DİS KLİNİGİ", "Klinik Yoneticisi", "Agiz ve dis sagligi", "Klinik kamera", "Muayene uniti", "Aydinlatma paneli"],
  ["Eren Müzik Atölyesi", "Elektro gitar", "Bas amfisi"],
);

const workflow = await readFile(workflowPath, "utf8");
assert.ok(workflow.includes("build_filming_package_prompt.mjs"));
assert.ok(workflow.includes("business-profile.json"));
for (const hardCoded of ["EREN MÜZİK ATÖLYESİ", "Eren'in Yapacağı", "Elektro gitar"]) {
  assert.ok(!workflow.includes(hardCoded), `Workflowta hard-code kaldı: ${hardCoded}`);
}

console.log("filming_prompt_portability_ok ai_calls=0 web_requests=0 video_calls=0");

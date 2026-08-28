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
  return rendered;
}


// Eren Müzik Atölyesi — primary_device = "Telefon": canonical output + phone-specific
// safety guidance must both be present.
const erenRendered = await assertProfile(
  join(repoRoot, ".github", "config", "business-profile.json"),
  [
    "EREN MÜZİK ATÖLYESİ",
    "Eren Özüşen",
    "Müzik eğitimi",
    "Telefon",
    "Elektro gitar",
    "Bas amfisi",
    "Piyano",
    "Ana kayıt cihazı: Telefon",
    "# 🎥 EREN MÜZİK ATÖLYESİ — ÇEKİM PAKETİ",
    "## 2. Oda ve Kayıt Cihazı Yerleşimi",
    "Kayıt Cihazı/Kadraj",
    "TELEFON ÖZEL KURALLARI",
    "\"primary_device\":\"Telefon\"",
  ],
  ["Mavi Dis Klinigi", "Klinik kamera"],
);
assert.ok(!erenRendered.includes("TELEFONLA ÇEKİM PAKETİ"), "Eren promptu artık genel canonical başlığı kullanmalı, eski TELEFONLA başlığı değil");
assert.ok(!erenRendered.includes("Telefon/Kadraj"), "Eren promptu artık genel Kayıt Cihazı/Kadraj kullanmalı, eski Telefon/Kadraj değil");

// Mavi Diş Kliniği — primary_device = "Klinik kamera": canonical output must appear,
// but every phone-specific instruction must be completely absent, and no invented
// camera spec (resolution/fps) that isn't in the profile should appear.
const maviRendered = await assertProfile(
  join(scriptDir, "fixtures", "second-business-profile.json"),
  [
    "MAVİ DİS KLİNİGİ",
    "Klinik Yoneticisi",
    "Agiz ve dis sagligi",
    "Klinik kamera",
    "Muayene uniti",
    "Aydinlatma paneli",
    "Ana kayıt cihazı: Klinik kamera",
    "# 🎥 MAVİ DİS KLİNİGİ — ÇEKİM PAKETİ",
    "## 2. Oda ve Kayıt Cihazı Yerleşimi",
    "Kayıt Cihazı/Kadraj",
    "\"primary_device\":\"Klinik kamera\"",
  ],
  [
    "Eren Müzik Atölyesi",
    "Elektro gitar",
    "Bas amfisi",
    "TELEFONLA ÇEKİM PAKETİ",
    "Telefon/Kadraj",
    "TELEFON ÖZEL KURALLARI",
    "Telefon desteği",
    "arka kamera",
    "1080p/30 fps",
    "Rahatsız Etmeyin",
  ],
);
// No device spec that isn't literally in the Mavi Diş profile should be invented.
for (const inventedSpec of ["4K", "60 fps", "1080p", "30 fps"]) {
  assert.ok(!maviRendered.includes(inventedSpec), `Klinik kamera promptunda profilde olmayan teknik özellik uydurulmuş: ${inventedSpec}`);
}

const workflow = await readFile(workflowPath, "utf8");
assert.ok(workflow.includes("build_filming_package_prompt.mjs"));
assert.ok(workflow.includes("business-profile.json"));
for (const hardCoded of ["EREN MÜZİK ATÖLYESİ", "Eren'in Yapacağı", "Elektro gitar"]) {
  assert.ok(!workflow.includes(hardCoded), `Workflowta hard-code kaldı: ${hardCoded}`);
}
for (const hardCoded of ["Telefonla çekim planı", "Telefonla çekim paketi hazırlandı", "telefonla çekim"]) {
  assert.ok(!workflow.includes(hardCoded), `Workflowta cihaz-özel hard-code kaldı: ${hardCoded}`);
}

console.log("filming_prompt_portability_ok ai_calls=0 web_requests=0 video_calls=0");

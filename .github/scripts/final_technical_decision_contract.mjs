#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const READY_DECISION = "GENEL KARAR: ✅ ONAYA HAZIR";
export const LEGACY_READY_DECISION = "GENEL KARAR: ✅ EREN ONAYINA HAZIR";
export const FIX_DECISION = "GENEL KARAR: ⚠️ DÜZELTME GEREKİYOR";

const ALLOWED_DECISIONS = new Map([
  [READY_DECISION, "ready"],
  [LEGACY_READY_DECISION, "ready"],
  [FIX_DECISION, "fix"],
]);

export function parseFinalTechnicalDecision(report) {
  const lines = report.replace(/\r\n/g, "\n").trimEnd().split("\n");
  const decisions = lines.filter((line) => ALLOWED_DECISIONS.has(line));
  if (decisions.length !== 1) {
    throw new Error("Son teknik kontrol raporu tam olarak bir geçerli GENEL KARAR içermiyor.");
  }
  const decision = decisions[0];
  if (lines.at(-1) !== decision) {
    throw new Error("GENEL KARAR raporun son satırı değil.");
  }
  return ALLOWED_DECISIONS.get(decision);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error("Kullanım: final_technical_decision_contract.mjs <rapor-dosyası>");
    process.exit(2);
  }
  try {
    process.stdout.write(`${parseFinalTechnicalDecision(fs.readFileSync(reportPath, "utf8"))}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

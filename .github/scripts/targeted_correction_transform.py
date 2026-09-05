#!/usr/bin/env python3
"""Deterministic request/output transformer for the script-correction agent.

The surrounding workflow still supplies the full base scripts + QC report.
This transformer narrows the paid model request to scenarios that QC (or an
applicable final technical report) explicitly marks ``DÜZELTME GEREKİYOR``.
Approved scenarios are never sent back for rewriting; they are carried into
the final document deterministically.
"""

from __future__ import annotations

import re
from typing import Any

SCENARIO_COUNT = 3
BASE_MARKER = "TEMEL SENARYO METNİ — "
QC_MARKER = "KALİTE KONTROL RAPORU — "
FINAL_MARKER = "SON TEKNİK KONTROL RAPORU — "


def _split_combined_prompt(prompt: str) -> tuple[str, str, str]:
    if BASE_MARKER not in prompt or QC_MARKER not in prompt:
        raise ValueError("targeted correction prompt is missing base/QC markers")
    base_start = prompt.index(BASE_MARKER)
    qc_start = prompt.index(QC_MARKER)
    final_start = prompt.find(FINAL_MARKER, qc_start)

    base_segment = prompt[base_start:qc_start]
    qc_segment = prompt[qc_start: final_start if final_start >= 0 else len(prompt)]
    final_segment = prompt[final_start:] if final_start >= 0 else ""

    base = base_segment.split("\n\n", 1)[1] if "\n\n" in base_segment else ""
    qc = qc_segment.split("\n\n", 1)[1] if "\n\n" in qc_segment else ""
    final_check = final_segment.split("\n\n", 1)[1] if final_segment and "\n\n" in final_segment else ""
    if not base.strip() or not qc.strip():
        raise ValueError("targeted correction could not extract base/QC text")
    return base.strip() + "\n", qc.strip() + "\n", final_check.strip() + ("\n" if final_check.strip() else "")


def _extract_base_scenarios(base: str) -> dict[int, str]:
    matches = list(re.finditer(r"(?im)^##\s*Senaryo\s+([1-3])\s*:", base))
    if [int(match.group(1)) for match in matches] != [1, 2, 3]:
        raise ValueError("base text must contain exactly ordered scenarios 1, 2, 3")
    result: dict[int, str] = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(base)
        block = base[match.start():end].strip()
        # The original multi-scenario document uses `---` only as a document
        # separator between scenario blocks. It is not part of the scenario
        # itself, so remove exactly one trailing separator before carrying an
        # approved source block into the newly assembled final document.
        block = re.sub(r"\n\s*---\s*$", "", block).rstrip()
        result[int(match.group(1))] = block
    return result


def _extract_report_scenarios(report: str) -> dict[int, str]:
    matches = list(re.finditer(r"(?m)^#\s+SENARYO\s+([1-3])\s*$", report))
    result: dict[int, str] = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(report)
        block = report[match.start():end].strip()
        # Stop before report-wide sections if this is the final scenario.
        block = re.split(r"(?m)^#\s+(?:GENEL|ÖZET|KULLANILAN)\b", block, maxsplit=1)[0].strip()
        result[int(match.group(1))] = block
    return result


def _blocked_scenarios(qc: str, final_check: str) -> list[int]:
    blocked: set[int] = set()
    for report in (qc, final_check):
        if not report.strip():
            continue
        for number, block in _extract_report_scenarios(report).items():
            if "DÜZELTME GEREKİYOR" in block:
                blocked.add(number)
    return sorted(blocked)


def _replace_output_contract(system_prompt: str, blocked: list[int]) -> str:
    prefix = system_prompt.split("ÇIKTI SÖZLEŞMESİ:", 1)[0].rstrip()
    numbers = ", ".join(str(number) for number in blocked)
    return (
        prefix
        + "\n\nTARGETED CORRECTION MODE:\n"
        + f"- Yalnız şu senaryoları düzelt: {numbers}. Diğer senaryoları üretme, özetleme veya yeniden yazma.\n"
        + "- Her hedef senaryoyu kaynak metindeki kapsam ve yaklaşık uzunlukta tut; yeni bölüm veya yeni konu ekleme.\n"
        + "- QC'nin istediği en küçük gerekli değişikliği yap. Doğrulanmamış şarkı/eser adı, fiyat, kampanya veya yeni gerçek ekleme.\n"
        + "- Başlık içerikle somut olarak eşleşmiyorsa, doğrulanmamış ayrıntı uydurmak yerine başlığı mevcut içeriğe uygun hale getir.\n"
        + "- Her hedef blok tam olarak `## SENARYO N:` satırıyla başlasın.\n"
        + "- Her hedef blokta `### Uygulanan QC düzeltmeleri` başlığı ve en fazla üç kısa madde olsun.\n"
        + "- Üst belge başlığı, hedef olmayan senaryolar, kod çiti veya ön açıklama üretme.\n"
        + "- Çıktıyı kısa tut; yalnızca gerekli hedef senaryo bloklarını döndür.\n"
    )


def prepare_request(*, prompt: str, system_prompt: str) -> dict[str, Any]:
    base, qc, final_check = _split_combined_prompt(prompt)
    base_scenarios = _extract_base_scenarios(base)
    qc_scenarios = _extract_report_scenarios(qc)
    final_scenarios = _extract_report_scenarios(final_check) if final_check.strip() else {}
    blocked = _blocked_scenarios(qc, final_check)
    if not blocked:
        raise ValueError("targeted correction found no scenario explicitly marked DÜZELTME GEREKİYOR")
    for number in blocked:
        if number not in base_scenarios or number not in qc_scenarios:
            raise ValueError(f"targeted correction is missing source/QC block for scenario {number}")

    parts = ["YALNIZ AŞAĞIDAKİ HEDEF SENARYOLARI DÜZELT.\n"]
    for number in blocked:
        parts.append(f"\n## HEDEF SENARYO {number} — KAYNAK METİN\n{base_scenarios[number]}\n")
        parts.append(f"\n## HEDEF SENARYO {number} — QC BULGUSU\n{qc_scenarios[number]}\n")
        if number in final_scenarios and "DÜZELTME GEREKİYOR" in final_scenarios[number]:
            parts.append(
                f"\n## HEDEF SENARYO {number} — SON TEKNİK KONTROL\n{final_scenarios[number]}\n"
            )

    heading_match = re.search(r"İlk satır tam olarak:\s*(# .*?NİHAİ SENARYOLAR)", system_prompt)
    if not heading_match:
        raise ValueError("targeted correction could not resolve the final document heading")

    return {
        "prompt": "\n".join(parts).strip() + "\n",
        "system_prompt": _replace_output_contract(system_prompt, blocked),
        "context": {
            "blocked": blocked,
            "base_scenarios": base_scenarios,
            "final_heading": heading_match.group(1).strip(),
        },
    }


def _extract_corrected_blocks(text: str, blocked: list[int]) -> dict[int, str]:
    matches = list(re.finditer(r"(?m)^##\s+SENARYO\s+([1-3])\s*:", text))
    numbers = [int(match.group(1)) for match in matches]
    if numbers != blocked:
        raise ValueError(f"model returned scenario headings {numbers}, expected exactly {blocked}")
    blocks: dict[int, str] = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        block = text[match.start():end].strip()
        if block.count("Uygulanan QC düzeltmeleri") != 1:
            raise ValueError(f"corrected scenario {match.group(1)} must contain exactly one QC summary")
        blocks[int(match.group(1))] = block
    return blocks


def _normalize_preserved_block(number: int, block: str) -> str:
    normalized = re.sub(
        rf"(?im)^##\s*Senaryo\s+{number}\s*:",
        f"## SENARYO {number}:",
        block,
        count=1,
    ).rstrip()
    if "Uygulanan QC düzeltmeleri" in normalized:
        raise ValueError(f"preserved scenario {number} unexpectedly already contains QC summary")
    return (
        normalized
        + "\n\n### Uygulanan QC düzeltmeleri\n"
        + "- Yok — QC kararı YAYINA HAZIR; kaynak senaryo içeriği korunmuştur."
    )


def finalize_output(*, text: str, context: dict[str, Any]) -> str:
    blocked = [int(number) for number in context["blocked"]]
    base_scenarios = {int(key): value for key, value in context["base_scenarios"].items()}
    corrected = _extract_corrected_blocks(text.strip(), blocked)

    final_blocks: list[str] = []
    for number in range(1, SCENARIO_COUNT + 1):
        if number in corrected:
            block = corrected[number].rstrip()
        else:
            block = _normalize_preserved_block(number, base_scenarios[number])
        final_blocks.append(block)

    document = str(context["final_heading"]).strip() + "\n\n" + "\n\n---\n\n".join(final_blocks) + "\n"
    if len(re.findall(r"(?m)^## SENARYO [123]:", document)) != SCENARIO_COUNT:
        raise ValueError("assembled final document does not contain exactly three scenarios")
    if document.count("Uygulanan QC düzeltmeleri") != SCENARIO_COUNT:
        raise ValueError("assembled final document does not contain exactly three QC summaries")
    return document

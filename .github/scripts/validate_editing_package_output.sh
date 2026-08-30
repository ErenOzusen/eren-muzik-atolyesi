#!/usr/bin/env bash
# Shared editing-package output contract check — extracted so the REAL
# AI-generated output and the TEST_MODE deterministic fixture are checked
# by the exact same code, not two copies that could silently drift apart.
# This is the only place these checks are allowed to live; the fixture
# step and the real-AI step both call this script instead of duplicating
# the grep patterns inline.
#
# Usage: validate_editing_package_output.sh <path-to-editing-package.md>
# Exit 0 if the file satisfies the contract; exit 1 with a message
# otherwise. Zero network, zero AI/provider calls, zero writes.
set -euo pipefail

TARGET_FILE="${1:?validate_editing_package_output.sh: dosya yolu gerekli}"

if [[ ! -s "$TARGET_FILE" ]]; then
  echo "Kurgu paketi çıktısı boş geldi."
  exit 1
fi

REQUIRED_PATTERNS=(
  '^##[[:space:]]+1\.[[:space:]].*Kaynak.*Dosya'
  '^##[[:space:]]+2\.[[:space:]].*Ana Video.*Kurgu'
  '^##[[:space:]]+3\.[[:space:]].*(Ekran Yazı|Altyazı)'
  '^##[[:space:]]+4\.[[:space:]].*Ses'
  '^##[[:space:]]+5\.[[:space:]].*(Kısa|Dikey|Shorts|Reels).*Kurgu'
  '^##[[:space:]]+6\.[[:space:]].*(Dışa Aktarma|Disa Aktarma)'
  '^##[[:space:]]+7\.[[:space:]].*Son Kontrol'
)

for pattern in "${REQUIRED_PATTERNS[@]}"; do
  if ! grep -Eiq "$pattern" "$TARGET_FILE"; then
    echo "Zorunlu bölüm eksik; Issue yayımlanmadı: $pattern"
    exit 1
  fi
done

SECTION_COUNT=$(grep -Ec '^##[[:space:]]+[1-7]\.' "$TARGET_FILE")
if [[ "$SECTION_COUNT" -ne 7 ]]; then
  echo "Kurgu paketinde tam olarak yedi numaralı bölüm bulunmalı; bulunan: $SECTION_COUNT"
  exit 1
fi

if ! grep -Eiq 'ham video.*görülmeden|ham görüntü.*görülmeden' "$TARGET_FILE"; then
  echo "Ham videonun görülmediği zorunlu uyarı eksik."
  exit 1
fi

if grep -Eiq '(videoyu|görüntüyü|ham videoyu)[[:space:]]+(izledim|inceledim)' "$TARGET_FILE"; then
  echo "Ajan ham videoyu izlemiş gibi yanlış iddia üretti."
  exit 1
fi

if grep -Eiq 'onay[ıi]?[[:space:]]+bekleniyor|onay[[:space:]]+gelmeden|senaryo[[:space:]]+durumu.*bekleniyor' "$TARGET_FILE"; then
  echo "Ajan, onaylı kaynak için yanlış onay durumu üretti."
  exit 1
fi

OUTPUT_CHARS=$(wc -c < "$TARGET_FILE")
if [[ "$OUTPUT_CHARS" -gt 28000 ]]; then
  echo "Kurgu paketi 28.000 karakter sınırını aştı."
  exit 1
fi

echo "editing_package_output_contract_ok chars=$OUTPUT_CHARS"

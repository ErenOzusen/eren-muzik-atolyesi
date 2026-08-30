#!/usr/bin/env bash
# Shared, deterministic thumbnail-package label persistence.
#
# This is the ONLY place that ever writes thumbnail-paketi identity/ready
# labels or the thumbnail package's owner-approval-pending labels (legacy
# Turkish + generic English twins, dual-write only — legacy is never
# removed). Also fixes a pre-existing torn-state risk: the previous inline
# implementation added "eren-onayi-bekliyor" in the create/edit call, then
# "owner-approval-pending" in a SEPARATE follow-up gh issue edit call — two
# network calls where one succeeding and the other failing would have left
# an inconsistent label state. Both are now added together in one call.
#
# Required environment:
#   GH_TOKEN, GH_REPO       - gh CLI auth/target
#   THUMBNAIL_TITLE         - title for the thumbnail package issue
#   THUMBNAIL_BODY_FILE     - path to the prepared package body content
#   TEST_MODE               - "true" or "false"
#   OWNER_DISPLAY_NAME      - for the pending-label description text
#   EXISTING_NUMBER         - optional; if set, update this issue instead of
#                             creating a new one
#   SUBTITLE_NUMBER         - optional; the subtitle-package issue to mark
#                             ready (real mode only, when non-empty)
#
# On success: appends THUMBNAIL_URL and THUMBNAIL_NUMBER to $GITHUB_ENV,
# exits 0. On any missing required label after mutation: exits 1, no
# suppression.

set -euo pipefail

: "${THUMBNAIL_TITLE:?THUMBNAIL_TITLE is required}"
: "${THUMBNAIL_BODY_FILE:?THUMBNAIL_BODY_FILE is required}"
: "${TEST_MODE:?TEST_MODE is required}"
: "${OWNER_DISPLAY_NAME:?OWNER_DISPLAY_NAME is required}"
EXISTING_NUMBER="${EXISTING_NUMBER:-}"
SUBTITLE_NUMBER="${SUBTITLE_NUMBER:-}"

gh label create "thumbnail-paketi" --color "D876E3" --description "Kapak görseli seçenekleri ve tasarım kontrol paketi" --force
gh label create "thumbnail-package" --color "D876E3" --description "This Issue is a thumbnail preparation package awaiting design/publication approval" --force
gh label create "thumbnail-paketi-hazir" --color "0E8A16" --description "Thumbnail hazırlık paketi tamamlandı" --force
gh label create "thumbnail-package-ready" --color "0E8A16" --description "A thumbnail preparation package is ready" --force

if [[ "$TEST_MODE" == "true" ]]; then
  gh label create "sistem-testi" --color "BFD4F2" --description "Gerçek üretim kayıtlarını değiştirmeyen sistem testi" --force
  ISSUE_LABELS=("thumbnail-paketi" "thumbnail-package" "sistem-testi")
else
  gh label create "eren-onayi-bekliyor" --color "FBCA04" --description "Yayın öncesi $OWNER_DISPLAY_NAME onayını bekliyor" --force
  gh label create "owner-approval-pending" --color "FBCA04" --description "Yayın öncesi $OWNER_DISPLAY_NAME onayını bekliyor" --force
  ISSUE_LABELS=("thumbnail-paketi" "thumbnail-package" "eren-onayi-bekliyor" "owner-approval-pending")
fi

ADD_LABEL_ARGS=()
for label in "${ISSUE_LABELS[@]}"; do
  ADD_LABEL_ARGS+=(--add-label "$label")
done

if [[ -n "$EXISTING_NUMBER" ]]; then
  gh issue edit "$EXISTING_NUMBER" \
    --title "$THUMBNAIL_TITLE" \
    --body-file "$THUMBNAIL_BODY_FILE" \
    "${ADD_LABEL_ARGS[@]}"
  THUMBNAIL_NUMBER="$EXISTING_NUMBER"
else
  CREATE_LABEL_ARGS=()
  for label in "${ISSUE_LABELS[@]}"; do
    CREATE_LABEL_ARGS+=(--label "$label")
  done
  THUMBNAIL_URL=$(gh issue create \
    --title "$THUMBNAIL_TITLE" \
    --body-file "$THUMBNAIL_BODY_FILE" \
    "${CREATE_LABEL_ARGS[@]}")
  THUMBNAIL_NUMBER=$(grep -oE '[0-9]+$' <<< "$THUMBNAIL_URL")
fi

# ---- Thumbnail package identity: re-fetch and verify BEFORE proceeding ----

gh issue view "$THUMBNAIL_NUMBER" --json labels --jq '.labels[].name' \
  > /tmp/thumbnail-labels-after.txt

for REQUIRED_PRESENT in "${ISSUE_LABELS[@]}"; do
  if ! grep -qx "$REQUIRED_PRESENT" /tmp/thumbnail-labels-after.txt; then
    echo "Thumbnail paketi doğrulaması başarısız; zorunlu etiket eksik: $REQUIRED_PRESENT"
    exit 1
  fi
done

THUMBNAIL_URL=$(gh issue view "$THUMBNAIL_NUMBER" --json url --jq '.url')

# ---- Subtitle-package ready-state (real mode only): mutate, then verify ----

if [[ "$TEST_MODE" == "false" && -n "$SUBTITLE_NUMBER" ]]; then
  gh issue edit "$SUBTITLE_NUMBER" \
    --add-label "thumbnail-paketi-hazir" \
    --add-label "thumbnail-package-ready"

  gh issue view "$SUBTITLE_NUMBER" --json labels --jq '.labels[].name' \
    > /tmp/subtitle-ready-labels-after.txt

  for REQUIRED_PRESENT in thumbnail-paketi-hazir thumbnail-package-ready; do
    if ! grep -qx "$REQUIRED_PRESENT" /tmp/subtitle-ready-labels-after.txt; then
      echo "Altyazı paketi hazır durumu doğrulaması başarısız; zorunlu etiket eksik: $REQUIRED_PRESENT"
      exit 1
    fi
  done
fi

# ---- Only after all verifications succeed: hand results back to the caller ----

{
  echo "THUMBNAIL_URL=$THUMBNAIL_URL"
  echo "THUMBNAIL_NUMBER=$THUMBNAIL_NUMBER"
} >> "$GITHUB_ENV"

#!/usr/bin/env bash
# Shared, deterministic YouTube-publication-package label persistence.
#
# This is the ONLY place that ever writes youtube-yayin-paketi
# identity/ready labels or the publication-approval-pending labels (legacy
# Turkish + generic English twins, dual-write only — legacy is never
# removed). Also fixes a pre-existing torn-state risk: the previous inline
# implementation added "eren-yayin-onayi-bekliyor" in the create/edit call,
# then "publication-approval-pending" in a SEPARATE follow-up gh issue edit
# call — two network calls where one succeeding and the other failing would
# have left an inconsistent label state. Both are now added together in one
# call.
#
# Required environment:
#   GH_TOKEN, GH_REPO      - gh CLI auth/target
#   YOUTUBE_TITLE          - title for the publication package issue
#   YOUTUBE_BODY_FILE      - path to the prepared package body content
#   TEST_MODE              - "true" or "false"
#   OWNER_DISPLAY_NAME     - for the pending-label description text
#   EXISTING_NUMBER        - optional; if set, update this issue instead of
#                            creating a new one
#   THUMBNAIL_NUMBER       - optional; the thumbnail-package issue to mark
#                            ready (real mode only, when non-empty)
#
# On success: appends YOUTUBE_URL and YOUTUBE_NUMBER to $GITHUB_ENV, exits
# 0. On any missing required label after mutation: exits 1, no suppression.
#
# This script never uploads, publishes, or calls any YouTube/video API —
# it only ever mutates GitHub Issue labels/body/comments.

set -euo pipefail

: "${YOUTUBE_TITLE:?YOUTUBE_TITLE is required}"
: "${YOUTUBE_BODY_FILE:?YOUTUBE_BODY_FILE is required}"
: "${TEST_MODE:?TEST_MODE is required}"
: "${OWNER_DISPLAY_NAME:?OWNER_DISPLAY_NAME is required}"
EXISTING_NUMBER="${EXISTING_NUMBER:-}"
THUMBNAIL_NUMBER="${THUMBNAIL_NUMBER:-}"

gh label create "youtube-yayin-paketi" --color "D93F0B" --description "YouTube metadata ve yayın öncesi kontrol paketi" --force
gh label create "youtube-publication-package" --color "D93F0B" --description "This Issue is a YouTube metadata/publication preparation package" --force
gh label create "youtube-yayin-paketi-hazir" --color "0E8A16" --description "YouTube yayın hazırlık paketi tamamlandı" --force
gh label create "youtube-publication-package-ready" --color "0E8A16" --description "A YouTube publication preparation package is ready" --force

if [[ "$TEST_MODE" == "true" ]]; then
  gh label create "sistem-testi" --color "BFD4F2" --description "Gerçek üretim kayıtlarını değiştirmeyen sistem testi" --force
  ISSUE_LABELS=("youtube-yayin-paketi" "youtube-publication-package" "sistem-testi")
else
  gh label create "eren-yayin-onayi-bekliyor" --color "FBCA04" --description "YouTube yükleme ve yayın için $OWNER_DISPLAY_NAME tarafından verilecek açık onayı bekliyor" --force
  gh label create "publication-approval-pending" --color "FBCA04" --description "YouTube yükleme ve yayın için $OWNER_DISPLAY_NAME tarafından verilecek açık onayı bekliyor" --force
  ISSUE_LABELS=("youtube-yayin-paketi" "youtube-publication-package" "eren-yayin-onayi-bekliyor" "publication-approval-pending")
fi

ADD_LABEL_ARGS=()
for label in "${ISSUE_LABELS[@]}"; do
  ADD_LABEL_ARGS+=(--add-label "$label")
done

if [[ -n "$EXISTING_NUMBER" ]]; then
  gh issue edit "$EXISTING_NUMBER" \
    --title "$YOUTUBE_TITLE" \
    --body-file "$YOUTUBE_BODY_FILE" \
    "${ADD_LABEL_ARGS[@]}"
  YOUTUBE_NUMBER="$EXISTING_NUMBER"
else
  CREATE_LABEL_ARGS=()
  for label in "${ISSUE_LABELS[@]}"; do
    CREATE_LABEL_ARGS+=(--label "$label")
  done
  YOUTUBE_URL=$(gh issue create \
    --title "$YOUTUBE_TITLE" \
    --body-file "$YOUTUBE_BODY_FILE" \
    "${CREATE_LABEL_ARGS[@]}")
  YOUTUBE_NUMBER=$(grep -oE '[0-9]+$' <<< "$YOUTUBE_URL")
fi

# ---- Publication package identity: re-fetch and verify BEFORE proceeding ----

gh issue view "$YOUTUBE_NUMBER" --json labels --jq '.labels[].name' \
  > /tmp/youtube-labels-after.txt

for REQUIRED_PRESENT in "${ISSUE_LABELS[@]}"; do
  if ! grep -qx "$REQUIRED_PRESENT" /tmp/youtube-labels-after.txt; then
    echo "YouTube yayın paketi doğrulaması başarısız; zorunlu etiket eksik: $REQUIRED_PRESENT"
    exit 1
  fi
done

YOUTUBE_URL=$(gh issue view "$YOUTUBE_NUMBER" --json url --jq '.url')

# ---- Thumbnail-package ready-state (real mode only): mutate, then verify ----

if [[ "$TEST_MODE" == "false" && -n "$THUMBNAIL_NUMBER" ]]; then
  gh issue edit "$THUMBNAIL_NUMBER" \
    --add-label "youtube-yayin-paketi-hazir" \
    --add-label "youtube-publication-package-ready"

  gh issue view "$THUMBNAIL_NUMBER" --json labels --jq '.labels[].name' \
    > /tmp/thumbnail-ready-labels-after.txt

  for REQUIRED_PRESENT in youtube-yayin-paketi-hazir youtube-publication-package-ready; do
    if ! grep -qx "$REQUIRED_PRESENT" /tmp/thumbnail-ready-labels-after.txt; then
      echo "Thumbnail paketi hazır durumu doğrulaması başarısız; zorunlu etiket eksik: $REQUIRED_PRESENT"
      exit 1
    fi
  done
fi

# ---- Only after all verifications succeed: hand results back to the caller ----

{
  echo "YOUTUBE_URL=$YOUTUBE_URL"
  echo "YOUTUBE_NUMBER=$YOUTUBE_NUMBER"
} >> "$GITHUB_ENV"

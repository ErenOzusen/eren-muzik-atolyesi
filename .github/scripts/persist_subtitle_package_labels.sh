#!/usr/bin/env bash
# Shared, deterministic subtitle-package label persistence.
#
# This is the ONLY place that ever writes altyazi-paketi identity/ready
# labels or the subtitle package's owner-approval-pending labels (legacy
# Turkish + generic English twins, dual-write only — legacy is never
# removed). Also fixes a pre-existing torn-state risk: the previous inline
# implementation added "eren-onayi-bekliyor" in the create/edit call, then
# "owner-approval-pending" in a SEPARATE follow-up gh issue edit call — two
# network calls where one succeeding and the other failing would have left
# an inconsistent label state. Both are now added together in one call.
#
# Required environment:
#   GH_TOKEN, GH_REPO      - gh CLI auth/target
#   SUBTITLE_TITLE         - title for the subtitle package issue
#   SUBTITLE_BODY_FILE     - path to the prepared package body content
#   TEST_MODE              - "true" or "false"
#   OWNER_DISPLAY_NAME     - for the pending-label description text
#   EXISTING_NUMBER        - optional; if set, update this issue instead of
#                            creating a new one
#   EDITING_NUMBER         - optional; the editing-package issue to mark
#                            ready (real mode only, when non-empty)
#
# On success: appends SUBTITLE_URL and SUBTITLE_NUMBER to $GITHUB_ENV, exits 0.
# On any missing required label after mutation: exits 1, no suppression.

set -euo pipefail

: "${SUBTITLE_TITLE:?SUBTITLE_TITLE is required}"
: "${SUBTITLE_BODY_FILE:?SUBTITLE_BODY_FILE is required}"
: "${TEST_MODE:?TEST_MODE is required}"
: "${OWNER_DISPLAY_NAME:?OWNER_DISPLAY_NAME is required}"
EXISTING_NUMBER="${EXISTING_NUMBER:-}"
EDITING_NUMBER="${EDITING_NUMBER:-}"

gh label create "altyazi-paketi" --color "1D76DB" --description "Zamanlama ve yayın onayı bekleyen altyazı hazırlık paketi" --force
gh label create "subtitle-package" --color "1D76DB" --description "This Issue is a subtitle preparation package awaiting timing/publication approval" --force
gh label create "altyazi-paketi-hazir" --color "0E8A16" --description "Altyazı hazırlık paketi tamamlandı" --force
gh label create "subtitle-package-ready" --color "0E8A16" --description "A subtitle preparation package is ready" --force

if [[ "$TEST_MODE" == "true" ]]; then
  gh label create "sistem-testi" --color "BFD4F2" --description "Gerçek üretim kayıtlarını değiştirmeyen sistem testi" --force
  ISSUE_LABELS=("altyazi-paketi" "subtitle-package" "sistem-testi")
else
  gh label create "eren-onayi-bekliyor" --color "FBCA04" --description "Yayın öncesi $OWNER_DISPLAY_NAME onayını bekliyor" --force
  gh label create "owner-approval-pending" --color "FBCA04" --description "Yayın öncesi $OWNER_DISPLAY_NAME onayını bekliyor" --force
  # Identity + pending labels added together, in the SAME create/edit call
  # below — not as a separate follow-up mutation (see header comment).
  ISSUE_LABELS=("altyazi-paketi" "subtitle-package" "eren-onayi-bekliyor" "owner-approval-pending")
fi

ADD_LABEL_ARGS=()
for label in "${ISSUE_LABELS[@]}"; do
  ADD_LABEL_ARGS+=(--add-label "$label")
done

if [[ -n "$EXISTING_NUMBER" ]]; then
  gh issue edit "$EXISTING_NUMBER" \
    --title "$SUBTITLE_TITLE" \
    --body-file "$SUBTITLE_BODY_FILE" \
    "${ADD_LABEL_ARGS[@]}"
  SUBTITLE_NUMBER="$EXISTING_NUMBER"
else
  CREATE_LABEL_ARGS=()
  for label in "${ISSUE_LABELS[@]}"; do
    CREATE_LABEL_ARGS+=(--label "$label")
  done
  SUBTITLE_URL=$(gh issue create \
    --title "$SUBTITLE_TITLE" \
    --body-file "$SUBTITLE_BODY_FILE" \
    "${CREATE_LABEL_ARGS[@]}")
  SUBTITLE_NUMBER=$(grep -oE '[0-9]+$' <<< "$SUBTITLE_URL")
fi

# ---- Subtitle package identity: re-fetch and verify BEFORE proceeding ----

gh issue view "$SUBTITLE_NUMBER" --json labels --jq '.labels[].name' \
  > /tmp/subtitle-labels-after.txt

for REQUIRED_PRESENT in "${ISSUE_LABELS[@]}"; do
  if ! grep -qx "$REQUIRED_PRESENT" /tmp/subtitle-labels-after.txt; then
    echo "Altyazı paketi doğrulaması başarısız; zorunlu etiket eksik: $REQUIRED_PRESENT"
    exit 1
  fi
done

SUBTITLE_URL=$(gh issue view "$SUBTITLE_NUMBER" --json url --jq '.url')

# ---- Editing-package ready-state (real mode only): mutate, then verify ----

if [[ "$TEST_MODE" == "false" && -n "$EDITING_NUMBER" ]]; then
  gh issue edit "$EDITING_NUMBER" \
    --add-label "altyazi-paketi-hazir" \
    --add-label "subtitle-package-ready"

  gh issue view "$EDITING_NUMBER" --json labels --jq '.labels[].name' \
    > /tmp/editing-ready-labels-after.txt

  for REQUIRED_PRESENT in altyazi-paketi-hazir subtitle-package-ready; do
    if ! grep -qx "$REQUIRED_PRESENT" /tmp/editing-ready-labels-after.txt; then
      echo "Kurgu paketi hazır durumu doğrulaması başarısız; zorunlu etiket eksik: $REQUIRED_PRESENT"
      exit 1
    fi
  done
fi

# ---- Only after all verifications succeed: hand results back to the caller ----

{
  echo "SUBTITLE_URL=$SUBTITLE_URL"
  echo "SUBTITLE_NUMBER=$SUBTITLE_NUMBER"
} >> "$GITHUB_ENV"

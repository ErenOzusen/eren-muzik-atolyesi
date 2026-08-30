#!/usr/bin/env bash
# Shared, deterministic editing-package label persistence.
#
# This is the ONLY place that ever writes cekim/kurgu-paketi identity or
# ready labels for the editing stage (legacy Turkish + generic English
# twins, dual-write only — legacy is never removed). Single call site in
# editing-package-agent.yml, for both test_mode and real-mode paths, so
# neither path can silently diverge from the other's persistence logic —
# same standard as persist_filming_package_labels.sh.
#
# Required environment:
#   GH_TOKEN, GH_REPO       - gh CLI auth/target
#   EDITING_TITLE           - title for the editing package issue
#   EDITING_BODY_FILE       - path to the prepared package body content
#   TEST_MODE               - "true" or "false"
#   EXISTING_NUMBER         - optional; if set, update this issue instead of
#                             creating a new one
#   INTAKE_NUMBER           - optional; the raw-video-intake issue to mark
#                             ready (real mode only, when non-empty)
#
# On success: appends EDITING_URL and EDITING_NUMBER to $GITHUB_ENV, exits 0.
# On any missing required label after mutation: exits 1, no suppression.

set -euo pipefail

: "${EDITING_TITLE:?EDITING_TITLE is required}"
: "${EDITING_BODY_FILE:?EDITING_BODY_FILE is required}"
: "${TEST_MODE:?TEST_MODE is required}"
EXISTING_NUMBER="${EXISTING_NUMBER:-}"
INTAKE_NUMBER="${INTAKE_NUMBER:-}"

gh label create "kurgu-paketi" --color "5319E7" --description "Video kurgu akışı ve yayın öncesi kontrol planı" --force
gh label create "kurgu-plani-hazir" --color "0E8A16" --description "Ham video teslimi için kurgu planı hazır" --force
gh label create "editing-package" --color "5319E7" --description "This Issue is an editing package for a delivered raw video" --force
gh label create "editing-package-ready" --color "0E8A16" --description "An editing plan is ready for the delivered raw video" --force

# Test mode intentionally uses a different identity label set than real
# mode (sistem-testi instead of the ready label) — preserved exactly as it
# was before this hardening pass; only the persistence mechanics changed.
if [[ "$TEST_MODE" == "true" ]]; then
  gh label create "sistem-testi" --color "BFD4F2" --description "Gerçek üretim kayıtlarını değiştirmeyen sistem testi" --force
  ISSUE_LABELS=("kurgu-paketi" "editing-package" "sistem-testi")
else
  ISSUE_LABELS=("kurgu-paketi" "editing-package" "kurgu-plani-hazir" "editing-package-ready")
fi

ADD_LABEL_ARGS=()
for label in "${ISSUE_LABELS[@]}"; do
  ADD_LABEL_ARGS+=(--add-label "$label")
done

if [[ -n "$EXISTING_NUMBER" ]]; then
  gh issue edit "$EXISTING_NUMBER" \
    --title "$EDITING_TITLE" \
    --body-file "$EDITING_BODY_FILE" \
    "${ADD_LABEL_ARGS[@]}"
  EDITING_NUMBER="$EXISTING_NUMBER"
else
  CREATE_LABEL_ARGS=()
  for label in "${ISSUE_LABELS[@]}"; do
    CREATE_LABEL_ARGS+=(--label "$label")
  done
  EDITING_URL=$(gh issue create \
    --title "$EDITING_TITLE" \
    --body-file "$EDITING_BODY_FILE" \
    "${CREATE_LABEL_ARGS[@]}")
  EDITING_NUMBER=$(grep -oE '[0-9]+$' <<< "$EDITING_URL")
fi

# ---- Editing package identity: re-fetch and verify BEFORE proceeding ----

gh issue view "$EDITING_NUMBER" --json labels --jq '.labels[].name' \
  > /tmp/editing-labels-after.txt

for REQUIRED_PRESENT in "${ISSUE_LABELS[@]}"; do
  if ! grep -qx "$REQUIRED_PRESENT" /tmp/editing-labels-after.txt; then
    echo "Kurgu paketi doğrulaması başarısız; zorunlu etiket eksik: $REQUIRED_PRESENT"
    exit 1
  fi
done

EDITING_URL=$(gh issue view "$EDITING_NUMBER" --json url --jq '.url')

# ---- Intake ready-state (real mode only): mutate, then re-fetch+verify ----

if [[ "$TEST_MODE" == "false" && -n "$INTAKE_NUMBER" ]]; then
  gh issue edit "$INTAKE_NUMBER" \
    --add-label "kurgu-plani-hazir" \
    --add-label "editing-package-ready"

  gh issue view "$INTAKE_NUMBER" --json labels --jq '.labels[].name' \
    > /tmp/intake-labels-after.txt

  for REQUIRED_PRESENT in kurgu-plani-hazir editing-package-ready; do
    if ! grep -qx "$REQUIRED_PRESENT" /tmp/intake-labels-after.txt; then
      echo "Teslim kaydı hazır durumu doğrulaması başarısız; zorunlu etiket eksik: $REQUIRED_PRESENT"
      exit 1
    fi
  done
fi

# ---- Only after all verifications succeed: hand results back to the caller ----

{
  echo "EDITING_URL=$EDITING_URL"
  echo "EDITING_NUMBER=$EDITING_NUMBER"
} >> "$GITHUB_ENV"

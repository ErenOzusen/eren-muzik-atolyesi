#!/usr/bin/env bash
# Shared, deterministic filming-package label persistence.
#
# This is the ONLY place that ever writes cekim-paketi / filming-package /
# cekim-paketi-hazir / filming-package-ready. It is used identically by:
#   1. the real production path, after AI-generated package content is ready
#   2. the controlled zero-token live-label-validation path, after a tiny
#      deterministic synthetic body is ready
# so neither path can silently diverge from the other's persistence logic.
#
# Required environment (inherited from the calling workflow job/step):
#   GH_TOKEN, GH_REPO   - gh CLI auth/target
#   FINAL_NUMBER        - root Nihai Senaryolar issue number
#   PACKAGE_TITLE       - title for the filming package issue
#   PACKAGE_BODY_FILE   - path to the prepared package body content
#   EXISTING_NUMBER     - optional; if set, update this issue instead of
#                         creating a new one
#
# On success: appends PACKAGE_URL and PACKAGE_NUMBER to $GITHUB_ENV, exits 0.
# On any missing required label after mutation: exits 1, no suppression.

set -euo pipefail

: "${FINAL_NUMBER:?FINAL_NUMBER is required}"
: "${PACKAGE_TITLE:?PACKAGE_TITLE is required}"
: "${PACKAGE_BODY_FILE:?PACKAGE_BODY_FILE is required}"
EXISTING_NUMBER="${EXISTING_NUMBER:-}"

gh label create "cekim-paketi" --color "5319E7" --description "Çekim planı ve kontrol listesi" --force
gh label create "cekim-paketi-hazir" --color "0E8A16" --description "Onaylı senaryo için çekim paketi hazır" --force
gh label create "filming-package" --color "5319E7" --description "This Issue is a filming package for a selected production scenario" --force
gh label create "filming-package-ready" --color "0E8A16" --description "A filming package is ready for the selected production scenario" --force

if [[ -n "$EXISTING_NUMBER" ]]; then
  gh issue edit "$EXISTING_NUMBER" \
    --title "$PACKAGE_TITLE" \
    --body-file "$PACKAGE_BODY_FILE" \
    --add-label "cekim-paketi" \
    --add-label "filming-package"
  PACKAGE_URL=$(gh issue view "$EXISTING_NUMBER" --json url --jq '.url')
  PACKAGE_NUMBER="$EXISTING_NUMBER"
else
  PACKAGE_URL=$(gh issue create \
    --title "$PACKAGE_TITLE" \
    --body-file "$PACKAGE_BODY_FILE" \
    --label "cekim-paketi" \
    --label "filming-package")
  PACKAGE_NUMBER=$(grep -oE '[0-9]+$' <<< "$PACKAGE_URL")
fi

# ---- Package identity: re-fetch and verify BOTH labels before proceeding ----

gh issue view "$PACKAGE_NUMBER" --json labels --jq '.labels[].name' \
  > /tmp/package-labels-after.txt

for REQUIRED_PRESENT in cekim-paketi filming-package; do
  if ! grep -qx "$REQUIRED_PRESENT" /tmp/package-labels-after.txt; then
    echo "Çekim paketi kimlik doğrulaması başarısız; zorunlu etiket eksik: $REQUIRED_PRESENT"
    exit 1
  fi
done

# ---- Root ready-state: mutate, then re-fetch and verify BOTH labels ----

gh issue edit "$FINAL_NUMBER" \
  --add-label "cekim-paketi-hazir" \
  --add-label "filming-package-ready"

gh issue view "$FINAL_NUMBER" --json labels --jq '.labels[].name' \
  > /tmp/root-labels-after.txt

for REQUIRED_PRESENT in cekim-paketi-hazir filming-package-ready; do
  if ! grep -qx "$REQUIRED_PRESENT" /tmp/root-labels-after.txt; then
    echo "Kök hazır durumu doğrulaması başarısız; zorunlu etiket eksik: $REQUIRED_PRESENT"
    exit 1
  fi
done

# ---- Only after both verifications succeed: hand results back to the caller ----

{
  echo "PACKAGE_URL=$PACKAGE_URL"
  echo "PACKAGE_NUMBER=$PACKAGE_NUMBER"
} >> "$GITHUB_ENV"

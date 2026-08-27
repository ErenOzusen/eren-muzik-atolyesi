# Project State

Last updated: 28 August 2026

## Git baseline

- Active branch: `main`
- Current `main` commit: `c9d6757` — `feat: make filming package prompt portable`
- `origin/main` was verified at the same commit after the fast-forward merge and push.
- The working tree was confirmed clean after the merge.

## Verified state

- Business Profile Zero-Token Smoke Test: successful in GitHub Actions
- Video Orchestrator Smoke Test: successful in GitHub Actions
- AI Router Smoke Test: successful in GitHub Actions
- All three smoke-test families were successful after the portability changes reached `main`.
- Live AI steps were not run for these validations.
- Automatic paid AI/video generation, video-engine dispatch, and publication remain disabled.
- Human approval, production selection, filming handoff, and publication gates remain required.
- Deterministic, zero-token checks are the default validation path.

The local VS Code/Codex environment does not currently provide a usable Python runtime. This affects local execution only and is not a project blocker.

## Completed work

The filming-package portability implementation is complete and merged into `main`. Brand, owner/presenter, category, and available equipment now come from `.github/config/business-profile.json` through its existing `business`, `offer`, `content`, and `assets` structures.

Deterministic tests cover both the production Eren Müzik Atölyesi profile and the second fake-business fixture. No live AI, API, or video-generation call was made.

## Next development target

Perform a full portability audit of the remaining hard-coded Eren, brand, and repository-owner dependencies. Move business-specific values into the existing configuration owners while preserving deterministic validation, human approval gates, disabled automatic generation/dispatch/publication, and zero-token defaults.

For historical architecture, workflow runs, commit references, and completed milestones, see `.github/PROJECT_CHECKPOINT.md`.

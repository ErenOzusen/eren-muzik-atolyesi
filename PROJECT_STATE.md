# Project State

Last updated: 27 August 2026

## Git baseline

- Active branch: `dev/automation-vscode`
- Relative to `main`: 3 commits ahead, 0 commits behind
- Last branch commit: `918caafa` — `test: validate portable video orchestrator configs`
- Confirmed branch baseline at that commit: clean working tree
- Current portability work and these state documents remain uncommitted

## Verified state

- Business Profile Zero-Token Smoke Test: successful in GitHub Actions
- Video Orchestrator Smoke Test: successful in GitHub Actions
- AI Router/output-contract zero-token validation: successful
- Live AI steps were not run for these validations.
- Automatic paid AI/video generation, video-engine dispatch, and publication remain disabled.
- Human approval, production selection, filming handoff, and publication gates remain required.
- Deterministic, zero-token checks are the default validation path.

The local VS Code/Codex environment does not currently provide a usable Python runtime. This affects local execution only and is not a project blocker.

## Current work

The portability implementation for `.github/workflows/filming-package-agent-v4-router.yml` is complete in the uncommitted working tree. Brand, owner/presenter, category, and available equipment now come from `.github/config/business-profile.json` through its existing `business`, `offer`, `content`, and `assets` structures.

Local deterministic Node tests pass with both the production Eren Müzik Atölyesi profile and the second fake-business fixture. No AI, API, or video-generation call was made.

## Next verification

- Run the filming-package prompt portability test in GitHub Actions before committing.
- Confirm the generated prompt uses the correct brand, presenter, category, and equipment for both profiles.
- Confirm no live AI/API/video-generation step runs.
- Commit or merge only after explicit user authorization and successful validation.

For historical architecture, workflow runs, commit references, and completed milestones, see `.github/PROJECT_CHECKPOINT.md`.

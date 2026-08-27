# Repository Working Instructions

## Scope

This repository contains:

- a React/Vite frontend in `src/`
- an Express/MongoDB backend in `server/`
- GitHub Actions automation, deterministic validators, routing logic, and contracts in `.github/`

Historical implementation notes live in `.github/PROJECT_CHECKPOINT.md`. Use `PROJECT_STATE.md` for the short, current state.

## Safety and authorization

- Do not commit, push, merge, deploy, publish, or trigger production workflows unless the user explicitly authorizes that action.
- Keep automatic paid AI generation, paid video generation, engine dispatch, and publication disabled.
- Preserve all human approval, production-selection, filming-handoff, and publication gates.
- Never bypass approval markers, exact-Issue checks, scenario-selection checks, or owner authorization.
- Treat deterministic, zero-token, zero-network validation as the default.
- Do not run live AI/API/video-generation steps unless the user explicitly requests them and confirms the expected cost and external effect.
- Preserve unrelated and pre-existing working-tree changes.

## Configuration ownership

- Business identity, owner/presenter, category, services, equipment, content settings, and assets belong in `.github/config/business-profile.json`.
- AI routing belongs in `.github/config/ai-router.json`.
- Video routing belongs in `.github/config/video-orchestrator.json`.
- Output requirements belong in `.github/config/contracts/`.
- Do not add new root keys to the business profile without an explicit schema change. Prefer the existing `business`, `offer`, `content`, and `assets` structures.
- Workflows and prompts should consume profile values rather than hard-code Eren, the brand, equipment, category, or presenter.

## Validation

Run checks relevant to the files changed. Prefer:

- `npm run lint`
- `npm run build`
- the applicable `.github/scripts/test_*.py` zero-token tests
- `git diff --check`
- syntax and path/link checks for changed workflow YAML files

Python may be unavailable inside the local VS Code/Codex environment. This is an environment limitation, not a project blocker. In that case, report which tests could not run locally and use successful GitHub Actions zero-token results when available; do not silently treat an unexecuted test as passed.

## Change handoff

Report:

- files changed
- deterministic tests run and their results
- tests not run and why
- whether any live/network/paid action occurred
- remaining risks or blockers

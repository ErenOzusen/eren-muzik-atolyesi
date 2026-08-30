# Project State

Last updated: 30 August 2026

This repository contains two independent systems — see `README.md` for the
full split. This file tracks the current state of both.

## 1. Website / CRM / Appointment System

### Git baseline

- Active branch: `dev/full-portability-audit`
- A large security/maintainability hardening pass is **currently
  uncommitted** in the working tree (auth token redesign, trust-proxy and
  rate-limit fixes, CORS hardening, appointment double-booking DB
  integrity fix, PII log cleanup, lint cleanup, new test infrastructure,
  approval-gate fail-closed hardening, AI-router dead-code fix, and
  governance/SEO/docs additions). Do not assume any of the below is on
  `main` yet — check `git log`/`git status` for the actual current state
  before relying on this file alone.

### What's actually true right now

- Every `/api/admin/*` route (and the equivalent `/api/submissions/*`
  routes) requires a valid, signed, non-expired, non-revoked admin token —
  verified by an automated route-enumeration test, not just spot-checked.
- The backend fails to start (does not run with an insecure default) if
  `ADMIN_PASSWORD` or a sufficiently strong `ADMIN_TOKEN_SECRET` is missing.
- Admin session tokens are HMAC-signed, time-limited (12h default), and
  individually revocable on logout via a random token id (`jti`) — not a
  raw shared secret with no expiry.
- A known trust-proxy misconfiguration (which would have made
  Render-deployed rate limiting treat all visitors as one shared client)
  is fixed via a central, environment-aware `TRUST_PROXY` setting.
- The appointment double-booking protection is enforced at the database
  level (a unique partial MongoDB index), proven against a real, ephemeral
  MongoDB instance in tests — not just asserted from the schema
  declaration. An earlier version of this index used an unsupported
  MongoDB operator and would never have actually built; this was caught
  and fixed by adding a real-database test, not a mocked one.
- `npm run lint` passes with zero errors/warnings on the frontend.

### Known, disclosed limitations (not silently ignored)

See `SECURITY.md` for the full list — notably: admin token revocation is
in-memory and resets on server restart/redeploy, and a small number of
admin-only (not public-facing) logs still print a full error object rather
than just `error.message`.

## 2. AI Content-Automation Pipeline

**This system does not currently produce or publish real content.**
`generation_dispatch_enabled` is `false` and validated as required-false by
a dedicated check; paid AI calls, real video generation, and YouTube
upload/publication all require explicit human approval steps that are
still in place. Nothing in this project has removed or weakened those
gates.

### Pipeline (as designed — see `AI_ROUTER.md` for the router itself)

```
Research → Script → QC → Correction → Final Check → Owner Approval
  → Production Selection → Filming Package → Video Orchestrator
  → Raw Video / Faceless route → Editing → Subtitle → Thumbnail
  → YouTube Package → Publication Approval
```

Every stage between "Owner Approval" and "Publication Approval" is gated
by an explicit human approval comment on a GitHub Issue, verified by
fail-closed GitHub Actions workflows (mutate → refetch → verify exact
final state → success), not by trusting a single mutation call's own exit
code.

### Verified state (as of the last automation-focused pass)

- Business Profile Zero-Token Smoke Test, Video Orchestrator Smoke Test,
  and AI Router Smoke Test have all passed in GitHub Actions after the
  portability changes on `main`.
- Deterministic, zero-token checks (no real AI/API/video calls) are the
  default and required validation path for every workflow change in this
  project.
- A local Python interpreter (CPython 3.12) is now available for this
  work via a user-scoped `uv`-managed install — no system-wide Python was
  modified. All `test_*.py` files in `.github/scripts/` are executed for
  real locally, not just assumed to work from source inspection.

### Known migration status

Every AI-calling workflow that is safely router-eligible has been migrated
to the central multi-provider router (`ai_router.py`): the filming
package, weekly research, weekly script, weekly script correction, final
technical check, and the editing package agent all call `ai_router.py`
now, each with its own zero-token migration test
(`test_*_router_migration.mjs`) proving prompt/token-budget/quality-check/
test_mode preservation. **One workflow remains intentionally
un-migrated**: `weekly-quality-control.yml`, because it uses Anthropic's
native `web_search` tool, which `ai_router.py` does not yet support —
migrating it today would silently drop web search, so it stays on a
direct provider call until the router gains that capability. See
`AI_ROUTER_MIGRATION_PLAN.md` for the full per-workflow detail. Cost Guard
(`cost_guard.py`) is wired into every one of these router-connected paths
(preflight config validation + postflight usage/limit enforcement),
fail-closed on any configured token/attempt limit violation.

For historical architecture, workflow runs, and older completed
milestones, see `.github/PROJECT_CHECKPOINT.md`.

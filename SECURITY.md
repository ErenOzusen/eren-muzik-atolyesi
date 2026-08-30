# Security Policy

This repository contains two distinct systems:

1. A small business website/CRM (React frontend + Express/MongoDB backend)
   for Eren Müzik Atölyesi.
2. An AI content-automation pipeline (GitHub Actions workflows) that is
   explicitly **not** fully autonomous — real AI-generated video production
   and YouTube publication are disabled by default and require human
   approval at multiple stages (see `PROJECT_STATE.md`).

## Reporting a Vulnerability

Please report security issues **privately**, not through a public GitHub
issue.

Preferred: use GitHub's private vulnerability reporting for this repository
(repository **Security** tab → **Report a vulnerability**, if enabled by the
maintainer). This creates a private advisory visible only to the maintainer
and you, and is GitHub's own recommended mechanism for exactly this purpose.

If that option isn't available, open a regular issue asking the maintainer
to open a private channel — please don't include exploit details in the
public issue itself.

## Scope

In scope: the Express backend (`server/`), the React frontend (`src/`), and
the GitHub Actions automation (`.github/`).

Out of scope: findings that require access already limited to the repository
owner (e.g. "you could set an insecure `ADMIN_TOKEN_SECRET` if you wanted
to" — the backend already refuses to start with a weak one, but this is
about the owner's own deployment configuration, not a vulnerability in the
code) or third-party services this project merely calls (MongoDB Atlas,
Brevo, GitHub itself, the AI providers) — please report those in the
sizeable, appropriate place instead.

## Current Known Limitations

Documented transparently rather than silently, so a reporter doesn't
duplicate a known/accepted trade-off:

- Admin sessions are revoked by an in-memory list that resets on server
  restart/redeploy — a token revoked just before a restart could remain
  valid again for the rest of its original (time-limited) lifetime after
  that restart. See `server/auth.js`.
- The admin session token is a signed, time-limited Bearer token stored in
  `localStorage` (`src/utils/adminSession.js`), not an HttpOnly cookie —
  a deliberate trade-off, not an oversight. The frontend (Vercel) and
  backend (Render) are on different sites, so a cookie-based session here
  would need `SameSite=None`, which reopens CSRF exposure the current
  design doesn't have, unless real CSRF protection is also built — none
  exists in this repository today. See `ADMIN_SESSION_COOKIE_MIGRATION_PLAN.md`
  for the full analysis and what a complete, safe migration would require.
- A handful of operational logs still call `console.error(..., error)` with
  a full error object rather than just `error.message` on a few
  lower-traffic admin routes (video management) — these are not user PII
  (name/phone/email/message/note), but are not perfectly minimal either.

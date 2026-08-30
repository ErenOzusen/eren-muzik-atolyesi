# Eren Müzik Atölyesi

This repository contains two separate systems that happen to share one
repo:

1. **The website/CRM/appointment system** — a small business site for
   Eren Müzik Atölyesi (guitar, piano, bass guitar, music theory lessons),
   with a public site, a contact/appointment booking flow, and a
   password-protected admin panel.
2. **An AI content-automation pipeline** — a set of GitHub Actions
   workflows that research, script, quality-check, and prepare (but do
   **not** currently produce or publish) YouTube content. See
   [AI_ROUTER.md](AI_ROUTER.md) and [PROJECT_STATE.md](PROJECT_STATE.md)
   for that system specifically.

This README covers system 1. Do not assume anything said here about the
website applies to the automation pipeline, or vice versa.

## Live Site

- Frontend: https://eren-muzik-atolyesi.vercel.app
- Admin Panel: https://eren-muzik-atolyesi.vercel.app/admin
- Backend: https://eren-muzik-atolyesi-backend.onrender.com

## Stack

- Frontend: React, Vite
- Backend: Node.js, Express, MongoDB (Mongoose)
- Hosting: Vercel (frontend), Render (backend)

## Features

- Responsive public site with a lesson/contact/appointment booking flow
- Admin panel: view/search/filter/manage contact submissions, appointments,
  the weekly schedule, blocked time slots, and the public video list
- Admin login is a single shared password (`ADMIN_PASSWORD`), producing a
  time-limited (12-hour), HMAC-signed session token — not a per-user
  account system, and not (yet) HttpOnly-cookie-based; see
  [`server/auth.js`](server/auth.js) for the exact mechanism and
  [SECURITY.md](SECURITY.md) for its known limitations
- Rate-limited login (brute-force protection) and public forms (spam
  protection), plus a hidden honeypot field on both public forms
- Server-side input validation on every public endpoint (allowed-field
  checks, length limits, a fixed lesson whitelist, phone/email format,
  date/time validation) — never only client-side
- A database-level unique index prevents two active appointments from ever
  being created for the same date+time, even under concurrent requests (in
  addition to the existing application-level check); a cancelled
  appointment's slot can always be rebooked
- CORS is origin-restricted (not open to any site), with the production
  frontend origin always allowed regardless of configuration

None of this is described as "fully secure" or "unhackable" — see
[SECURITY.md](SECURITY.md) for what's covered, what isn't, and known
trade-offs (e.g. admin session revocation resets on server restart).

## Local Development

```bash
# Frontend
npm install
cp .env.example .env.local   # optional — sensible defaults exist without it
npm run dev

# Backend
cd server
npm install
cp .env.example .env         # required — see below
npm start
```

The backend **refuses to start** without `ADMIN_PASSWORD` and a sufficiently
long/random `ADMIN_TOKEN_SECRET` set in `server/.env` — this is intentional
fail-closed behavior, not a bug. See
[`server/.env.example`](server/.env.example) for every variable and
[DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md) for what to configure before
deploying.

## Testing

```bash
# Frontend: build, lint, unit/static tests
npm run build
npm run lint
npm test

# Backend: unit + integration tests (includes a real, ephemeral MongoDB
# via mongodb-memory-server for the appointment double-booking guarantee —
# no production database is ever touched)
cd server
npm test
```

## Deploy

Frontend is on Vercel; backend is on Render. See
[DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md) before deploying — several
environment variables are required and the backend will not start without
them.

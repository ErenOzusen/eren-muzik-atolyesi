# Deploy Checklist

This project has two independently-deployed pieces: the **backend** (Render)
and the **frontend** (Vercel). This checklist covers what must be configured
before deploying the current hardening work — most of it is a one-time setup.

## Backend (Render)

### Required — the backend refuses to start without these

| Variable | Notes |
|---|---|
| `ADMIN_PASSWORD` | The admin login password. No default; must be set. |
| `ADMIN_TOKEN_SECRET` | **New.** At least 32 characters, reasonably random. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Rotating it logs out every existing admin session. |

If either is missing, empty, or (for `ADMIN_TOKEN_SECRET`) too short/low-variety,
the backend process exits instead of running with an insecure default —
this is intentional. Watch the Render deploy logs for a line starting
`Güvenlik nedeniyle başlatma durduruldu:` if a deploy fails to come up.

### Strongly recommended — safe defaults exist, but explicit is better

| Variable | Default if unset | Notes |
|---|---|---|
| `ALLOWED_ORIGINS` | production Vercel origin + localhost | Add any *additional* frontend origins here (e.g. a staging site) — the production origin can never be removed by setting this. |
| `TRUST_PROXY` | `1` on Render automatically | Only set this if Render's proxy topology ever changes, or if deploying to a different host with a different number of proxy hops. |

### Already required (unchanged by this hardening pass)

`MONGODB_URI`, `EMAIL_USER`, `BREVO_API_KEY`, `NOTIFICATION_EMAIL` — see
`server/.env.example` for details. Missing these degrades gracefully
(DB routes return 503, email sending is skipped with a warning) rather than
crashing the process.

### Post-deploy verification

1. Check the deploy logs for `Randevu çakışma koruması (unique index) doğrulandı: aktif.` — confirms the appointment double-booking DB-level protection actually built. If instead you see `‼️ RANDEVU ÇAKIŞMA KORUMASI (DB seviyesi) AKTİF DEĞİL`, there is likely pre-existing duplicate active-appointment data in production for the same date+time slot — the application-level check still protects new bookings either way, but this should be investigated (read-only) before relying on the DB-level guarantee.
2. Confirm `/api/admin/login` works with the real `ADMIN_PASSWORD`.
3. Confirm a request from the real production frontend succeeds (no CORS rejection) and a request from an arbitrary other origin is rejected.

## Frontend (Vercel)

### Recommended

| Variable | Default if unset | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | `https://eren-muzik-atolyesi-backend.onrender.com` in production, `http://localhost:5000` on `localhost` | Set explicitly in Vercel's project settings for full control instead of relying on the hostname heuristic. |

Vite environment variables are baked in at **build time** — changing this
in Vercel requires a new deployment to take effect, not just a restart.

### Post-deploy verification

1. Confirm the deployed site's contact/appointment forms hit the real Render
   backend (check the Network tab — should never be `localhost`).
2. Confirm `npm run build` and `npm run lint` both pass in CI before merging
   (see `package.json` scripts — both are also run locally as part of this
   hardening work).

## Both

- Never commit `server/.env` or any real secret value — both are
  git-ignored; `.env.example` files document the shape only.
- If you rotate `ADMIN_TOKEN_SECRET`, every logged-in admin session becomes
  invalid immediately (this is expected, not a bug).

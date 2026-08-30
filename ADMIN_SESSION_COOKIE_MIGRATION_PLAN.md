# Admin Session Cookie Migration Plan

## Status: analyzed, **not implemented** — localStorage/Bearer stays as the current, hardened design

This document is the outcome of an explicit analysis task: evaluate whether
the admin session (currently a Bearer token in `localStorage`, see
`src/utils/adminSession.js` and `server/auth.js`) can be safely, *completely*
migrated to an HttpOnly cookie, given this project's actual deployment
topology. The instruction that produced this document was explicit that a
**half** migration must never be shipped — either a migration is fully
correct and fully tested, or the existing design stays as-is and this plan
is written instead. Conclusion: **defer the migration** — not because
cookies are the wrong idea in general, but because this specific
cross-origin deployment cannot support one safely without also building
CSRF protection and a way to verify a real cross-site cookie flow, neither
of which exist in this repository today, and building both correctly inside
one unreviewed pass would be exactly the "half migration" this task was
told to avoid.

## Current design (verified from source)

- **Token shape**: `server/auth.js` issues an HMAC-SHA256-signed,
  time-limited (12h default, `ADMIN_TOKEN_TTL_SECONDS`) opaque token
  containing a random `jti`. Verification is fail-closed and constant-time
  (`timingSafeEqualStrings`), and rejects non-canonical base64url re-encodings
  of an otherwise-valid payload (a previously-fixed revocation bypass).
  Revocation is by `jti`, in an **in-memory** `Set` — already a documented,
  accepted limitation (see `SECURITY.md`): a revoked token remains
  technically valid again after a server restart, for the rest of its
  original lifetime.
- **Transport today**: the token is returned in the JSON login response
  body, stored in `localStorage` (`src/utils/adminSession.js`), and sent
  back as `Authorization: Bearer <token>` on every admin request
  (`fetchWithAdminToken` in `src/services/api.js`, and each admin
  mutation's own manual `fetch` call). `server/server.js`'s `checkAdminToken`
  middleware reads that header — there is no cookie-parsing middleware
  installed anywhere in `server/server.js` today.
- **CORS today**: `server/corsConfig.js` resolves a strict, explicit origin
  allowlist (always includes the real production frontend origin
  `https://eren-muzik-atolyesi.vercel.app` plus configured dev/staging
  origins; a literal `"*"` wildcard fails closed at startup). `server.js`'s
  `corsOptions` does **not** set `credentials: true` — correct and required
  for the current design, since no cookie is ever sent.
- **Deployment topology**: the frontend is a static SPA on Vercel
  (`eren-muzik-atolyesi.vercel.app`) and the backend is a separate Express
  service on Render (`eren-muzik-atolyesi-backend.onrender.com`, from
  `src/services/api.js`'s fallback). These are two different domains under
  two different eTLD+1s (`vercel.app` vs `onrender.com`) — this is a genuine
  **cross-site** relationship, not merely cross-origin-same-site. That
  single fact drives everything below.
- **No CSP protects the admin UI today**: `helmet()` is applied only to the
  Render *API* responses (JSON), not to the Vercel-hosted HTML/JS the
  browser actually executes — `index.html` has no CSP `<meta>` tag and
  `vercel.json` sets no custom headers. So the admin panel's own JS runs
  with no Content-Security-Policy at all. This matters directly: the
  textbook argument for HttpOnly cookies is that JS (including anything an
  XSS bug might inject) cannot read an HttpOnly cookie, whereas it can
  always read `localStorage`. That argument is real here — but only *half*
  the picture, because of the next point.

## Why a straightforward migration would be unsafe here

1. **Cross-site cookies require `SameSite=None; Secure`, which reopens CSRF
   — a risk the current design doesn't have at all.** Because
   `vercel.app` and `onrender.com` are different sites, no `SameSite=Lax`
   or `SameSite=Strict` cookie would ever be sent by the browser on the
   frontend's own cross-origin fetches to the API — only `SameSite=None`
   works here. But `SameSite=None` cookies are also sent on requests
   *initiated by any other site* the admin's browser happens to visit,
   which is the entire CSRF threat model. The current Bearer-token design
   is naturally immune to CSRF (a third-party page cannot read
   `localStorage` or silently attach a custom `Authorization` header to a
   cross-site request) — trading that away for an HttpOnly cookie's
   XSS-resistance, without adding CSRF protection, would be a net-worse
   security posture, not an improvement.
2. **This repository has zero CSRF protection infrastructure today** — no
   CSRF token issuance, no double-submit-cookie middleware, no
   `Sec-Fetch-Site`/custom-header enforcement beyond the existing
   response-side CORS check (which does not stop a cookie-bearing request
   from being *sent* in the first place for CSRF-vulnerable "simple"
   requests; CORS only gates whether the *response* is readable by the
   calling page's JS). Building this correctly is real, separate,
   security-critical work, not a side effect of swapping a storage
   mechanism.
3. **Every admin-authenticated `fetch` call would need updating in lockstep
   with the backend**, and partial coverage is exactly the forbidden "half
   migration": `credentials: 'include'` would need to be added everywhere
   an admin request is made (today centralized in `fetchWithAdminToken`,
   but several admin mutations — video/appointment/blocked-slot/schedule
   writes — still build their own `fetch` calls directly in `App.jsx` and
   would each need auditing), `server.js`'s `corsOptions` would need
   `credentials: true` added, and `checkAdminToken` would need to read a
   cookie via new `cookie-parser` middleware instead of the `Authorization`
   header — with the old header path either fully removed (a hard cutover)
   or kept as a "temporary" fallback, which is itself a half-migrated state
   if left in place for any length of time.
4. **No way to actually test a real cross-site cookie flow in this
   repository today.** This project's entire test suite (backend Vitest +
   Jest-style Node tests, frontend Vitest) is unit/integration-level with
   no browser automation (no Playwright/Cypress/etc.). A `SameSite=None`
   cookie's behavior is inherently a *real-browser* concern — and
   increasingly, mainstream browsers (Safari's ITP most aggressively today)
   restrict or partition cross-site cookies by default, sometimes
   irrespective of `SameSite=None; Secure`. Shipping this change with no
   automated way to catch "the admin's own browser silently refuses the
   cookie and login appears to succeed but every subsequent request comes
   back 401" before it reaches the real site owner in production would be
   trading a well-tested, well-understood design for a materially less
   verifiable one — a worse outcome for a single-admin small-business site
   where "the owner gets locked out of their own dashboard" is a real
   operational incident, not an abstract risk.

## What a complete, safe migration would actually require (for a future pass)

Recorded here so this isn't re-derived from scratch later:

1. Add `cookie-parser` (or equivalent) middleware in `server.js`.
2. `POST /api/admin/login` sets `Set-Cookie: adminToken=<token>; HttpOnly;
   Secure; SameSite=None; Path=/api; Max-Age=<ADMIN_TOKEN_TTL_SECONDS>`
   instead of returning the token in the JSON body.
3. `checkAdminToken` reads `req.cookies.adminToken` instead of the
   `Authorization` header. `POST /api/admin/logout` clears the cookie
   (`Max-Age=0`) in addition to revoking the `jti` server-side, unchanged.
4. Add real CSRF protection: the standard fit here is a **double-submit
   cookie** — a second, non-HttpOnly `csrfToken` cookie set alongside the
   session cookie at login, which the frontend must read and echo back as
   a custom header (e.g. `X-CSRF-Token`) on every mutating
   (`POST`/`PATCH`/`PUT`/`DELETE`) admin request; the server rejects the
   request if the header doesn't match the cookie. This also has the nice
   property of forcing a CORS preflight (a custom header on a cross-origin
   request is never a "simple request"), giving the existing strict-origin
   CORS check real teeth against forged cross-site requests.
5. `server.js`'s `corsOptions` needs `credentials: true` added (the
   existing explicit, non-wildcard origin allowlist in
   `server/corsConfig.js` already satisfies the prerequisite that
   `credentials: true` can never be paired with `origin: "*"`).
6. Every admin-authenticated `fetch` call in the frontend needs
   `credentials: 'include'`, and the CSRF header wired in for mutations —
   centralize this the same way `fetchWithAdminToken` already centralizes
   the current Bearer-header logic, specifically so this migration (or any
   future one) only has one call site to change instead of a dozen.
7. Remove `localStorage` usage and the `Authorization`-header path
   entirely once the cookie path is verified working — no long-lived dual
   mode.
8. **Verify the real cross-site flow before relying on it**: either add a
   genuine browser-level e2e test (Playwright, testing against a real or
   locally-proxied cross-origin setup, including at least one WebKit/Safari
   run given its stricter cross-site cookie defaults), or have the site
   owner manually verify login/logout/session-expiry in their own actual
   browsers (Safari included) against the real Render+Vercel deployment
   before this is considered done — a passing Vitest suite alone cannot
   confirm a cross-site cookie actually survives a real browser's
   cross-site cookie policy.
9. Update `SECURITY.md` and `src/utils/adminSession.js`'s own header
   comment to describe the new design once implemented (see the
   "Current Known Limitations" section of `SECURITY.md`, which this pass
   also corrected to actually describe the current localStorage/Bearer
   trade-off, since it did not before).

## Recommendation

Keep the current localStorage/Bearer-token design as-is. It is not
insecure for what it is: origin-restricted (strict CORS allowlist, no
wildcard), signed and time-limited, constant-time verified, revocable, and
naturally immune to CSRF. Its one real theoretical weakness — an XSS bug
could exfiltrate the token from `localStorage` — is real but unmitigated
either way today (there is no CSP protecting the admin UI regardless of
where the token lives), and trading it for `SameSite=None` cookies without
also shipping CSRF protection and a real cross-site verification path would
plausibly make things worse, not better. Revisit this once either (a) a
browser-level e2e test harness exists to actually verify a cross-site
cookie flow, or (b) the frontend and backend are moved to the same site
(e.g. a Vercel serverless API or a custom domain shared via a subdomain),
which would remove the cross-site requirement entirely and let a much
simpler `SameSite=Lax` cookie work with no CSRF-token machinery needed.

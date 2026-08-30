// Single source of truth for the backend API base URL. Every fetch call in
// this app (contact, appointments, admin login, submissions, videos,
// blocked slots, weekly schedule, ...) must go through this constant rather
// than hard-coding a backend URL — that was the actual bug this file fixes:
// a handful of call sites previously hard-coded the production Render URL
// directly, so local development could silently write to production data.
//
// Set VITE_API_BASE_URL explicitly (in .env.local for dev, or in your
// hosting provider's environment variables for production) for full
// control. If it is not set, this falls back to the same hostname-based
// heuristic the app already used before, so nothing changes for anyone who
// hasn't configured it yet.

// Pure, dependency-injected resolver — exported separately from the
// top-level API_BASE_URL constant so it can be unit-tested directly with
// explicit env/hostname inputs, without needing to reset/re-import the
// module for each scenario.
export function resolveApiBaseUrl(env, hostname) {
  const configured = env && typeof env.VITE_API_BASE_URL === "string" ? env.VITE_API_BASE_URL.trim() : "";

  if (configured) {
    // An explicitly-configured value is used as-is, even if malformed —
    // failing loudly with a network error on the first fetch call is safer
    // than silently guessing a different backend, and does not require
    // build-time validation tooling this project doesn't otherwise have.
    return configured;
  }

  return hostname === "localhost"
    ? "http://localhost:5000"
    : "https://eren-muzik-atolyesi-backend.onrender.com";
}

export const API_BASE_URL = resolveApiBaseUrl(
  import.meta.env,
  typeof window !== "undefined" ? window.location.hostname : undefined
);

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

// Shared shape for every admin-only GET call (submissions, appointments,
// blocked slots, weekly schedule, admin videos, ...): same base URL, same
// Bearer-token header, same "parse JSON then let the caller decide what to
// do with response.ok" contract. Extracted to remove repeated fetch
// boilerplate across those call sites without changing any of their
// individual error messages or state updates, which stay in the caller.
export async function fetchWithAdminToken(path, token) {
  const response = await fetch(apiUrl(path), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json();
  return { ok: response.ok, data };
}

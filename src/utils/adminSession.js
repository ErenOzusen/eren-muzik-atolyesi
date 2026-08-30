// Centralizes the admin session token's localStorage persistence. Pulled
// out of App.jsx (Section K, a small/safe extraction) so this small but
// security-relevant piece of logic has one place and one set of tests
// instead of four independent inline localStorage calls.
//
// This does not change the session model itself: the token is still an
// opaque string handed to fetch() as `Authorization: Bearer <token>`, and
// still lives in localStorage rather than an HttpOnly cookie — see
// SECURITY.md for why that trade-off was made deliberately.

const ADMIN_TOKEN_STORAGE_KEY = "adminToken";

export function getSavedAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
}

export function hasSavedAdminToken() {
  return Boolean(getSavedAdminToken());
}

export function saveAdminToken(token) {
  localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
}

export function clearAdminToken() {
  localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
}

// Resolves Express's `trust proxy` setting from a central TRUST_PROXY env
// var, with safe environment-specific defaults when it isn't set.
//
// Why this exists: without a correct `trust proxy` setting, an app behind a
// reverse proxy (Render, like virtually every PaaS, terminates the real
// client connection at its own edge and forwards it over an internal hop)
// cannot tell real client IPs apart — every request looks like it comes
// from the proxy itself. That breaks express-rate-limit's per-client
// bucketing (all traffic shares one bucket) and, conversely, trusting
// X-Forwarded-For with NO reverse proxy in front of the app (e.g. plain
// local development) would let any client forge its own apparent IP via
// that same header and bypass rate limiting entirely. Both failure modes
// are real; the fix is to trust exactly the number of hops that are
// actually real, known reverse proxies — no more, no less.
//
// Only a small, explicit allowlist of values is accepted (no eval, no free
// string parsing of arbitrary shell-like syntax): "true", "false", a
// non-negative integer hop count, or one of Express's built-in named
// presets. Anything else fails closed at startup with a clear error,
// exactly like a missing admin secret.

const KNOWN_PRESETS = new Set(["loopback", "linklocal", "uniquelocal"]);

function isRenderEnvironment(env) {
  // Render sets this on every service; NODE_ENV is a more universal signal
  // in case of a different host. Either is enough to assume "behind exactly
  // one trusted reverse-proxy hop" as the safe production default.
  return Boolean(env.RENDER) || env.NODE_ENV === "production";
}

function resolveTrustProxySetting(env = process.env) {
  const raw = env.TRUST_PROXY;

  if (raw === undefined || raw.trim() === "") {
    // No explicit override.
    if (isRenderEnvironment(env)) {
      // Render (and most PaaS platforms) proxy every request through
      // exactly one hop before it reaches this process — trust exactly
      // that one hop, nothing more.
      return 1;
    }

    // Plain local development: no reverse proxy is normally in front of
    // this app. Trusting X-Forwarded-For here would let a direct client
    // forge its own apparent IP and bypass rate limiting.
    return false;
  }

  const trimmed = raw.trim();

  if (trimmed === "true") {
    // `trust proxy = true` tells Express to trust the ENTIRE
    // X-Forwarded-For chain, from however many hops a client claims —
    // exactly the "no more, no less" precision this module exists to
    // enforce, undone by a single overly-broad override. In a real
    // deployment (Render or any other host that sets NODE_ENV=production)
    // that is never actually correct — Render always terminates at
    // exactly one real hop — so this fails closed here the same way a
    // weak ADMIN_TOKEN_SECRET fails closed, rather than silently trusting
    // a setting that would let any client forge its own apparent IP and
    // bypass rate limiting. Non-production use (local experimentation)
    // is unaffected.
    if (isRenderEnvironment(env)) {
      throw new Error(
        'Güvenlik nedeniyle başlatma durduruldu: TRUST_PROXY="true" production ortamında kabul edilmez ' +
          "(tüm X-Forwarded-For zincirini güvenilir sayar). Render tam olarak bir hop üzerinden proxy'ler — " +
          'TRUST_PROXY değişkenini kaldırın (varsayılan olarak 1 kullanılır) veya açıkça "1" olarak ayarlayın.'
      );
    }
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (KNOWN_PRESETS.has(trimmed)) {
    return trimmed;
  }

  throw new Error(
    `Güvenlik nedeniyle başlatma durduruldu: TRUST_PROXY değeri "${raw}" tanınmıyor. ` +
      `Desteklenen değerler: "true", "false", bir tam sayı (hop sayısı), ` +
      `veya ${[...KNOWN_PRESETS].map((p) => `"${p}"`).join(", ")}.`
  );
}

module.exports = { resolveTrustProxySetting, isRenderEnvironment };

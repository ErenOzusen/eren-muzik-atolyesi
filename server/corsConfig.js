// Resolves the CORS allowed-origins allowlist from ALLOWED_ORIGINS, with a
// deterministic rule (B4): the known production frontend origin is ALWAYS
// included, whether or not ALLOWED_ORIGINS is set — setting ALLOWED_ORIGINS
// to add other domains (e.g. a staging frontend) must never accidentally
// drop the real production site's access. Development localhost origins
// are likewise always included, since they're never sensitive to add.
//
// Fail-closed: a malformed entry (not a valid absolute http(s) URL) or a
// literal wildcard ("*") throws at startup rather than being silently
// dropped or, worse, silently accepted as "allow everything".

const PRODUCTION_ORIGIN = "https://eren-muzik-atolyesi.vercel.app";

const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
];

// Parses one configured origin string into its canonical form (scheme +
// host + port, no path/query/hash/trailing slash — exactly what a browser
// sends in an Origin header). Throws with a clear message on anything that
// isn't a plausible http(s) origin.
function normalizeOrigin(rawOrigin) {
  const trimmed = rawOrigin.trim();

  if (trimmed === "*") {
    throw new Error(
      'Güvenlik nedeniyle başlatma durduruldu: ALLOWED_ORIGINS içinde "*" (wildcard) kullanılamaz. ' +
        "İzin verilen origin'leri tek tek, virgülle ayırarak belirtin."
    );
  }

  let parsed;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `Güvenlik nedeniyle başlatma durduruldu: ALLOWED_ORIGINS içindeki "${rawOrigin}" geçerli bir URL değil. ` +
        'Beklenen biçim: "https://example.com" (şema + host, yol/parametre olmadan).'
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Güvenlik nedeniyle başlatma durduruldu: ALLOWED_ORIGINS içindeki "${rawOrigin}" http/https dışında bir şema kullanıyor.`
    );
  }

  // .origin is the browser-equivalent canonical form: scheme://host[:port],
  // no trailing slash, no path — exactly what an Origin header contains.
  return parsed.origin;
}

function resolveAllowedOrigins(env = process.env) {
  const raw = env.ALLOWED_ORIGINS || "";

  const configuredOrigins = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(normalizeOrigin);

  return new Set([PRODUCTION_ORIGIN, ...DEV_ORIGINS, ...configuredOrigins]);
}

module.exports = { resolveAllowedOrigins, normalizeOrigin, PRODUCTION_ORIGIN, DEV_ORIGINS };

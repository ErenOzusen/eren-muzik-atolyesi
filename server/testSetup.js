// Preloaded via `node --require ./testSetup.js --test test/` (see
// package.json's "test" script) — runs once, before ANY test file's own
// code, in the SAME process every test file shares.
//
// Deliberately lives OUTSIDE test/: `node --test test/` recursively treats
// every .js file under that directory as a candidate test file (even one
// with no test() calls in it gets reported as its own trivial "passing
// test"), so a setup script placed inside test/ (including in a nested
// subdirectory) gets counted and re-executed a second time as a phantom
// test entry. Living beside server.js avoids that entirely while still
// being a perfectly normal relative --require target.
//
// Its one job: make outbound email network calls structurally impossible
// during a test run, independent of whatever else is true — MONGODB_URI
// set or unset, a real or fake BREVO_API_KEY, DB reachable or not. Without
// this, the only thing that has ever stopped a test from reaching the real
// Brevo API is that the specific integration test files happen to delete
// MONGODB_URI (so ensureDbConnection() returns false and the request never
// reaches the email-sending code). That is real protection today, but it
// is an implicit side effect of an unrelated check, not an explicit
// guarantee — a future test that adds a real or in-memory MongoDB
// connection (to test a full happy path, say) would, without this file,
// have nothing left stopping it from calling the real Brevo API using the
// real BREVO_API_KEY that already sits in server/.env.
//
// See services/emailService.js's isOutboundEmailDisabledForTests(): the
// guard is fail-safe by construction — it defaults to "real email allowed"
// and is turned off ONLY by this exact flag being the literal string
// "true". Production deploys (Vercel/Render env config) never set
// DISABLE_OUTBOUND_EMAIL, so this can never suppress a real customer/admin
// email by accident; it only ever does anything inside this test process.
process.env.DISABLE_OUTBOUND_EMAIL = "true";

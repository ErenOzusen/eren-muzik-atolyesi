require("dotenv").config({ quiet: true });

// dotenv.config() runs first, before app.js (and everything it transitively
// requires — authMiddleware's loadAdminSecrets, corsConfig, proxyConfig,
// each of which reads process.env at require time) gets loaded, exactly as
// when this was the first line of the single monolithic server.js.
const app = require("./app");
const { connectMongo } = require("./config/database");

const PORT = process.env.PORT || 5000;

// Only connect to Mongo and start listening when this file is run directly
// (`node server.js`). When required as a module — e.g. by the test suite —
// this stays a plain, inert Express app with no network/DB side effects.
if (require.main === module) {
  connectMongo().finally(() => {
    app.listen(PORT, () => {
      console.log(`Backend ${PORT} portunda çalışıyor`);
    });
  });
}

module.exports = app;

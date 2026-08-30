// Architecture-regression checks added by the backend architecture refactor
// (server.js split into routes/controllers/services/middleware/config).
// These guard the shape of the refactor itself — not request/response
// behavior (that's covered by every other test file, unchanged) — so a
// future change can't quietly undo the separation of concerns this refactor
// established. Zero-network, mostly zero-DB (one test binds a loopback
// socket briefly to prove no port gets bound as a side effect of require()).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const http = require("node:http");
const { readFileSync, readdirSync } = require("node:fs");

const SERVER_ROOT = path.join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", "test", ".git", "models"]);

function collectSourceFiles(dir) {
  const files = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...collectSourceFiles(path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(path.join(dir, entry.name));
    }
  }

  return files;
}

const ROUTE_DIR = path.join(SERVER_ROOT, "routes");
const CONTROLLER_DIR = path.join(SERVER_ROOT, "controllers");

test("architecture — server.js contains no inline route handlers (no app.get/post/put/patch/delete registrations)", () => {
  const source = readFileSync(path.join(SERVER_ROOT, "server.js"), "utf8");

  assert.doesNotMatch(
    source,
    /app\.(get|post|put|patch|delete)\s*\(/,
    "server.js must only bootstrap (env, DB connect, listen) — all route registration belongs in app.js + routes/*.js"
  );
});

test("architecture — server.js is a small bootstrap file, not a re-grown monolith", () => {
  const source = readFileSync(path.join(SERVER_ROOT, "server.js"), "utf8");
  const lineCount = source.split("\n").length;

  assert.ok(
    lineCount < 40,
    `server.js has grown to ${lineCount} lines — it should stay a thin env/DB-connect/listen bootstrap; route/business logic belongs in app.js, routes/, controllers/, or services/`
  );
});

test("architecture — every route file registers routes via imported controller functions, not inline handlers", () => {
  const routeFiles = readdirSync(ROUTE_DIR).filter((name) => name.endsWith(".js"));
  assert.ok(routeFiles.length > 0, "expected at least one route file under routes/");

  for (const fileName of routeFiles) {
    const source = readFileSync(path.join(ROUTE_DIR, fileName), "utf8");

    assert.match(
      source,
      /require\(["']\.\.\/controllers\//,
      `${fileName}: a route file must import its handlers from ../controllers/*`
    );

    assert.doesNotMatch(
      source,
      /router\.(get|post|put|patch|delete)\([^)]*\basync\s*\(|router\.(get|post|put|patch|delete)\([^)]*\(req,\s*res\)\s*=>/,
      `${fileName}: route registrations must reference a named controller function, not an inline handler`
    );
  }
});

test("architecture — every controller file is actually wired up by at least one route file", () => {
  const controllerFiles = readdirSync(CONTROLLER_DIR).filter((name) => name.endsWith(".js"));
  const routeFiles = readdirSync(ROUTE_DIR).filter((name) => name.endsWith(".js"));
  const routesSource = routeFiles
    .map((name) => readFileSync(path.join(ROUTE_DIR, name), "utf8"))
    .join("\n");

  for (const fileName of controllerFiles) {
    const moduleName = fileName.replace(/\.js$/, "");
    assert.match(
      routesSource,
      new RegExp(`controllers/${moduleName}["']`),
      `controllers/${fileName} is never required by any route file — dead controller, or a route wiring bug`
    );
  }
});

test("architecture — no circular require() dependencies among server-owned source files", () => {
  const files = collectSourceFiles(SERVER_ROOT);
  const graph = new Map();

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const deps = [];
    const requireRegex = /require\(\s*["'](\.[^"']+)["']\s*\)/g;
    let match;

    while ((match = requireRegex.exec(source)) !== null) {
      let resolved = path.resolve(path.dirname(file), match[1]);

      // Mirror Node's own resolution: a bare directory require falls back
      // to index.js (see validation/index.js).
      try {
        if (!resolved.endsWith(".js")) {
          resolved = require.resolve(resolved);
        } else {
          require.resolve(resolved);
        }
      } catch {
        continue; // not a local server-owned file (or unresolved) — irrelevant to this graph
      }

      if (files.includes(resolved)) {
        deps.push(resolved);
      }
    }

    graph.set(file, deps);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map(files.map((f) => [f, WHITE]));
  const cyclePath = [];

  function visit(file) {
    color.set(file, GRAY);
    cyclePath.push(file);

    for (const dep of graph.get(file) || []) {
      if (color.get(dep) === GRAY) {
        const cycleStart = cyclePath.indexOf(dep);
        const cycle = [...cyclePath.slice(cycleStart), dep].map((f) => path.relative(SERVER_ROOT, f));
        assert.fail(`circular require() dependency detected: ${cycle.join(" -> ")}`);
      }

      if (color.get(dep) === WHITE) {
        visit(dep);
      }
    }

    cyclePath.pop();
    color.set(file, BLACK);
  }

  for (const file of files) {
    if (color.get(file) === WHITE) {
      visit(file);
    }
  }
});

test("architecture — app.listen is called exactly once in the whole backend source, guarded by require.main", () => {
  const files = collectSourceFiles(SERVER_ROOT);
  let listenCallCount = 0;
  let guardedListenFile = null;

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const matches = source.match(/\.listen\(/g);

    if (matches) {
      listenCallCount += matches.length;

      if (/require\.main\s*===\s*module[\s\S]*?\.listen\(/.test(source)) {
        guardedListenFile = file;
      }
    }
  }

  assert.equal(listenCallCount, 1, "expected exactly one app.listen(...) call site across the backend source");
  assert.ok(
    guardedListenFile,
    "the single app.listen(...) call must be guarded by `if (require.main === module)` so requiring the app as a module never starts a real server"
  );
});

test("architecture — requiring server.js as a module never binds a real port (no listen side effect)", async () => {
  for (const resolved of [require.resolve("../server.js"), require.resolve("../app.js")]) {
    delete require.cache[resolved];
  }

  const app = require("../server.js");
  assert.equal(typeof app, "function", "server.js must still export the Express app directly (require.main !== module here)");

  // If server.js's require.main guard were broken, requiring it above would
  // already have bound the default PORT — this probe binding to that same
  // port would then fail with EADDRINUSE.
  const port = Number(process.env.PORT) || 5000;
  const probe = http.createServer();

  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", resolve);
  });

  await new Promise((resolve) => probe.close(resolve));
});

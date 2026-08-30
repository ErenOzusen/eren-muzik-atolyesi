import { defineConfig } from "vitest/config";

// Minimal, dependency-light test config: these tests are pure-logic and
// source-text/static assertions (no component rendering), so the default
// "node" environment is sufficient — no jsdom/@testing-library dependency
// is needed for what this project currently tests on the frontend.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
  },
});

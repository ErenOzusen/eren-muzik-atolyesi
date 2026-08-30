import { describe, it, expect, beforeEach } from "vitest";
import {
  getSavedAdminToken,
  hasSavedAdminToken,
  saveAdminToken,
  clearAdminToken,
} from "./adminSession";

// vitest's default "node" environment doesn't provide a real localStorage,
// so this test provides a minimal in-memory stand-in — enough to test the
// module's own logic (key name, get/set/remove/has semantics) without
// pulling in a jsdom dependency for one small utility.
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
});

describe("adminSession (K — extracted admin session persistence)", () => {
  it("has no saved token initially", () => {
    expect(getSavedAdminToken()).toBeNull();
    expect(hasSavedAdminToken()).toBe(false);
  });

  it("saves and retrieves a token", () => {
    saveAdminToken("abc.def");
    expect(getSavedAdminToken()).toBe("abc.def");
    expect(hasSavedAdminToken()).toBe(true);
  });

  it("clears a saved token", () => {
    saveAdminToken("abc.def");
    clearAdminToken();
    expect(getSavedAdminToken()).toBeNull();
    expect(hasSavedAdminToken()).toBe(false);
  });

  it("uses the literal key \"adminToken\" (stable across a redeploy/reload)", () => {
    saveAdminToken("xyz");
    expect(localStorage.getItem("adminToken")).toBe("xyz");
  });
});

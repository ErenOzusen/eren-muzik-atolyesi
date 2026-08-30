import { describe, it, expect } from "vitest";
import { resolveApiBaseUrl, apiUrl } from "./api";

describe("resolveApiBaseUrl (D — API base URL dev/prod/override behavior)", () => {
  it("resolves to the local backend when hostname is localhost and no override is set", () => {
    expect(resolveApiBaseUrl({}, "localhost")).toBe("http://localhost:5000");
  });

  it("resolves to the production backend when hostname is not localhost and no override is set", () => {
    expect(resolveApiBaseUrl({}, "eren-muzik-atolyesi.vercel.app")).toBe(
      "https://eren-muzik-atolyesi-backend.onrender.com"
    );
  });

  it("VITE_API_BASE_URL override takes precedence over the localhost heuristic", () => {
    expect(
      resolveApiBaseUrl({ VITE_API_BASE_URL: "https://staging-backend.example.com" }, "localhost")
    ).toBe("https://staging-backend.example.com");
  });

  it("VITE_API_BASE_URL override takes precedence in production too", () => {
    expect(
      resolveApiBaseUrl(
        { VITE_API_BASE_URL: "https://staging-backend.example.com" },
        "eren-muzik-atolyesi.vercel.app"
      )
    ).toBe("https://staging-backend.example.com");
  });

  it("an empty-string VITE_API_BASE_URL is treated as unset (falls back to the hostname heuristic)", () => {
    expect(resolveApiBaseUrl({ VITE_API_BASE_URL: "" }, "localhost")).toBe("http://localhost:5000");
    expect(resolveApiBaseUrl({ VITE_API_BASE_URL: "   " }, "localhost")).toBe("http://localhost:5000");
  });

  it("a malformed but non-empty VITE_API_BASE_URL is still used as-is (fails loudly on fetch rather than silently guessing a backend)", () => {
    expect(resolveApiBaseUrl({ VITE_API_BASE_URL: "not-a-url" }, "localhost")).toBe("not-a-url");
  });

  it("a missing env object does not throw", () => {
    expect(() => resolveApiBaseUrl(undefined, "localhost")).not.toThrow();
    expect(resolveApiBaseUrl(undefined, "localhost")).toBe("http://localhost:5000");
  });

  it("local development never resolves to the production backend by accident", () => {
    const result = resolveApiBaseUrl({}, "localhost");
    expect(result).not.toContain("onrender.com");
  });
});

describe("apiUrl", () => {
  it("concatenates the resolved base URL with the given path", () => {
    expect(apiUrl("/api/contact")).toMatch(/\/api\/contact$/);
  });
});

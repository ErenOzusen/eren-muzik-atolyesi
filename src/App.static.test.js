// Static/structural tests for App.jsx (D). These are source-text
// assertions, not component-rendering tests — App.jsx is a large,
// not-yet-fully-decomposed component (see Section K), so this mirrors the
// same zero-render, static-assertion style already used throughout this
// project's backend and automation test suites rather than pulling in a
// jsdom/@testing-library stack for a handful of checks.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "App.jsx"),
  "utf8"
).replace(/\r\n/g, "\n");

describe("D — honeypot field serialization", () => {
  it("both public forms include a website honeypot field in their state, defaulting to empty", () => {
    const contactFormMatch = appSource.match(/const \[contactForm, setContactForm\] = useState\(\{[\s\S]*?\}\);/);
    expect(contactFormMatch).not.toBeNull();
    expect(contactFormMatch[0]).toMatch(/website:\s*""/);

    const appointmentFormMatch = appSource.match(/const \[appointmentForm, setAppointmentForm\] = useState\(\{[\s\S]*?\}\);/);
    expect(appointmentFormMatch).not.toBeNull();
    expect(appointmentFormMatch[0]).toMatch(/website:\s*""/);
  });

  it("both forms render a hidden, aria-hidden, tab-unreachable input named website (so JSON.stringify(formState) includes it exactly as the backend's honeypot check expects)", () => {
    const honeypotInputs = appSource.match(/name="website"[\s\S]{0,400}?aria-hidden="true"/g) || [];
    expect(honeypotInputs.length).toBe(2);
    for (const block of honeypotInputs) {
      expect(block).toMatch(/tabIndex="-1"/);
    }
  });

  it("the contact and appointment submit handlers send the whole form state as JSON (so the honeypot field is included in the request body)", () => {
    expect(appSource).toMatch(/body:\s*JSON\.stringify\(contactForm\)/);
    expect(appSource).toMatch(/body:\s*JSON\.stringify\(appointmentForm\)/);
  });
});

describe("D — admin login/logout session state", () => {
  it("imports the extracted admin session helpers (Section K) rather than calling localStorage directly", () => {
    expect(appSource).toMatch(/from "\.\/utils\/adminSession"/);
    expect(appSource).not.toMatch(/localStorage\.(get|set|remove)Item\(\s*"adminToken"/);
  });

  it("login persists the token via saveAdminToken and sets logged-in state", () => {
    const loginHandlerIdx = appSource.indexOf("const handleAdminLogin");
    expect(loginHandlerIdx).toBeGreaterThan(-1);
    const loginBlock = appSource.slice(loginHandlerIdx, loginHandlerIdx + 2000);
    expect(loginBlock).toMatch(/saveAdminToken\(/);
    expect(loginBlock).toMatch(/setIsAdminLoggedIn\(true\)/);
  });

  it("logout clears the token via clearAdminToken and clears logged-in state", () => {
    const logoutIdx = appSource.search(/const handleAdminLogout|handleLogout/);
    expect(logoutIdx).toBeGreaterThan(-1);
    const logoutBlock = appSource.slice(logoutIdx, logoutIdx + 1000);
    expect(logoutBlock).toMatch(/clearAdminToken\(\)/);
    expect(logoutBlock).toMatch(/setIsAdminLoggedIn\(false\)/);
  });

  it("a saved token is restored on mount via getSavedAdminToken", () => {
    expect(appSource).toMatch(/getSavedAdminToken\(\)/);
  });
});

describe("D — unauthorized/failed admin request handling", () => {
  it("admin login checks the response body's success flag before treating the request as logged in (and does not log in on failure)", () => {
    const loginHandlerIdx = appSource.indexOf("const handleAdminLogin");
    const loginBlock = appSource.slice(loginHandlerIdx, loginHandlerIdx + 2000);
    expect(loginBlock).toMatch(/if\s*\(\s*data\.success\s*\)/);
    expect(loginBlock).toMatch(/setIsAdminLoggedIn\(true\)/);
  });

  it("every admin data-fetching function checks response.ok and surfaces an error rather than silently treating a 401/403 as success", () => {
    const fetchFunctionNames = [
      "fetchSubmissions",
      "fetchAppointments",
      "fetchBlockedSlots",
      "fetchWeeklySchedule",
      "fetchAdminVideos",
    ];

    for (const name of fetchFunctionNames) {
      const defIdx = appSource.indexOf(`const ${name} = async`);
      expect(defIdx, `expected to find ${name}'s definition`).toBeGreaterThan(-1);
      const nextConst = appSource.indexOf("\nconst ", defIdx + 10);
      const block = appSource.slice(defIdx, nextConst === -1 ? defIdx + 1500 : nextConst);

      // Either the function checks response.ok directly, or it goes
      // through the shared fetchWithAdminToken helper (Section K) and
      // still branches on the ok flag it returns — both shapes actually
      // surface a 401/403 as an error rather than silently treating it as
      // success.
      const checksRawResponseOk = /response\.ok/.test(block);
      const usesSharedAdminFetchHelperAndBranchesOnOk =
        /const \{\s*ok,\s*data\s*\} = await fetchWithAdminToken\(/.test(block) &&
        /if\s*\(\s*!?ok\s*\)/.test(block);
      expect(
        checksRawResponseOk || usesSharedAdminFetchHelperAndBranchesOnOk,
        `${name} must check response.ok (or branch on the shared fetchWithAdminToken helper's ok flag)`
      ).toBe(true);
    }
  });
});

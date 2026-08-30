// Static/structural test proving the public-site WhatsApp CTA links are
// centralized through buildBusinessWhatsAppLink (src/utils/whatsapp.js)
// rather than hardcoded per call site, and that the real business number
// and every existing message/link format is preserved exactly.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { BUSINESS_WHATSAPP_PHONE, buildBusinessWhatsAppLink } from "./utils/whatsapp";

const appSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "App.jsx"),
  "utf8"
).replace(/\r\n/g, "\n");

describe("public-site WhatsApp CTA centralization", () => {
  it("never hardcodes the business WhatsApp number's wa.me URL directly in JSX", () => {
    expect(appSource).not.toMatch(/wa\.me\/905558089585/);
  });

  it("every public CTA link is built through buildBusinessWhatsAppLink", () => {
    const matches = appSource.match(/buildBusinessWhatsAppLink\(/g) || [];
    // 8 known call sites as of this refactor -- at least that many, so a
    // future CTA added the same way keeps passing.
    expect(matches.length).toBeGreaterThanOrEqual(8);
  });

  it("the centralized phone number is the real, existing business number (not deleted or changed)", () => {
    expect(BUSINESS_WHATSAPP_PHONE).toBe("905558089585");
  });

  it("buildBusinessWhatsAppLink reproduces byte-identical links to the ones previously hardcoded", () => {
    const cases = [
      [
        "Merhaba, Eren Müzik Atölyesi hakkında bilgi almak istiyorum.",
        "https://wa.me/905558089585?text=Merhaba%2C%20Eren%20M%C3%BCzik%20At%C3%B6lyesi%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum.",
      ],
      [
        "Merhaba, müzik dersleri hakkında bilgi almak istiyorum.",
        "https://wa.me/905558089585?text=Merhaba%2C%20m%C3%BCzik%20dersleri%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum.",
      ],
      [
        "Merhaba, gitar dersi hakkında bilgi almak istiyorum.",
        "https://wa.me/905558089585?text=Merhaba%2C%20gitar%20dersi%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum.",
      ],
      [
        "Merhaba, piyano dersi hakkında bilgi almak istiyorum.",
        "https://wa.me/905558089585?text=Merhaba%2C%20piyano%20dersi%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum.",
      ],
      [
        "Merhaba, bas gitar dersi hakkında bilgi almak istiyorum.",
        "https://wa.me/905558089585?text=Merhaba%2C%20bas%20gitar%20dersi%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum.",
      ],
      [
        "Merhaba, aklıma takılan bir soru var. Bilgi alabilir miyim?",
        "https://wa.me/905558089585?text=Merhaba%2C%20akl%C4%B1ma%20tak%C4%B1lan%20bir%20soru%20var.%20Bilgi%20alabilir%20miyim%3F",
      ],
      [
        "Merhaba, dersler hakkında bilgi almak istiyorum.",
        "https://wa.me/905558089585?text=Merhaba%2C%20dersler%20hakk%C4%B1nda%20bilgi%20almak%20istiyorum.",
      ],
    ];
    for (const [message, expectedUrl] of cases) {
      expect(buildBusinessWhatsAppLink(message)).toBe(expectedUrl);
    }
  });

  it("still opens in a new tab with safe rel attributes on every occurrence (behavior unchanged)", () => {
    const linkBlocks = appSource.match(/buildBusinessWhatsAppLink\([^)]*\)\}[\s\S]{0,200}/g) || [];
    expect(linkBlocks.length).toBeGreaterThanOrEqual(8);
    for (const block of linkBlocks) {
      expect(block).toMatch(/target="_blank"/);
      expect(block).toMatch(/rel="noopener noreferrer"/);
    }
  });
});

import { describe, it, expect } from "vitest";
import { normalizePhoneForWhatsApp, buildWhatsAppLink } from "./whatsapp";

describe("normalizePhoneForWhatsApp", () => {
  it("returns null for empty/non-string input", () => {
    expect(normalizePhoneForWhatsApp(null)).toBeNull();
    expect(normalizePhoneForWhatsApp(undefined)).toBeNull();
    expect(normalizePhoneForWhatsApp("")).toBeNull();
    expect(normalizePhoneForWhatsApp(5551234567)).toBeNull();
  });

  it("strips spaces, dashes, parens and dots", () => {
    expect(normalizePhoneForWhatsApp("(0532) 123-45.67")).toBe("905321234567");
  });

  it("converts a leading 0 to the 90 country code", () => {
    expect(normalizePhoneForWhatsApp("05321234567")).toBe("905321234567");
  });

  it("adds the 90 country code to a bare 10-digit 5xx number", () => {
    expect(normalizePhoneForWhatsApp("5321234567")).toBe("905321234567");
  });

  it("strips a leading + and keeps an already-international number as-is", () => {
    expect(normalizePhoneForWhatsApp("+905321234567")).toBe("905321234567");
  });

  it("rejects non-numeric content", () => {
    expect(normalizePhoneForWhatsApp("abc-def-ghij")).toBeNull();
  });

  it("rejects numbers outside the 10-15 digit safe range", () => {
    expect(normalizePhoneForWhatsApp("123")).toBeNull();
    expect(normalizePhoneForWhatsApp("1234567890123456")).toBeNull();
  });
});

describe("buildWhatsAppLink", () => {
  it("returns null when the phone can't be normalized", () => {
    expect(buildWhatsAppLink("")).toBeNull();
    expect(buildWhatsAppLink("abc")).toBeNull();
  });

  it("builds a wa.me link with an encoded prefill message", () => {
    const link = buildWhatsAppLink("05321234567");
    expect(link).toMatch(/^https:\/\/wa\.me\/905321234567\?text=/);
    expect(decodeURIComponent(link.split("?text=")[1])).toBe(
      "Merhaba, Eren Müzik Atölyesi'ne yaptığınız başvuru için size ulaşıyorum."
    );
  });
});

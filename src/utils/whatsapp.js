const WHATSAPP_PREFILL_MESSAGE =
  "Merhaba, Eren Müzik Atölyesi'ne yaptığınız başvuru için size ulaşıyorum.";

// Single source of truth for the business's own public WhatsApp contact
// number, used by every "Bize WhatsApp'tan ulaşın" style CTA link on the
// public site (as opposed to buildWhatsAppLink above, which builds a link
// to a SUBMITTED CONTACT's own phone number). Previously this exact
// number was hardcoded directly in 8 separate JSX hrefs in App.jsx —
// centralizing it here does not change the number, the link format, or
// any user-visible behavior; it only removes the duplication so a future
// second-business deployment (or a real number change) has one place to
// update instead of eight.
export const BUSINESS_WHATSAPP_PHONE = "905558089585";

export function buildBusinessWhatsAppLink(message) {
  return `https://wa.me/${BUSINESS_WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`;
}

export function normalizePhoneForWhatsApp(phone) {
  if (!phone || typeof phone !== "string") return null;

  let digits = phone.replace(/[\s\-().]/g, "").replace(/^\+/, "");

  if (!digits || !/^\d+$/.test(digits)) return null;

  if (digits.startsWith("0")) {
    digits = "90" + digits.slice(1);
  } else if (digits.length === 10 && digits.startsWith("5")) {
    digits = "90" + digits;
  }

  if (digits.length < 10 || digits.length > 15) return null;

  return digits;
}

export function buildWhatsAppLink(phone) {
  const normalizedPhone = normalizePhoneForWhatsApp(phone);
  if (!normalizedPhone) return null;

  const text = encodeURIComponent(WHATSAPP_PREFILL_MESSAGE);
  return `https://wa.me/${normalizedPhone}?text=${text}`;
}

// Explicit, fail-safe outbound-email kill switch for tests (see
// testSetup.js). This is a positive opt-IN, not a NODE_ENV-based
// negative check: it defaults to "real email allowed" and is disabled ONLY
// when this exact flag is the literal string "true". No production deploy
// config (Vercel/Render env vars) ever sets DISABLE_OUTBOUND_EMAIL, so a
// missing/misconfigured env var can never accidentally suppress a real
// customer/admin email — the only way to reach the disabled branch is for
// something to explicitly turn it on, which only the test bootstrap does.
function isOutboundEmailDisabledForTests(env = process.env) {
  return env.DISABLE_OUTBOUND_EMAIL === "true";
}

// Generic Brevo (transactional email) sender plus the specific notification
// emails this app sends. Extracted unchanged from server.js — same env
// vars, same endpoint, same sender identity, same subject/body text for
// every email, same warn-and-return-null behavior when config/recipient is
// missing, same throw-on-non-OK-response behavior.
const sendBrevoEmail = async ({ subject, text, to, toName = "" }) => {
  if (isOutboundEmailDisabledForTests()) {
    // Same shape as the "config/recipient missing" early-return below —
    // every existing caller already handles a null result, so this adds
    // no new contract for them to worry about.
    console.warn(
      "Outbound email devre dışı (DISABLE_OUTBOUND_EMAIL=true) — Brevo isteğine hiç çıkılmadı. " +
        "Bu yalnızca test süreci için ayarlanır; production'da bu değişken hiçbir zaman ayarlanmaz."
    );
    return null;
  }

  const recipientEmail = to || process.env.NOTIFICATION_EMAIL;

  if (
    !process.env.BREVO_API_KEY ||
    !process.env.EMAIL_USER ||
    !recipientEmail
  ) {
    console.warn("Brevo e-posta ayarları veya alıcı adresi eksik.");
    return null;
  }

  const recipient = {
    email: recipientEmail,
  };

  if (toName && toName.trim()) {
    recipient.name = toName.trim();
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": process.env.BREVO_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: "Eren Müzik Atölyesi",
        email: process.env.EMAIL_USER,
      },
      to: [recipient],
      subject,
      textContent: text,
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      `Brevo API hatası (${response.status}): ${
        result.message || JSON.stringify(result)
      }`
    );
  }

  console.log(
    "Brevo e-postası kabul edildi:",
    result.messageId || result
  );

  return result;
};

const sendNewSubmissionEmail = async (submission) => {
  const result = await sendBrevoEmail({
    subject: "Yeni bilgi alma başvurusu geldi 🎵",
    text: `
Yeni bir bilgi alma başvurusu geldi 🎵

Ad Soyad: ${submission.name || "-"}
Telefon: ${submission.phone || "-"}
Ders: ${submission.lesson || "-"}
Mesaj: ${submission.message || "-"}

Admin panel:
https://eren-muzik-atolyesi.vercel.app/admin
    `,
  });

  console.log(
    "Yeni başvuru e-postası Brevo ile gönderildi:",
    result?.messageId
  );
};

const sendNewAppointmentEmail = async (appointment) => {
  const result = await sendBrevoEmail({
    subject: "Yeni ön görüşme talebi geldi 🎵",
    text: `
Yeni bir ön görüşme talebi geldi 🎵

Ad Soyad: ${appointment.name || "-"}
Telefon: ${appointment.phone || "-"}
E-posta: ${appointment.email || "-"}
Ders: ${appointment.lesson || "-"}
Tarih: ${appointment.appointmentDate || "-"}
Saat: ${appointment.appointmentTime || "-"}
Not: ${appointment.note || "-"}

Admin panel:
https://eren-muzik-atolyesi.vercel.app/admin
    `,
  });

  console.log(
    "Ön görüşme e-postası Brevo ile gönderildi:",
    result?.messageId
  );
};

// Builds and sends the "your appointment was confirmed" email to the
// student. Throws on failure — same as the original inline logic, whose
// caller (the appointment status-update flow) swallows the error and
// simply leaves confirmationEmailSent false; see appointmentController.
async function sendAppointmentConfirmationEmail(appointment) {
  const rawAppointmentDate = String(appointment.appointmentDate);

  const appointmentDate = new Date(
    rawAppointmentDate.includes("T")
      ? rawAppointmentDate
      : `${rawAppointmentDate}T12:00:00`
  );

  const formattedDate = appointmentDate.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long",
    timeZone: "Europe/Istanbul",
  });

  await sendBrevoEmail({
    to: appointment.email,
    toName: appointment.name,
    subject: "Ön görüşmeniz onaylandı | Eren Müzik Atölyesi",
    text: `Merhaba ${appointment.name},

Ön görüşme talebiniz onaylandı.

Tarih: ${formattedDate}
Saat: ${appointment.appointmentTime}
Ders: ${appointment.lesson}

Görüşme öncesinde gerekli olması hâlinde sizinle telefon veya WhatsApp üzerinden iletişime geçeceğiz.

Görüşmek üzere,

Eren Özüşen
Eren Müzik Atölyesi`,
  });
}

module.exports = {
  sendBrevoEmail,
  sendNewSubmissionEmail,
  sendNewAppointmentEmail,
  sendAppointmentConfirmationEmail,
  isOutboundEmailDisabledForTests,
};

import { loadEnvironment } from "../config.mjs";

await loadEnvironment();

async function sendSms(to, body) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
  const configuredValues = [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER];
  if (configuredValues.every((value) => !value)) {
    console.log(`[Twilio mock] To: ${to}\n${body}`);
    return "mock";
  }
  if (configuredValues.some((value) => !value)) {
    throw new Error("Twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER.");
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Messages.json`;
  const credentials = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: body }),
  });
  if (!response.ok) throw new Error(`Twilio SMS failed with HTTP ${response.status}.`);
  return "sent";
}

async function sendEmail(to, subject, html) {
  const configuredValues = [process.env.RESEND_API_KEY, process.env.RESEND_FROM_EMAIL];
  if (configuredValues.every((value) => !value)) {
    console.log(`[Resend mock] To: ${to}\nSubject: ${subject}\nHTML: ${html}`);
    return "mock";
  }
  if (configuredValues.some((value) => !value)) {
    throw new Error("Resend requires RESEND_API_KEY and RESEND_FROM_EMAIL.");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: [to],
      subject,
      html,
    }),
  });
  if (!response.ok) throw new Error(`Resend email failed with HTTP ${response.status}.`);
  return "sent";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

export async function sendReminderMessages({ phone, email, sms, subject, html }) {
  const results = await Promise.allSettled([
    sendSms(phone, sms),
    sendEmail(email, subject, html),
  ]);
  const [smsResult, emailResult] = results;
  const delivery = {
    sms: smsResult.status === "fulfilled" ? smsResult.value : "failed",
    email: emailResult.status === "fulfilled" ? emailResult.value : "failed",
  };
  if (smsResult.status === "rejected" || emailResult.status === "rejected") {
    const errors = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason.message);
    return { ...delivery, error: errors.join(" ") };
  }
  return delivery;
}

export async function sendFollowUp(client) {
  const firstName = client.name.split(/\s+/)[0];
  const progress = Math.max(0, Math.min(6, Number(client.loyaltyStamps) || 0));
  const loyalty = client.freeCutAvailable
    ? "Your FREE 7th cut is ready. Book it whenever you're ready!"
    : `You're ${6 - progress} cut${6 - progress === 1 ? "" : "s"} away from your FREE 7th cut.`;
  const bookingLink = process.env.BOOKING_LINK || "http://localhost:3000/#book";
  const googleReviewLink = "https://g.page/r/letsgfaded/review"; // Replace with actual Google Business Profile review link
  const sms = `Thanks for coming in, ${firstName}! Jay from Let's Get Faded here. ${loyalty} Book your next chair: ${bookingLink} · Leave a review: ${googleReviewLink}`;
  const subject = "Thanks for coming through — stay sharp";
  const safeName = escapeHtml(firstName);
  const safeBookingLink = escapeHtml(bookingLink);
  const safeGoogleReviewLink = escapeHtml(googleReviewLink);
  const html = `<div style="margin:0;background:#0b0c10;padding:36px 16px;font-family:Arial,sans-serif;color:#f5f6f8"><div style="max-width:540px;margin:auto;border:1px solid #30333b;padding:32px;background:#121419"><p style="color:#52a8ff;letter-spacing:3px;font-size:11px;font-weight:bold">LET'S GET FADED · HAMILTON</p><h1 style="font-size:26px;margin:20px 0 12px">Good seeing you, ${safeName}.</h1><p style="color:#c2c5ce;line-height:1.7">Thanks for trusting Jay with the cut. ${escapeHtml(loyalty)}</p><a href="${safeBookingLink}" style="display:inline-block;margin-top:12px;background:#45a5ff;color:#07111c;padding:13px 19px;text-decoration:none;font-weight:bold">Book your next chair</a><p style="color:#c2c5ce;line-height:1.7;margin-top:20px">Enjoyed the cut? <a href="${safeGoogleReviewLink}" style="color:#52a8ff;text-decoration:underline">Leave Jay a review on Google</a> — it helps other Hamilton guys find the chair.</p><p style="color:#777d89;font-size:12px;margin-top:28px">Precision cuts. Anytime convenience. · Hamilton, ON · @letsgetfaded</p></div></div>`;
  return sendReminderMessages({ phone: client.phone, email: client.email, sms, subject, html });
}

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadEnvironment } from "../config.mjs";
import { sendReminderMessages } from "./mailer.mjs";

await loadEnvironment();

const dataFile = fileURLToPath(new URL("../data/clients.json", import.meta.url));
const bookingLink = process.env.BOOKING_LINK || "https://letsgetfaded.ca/#book";

function todayInHamilton() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addUtcDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ISO date: ${isoDate}`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function reminderIsDue(client, today) {
  return Boolean(
    client.nextCutDueDate &&
      addUtcDays(client.nextCutDueDate, -3) === today &&
      client.reminderSentFor !== today,
  );
}

export function loyaltyMessage(totalCuts = 1) {
  const progress = Math.max(0, Math.min(6, Number(totalCuts) || 0));
  if (progress === 6) return "Your FREE 7th cut is unlocked!";
  const cutsAway = 6 - progress;
  return `You're ${cutsAway} cut${cutsAway === 1 ? "" : "s"} away from your FREE 7th cut!`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

export function createReminder(client, bookingUrl = bookingLink) {
  const name = client.name.split(/\s+/)[0];
  const emailName = escapeHtml(name);
  const emailBookingUrl = escapeHtml(bookingUrl);
  const loyalty = client.freeCutAvailable
    ? "Your FREE 7th cut is unlocked!"
    : loyaltyMessage(client.loyaltyStamps ?? client.totalCuts);
  return {
    sms: `Hey ${name}! Jay from Let's Get Faded. Your fresh cut is due in 3 days. Lock in your chair time here: ${bookingUrl}`,
    email: {
      subject: "Your next cut is coming up — stay sharp",
      html: `<div style="margin:0;background:#0b0c10;padding:36px 16px;font-family:Arial,sans-serif;color:#f5f6f8"><div style="max-width:540px;margin:auto;border:1px solid #30333b;border-radius:16px;padding:32px;background:#121419"><p style="color:#52a8ff;letter-spacing:3px;font-size:11px;font-weight:bold">LET'S GET FADED · HAMILTON</p><h1 style="font-size:26px;margin:20px 0 12px">Stay sharp, ${emailName}.</h1><p style="color:#c2c5ce;line-height:1.7">Jay here. Your next cut is due in 3 days. Grab a time before the good slots are gone.</p><p style="border-left:3px solid #ff7a2f;padding:10px 14px;color:#ffb181">${escapeHtml(loyalty)}</p><a href="${emailBookingUrl}" style="display:inline-block;margin-top:12px;background:#45a5ff;color:#07111c;padding:13px 19px;border-radius:8px;text-decoration:none;font-weight:bold">Book your chair</a><p style="color:#777d89;font-size:12px;margin-top:28px">Precision cuts. Anytime convenience. · Hamilton, ON</p></div></div>`,
    },
  };
}

export async function runReminders(today = todayInHamilton()) {
  const clients = JSON.parse(await readFile(dataFile, "utf8"));
  let remindersSent = 0;
  const failures = [];

  for (const client of clients) {
    if (!reminderIsDue(client, today)) continue;
    if (!client.phone || !client.email || !client.name) {
      throw new Error(`Client profile ${client.phoneDigits || "(unknown)"} is missing contact details.`);
    }
    const reminder = createReminder(client);
    const delivery = await sendReminderMessages({
      phone: client.phone,
      email: client.email,
      sms: reminder.sms,
      ...reminder.email,
    });
    if (delivery.error) {
      failures.push(`${client.phoneDigits || client.phone}: ${delivery.error}`);
      continue;
    }
    client.reminderSentFor = today;
    remindersSent += 1;
  }

  if (remindersSent > 0) await writeFile(dataFile, `${JSON.stringify(clients, null, 2)}\n`, "utf8");
  console.log(`Reminder run complete for ${today}. Sent ${remindersSent} reminder(s).`);
  if (failures.length) throw new Error(`Reminder delivery failed for ${failures.length} client(s): ${failures.join(" | ")}`);
  return remindersSent;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runReminders().catch((error) => {
    console.error("Reminder run failed:", error);
    process.exitCode = 1;
  });
}

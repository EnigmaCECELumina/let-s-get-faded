import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvironment } from "./config.mjs";
import { sendFollowUp } from "./scripts/mailer.mjs";
import { addUtcDays, runReminders, reminderIsDue } from "./scripts/reminders.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const sessionDurationMs = 8 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/manifest+json; charset=utf-8",
};
const publicFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/admin", "admin.html"],
  ["/admin/", "admin.html"],
  ["/admin.html", "admin.html"],
  ["/styles.css", "styles.css"],
  ["/app.js", "app.js"],
  ["/admin.css", "admin.css"],
  ["/admin.js", "admin.js"],
  ["/robots.txt", "public/robots.txt"],
  ["/sitemap.xml", "public/sitemap.xml"],
  ["/logo.jpg", "public/logo.jpg"],
  ["/public/logo.jpg", "public/logo.jpg"],
  ["/manifest.json", "public/manifest.json"],
  ["/admin-manifest.json", "public/admin-manifest.json"],
  ["/sw.js", "public/sw.js"],
  ["/main-sw.js", "public/main-sw.js"],
]);

await loadEnvironment();

const defaultDataFile = process.env.VERCEL
  ? resolve("/tmp/clients.json")
  : resolve(root, "data/clients.json");
const dataFile = resolve(process.env.CLIENT_DATA_FILE || defaultDataFile);
const port = Number(process.env.PORT || 3000);

async function readClients() {
  let content;
  try {
    content = await readFile(dataFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    try {
      content = await readFile(resolve(root, "data/clients.json"), "utf8");
    } catch {
      content = "[]";
    }
    await writeFile(dataFile, `${content.trim()}\n`, "utf8").catch(() => {});
  }
  const clients = JSON.parse(content);
  if (!Array.isArray(clients)) throw new Error("Client data must be a JSON array.");
  return clients;
}

async function writeClients(clients) {
  await writeFile(dataFile, `${JSON.stringify(clients, null, 2)}\n`, "utf8");
}

function sendJson(response, status, value, extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("Request body exceeds 1 MB.");
  }
  return JSON.parse(raw);
}

function todayInHamilton() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function currentTimeInHamilton() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

function getCookie(request, name) {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie?.slice(name.length + 1);
}

function getAdminSession(request) {
  const token = getCookie(request, "lgf_admin");
  if (!token) return null;
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return token;
}

function sameSecret(candidate, expected) {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cleanPreferences(preferences = {}) {
  return {
    guard: typeof preferences.guard === "string" ? preferences.guard.slice(0, 120) : "",
    fade: typeof preferences.fade === "string" ? preferences.fade.slice(0, 80) : "",
    beard: typeof preferences.beard === "string" ? preferences.beard.slice(0, 240) : "",
    notes: typeof preferences.notes === "string" ? preferences.notes.slice(0, 1000) : "",
    drink: typeof preferences.drink === "string" ? preferences.drink.slice(0, 80) : "",
    quiet: preferences.quiet === true,
  };
}

function bookingValidation(appointment, firstCut) {
  const allowedServices = new Set(["welcome", "buzz", "lineup", "specialty", "beard"]);
  if (!appointment || typeof appointment !== "object") return "Choose a service and appointment time.";
  const parsedDate = new Date(`${appointment.date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointment.date) ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== appointment.date) return "Choose a valid appointment date.";
  if (appointment.date < todayInHamilton()) return "Choose today or a future appointment date.";
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(appointment.time)) return "Choose a valid appointment time.";
  if (appointment.date === todayInHamilton() && appointment.time <= currentTimeInHamilton()) {
    return "Choose a time later than now.";
  }
  const hour = Number(appointment.time.slice(0, 2));
  const isVipTime = hour < 9 || hour >= 21;
  if ((appointment.bookingTime === "vip") !== isVipTime) {
    return "Regular slots are 9:00 AM–8:59 PM; VIP slots are 9:00 PM–8:59 AM.";
  }
  if (!allowedServices.has(appointment.service) || (!firstCut && appointment.service === "welcome")) {
    return "Choose an available service.";
  }
  return null;
}

function priceFor(appointment, firstCut) {
  const prices = { welcome: 0, buzz: 20, lineup: 25, specialty: 30, beard: 40 };
  return (firstCut ? 0 : prices[appointment.service]) + (appointment.bookingTime === "vip" ? 20 : 0);
}

function flattenAppointments(clients) {
  return clients.flatMap((client) =>
    (client.appointments || []).map((appointment, index) => ({
      ...appointment,
      id: appointment.id || `${client.phoneDigits}-${index}`,
      clientName: client.name,
      phone: client.phone,
      email: client.email,
      phoneDigits: client.phoneDigits,
      intervalWeeks: appointment.intervalWeeks || client.intervalWeeks || 2,
      preferences: appointment.preferences || client.preferences || {},
    })),
  );
}

function adminCookie(token, clear = false) {
  const parts = [
    `lgf_admin=${clear ? "" : token}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${clear ? 0 : sessionDurationMs / 1000}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const clientIp = request.socket.remoteAddress || "unknown";

    if (request.method === "GET" && url.pathname === "/book") {
      response.writeHead(302, { Location: "/#book", "Cache-Control": "no-store" });
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/login") {
      const attempts = loginAttempts.get(clientIp) || { count: 0, blockedUntil: 0 };
      if (attempts.blockedUntil > Date.now()) {
        sendJson(response, 429, { error: "Too many attempts. Wait 15 minutes and try again." });
        return;
      }
      const body = await readBody(request);
      const configuredPin = process.env.ADMIN_PIN;
      if (!configuredPin) {
        sendJson(response, 503, { error: "Admin access is not configured. Set ADMIN_PIN in the server environment." });
        return;
      }
      if (typeof body.pin !== "string" || !sameSecret(body.pin, configuredPin)) {
        attempts.count += 1;
        if (attempts.count >= 5) {
          attempts.count = 0;
          attempts.blockedUntil = Date.now() + 15 * 60 * 1000;
        }
        loginAttempts.set(clientIp, attempts);
        sendJson(response, 401, { error: "That PIN didn't match. Try again." });
        return;
      }
      loginAttempts.delete(clientIp);
      const token = randomBytes(32).toString("hex");
      sessions.set(token, Date.now() + sessionDurationMs);
      sendJson(response, 200, { authenticated: true }, { "Set-Cookie": adminCookie(token) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/session") {
      sendJson(response, 200, { authenticated: Boolean(getAdminSession(request)) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/logout") {
      const token = getCookie(request, "lgf_admin");
      if (token) sessions.delete(token);
      sendJson(response, 200, { authenticated: false }, { "Set-Cookie": adminCookie("", true) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/clients") {
      const incoming = await readBody(request);
      const required = ["name", "phone", "email"];
      if (required.some((field) => typeof incoming[field] !== "string" || !incoming[field].trim())) {
        sendJson(response, 400, { error: "Name, phone, and email are required." });
        return;
      }
      const phoneDigits = incoming.phone.replace(/\D/g, "");
      if (phoneDigits.length < 7) {
        sendJson(response, 400, { error: "Enter a valid phone number." });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(incoming.email)) {
        sendJson(response, 400, { error: "Enter a valid email address." });
        return;
      }

      const clients = await readClients();
      const existingIndex = clients.findIndex((client) => client.phoneDigits === phoneDigits);
      const existing = existingIndex < 0 ? null : clients[existingIndex];
      const hasPendingFirstCut = existing?.appointments?.some(
        (appointment) => appointment.status === "requested" && appointment.firstCut,
      );
      const isFirstCut = (!existing || (existing.completedCuts || 0) === 0) && !hasPendingFirstCut;
      const requestedAppointment = {
        ...incoming.appointment,
        bookingTime: incoming.appointment?.bookingTime === "vip" ? "vip" : "regular",
        preferences: cleanPreferences(incoming.appointment?.preferences || incoming.preferences),
      };
      const invalidBooking = bookingValidation(requestedAppointment, isFirstCut);
      if (invalidBooking) {
        sendJson(response, 400, { error: invalidBooking });
        return;
      }
      requestedAppointment.id = randomUUID();
      requestedAppointment.status = "requested";
      requestedAppointment.firstCut = isFirstCut;
      const hasReservedReward = existing?.appointments?.some(
        (appointment) => appointment.status === "requested" && appointment.loyaltyReward,
      );
      requestedAppointment.loyaltyReward = Boolean(
        !isFirstCut && existing?.freeCutAvailable && !hasReservedReward,
      );
      requestedAppointment.price = requestedAppointment.loyaltyReward
        ? (requestedAppointment.bookingTime === "vip" ? 20 : 0)
        : priceFor(requestedAppointment, isFirstCut);
      requestedAppointment.createdAt = new Date().toISOString();
      requestedAppointment.intervalWeeks = Math.max(1, Math.min(4, Number(incoming.intervalWeeks) || 2));
      const profile = {
        ...existing,
        name: incoming.name.trim().slice(0, 120),
        phone: incoming.phone.trim().slice(0, 40),
        phoneDigits,
        email: incoming.email.trim().slice(0, 254),
        firstCut: isFirstCut,
        service: requestedAppointment.service,
        serviceName: incoming.serviceName,
        intervalWeeks: requestedAppointment.intervalWeeks,
        nextCutDueDate: existing?.nextCutDueDate || null,
        totalCuts: existing?.totalCuts ?? 0,
        completedCuts: existing?.completedCuts ?? 0,
        loyaltyStamps: existing?.loyaltyStamps ?? 0,
        freeCutAvailable: existing?.freeCutAvailable ?? false,
        appointment: requestedAppointment,
        preferences: requestedAppointment.preferences,
        appointments: [...(existing?.appointments || []), requestedAppointment],
        updatedAt: new Date().toISOString(),
      };
      if (existingIndex < 0) clients.push(profile);
      else clients[existingIndex] = profile;
      await writeClients(clients);
      sendJson(response, 201, { profile, appointment: requestedAppointment });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/admin/")) {
      if (!getAdminSession(request)) {
        sendJson(response, 401, { error: "Admin sign-in required." });
        return;
      }

      if (url.pathname === "/api/admin/appointments") {
        const date = url.searchParams.get("date") || todayInHamilton();
        const appointments = flattenAppointments(await readClients())
          .filter((appointment) => appointment.date === date && appointment.status !== "cancelled")
          .sort((left, right) => left.time.localeCompare(right.time));
        sendJson(response, 200, { date, appointments });
        return;
      }

      if (url.pathname === "/api/admin/clients") {
        const query = (url.searchParams.get("q") || "").trim().toLocaleLowerCase();
        const clients = await readClients();
        const results = clients
          .filter((client) => !query ||
            client.name.toLocaleLowerCase().includes(query) ||
            (query.replace(/\D/g, "") && client.phoneDigits.includes(query.replace(/\D/g, ""))) ||
            client.email.toLocaleLowerCase().includes(query))
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((client) => ({
            name: client.name,
            phone: client.phone,
            phoneDigits: client.phoneDigits,
            email: client.email,
            totalCuts: client.totalCuts || 0,
            loyaltyStamps: client.loyaltyStamps || 0,
            freeCutAvailable: client.freeCutAvailable === true,
            intervalWeeks: client.intervalWeeks || 2,
            nextCutDueDate: client.nextCutDueDate,
            appointments: client.appointments || [],
            preferences: client.preferences || {},
          }));
        sendJson(response, 200, { clients: results });
        return;
      }

      if (url.pathname === "/api/admin/reminders/due") {
        const today = todayInHamilton();
        const clients = await readClients();
        const due = clients.filter((client) => reminderIsDue(client, today));
        sendJson(response, 200, { today, count: due.length, clients: due });
        return;
      }
    }

    if (request.method === "POST" && url.pathname === "/api/admin/reminders/run") {
      if (!getAdminSession(request)) {
        sendJson(response, 401, { error: "Admin sign-in required." });
        return;
      }
      const count = await runReminders(todayInHamilton());
      sendJson(response, 200, { success: true, count, date: todayInHamilton() });
      return;
    }

    // Direct client cut completion by phone (for walk-ins / manual entry)
    const clientCompleteMatch = url.pathname.match(/^\/api\/admin\/clients\/([0-9+() -]+)\/complete$/i);
    if (request.method === "POST" && clientCompleteMatch) {
      if (!getAdminSession(request)) {
        sendJson(response, 401, { error: "Admin sign-in required." });
        return;
      }
      const rawPhone = decodeURIComponent(clientCompleteMatch[1]);
      const searchDigits = rawPhone.replace(/\D/g, "");
      const clients = await readClients();
      const target = clients.find((c) => c.phoneDigits === searchDigits || c.phone.replace(/\D/g, "") === searchDigits);
      if (!target) {
        sendJson(response, 404, { error: "Client profile not found." });
        return;
      }
      const completedAt = new Date();
      const interval = target.intervalWeeks || 2;
      const dueDate = new Date(completedAt);
      dueDate.setDate(dueDate.getDate() + interval * 7);
      const dueDateIso = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Toronto",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(dueDate);

      target.totalCuts = (target.totalCuts || 0) + 1;
      target.completedCuts = (target.completedCuts || 0) + 1;
      if (target.freeCutAvailable) {
        target.freeCutAvailable = false;
        target.loyaltyStamps = 0;
      } else {
        target.loyaltyStamps = Math.min(6, (target.loyaltyStamps || 0) + 1);
        if (target.loyaltyStamps === 6) target.freeCutAvailable = true;
      }
      target.nextCutDueDate = addUtcDays(dueDateIso, 0);
      target.reminderSentFor = null;
      target.updatedAt = completedAt.toISOString();
      await writeClients(clients);

      const delivery = await sendFollowUp(target).catch((error) => {
        console.error(`Follow-up delivery failed for ${target.phoneDigits}:`, error);
        return { sms: "failed", email: "failed", error: error.message };
      });
      sendJson(response, 200, {
        client: {
          name: target.name,
          phone: target.phone,
          totalCuts: target.totalCuts,
          loyaltyStamps: target.loyaltyStamps,
          freeCutAvailable: target.freeCutAvailable,
          cutsUntilFree: target.freeCutAvailable ? 0 : 6 - target.loyaltyStamps,
          nextCutDueDate: target.nextCutDueDate,
        },
        delivery,
      });
      return;
    }

    const completeMatch = url.pathname.match(/^\/api\/admin\/appointments\/([0-9a-f-]+)\/complete$/i);
    if (request.method === "POST" && completeMatch) {
      if (!getAdminSession(request)) {
        sendJson(response, 401, { error: "Admin sign-in required." });
        return;
      }
      const clients = await readClients();
      let target;
      for (const client of clients) {
        const appointment = (client.appointments || []).find((entry) => entry.id === completeMatch[1]);
        if (appointment) {
          target = { client, appointment };
          break;
        }
      }
      if (!target) {
        sendJson(response, 404, { error: "Appointment not found." });
        return;
      }
      if (target.appointment.status === "completed") {
        sendJson(response, 409, { error: "This appointment is already completed." });
        return;
      }

      const completedAt = new Date();
      const interval = target.appointment.intervalWeeks || target.client.intervalWeeks || 2;
      const dueDate = new Date(completedAt);
      dueDate.setDate(dueDate.getDate() + interval * 7);
      const dueDateIso = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Toronto",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(dueDate);
      target.appointment.status = "completed";
      target.appointment.completedAt = completedAt.toISOString();
      target.client.totalCuts = (target.client.totalCuts || 0) + 1;
      target.client.completedCuts = (target.client.completedCuts || 0) + 1;
      if (target.appointment.loyaltyReward) {
        target.client.freeCutAvailable = false;
        target.client.loyaltyStamps = 0;
      } else {
        target.client.loyaltyStamps = Math.min(6, (target.client.loyaltyStamps || 0) + 1);
        if (target.client.loyaltyStamps === 6) target.client.freeCutAvailable = true;
      }
      target.client.nextCutDueDate = addUtcDays(dueDateIso, 0);
      target.client.reminderSentFor = null;
      target.client.updatedAt = completedAt.toISOString();
      await writeClients(clients);

      const delivery = await sendFollowUp(target.client).catch((error) => {
        console.error(`Follow-up delivery failed for ${target.client.phoneDigits}:`, error);
        return { sms: "failed", email: "failed", error: error.message };
      });
      sendJson(response, 200, {
        appointment: target.appointment,
        client: {
          name: target.client.name,
          phone: target.client.phone,
          totalCuts: target.client.totalCuts,
          loyaltyStamps: target.client.loyaltyStamps,
          freeCutAvailable: target.client.freeCutAvailable,
          cutsUntilFree: target.client.freeCutAvailable ? 0 : 6 - target.client.loyaltyStamps,
          nextCutDueDate: target.client.nextCutDueDate,
        },
        delivery,
      });
      return;
    }

    if (request.method !== "GET" || url.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    const publicFile = publicFiles.get(url.pathname);
    let resolvedPath = null;
    if (publicFile) {
      resolvedPath = resolve(root, publicFile);
    } else if (url.pathname.startsWith("/images/") || url.pathname.startsWith("/public/images/")) {
      const cleanRelative = url.pathname.replace(/^\/public\//, "").replace(/^\/images\//, "images/");
      resolvedPath = resolve(root, "public", cleanRelative);
      const publicDir = resolve(root, "public");
      if (!resolvedPath.startsWith(publicDir)) {
        sendJson(response, 403, { error: "Forbidden" });
        return;
      }
    }

    if (!resolvedPath) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    const contents = await readFile(resolvedPath);
    const extension = extname(resolvedPath);
    const contentType = mimeTypes[extension] || "application/octet-stream";

    const headers = {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    };

    // Service Worker and Manifest need specific headers
    if (url.pathname === "/sw.js" || url.pathname === "/main-sw.js") {
      headers["Service-Worker-Allowed"] = "/";
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    } else if (url.pathname === "/manifest.json" || url.pathname === "/admin-manifest.json") {
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    } else if (resolvedPath.endsWith("index.html") || resolvedPath.endsWith("admin.html")) {
      headers["Cache-Control"] = "no-cache";
    } else {
      headers["Cache-Control"] = "public, max-age=86400";
    }

    response.writeHead(200, headers);
    response.end(contents);
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendJson(response, 400, { error: "Request body must be valid JSON." });
    } else if (error.code === "ENOENT") {
      sendJson(response, 404, { error: "Not found." });
    } else {
      console.error("Request failed:", error);
      sendJson(response, 500, { error: "Unexpected server error." });
    }
  }
});

// Periodic background check for automated 2-3 week reminders
setInterval(() => {
  runReminders().catch((error) => console.error("Background automated reminder error:", error));
}, 12 * 60 * 60 * 1000);

server.listen(port, "0.0.0.0", () => {
  console.log(`Let's Get Faded is ready at http://localhost:${port}`);
});

export default server;

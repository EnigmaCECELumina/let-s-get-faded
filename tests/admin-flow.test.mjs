import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const tempDirectory = await mkdtemp(join(tmpdir(), "lgf-admin-flow-"));
const clientFile = join(tempDirectory, "clients.json");
const portServer = createTcpServer();
portServer.listen(0, "127.0.0.1");
await once(portServer, "listening");
const port = portServer.address().port;
await new Promise((resolveClose, reject) => portServer.close((error) => error ? reject(error) : resolveClose()));
const baseUrl = `http://127.0.0.1:${port}`;
const serverProcess = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    ADMIN_PIN: "123456",
    CLIENT_DATA_FILE: clientFile,
    TWILIO_ACCOUNT_SID: "",
    TWILIO_AUTH_TOKEN: "",
    TWILIO_FROM_NUMBER: "",
    RESEND_API_KEY: "",
    RESEND_FROM_EMAIL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let cookie = "";
let stdout = "";
let stderr = "";
serverProcess.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
serverProcess.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const body = await response.json();
  return { response, body };
}

function localTomorrow() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(tomorrow);
}

function booking({ service, time, firstCut = false, hour }) {
  const serviceNames = {
    welcome: "First-Timer Welcome Cut",
    buzz: "Buzz / One-Size Cut",
    lineup: "Haircut + Precision Lineup",
    specialty: "Specialty Cut",
    beard: "Cut + Full Beard Sculpt",
  };
  return {
    name: "Taylor Integration",
    phone: "9055550177",
    email: "taylor-integration@example.com",
    firstCut,
    service,
    serviceName: serviceNames[service],
    intervalWeeks: 1,
    appointment: {
      service,
      serviceName: serviceNames[service],
      date: localTomorrow(),
      time: `${String(hour).padStart(2, "0")}:00`,
      bookingTime: time,
      intervalWeeks: 1,
      preferences: {
        guard: "#1",
        fade: "Low fade",
        notes: "Sensitive scalp",
        drink: "Coke Zero",
        quiet: true,
      },
    },
  };
}

before(async () => {
  await writeFile(clientFile, "[]\n", "utf8");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Test server exited unexpectedly.\n${stdout}\n${stderr}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Test server did not start.\n${stdout}\n${stderr}`);
});

after(async () => {
  serverProcess.kill();
  if (serverProcess.exitCode === null) await once(serverProcess, "exit");
  await rm(tempDirectory, { recursive: true, force: true });
});

test("protects admin data and confirms SEO and admin routes", async () => {
  const unauthorized = await request("/api/admin/appointments");
  assert.equal(unauthorized.response.status, 401);
  const adminPage = await fetch(`${baseUrl}/admin`);
  assert.equal(adminPage.status, 200);
  const adminHtml = await adminPage.text();
  assert.match(adminHtml, /JAY'S PRIVATE DASHBOARD/);
  const publicPage = await fetch(`${baseUrl}/`);
  const publicHtml = await publicPage.text();
  const schemaMatch = publicHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(schemaMatch, "homepage should expose LocalBusiness JSON-LD");
  assert.ok(JSON.parse(schemaMatch[1])["@type"].includes("BarberShop"));
  for (const assetPath of ["/manifest.json", "/admin-manifest.json", "/main-sw.js", "/sw.js"]) {
    const asset = await fetch(`${baseUrl}${assetPath}`);
    assert.equal(asset.status, 200, `${assetPath} should be available`);
  }
  const robots = await fetch(`${baseUrl}/robots.txt`);
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /Disallow: \/admin/);
  const sitemap = await fetch(`${baseUrl}/sitemap.xml`);
  assert.equal(sitemap.status, 200);
  assert.match(await sitemap.text(), /https:\/\/letsgetfaded\.ca\/#book/);
  const bookingRoute = await fetch(`${baseUrl}/book`, { redirect: "manual" });
  assert.equal(bookingRoute.status, 302);
  assert.equal(bookingRoute.headers.get("location"), "/#book");
  const protectedFiles = await fetch(`${baseUrl}/data/clients.json`);
  assert.equal(protectedFiles.status, 404);
});

test("books, completes, earns and reserves the seventh-cut reward", async () => {
  const first = await request("/api/clients", {
    method: "POST",
    body: JSON.stringify(booking({ service: "welcome", time: "regular", firstCut: true, hour: 10 })),
  });
  assert.equal(first.response.status, 201);
  assert.equal(first.body.appointment.price, 0);
  assert.equal(first.body.appointment.firstCut, true);
  const firstId = first.body.appointment.id;

  const duplicatePromo = await request("/api/clients", {
    method: "POST",
    body: JSON.stringify(booking({ service: "lineup", time: "regular", hour: 11 })),
  });
  assert.equal(duplicatePromo.response.status, 201);
  assert.equal(duplicatePromo.body.appointment.price, 25);
  assert.equal(duplicatePromo.body.appointment.firstCut, false);

  const invalidDate = await request("/api/clients", {
    method: "POST",
    body: JSON.stringify({
      ...booking({ service: "lineup", time: "regular", hour: 12 }),
      appointment: { ...booking({ service: "lineup", time: "regular", hour: 12 }).appointment, date: "2026-02-31" },
    }),
  });
  assert.equal(invalidDate.response.status, 400);

  const login = await request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ pin: "123456" }),
  });
  assert.equal(login.response.status, 200);
  cookie = login.response.headers.get("set-cookie").split(";")[0];

  const schedule = await request(`/api/admin/appointments?date=${localTomorrow()}`);
  assert.equal(schedule.response.status, 200);
  assert.equal(schedule.body.appointments.length, 2);
  assert.equal(schedule.body.appointments[0].preferences.drink, "Coke Zero");

  const firstComplete = await request(`/api/admin/appointments/${firstId}/complete`, {
    method: "POST",
    body: "{}",
  });
  assert.equal(firstComplete.response.status, 200);
  assert.equal(firstComplete.body.client.totalCuts, 1);
  assert.equal(firstComplete.body.client.loyaltyStamps, 1);
  assert.equal(firstComplete.body.delivery.sms, "mock");
  assert.match(stdout, /Twilio mock/);
  assert.match(stdout, /Resend mock/);

  const duplicateComplete = await request(`/api/admin/appointments/${firstId}/complete`, {
    method: "POST",
    body: "{}",
  });
  assert.equal(duplicateComplete.response.status, 409);

  const currentAppointments = (await readFile(clientFile, "utf8")).trim();
  const profile = JSON.parse(currentAppointments)[0];
  const remainingAppointment = profile.appointments[1];
  const secondComplete = await request(`/api/admin/appointments/${remainingAppointment.id}/complete`, {
    method: "POST",
    body: "{}",
  });
  assert.equal(secondComplete.body.client.loyaltyStamps, 2);

  for (let index = 0; index < 4; index += 1) {
    const nextBooking = await request("/api/clients", {
      method: "POST",
      body: JSON.stringify(booking({ service: "lineup", time: "regular", hour: 12 + index })),
    });
    assert.equal(nextBooking.response.status, 201);
    const completion = await request(`/api/admin/appointments/${nextBooking.body.appointment.id}/complete`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(completion.response.status, 200);
  }

  const clientSearch = await request("/api/admin/clients?q=Taylor");
  assert.equal(clientSearch.body.clients[0].freeCutAvailable, true);
  assert.equal(clientSearch.body.clients[0].loyaltyStamps, 6);

  const rewardBooking = await request("/api/clients", {
    method: "POST",
    body: JSON.stringify(booking({ service: "beard", time: "regular", hour: 17 })),
  });
  assert.equal(rewardBooking.body.appointment.price, 0);
  assert.equal(rewardBooking.body.appointment.loyaltyReward, true);

  const paidBookingWhileRewardReserved = await request("/api/clients", {
    method: "POST",
    body: JSON.stringify(booking({ service: "beard", time: "regular", hour: 18 })),
  });
  assert.equal(paidBookingWhileRewardReserved.body.appointment.price, 40);
  assert.equal(paidBookingWhileRewardReserved.body.appointment.loyaltyReward, false);

  const rewardComplete = await request(`/api/admin/appointments/${rewardBooking.body.appointment.id}/complete`, {
    method: "POST",
    body: "{}",
  });
  assert.equal(rewardComplete.body.client.freeCutAvailable, false);
  assert.equal(rewardComplete.body.client.loyaltyStamps, 0);
});

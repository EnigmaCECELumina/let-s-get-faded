const loginView = document.querySelector("#login-view");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector("#login-form");
const loginStatus = document.querySelector("#login-status");
const dateField = document.querySelector("#schedule-date");
const scheduleList = document.querySelector("#schedule-list");
const scheduleEmpty = document.querySelector("#schedule-empty");
const clientSearch = document.querySelector("#client-search");
const clientResults = document.querySelector("#client-results");
const clientDetail = document.querySelector("#client-detail");
const toast = document.querySelector("#admin-toast");
const logoutButton = document.querySelector("#logout-button");
let toastTimer;
let searchTimer;

function localToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    credentials: "same-origin",
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.endsWith("/login")) showLogin();
    throw new Error(result.error || "The request could not be completed.");
  }
  return result;
}

function showLogin() {
  dashboard.hidden = true;
  loginView.hidden = false;
  logoutButton.hidden = true;
  document.querySelector("#admin-pin").focus();
}

function showDashboard() {
  loginView.hidden = true;
  dashboard.hidden = false;
  logoutButton.hidden = false;
  dateField.value ||= localToday();
  loadSchedule();
  loadClients("");
}

function notify(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 5200);
}

function formatTime(time) {
  if (!time) return "TIME TBD";
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

function servicePrice(appointment) {
  return Number.isFinite(Number(appointment.price)) ? Number(appointment.price) : 0;
}

function appointmentTags(appointment) {
  const preferences = appointment.preferences || {};
  const tags = [];
  if (appointment.firstCut || appointment.service === "welcome") tags.push(["⚡ First Cut", "accent-orange"]);
  if (appointment.bookingTime === "vip") tags.push(["✳ After-hours VIP", "accent-orange"]);
  if (appointment.loyaltyReward) tags.push(["✳ Free 7th cut", "accent-orange"]);
  if (preferences.drink) tags.push([`🥤 ${preferences.drink}`, ""]);
  if (preferences.quiet) tags.push(["🤫 Quiet cut", ""]);
  const haircut = [preferences.guard, preferences.fade].filter(Boolean).join(" · ");
  if (haircut) tags.push([`💈 ${haircut}`, "accent-blue"]);
  if (preferences.notes) tags.push(["✎ Has notes", "accent-blue"]);
  if (preferences.beard) tags.push(["Beard details", ""]);
  return tags.map(([label, color]) =>
    `<span class="preference-tag ${color}">${escapeHtml(label)}</span>`,
  ).join("");
}

function appointmentCard(appointment) {
  const completed = appointment.status === "completed";
  const preferences = appointment.preferences || {};
  const note = [preferences.notes, preferences.beard && `Beard: ${preferences.beard}`]
    .filter(Boolean).join(" · ");
  return `<article class="appointment-card">
    <div class="appointment-time">${escapeHtml(formatTime(appointment.time))}</div>
    <div class="appointment-main">
      <div class="appointment-client"><button type="button" data-client-phone="${escapeHtml(appointment.phoneDigits)}">${escapeHtml(appointment.clientName)}</button>${appointment.bookingTime === "vip" ? '<span class="appointment-status">VIP</span>' : ""}</div>
      <p class="appointment-service">${escapeHtml(appointment.serviceName || appointment.service || "Haircut")}${appointment.loyaltyReward ? " · Reward cut" : ""}</p>
      <p class="appointment-meta">${escapeHtml(appointment.phone)}${note ? ` · ${escapeHtml(note)}` : ""}</p>
      <div class="appointment-tags">${appointmentTags(appointment)}</div>
    </div>
    <div class="appointment-footer"><span class="appointment-price">${servicePrice(appointment) === 0 ? "FREE" : `$${servicePrice(appointment)}`}</span>${completed
      ? '<span class="appointment-status">COMPLETED</span>'
      : `<button class="complete-button" type="button" data-complete="${escapeHtml(appointment.id)}">Mark completed ✓</button>`}</div>
  </article>`;
}

async function loadSchedule() {
  try {
    const { appointments } = await api(`/api/admin/appointments?date=${encodeURIComponent(dateField.value)}`);
    scheduleList.innerHTML = appointments.map(appointmentCard).join("");
    scheduleEmpty.hidden = appointments.length > 0;
    document.querySelector("#appointment-count").textContent = appointments.length;
    const next = appointments.find((appointment) => appointment.status !== "completed");
    document.querySelector("#next-appointment").textContent = next ? formatTime(next.time) : "—";
    document.querySelector("#next-client").textContent = next ? next.clientName : "No upcoming chair";
  } catch (error) {
    notify(error.message, true);
  }
}

async function completeAppointment(id, button) {
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const result = await api(`/api/admin/appointments/${encodeURIComponent(id)}/complete`, {
      method: "POST",
      body: "{}",
    });
    const delivery = result.delivery;
    const deliveryMessage = delivery.error
      ? `The cut is logged, but a follow-up failed: ${delivery.error}`
      : `Follow-up SMS: ${delivery.sms}. Email: ${delivery.email}.`;
    const rewardMessage = result.client.freeCutAvailable
      ? " Six stamps earned—the next cut is free!"
      : result.client.cutsUntilFree === 0
        ? " The free seventh cut has been redeemed."
        : ` ${result.client.cutsUntilFree} cut${result.client.cutsUntilFree === 1 ? "" : "s"} to the free seventh.`;
    notify(`Cut completed for ${result.client.name}.${rewardMessage} ${deliveryMessage}`, Boolean(delivery.error));
    await Promise.all([loadSchedule(), clientSearch.value ? loadClients(clientSearch.value) : Promise.resolve()]);
  } catch (error) {
    button.disabled = false;
    button.textContent = "Mark completed ✓";
    notify(error.message, true);
  }
}

async function loadClients(query) {
  try {
    const { clients } = await api(`/api/admin/clients?q=${encodeURIComponent(query)}`);
    const visibleClients = query ? clients : clients.slice(0, 8);
    clientResults.innerHTML = visibleClients.map((client) => `
      <article class="client-row">
        <button class="client-row-name" type="button" data-open-client="${escapeHtml(client.phone)}">${escapeHtml(client.name)}</button>
        <span class="client-row-meta">${client.totalCuts || 0} completed cuts · ${escapeHtml(client.phone)}</span>
      </article>`).join("");
  } catch (error) {
    notify(error.message, true);
  }
}

async function showClient(phone) {
  try {
    const query = phone.replace(/\D/g, "");
    const { clients } = await api(`/api/admin/clients?q=${encodeURIComponent(query)}`);
    const client = clients.find((entry) => entry.phone.replace(/\D/g, "") === query);
    if (!client) throw new Error("Client profile not found.");
    const progress = client.freeCutAvailable ? 6 : Math.min(6, client.loyaltyStamps || 0);
    const lastAppointments = [...client.appointments].reverse().slice(0, 5);
    const preferences = client.preferences || {};
    clientDetail.innerHTML = `
      <div class="client-detail-head"><div><h3>${escapeHtml(client.name)}</h3><p class="client-detail-contact">${escapeHtml(client.phone)}<br />${escapeHtml(client.email)}</p></div><span class="loyalty-pill">${client.freeCutAvailable ? "FREE CUT READY" : `${progress} / 6 STAMPS`}</span></div>
      <p class="client-detail-label">CUT NOTES & PREFERENCES</p>
      <p class="client-notes">${escapeHtml([
        preferences.guard && `Guard: ${preferences.guard}`,
        preferences.fade && `Fade: ${preferences.fade}`,
        preferences.beard && `Beard: ${preferences.beard}`,
        preferences.drink && `Drink: ${preferences.drink}`,
        preferences.quiet && "Quiet cut requested",
        preferences.notes,
      ].filter(Boolean).join("\n") || "No saved haircut notes yet.")}</p>
      <p class="client-detail-label">RECENT CUTS & BOOKINGS</p>
      <div class="client-history">${lastAppointments.map((appointment) =>
        `<span>${escapeHtml(appointment.date || "Date TBD")} · ${escapeHtml(appointment.serviceName || appointment.service || "Cut")} · ${escapeHtml(appointment.status || "requested")}</span>`,
      ).join("") || "<span>No appointment history yet.</span>"}</div>`;
    clientDetail.hidden = false;
  } catch (error) {
    notify(error.message, true);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginStatus.textContent = "";
  const button = loginForm.querySelector("button");
  button.disabled = true;
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ pin: loginForm.elements.pin.value }),
    });
    loginForm.reset();
    showDashboard();
  } catch (error) {
    loginStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await api("/api/admin/logout", { method: "POST", body: "{}" });
  } finally {
    showLogin();
  }
});

dateField.addEventListener("change", loadSchedule);
document.querySelector("#refresh-button").addEventListener("click", loadSchedule);
scheduleList.addEventListener("click", (event) => {
  const completeButton = event.target.closest("[data-complete]");
  if (completeButton) completeAppointment(completeButton.dataset.complete, completeButton);
  const clientButton = event.target.closest("[data-client-phone]");
  if (clientButton) showClient(clientButton.dataset.clientPhone);
});
clientResults.addEventListener("click", (event) => {
  const clientButton = event.target.closest("[data-open-client]");
  if (clientButton) showClient(clientButton.dataset.openClient);
});
clientSearch.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadClients(clientSearch.value.trim()), 200);
  if (!clientSearch.value.trim()) clientDetail.hidden = true;
});

dateField.value = localToday();
api("/api/admin/session").then(({ authenticated }) => {
  if (authenticated) showDashboard();
  else showLogin();
}).catch(() => showLogin());

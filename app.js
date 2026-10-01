const STORAGE_KEY = "lets-get-faded-client";
const servicePrices = { welcome: 0, buzz: 20, lineup: 25, specialty: 30, beard: 40 };
const serviceNames = {
  welcome: "Welcome Cut + Lineup (100% Free)",
  buzz: "The Quick Buzz (One-Size, No Lineup) — $20",
  lineup: "Signature Cut + Precision Lineup — $25",
  specialty: "Specialty Fade / Taper (Skin, Burst, Taper) — $30",
  beard: "The Full Work (Haircut + Beard Sculpt & Razor Finish) — $40",
};
const form = document.querySelector("#booking-form");
const status = document.querySelector("#form-status");
const priceValue = document.querySelector("#price-value");
const priceNote = document.querySelector("#price-note");
const pricePreview = document.querySelector(".price-preview");
const stampGrid = document.querySelector("#stamp-grid");
const loyaltyAction = document.querySelector("#loyalty-action");
let clientProfile = readStoredProfile();

function readStoredProfile() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error("Could not read the saved client profile.", error);
    return null;
  }
}

function persistProfile(profile) {
  clientProfile = profile;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch (error) {
    console.error("Could not save the client profile on this device.", error);
    setStatus("Your booking was received, but this browser could not save your profile. Please keep your confirmation.", true);
  }
  renderLoyalty();
}

function setStatus(message, isError = false) {
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-error", isError);
  status.classList.toggle("is-visible", Boolean(message));
}

function formatPrice(amount) {
  return amount === 0 ? "FREE" : `$${amount}`;
}

function calculatePrice() {
  if (!form) return;
  const firstCut = form.elements.firstCut ? form.elements.firstCut.checked : false;
  if (firstCut) {
    form.elements.service.value = "welcome";
  } else if (form.elements.service.value === "welcome") {
    form.elements.service.value = "lineup";
  }
  const service = firstCut ? "welcome" : form.elements.service.value;
  const basePrice = servicePrices[service] ?? 25;
  const afterHours = form.elements.time.value === "vip";
  const rewardReserved = clientProfile?.appointments?.some(
    (appointment) => appointment.status === "requested" && appointment.loyaltyReward,
  );
  const loyaltyReward = !firstCut && clientProfile?.freeCutAvailable && !rewardReserved;
  const total = (firstCut || loyaltyReward ? 0 : basePrice) + (afterHours ? 20 : 0);
  if (priceValue) priceValue.textContent = formatPrice(total);
  if (priceNote) {
    priceNote.textContent = firstCut
      ? afterHours
        ? "First cut is free · $20 Late Night VIP surcharge applies."
        : "Your first welcome cut is 100% on Jay."
      : loyaltyReward
        ? afterHours
          ? "Your free 7th cut is reserved · $20 Late Night VIP surcharge applies."
          : "Your free 7th cut is 100% on Jay."
      : afterHours
        ? `${formatPrice(basePrice)} service + $20 Late Night VIP surcharge.`
        : `${serviceNames[service] || "Precision service"} · CAD.`;
  }
  if (pricePreview) pricePreview.classList.toggle("is-vip", afterHours);
  if (form.elements.service) form.elements.service.disabled = firstCut;
}

function renderLoyalty() {
  if (!stampGrid) return;
  const progress = Math.max(0, Math.min(6, Number(clientProfile?.loyaltyStamps) || 0));
  const unlocked = Boolean(clientProfile?.freeCutAvailable);
  stampGrid.replaceChildren();
  for (let index = 1; index <= 7; index += 1) {
    const stamp = document.createElement("div");
    stamp.className = "stamp";
    if (index === 7) {
      stamp.classList.add("stamp-reward");
      if (unlocked) stamp.classList.add("is-unlocked");
      stamp.innerHTML = '<span class="stamp-free-star">⚡</span><span>FREE<br />7TH CUT</span>';
    } else {
      const filled = index <= progress;
      stamp.classList.toggle("is-filled", filled);
      stamp.innerHTML = filled
        ? '<span class="stamp-check" aria-label="Cut completed">✓</span>'
        : `<span class="stamp-number">0${index}</span>`;
    }
    stampGrid.append(stamp);
  }
  stampGrid.setAttribute(
    "aria-label",
    unlocked
      ? "Loyalty card: free seventh cut unlocked"
      : `Loyalty card: ${progress} of 6 cuts toward a free seventh cut`,
  );
  const cutCount = document.querySelector("#cut-count");
  const cutsRem = document.querySelector("#cuts-remaining");
  const loyaltyHeadline = document.querySelector("#loyalty-headline");
  const loyaltySubtitle = document.querySelector("#loyalty-subtitle");
  const hint = document.querySelector("#loyalty-profile-hint");

  if (cutCount) cutCount.textContent = clientProfile?.totalCuts || 0;
  if (cutsRem) cutsRem.textContent = unlocked ? "FREE" : 6 - progress;
  if (loyaltyHeadline) {
    loyaltyHeadline.innerHTML = unlocked
      ? "Your 7th cut<br /><span>is on Jay.</span>"
      : "Buy 6 cuts,<br /><span>7th is on Jay.</span>";
  }
  if (loyaltySubtitle) {
    loyaltySubtitle.textContent = unlocked
      ? "You've earned your free 7th cut! Lock in your chair with Jay whenever you're ready."
      : "No paper cards to lose in your laundry. Your phone number tracks your cuts automatically.";
  }
  if (hint) {
    hint.textContent = clientProfile
      ? `DIGITAL CARD · ${(clientProfile.name || "YOUR PROFILE").toUpperCase()} (${clientProfile.phone || ""})`
      : "Book your first chair to start your automated digital loyalty card.";
  }
  if (loyaltyAction) loyaltyAction.hidden = true;
}

if (form) {
  form.addEventListener("input", calculatePrice);
  form.addEventListener("change", calculatePrice);
  const appointmentDateField = form.elements.appointmentDate;
  const todayInHamilton = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (appointmentDateField) {
    appointmentDateField.min = todayInHamilton;
    appointmentDateField.value = todayInHamilton;
  }
  if (
    clientProfile?.completedCuts > 0 ||
    clientProfile?.appointments?.some((appointment) => appointment.status === "requested" && appointment.firstCut)
  ) {
    if (form.elements.firstCut) form.elements.firstCut.checked = false;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("");
    const data = new FormData(form);
    const firstCut = form.elements.firstCut ? form.elements.firstCut.checked : false;
    const hasReservedReward = clientProfile?.appointments?.some(
      (entry) => entry.status === "requested" && entry.loyaltyReward,
    );
    const loyaltyReward = !firstCut && clientProfile?.freeCutAvailable && !hasReservedReward;
    const service = firstCut ? "welcome" : String(data.get("service"));
    const intervalWeeks = Number(data.get("interval")) || 2;
    const appointment = {
      date: String(data.get("appointmentDate")),
      time: String(data.get("appointmentTime")),
      service,
      serviceName: serviceNames[service] || service,
      bookingTime: data.get("time") === "vip" ? "vip" : "regular",
      price: (firstCut || loyaltyReward ? 0 : servicePrices[service] ?? 25) + (data.get("time") === "vip" ? 20 : 0),
      firstCut,
      intervalWeeks,
      preferences: {
        guard: String(data.get("guard") || "").trim(),
        fade: String(data.get("fade") || ""),
        beard: String(data.get("beard") || "").trim(),
        notes: String(data.get("notes") || "").trim(),
        drink: String(data.get("drink") || ""),
        quiet: data.get("quiet") === "yes",
      },
    };
    const phone = String(data.get("phone") || "").trim();
    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length < 7) {
      setStatus("Please enter a valid phone number so Jay can text your chair confirmation.", true);
      form.elements.phone.focus();
      return;
    }
    const existing = clientProfile?.phoneDigits === phoneDigits ? clientProfile : null;
    const profile = {
      ...existing,
      name: String(data.get("name") || "").trim(),
      phone,
      phoneDigits,
      email: String(data.get("email") || "").trim(),
      firstCut,
      service,
      serviceName: serviceNames[service] || service,
      bookingTime: appointment.bookingTime,
      intervalWeeks,
      nextCutDueDate: existing?.nextCutDueDate || null,
      totalCuts: existing?.totalCuts ?? 0,
      completedCuts: existing?.completedCuts ?? 0,
      loyaltyStamps: existing?.loyaltyStamps ?? 0,
      freeCutAvailable: existing?.freeCutAvailable ?? false,
      appointment,
      preferences: appointment.preferences,
      appointments: [...(existing?.appointments || []), appointment],
      updatedAt: new Date().toISOString(),
    };
    try {
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The booking could not be synced.");
      persistProfile(result.profile);
      const savedAppointment = result.appointment;
      const savedDate = new Date(`${savedAppointment.date}T12:00:00`);
      setStatus(`Booking request received, ${profile.name.split(/\s+/)[0]}! ${formatPrice(savedAppointment.price)}${savedAppointment.bookingTime === "vip" ? " VIP" : ""} · ${savedDate.toLocaleDateString("en-CA", { month: "long", day: "numeric" })} at ${savedAppointment.time}. Jay will text you shortly with address details.`);

      // Show social share section for first-time clients
      if (firstCut) {
        const shareSection = document.querySelector("#share-section");
        if (shareSection) shareSection.hidden = false;
      }

      form.reset();
      if (form.elements.firstCut) {
        form.elements.firstCut.checked =
          result.profile.completedCuts === 0 &&
          !result.profile.appointments.some((entry) => entry.status === "requested" && entry.firstCut);
      }
      if (appointmentDateField) appointmentDateField.value = todayInHamilton;
      calculatePrice();
    } catch (error) {
      persistProfile(profile);
      setStatus(`Your request is saved locally. Note: ${error.message}`, true);
    }
  });
}

document.querySelectorAll("[data-claim]").forEach((link) => {
  link.addEventListener("click", () => {
    if (form?.elements.firstCut) form.elements.firstCut.checked = true;
    calculatePrice();
  });
});

document.querySelectorAll("[data-select-vip]").forEach((link) => {
  link.addEventListener("click", () => {
    if (form?.elements.time) form.elements.time.value = "vip";
    calculatePrice();
  });
});

// Interactive Comparison Sliders
function setupCompareSliders() {
  document.querySelectorAll(".compare").forEach((compareContainer) => {
    const rangeInput = compareContainer.querySelector(".compare-range");
    if (!rangeInput) return;
    const syncWidth = () => {
      compareContainer.style.setProperty("--compare-width", `${compareContainer.clientWidth}px`);
    };
    rangeInput.addEventListener("input", () => {
      compareContainer.style.setProperty("--compare-position", `${rangeInput.value}%`);
    });
    compareContainer.style.setProperty("--compare-position", `${rangeInput.value}%`);
    syncWidth();
    new ResizeObserver(syncWidth).observe(compareContainer);
  });
}

const navToggle = document.querySelector(".nav-toggle");
const nav = document.querySelector(".main-nav");
if (navToggle && nav) {
  navToggle.addEventListener("click", () => {
    const open = navToggle.getAttribute("aria-expanded") !== "true";
    navToggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
  });
  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      nav.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    }
  });
}

setupCompareSliders();
calculatePrice();
renderLoyalty();

// Social Share Functionality
const shareButtons = document.querySelectorAll(".share-button");
shareButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const platform = button.dataset.platform;
    const shareUrl = "https://letsgetfaded.ca";
    const shareText = "Just booked my FREE first cut with Jay at Let's Get Faded 24/7 Cuts in Hamilton! 🎯 Precision cuts anytime, 24/7. @letsgetfaded #HamiltonBarber #LetsGetFaded";

    switch (platform) {
      case "instagram":
        // Instagram doesn't support direct URL sharing, open app
        window.open("https://instagram.com/letsgetfaded", "_blank");
        break;
      case "whatsapp":
        window.open(`https://wa.me/?text=${encodeURIComponent(shareText + " " + shareUrl)}`, "_blank");
        break;
      case "facebook":
        window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(shareText)}`, "_blank");
        break;
      case "copy":
        navigator.clipboard.writeText(`${shareText} ${shareUrl}`).then(() => {
          const originalText = button.innerHTML;
          button.innerHTML = '<span class="share-icon">✓</span><span>Copied!</span>';
          setTimeout(() => {
            button.innerHTML = originalText;
          }, 2000);
        }).catch(() => {
          alert("Could not copy link. Please copy manually: " + shareUrl);
        });
        break;
    }
  });
});

// Legal Modal Functionality
const modalTriggers = document.querySelectorAll(".footer-modal-trigger");
const modals = document.querySelectorAll(".legal-modal");

modalTriggers.forEach((trigger) => {
  trigger.addEventListener("click", () => {
    const modalId = trigger.getAttribute("data-modal");
    const modal = document.getElementById(`${modalId}-modal`);
    if (modal) {
      modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      modal.querySelector(".modal-close").focus();
    }
  });
});

modals.forEach((modal) => {
  const closeButtons = modal.querySelectorAll("[data-close]");
  closeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    });
  });

  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    }
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal.querySelector(".modal-backdrop")) {
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    }
  });
});

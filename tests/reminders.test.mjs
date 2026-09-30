import test from "node:test";
import assert from "node:assert/strict";
import { addUtcDays, createReminder, loyaltyMessage, reminderIsDue } from "../scripts/reminders.mjs";

const client = {
  name: "Alex Morgan",
  phone: "905-555-0100",
  email: "alex@example.com",
  totalCuts: 5,
  nextCutDueDate: "2026-10-02",
};

test("adds UTC days correctly across month and year boundaries", () => {
  assert.equal(addUtcDays("2026-03-01", -3), "2026-02-26");
  assert.equal(addUtcDays("2026-12-31", 1), "2027-01-01");
});

test("sends only three days ahead of the due date and once per day", () => {
  assert.equal(reminderIsDue(client, "2026-09-29"), true);
  assert.equal(reminderIsDue(client, "2026-09-28"), false);
  assert.equal(reminderIsDue({ ...client, reminderSentFor: "2026-09-29" }, "2026-09-29"), false);
});

test("personalizes SMS and loyalty email with cut progress", () => {
  const reminder = createReminder(client, "https://example.com/book");
  assert.match(reminder.sms, /^Hey Alex! Jay from/);
  assert.match(reminder.sms, /https:\/\/example\.com\/book/);
  assert.match(reminder.email.html, /1 cut away from your FREE 7th cut/);
});

test("describes the unlocked reward and one-cut remaining states", () => {
  assert.equal(loyaltyMessage(6), "Your FREE 7th cut is unlocked!");
  assert.equal(loyaltyMessage(5), "You're 1 cut away from your FREE 7th cut!");
});

test("escapes profile names and booking URLs in reminder HTML", () => {
  const reminder = createReminder({ ...client, name: "<img src=x>", totalCuts: 1 }, "https://example.com/book?a=1&b=2");
  assert.match(reminder.email.html, /Stay sharp, &lt;img\./);
  assert.match(reminder.email.html, /href="https:\/\/example\.com\/book\?a=1&amp;b=2"/);
});

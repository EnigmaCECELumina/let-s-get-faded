# Let's Get Faded 24/7 Cuts

A mobile-first client booking portal and Jay's PIN-protected barber dashboard for the Hamilton, Ontario studio. The app is split into small Node.js modules and vanilla browser clients; it does not require a package install or a framework build step.

## Run locally

Use Node.js 18 or newer. Copy `.env.example` to `.env`, set a private `ADMIN_PIN` with at least six characters, then start the server:

```powershell
Copy-Item .env.example .env
npm start
```

Open [http://localhost:3000](http://localhost:3000) for client bookings or [http://localhost:3000/admin](http://localhost:3000/admin) for Jay's dashboard. `.env` and `data/clients.json` are local-only and excluded from version control. If the data file does not exist yet, the server creates an empty client store on the first booking.

## Booking, schedule, and loyalty

Clients request an actual date and time. Regular appointments are 9:00 AM–8:59 PM; after-hours VIP requests are 9:00 PM–8:59 AM and add $20 to the service price. The API validates the time window and determines first-visit eligibility on the server, so a browser cannot claim the free welcome cut repeatedly.

Jay's dashboard provides a date-based schedule, quick preference tags, completion actions, and a name/phone directory. Completing an appointment once:

- marks the booking completed and updates the client's cut history;
- adds a loyalty stamp (six completed cuts unlock a free seventh cut);
- calculates the next due date from the client's selected 1–4 week interval;
- sends a thank-you SMS/email immediately and makes the three-day reminder eligible for the daily job.

An unlocked reward is reserved when its free-cut appointment is requested; a second pending booking cannot claim that same reward. Completing the reward clears the six-stamp card. Booking requests are requests, not confirmed appointments: Jay should confirm the time directly with the client.

## PIN and provider setup

Set `ADMIN_PIN` before using `/admin`. Login attempts are rate-limited after five incorrect PINs. The server issues an HttpOnly, SameSite=Strict session cookie that expires after eight hours. Sessions are held in server memory, so a server restart signs Jay out. Use HTTPS in production.

SMS and email run in console-mock mode when provider credentials are absent. Add all three Twilio values (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`) to enable SMS delivery. Add both Resend values (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`) to enable email delivery. A partial provider configuration reports a delivery error instead of silently falling back to a mock. Set `BOOKING_LINK` to the public rebooking URL.

The daily reminder job runs once each day:

```sh
npm run reminders
```

It sends to clients whose next cut is due in three days, records successful send dates, and includes loyalty progress and a one-click booking link in the email. On Windows, schedule `npm run reminders` in Task Scheduler with the project folder as its working directory.

## Storage and production

The JSON data file is a simple local development store, **not** a production database. For a public deployment, replace it with an access-controlled database, configure HTTPS, and use persistent shared session storage and rate limiting. Never commit `.env`, client contact details, or provider credentials.

## Validate

```sh
npm test
```

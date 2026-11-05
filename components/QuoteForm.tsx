"use client";

import { useState } from "react";
import type { FormEvent } from "react";

const ACCESS_KEY = process.env.NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY;
const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";

export default function QuoteForm() {
  const [status, setStatus] = useState("");
  const [state, setState] = useState<"idle" | "success" | "error">("idle");
  const [sending, setSending] = useState(false);

  async function submitQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setState("idle");

    if (!ACCESS_KEY) {
      setState("error");
      setStatus("The estimate form is not connected yet. Please call Brent at 289-775-2020.");
      return;
    }

    const form = event.currentTarget;
    const file = form.elements.namedItem("attachment");
    if (file instanceof HTMLInputElement && file.files?.[0]?.size && file.files[0].size > 5 * 1024 * 1024) {
      setState("error");
      setStatus("Please choose a photo smaller than 5 MB.");
      return;
    }

    setSending(true);
    setStatus("Sending your estimate request...");
    try {
      const response = await fetch(WEB3FORMS_ENDPOINT, {
        method: "POST",
        body: new FormData(form),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "The form could not be sent.");
      form.reset();
      setState("success");
      setStatus("Thanks. Brent will reply within one business day.");
    } catch (error) {
      setState("error");
      setStatus(error instanceof Error ? error.message : "The form could not be sent. Please call 289-775-2020.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      className="quote-form"
      action={WEB3FORMS_ENDPOINT}
      method="POST"
      onSubmit={submitQuote}
      encType="multipart/form-data"
    >
      <input type="hidden" name="access_key" value={ACCESS_KEY ?? ""} />
      <input type="hidden" name="subject" value="New estimate request - Steel City Painting & Handyman" />
      <input type="checkbox" name="botcheck" className="hidden" tabIndex={-1} aria-hidden="true" />
      <div className="form-field">
        <label htmlFor="quote-name">Name</label>
        <input id="quote-name" name="name" autoComplete="name" required />
      </div>
      <div className="form-field">
        <label htmlFor="quote-phone">Phone</label>
        <input id="quote-phone" name="phone" type="tel" autoComplete="tel" required />
      </div>
      <div className="form-field">
        <label htmlFor="quote-postal">Postal code</label>
        <input id="quote-postal" name="postal_code" autoComplete="postal-code" required />
      </div>
      <div className="form-field">
        <label htmlFor="quote-job">Type of job</label>
        <select id="quote-job" name="job_type" required defaultValue="">
          <option value="" disabled>Select a service</option>
          <option>Interior painting</option>
          <option>Exterior painting</option>
          <option>Handyman repairs</option>
          <option>Drywall and patching</option>
          <option>Decks and fences</option>
          <option>Other home repair</option>
        </select>
      </div>
      <div className="form-field full">
        <label htmlFor="quote-details">A few details</label>
        <textarea id="quote-details" name="message" required />
      </div>
      <div className="form-field full">
        <label htmlFor="quote-photo">Photo (optional)</label>
        <input id="quote-photo" name="attachment" type="file" accept="image/*" />
        <span className="form-help">One image up to 5 MB. Web3Forms file attachments require a Pro plan.</span>
      </div>
      <p className="form-help full">Your details and photo are used to respond to this estimate request. See our <a href="/privacy/">privacy notice</a>.</p>
      <p className="form-status" data-state={state} role="status" aria-live="polite">{status}</p>
      <button className="button button-primary form-submit" type="submit" disabled={sending}>Request an estimate</button>
    </form>
  );
}

import { SURVEY_VERSION } from "./questions";

// Absolute backend URL. The Shopify CLI substitutes process.env.* at build
// time from the app root .env (dev) or the shell environment (deploy).
// If unset, every network call silently no-ops so the survey UI still works.
const API_BASE = (process.env.SURVEY_API_URL || "").replace(/\/$/, "");

// Serialize sends so snapshots always arrive in order (last write wins server-side).
let chain = Promise.resolve();

/**
 * Upsert the full answer snapshot to the app backend.
 * Fire-and-forget: failures are swallowed, the page must never break.
 */
export function sendSurvey(orderId, surface, answers) {
  if (!API_BASE || !orderId) return chain;
  const body = JSON.stringify({
    order_id: orderId,
    surface,
    version: SURVEY_VERSION,
    source: answers.source || null,
    source_detail: answers.sourceDetail || null,
    source_text: answers.sourceText || null,
    trigger: answers.trigger || null,
  });
  chain = chain.then(async () => {
    try {
      const token = await shopify.sessionToken.get();
      await fetch(`${API_BASE}/api/survey?surface=${encodeURIComponent(surface)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body,
        keepalive: true,
      });
    } catch {
      // Silent: never surface network errors to the customer.
    }
  });
  return chain;
}

/** True if the backend already has an answer for this order. */
export async function fetchAnswered(orderId, surface) {
  if (!API_BASE || !orderId) return false;
  try {
    const token = await shopify.sessionToken.get();
    const params = new URLSearchParams({ surface, order_id: orderId });
    const res = await fetch(`${API_BASE}/api/survey?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data.answered);
  } catch {
    return false;
  }
}

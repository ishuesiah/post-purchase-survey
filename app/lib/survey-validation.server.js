// Server-side allow-lists for survey answers. Must stay in sync with the
// option values in extensions/post-purchase-survey/src/questions.js.
// Strategy: `source` is required and strictly validated; the dependent
// fields (detail/text/trigger) are stripped to null when invalid rather
// than rejected, so a stale client can never block a save.

export const SURVEY_VERSION = 2;

// Accept the previous version during rollout: already-loaded checkout pages
// keep the old extension bundle and must still be able to save.
const SUPPORTED_VERSIONS = new Set([1, SURVEY_VERSION]);

export const SURFACES = new Set(["thank_you", "order_status"]);

const FOLLOW_UP_A = new Set(["ad", "organic_ho", "organic_other", "unsure"]);
const FOLLOW_UP_B = new Set(["brand", "product", "unsure"]);

// source -> allowed source_detail values (absent = no follow-up question)
const DETAIL_BY_SOURCE = {
  instagram: FOLLOW_UP_A,
  facebook: FOLLOW_UP_A,
  pinterest: FOLLOW_UP_A,
  reddit: FOLLOW_UP_A,
  tiktok: FOLLOW_UP_A,
  youtube: FOLLOW_UP_A,
  google: FOLLOW_UP_B,
};

export const SOURCES = new Set([
  "instagram",
  "facebook",
  "pinterest",
  "reddit",
  "tiktok",
  "youtube",
  "google",
  "friend",
  "gift",
  "creator",
  "article",
  "podcast",
  "dont_remember",
  "other",
]);

// Sources whose UI shows an optional free-text field.
const TEXT_SOURCES = new Set(["reddit", "creator", "article", "podcast", "other"]);

export const TRIGGERS = new Set([
  "new_year",
  "replacing",
  "gift_for",
  "offer",
  "new_design",
  "other",
]);

const MAX_TEXT_LENGTH = 500;

const ALLOWED_FIELDS = new Set([
  "order_id",
  "surface",
  "version",
  "source",
  "source_detail",
  "source_text",
  "trigger",
  "suggestions",
]);

/**
 * Accepts a numeric Shopify order id or an Order GID
 * (e.g. "gid://shopify/Order/123456", possibly with a query string).
 * Returns the numeric id as a string, or null if unparseable.
 */
export function parseOrderId(raw) {
  if (typeof raw !== "string" || !raw) return null;
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/^gid:\/\/shopify\/\w+\/(\d+)(?:[/?].*)?$/);
  return match ? match[1] : null;
}

/**
 * Validates a survey POST body. Returns { ok: true, data } with normalized
 * fields, or { ok: false, error } with a human-readable message.
 */
export function validateSurveyPayload(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object" };
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) {
      return { ok: false, error: `Unknown field: ${key}` };
    }
  }

  const orderId = parseOrderId(body.order_id);
  if (!orderId) {
    return { ok: false, error: "Invalid or missing order_id" };
  }

  if (!SURFACES.has(body.surface)) {
    return { ok: false, error: "Invalid or missing surface" };
  }

  if (!SUPPORTED_VERSIONS.has(body.version)) {
    return { ok: false, error: "Unsupported survey version" };
  }

  if (typeof body.source !== "string" || !SOURCES.has(body.source)) {
    return { ok: false, error: "Invalid or missing source" };
  }
  const source = body.source;

  // Lenient dependent fields: strip when inconsistent with the source.
  let sourceDetail = null;
  const allowedDetails = DETAIL_BY_SOURCE[source];
  if (
    allowedDetails &&
    typeof body.source_detail === "string" &&
    allowedDetails.has(body.source_detail)
  ) {
    sourceDetail = body.source_detail;
  }

  let sourceText = null;
  if (TEXT_SOURCES.has(source) && typeof body.source_text === "string") {
    const trimmed = body.source_text.trim().slice(0, MAX_TEXT_LENGTH);
    if (trimmed) sourceText = trimmed;
  }

  let trigger = null;
  if (typeof body.trigger === "string" && TRIGGERS.has(body.trigger)) {
    trigger = body.trigger;
  }

  // Free-text product suggestions (Q3). Newlines are allowed; the sync layer
  // writes this as a multi_line_text_field metafield.
  let suggestions = null;
  if (typeof body.suggestions === "string") {
    const trimmed = body.suggestions.trim().slice(0, MAX_TEXT_LENGTH);
    if (trimmed) suggestions = trimmed;
  }

  return {
    ok: true,
    data: {
      orderId,
      surface: body.surface,
      // Store the client's version so v1 rows (no Q3 asked) stay distinguishable.
      version: body.version,
      source,
      sourceDetail,
      sourceText,
      trigger,
      suggestions,
    },
  };
}

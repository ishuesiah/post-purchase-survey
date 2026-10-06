import { authenticate } from "../shopify.server";
import db from "../db.server";
import { syncOrder } from "../lib/sync.server";
import {
  parseOrderId,
  validateSurveyPayload,
  SURFACES,
} from "../lib/survey-validation.server";

// POST /api/survey?surface=... : upsert answers from the checkout UI extension.
// GET  /api/survey?surface=...&order_id=... : answered check for the
// order-status surface (source of truth across devices/sessions).
//
// Auth: the extension sends a Shopify session token (Bearer JWT).
// authenticate.public.checkout / .customerAccount verify the signature and
// hand back a `cors` wrapper that MUST wrap every response, including errors.
//
// Accepted risk (documented in the plan): the session token proves the call
// comes from a real extension on our shop, but order_id itself is
// client-supplied. A hostile buyer could tag a different order id. Low
// stakes for a survey; not worth an Admin API round-trip per answer.

const CORS_OPTIONS = {
  corsHeaders: ["Authorization", "Content-Type"],
};

async function authenticateRequest(request) {
  const url = new URL(request.url);
  const surface = url.searchParams.get("surface");
  if (!SURFACES.has(surface)) {
    throw Response.json({ error: "Invalid surface" }, { status: 400 });
  }

  // Thank-you page runs in the checkout context; Order status runs in the
  // customer account context. Each has its own token audience.
  const { sessionToken, cors } =
    surface === "thank_you"
      ? await authenticate.public.checkout(request, CORS_OPTIONS)
      : await authenticate.public.customerAccount(request, CORS_OPTIONS);

  // Lock to our shop. `dest` looks like "https://{shop}.myshopify.com".
  const shopDomain = process.env.SHOP_DOMAIN;
  const tokenShop = (sessionToken.dest || "").replace(/^https?:\/\//, "");
  if (shopDomain && tokenShop !== shopDomain) {
    throw cors(Response.json({ error: "Wrong shop" }, { status: 403 }));
  }

  return { surface, shop: tokenShop, cors, url };
}

export async function action({ request }) {
  const { shop, cors } = await authenticateRequest(request);

  if (request.method !== "POST") {
    throw cors(Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  let body;
  try {
    body = await request.json();
  } catch {
    throw cors(Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }

  const result = validateSurveyPayload(body);
  if (!result.ok) {
    throw cors(Response.json({ error: result.error }, { status: 422 }));
  }

  const {
    orderId,
    surface,
    version,
    source,
    sourceDetail,
    sourceText,
    trigger,
    suggestions,
  } = result.data;

  // Snapshot upsert: the extension always sends the full current answer set,
  // and serializes its requests, so overwrite-all is safe and idempotent.
  // Any change resets sync state so metafields/Klaviyo converge on the latest.
  await db.surveyResponse.upsert({
    where: { orderId },
    create: {
      orderId,
      shop,
      surface,
      version,
      source,
      sourceDetail,
      sourceText,
      trigger,
      suggestions,
    },
    update: {
      source,
      sourceDetail,
      sourceText,
      trigger,
      suggestions,
      surface,
      version,
      syncStatus: "PENDING",
      attempts: 0,
      nextRetryAt: new Date(),
      lastError: null,
    },
  });

  // Fire-and-forget: on the Thank-you page the order usually doesn't exist
  // yet; syncOrder leaves the row PENDING and the orders/create webhook or
  // the interval worker finishes the job.
  void syncOrder(orderId).catch((error) => {
    console.error(`[survey] inline sync failed for order ${orderId}:`, error);
  });

  return cors(Response.json({ ok: true }));
}

export async function loader({ request }) {
  const { shop, cors, url } = await authenticateRequest(request);

  const orderId = parseOrderId(url.searchParams.get("order_id") || "");
  if (!orderId) {
    throw cors(Response.json({ error: "Invalid order_id" }, { status: 400 }));
  }

  const row = await db.surveyResponse.findUnique({ where: { orderId } });
  if (!row || row.shop !== shop) {
    return cors(Response.json({ answered: false }));
  }

  return cors(
    Response.json({
      answered: true,
      source: row.source,
      source_detail: row.sourceDetail,
      source_text: row.sourceText,
      trigger: row.trigger,
      suggestions: row.suggestions,
    }),
  );
}

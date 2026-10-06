import { unauthenticated } from "../shopify.server";
import db from "../db.server";
import { klaviyoUpsertProfile } from "./klaviyo.server";

// Syncs a SurveyResponse row to the order's metafields and to Klaviyo.
// Called fire-and-forget from the API route (order may not exist yet),
// from the orders/create webhook, and from the interval worker. Every
// step is an upsert, so overlapping calls are harmless.

const MAX_ATTEMPTS = 12;
const BASE_DELAY_MS = 60 * 1000;
const MAX_DELAY_MS = 60 * 60 * 1000;

const ORDER_QUERY = `#graphql
  query SurveyOrder($id: ID!) {
    order(id: $id) {
      id
      email
    }
  }
`;

const METAFIELDS_SET = `#graphql
  mutation SurveyMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message code }
    }
  }
`;

function buildMetafields(ownerId, row) {
  const single = (key, value) =>
    value == null
      ? null
      : { ownerId, namespace: "survey", key, type: "single_line_text_field", value };

  return [
    single("source", row.source),
    single("source_detail", row.sourceDetail),
    single("source_text", row.sourceText),
    single("trigger", row.trigger),
    single("surface", row.surface),
    // Multi-line: customers may use line breaks, which single_line rejects.
    row.suggestions == null
      ? null
      : {
          ownerId,
          namespace: "survey",
          key: "suggestions",
          type: "multi_line_text_field",
          value: row.suggestions,
        },
    {
      ownerId,
      namespace: "survey",
      key: "answered_at",
      type: "date_time",
      value: row.answeredAt.toISOString(),
    },
    {
      ownerId,
      namespace: "survey",
      key: "version",
      type: "number_integer",
      value: String(row.version),
    },
  ].filter(Boolean);
}

async function scheduleRetry(row, message, retryAfterSeconds) {
  const attempts = row.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    console.error(
      `[survey] GIVING UP on order ${row.orderId} after ${attempts} attempts: ${message}`,
    );
    await db.surveyResponse.update({
      where: { orderId: row.orderId },
      data: { syncStatus: "FAILED", attempts, lastError: message.slice(0, 500) },
    });
    return;
  }

  // Exponential backoff with jitter, honoring Retry-After when provided.
  const backoff = Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS);
  const delay = retryAfterSeconds
    ? retryAfterSeconds * 1000
    : backoff + Math.floor(Math.random() * 15000);

  await db.surveyResponse.update({
    where: { orderId: row.orderId },
    data: {
      attempts,
      nextRetryAt: new Date(Date.now() + delay),
      lastError: message.slice(0, 500),
    },
  });
}

/**
 * Attempts one full sync pass for an order. Safe to call repeatedly.
 * Never throws for expected conditions (order not found yet, throttling);
 * those just schedule a retry.
 */
export async function syncOrder(orderId) {
  const row = await db.surveyResponse.findUnique({ where: { orderId } });
  if (!row || row.syncStatus === "SYNCED") return;

  try {
    const { admin } = await unauthenticated.admin(row.shop);
    const gid = `gid://shopify/Order/${orderId}`;

    const orderResponse = await admin.graphql(ORDER_QUERY, {
      variables: { id: gid },
    });
    const orderJson = await orderResponse.json();
    const order = orderJson.data?.order;

    if (!order) {
      // Thank-you page answers land before the order exists in Admin.
      // The orders/create webhook or the worker sweep will finish this.
      await scheduleRetry(row, "Order not found yet");
      return;
    }

    // 1) Order metafields (single upsert call).
    const metafieldsResponse = await admin.graphql(METAFIELDS_SET, {
      variables: { metafields: buildMetafields(order.id, row) },
    });
    const metafieldsJson = await metafieldsResponse.json();
    const userErrors = metafieldsJson.data?.metafieldsSet?.userErrors ?? [];
    if (userErrors.length > 0) {
      await scheduleRetry(
        row,
        `metafieldsSet userErrors: ${JSON.stringify(userErrors)}`,
      );
      return;
    }
    const metafieldsAt = new Date();

    // 2) Klaviyo profile properties. Email is re-fetched (never stored) and
    // can legitimately be null; skip Klaviyo silently in that case.
    let klaviyoAt = row.klaviyoAt;
    if (order.email) {
      const sent = await klaviyoUpsertProfile(order.email, {
        source: row.source,
        sourceDetail: row.sourceDetail,
        trigger: row.trigger,
      });
      if (sent) klaviyoAt = new Date();
    }

    await db.surveyResponse.update({
      where: { orderId },
      data: {
        syncStatus: "SYNCED",
        lastError: null,
        metafieldsAt,
        klaviyoAt,
      },
    });
    console.log(`[survey] synced order ${orderId} (attempt ${row.attempts + 1})`);
  } catch (error) {
    // Throttling (GraphQL THROTTLED surfaces as a thrown response error in
    // the library, Klaviyo 429 sets retryAfter) and transient network
    // failures all funnel through the same backoff.
    const message = error instanceof Error ? error.message : String(error);
    await scheduleRetry(row, message, error?.retryAfter ?? null);
  }
}

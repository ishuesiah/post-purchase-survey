import { authenticate } from "../shopify.server";
import db from "../db.server";
import { syncOrder } from "../lib/sync.server";

// orders/create: the moment a Thank-you page answer can be flushed to
// metafields + Klaviyo. authenticate.webhook verifies the HMAC on the raw
// body and 401s forgeries before we ever touch the payload.
export const action = async ({ request }) => {
  const { shop, topic, payload, webhookId } = await authenticate.webhook(request);

  // Only act for our shop (defense in depth; the app is single-store).
  const shopDomain = process.env.SHOP_DOMAIN;
  if (shopDomain && shop !== shopDomain) {
    console.warn(`[survey] ignoring ${topic} webhook for unexpected shop ${shop}`);
    return new Response();
  }

  // Dedupe: Shopify delivers at-least-once. A unique-violation on the
  // webhookId primary key means we already handled this delivery.
  try {
    await db.processedWebhook.create({ data: { webhookId, topic } });
  } catch (error) {
    if (error?.code === "P2002") {
      return new Response();
    }
    throw error;
  }

  const orderId = payload?.id != null ? String(payload.id) : null;

  // Ack fast; do the sync out of band. syncOrder no-ops unless a PENDING
  // survey row exists for this order, and is idempotent regardless.
  if (orderId) {
    void syncOrder(orderId).catch((error) => {
      console.error(`[survey] webhook sync failed for order ${orderId}:`, error);
    });
  }

  return new Response();
};

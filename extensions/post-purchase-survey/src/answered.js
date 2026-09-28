// Local "already answered" flag via the extension Storage API.
// Storage is shared across both targets of this extension but is
// session-scoped and not guaranteed to persist, so the order-status
// surface also checks the backend (see Survey.jsx).

const KEY = "survey_answered_v1";

export async function readAnsweredFlag(orderId) {
  try {
    const flag = await shopify.storage.read(KEY);
    return Boolean(flag && flag.orderId === orderId);
  } catch {
    return false;
  }
}

export async function writeAnsweredFlag(orderId) {
  try {
    await shopify.storage.write(KEY, { orderId, at: Date.now() });
  } catch {
    // Non-fatal: worst case the survey shows again and the backend dedupes.
  }
}

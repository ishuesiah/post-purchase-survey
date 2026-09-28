// Klaviyo Profiles API client. profile-import is a create-or-update
// (upsert by email), so retries are harmless.

const KLAVIYO_URL = "https://a.klaviyo.com/api/profile-import";
const KLAVIYO_REVISION = "2026-04-15";

/**
 * Upserts survey answers as custom profile properties.
 * Skips silently (returns false) when no API key is configured, so local
 * dev works without Klaviyo. Throws on API failure so the caller retries.
 * Optional properties are spread conditionally so a partial answer set
 * never null-clobbers a previously synced value on the profile.
 */
export async function klaviyoUpsertProfile(email, { source, sourceDetail, trigger }) {
  const apiKey = process.env.KLAVIYO_PRIVATE_KEY;
  if (!apiKey) {
    console.warn("[survey] KLAVIYO_PRIVATE_KEY not set; skipping Klaviyo sync");
    return false;
  }

  const response = await fetch(KLAVIYO_URL, {
    method: "POST",
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      "Content-Type": "application/vnd.api+json",
      accept: "application/vnd.api+json",
      revision: KLAVIYO_REVISION,
    },
    body: JSON.stringify({
      data: {
        type: "profile",
        attributes: {
          email,
          properties: {
            hdyhau_source: source,
            ...(sourceDetail ? { hdyhau_detail: sourceDetail } : {}),
            ...(trigger ? { purchase_trigger: trigger } : {}),
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(
      `Klaviyo profile-import failed (${response.status}): ${detail.slice(0, 300)}`,
    );
    error.retryAfter = Number(response.headers.get("Retry-After")) || null;
    throw error;
  }

  return true;
}

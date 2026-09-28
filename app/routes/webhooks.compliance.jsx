import { authenticate } from "../shopify.server";
import db from "../db.server";

// GDPR compliance topics: customers/data_request, customers/redact,
// shop/redact. This app stores no customer PII (SurveyResponse holds only
// order ids and survey answer codes; email is fetched at sync time and
// never persisted), so data_request has nothing to return and
// customers/redact has nothing to delete. shop/redact clears everything
// for the shop.
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[survey] received compliance webhook ${topic} for ${shop}`);

  if (topic === "SHOP_REDACT") {
    await db.surveyResponse.deleteMany({ where: { shop } });
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};

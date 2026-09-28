import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { Survey } from "./Survey.jsx";

// purchase.thank-you.block.render
// The order does not exist yet on this page, but its id is available via
// the order confirmation signal (may resolve asynchronously, so read it
// reactively and render nothing until it arrives).
export default async () => {
  render(<ThankYouSurvey />, document.body);
};

function ThankYouSurvey() {
  const confirmation = shopify.orderConfirmation.value;
  const orderId = confirmation?.order?.id ?? confirmation?.id;
  if (!orderId) return null;
  return <Survey surface="thank_you" orderId={orderId} />;
}

import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { Survey } from "./Survey.jsx";

// customer-account.order-status.block.render
// The order always exists here. If the order signal is unavailable
// (e.g. pre-authenticated visit from an email link), render nothing.
export default async () => {
  render(<OrderStatusSurvey />, document.body);
};

function OrderStatusSurvey() {
  const order = shopify.order.value;
  if (!order?.id) return null;
  return <Survey surface="order_status" orderId={order.id} />;
}

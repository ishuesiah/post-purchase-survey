import { requireDashboardUser } from "../lib/dashboard-auth.server";
import { exportCsv, dashboardShop } from "../lib/responses.server";
import { parseFilters } from "../lib/survey-filters";

// GET /export.csv?period=&source=&status= : CSV download for the public
// dashboard. Cookie-authenticated, so a plain link works here (unlike the
// embedded admin page, which has to POST through a fetcher).
export const loader = async ({ request }) => {
  const { headers } = await requireDashboardUser(request);
  const filters = parseFilters(new URL(request.url));
  const { csv } = await exportCsv(dashboardShop(), filters);
  return new Response(csv, {
    headers: {
      ...headers,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="survey-responses-${filters.period}d.csv"`,
      "Cache-Control": "no-store",
    },
  });
};

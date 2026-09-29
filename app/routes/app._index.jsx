import { useEffect } from "react";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useRouteError,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { exportCsv, loadDashboardData } from "../lib/responses.server";
import { SOURCE_OPTIONS } from "../lib/survey-labels.server";
import { PERIODS, STATUS_FILTERS, parseFilters } from "../lib/survey-filters";

// Survey responses dashboard (app home, embedded in Shopify admin).
// Read-only view over the SurveyResponse table for the installed shop.
// Filters live in the URL so a view can be bookmarked; the CSV export reuses
// them. The same data also powers the public Google-authenticated page at "/".

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const filters = parseFilters(new URL(request.url));
  const data = await loadDashboardData(session.shop, filters);
  return { filters, ...data, sourceOptions: SOURCE_OPTIONS };
};

// POST intent=export: returns CSV text for the current filters. The client
// turns it into a download; a plain GET link can't carry the embedded-app
// session token, which is why this is a fetcher action and not a resource route.
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "export") {
    return Response.json({ error: "Unknown intent" }, { status: 400 });
  }
  const url = new URL(request.url);
  const filters = parseFilters(url);
  const { csv, count } = await exportCsv(session.shop, filters);
  return { csv, count, filename: `survey-responses-${filters.period}d.csv` };
};

export default function ResponsesDashboard() {
  const { filters, stats, sources, triggers, responses, sourceOptions, timeZone } =
    useLoaderData();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const exporter = useFetcher();

  const setFilter = (changes) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("page" in changes)) next.delete("page");
    navigate(`?${next.toString()}`);
  };

  const exporting = exporter.state !== "idle";
  useEffect(() => {
    if (exporter.state !== "idle" || !exporter.data?.csv) return;
    downloadText(exporter.data.filename, exporter.data.csv);
    shopify.toast.show(`Exported ${exporter.data.count} responses`);
  }, [exporter.state, exporter.data]);

  const runExport = () => {
    exporter.submit(
      { intent: "export" },
      { method: "post", action: `?${searchParams.toString()}` },
    );
  };

  return (
    <s-page heading="Survey responses">
      <s-button slot="primary-action" onClick={runExport} loading={exporting}>
        Export CSV
      </s-button>

      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <Stat label={`Responses (${periodLabel(filters.period)})`} value={stats.filtered} />
          <Stat label="Responses (all time)" value={stats.total} />
          <Stat
            label="Waiting to sync"
            value={stats.pending}
            tone={stats.pending ? "info" : undefined}
          />
          <Stat
            label="Failed to sync"
            value={stats.failed}
            tone={stats.failed ? "critical" : undefined}
          />
        </s-grid>
        <s-paragraph>
          <s-text color="subdued">
            Every answer is also written to the order as survey.* metafields and
            to the customer&apos;s Klaviyo profile. Pending rows are usually
            Thank-you page answers whose order hasn&apos;t been created yet; a
            worker retries them every minute.
          </s-text>
        </s-paragraph>
      </s-section>

      <s-section heading="Filters">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
          <s-select
            label="Period"
            value={filters.period}
            onChange={(event) => setFilter({ period: event.currentTarget.value })}
          >
            {PERIODS.map((period) => (
              <s-option key={period.value} value={period.value}>
                {period.label}
              </s-option>
            ))}
          </s-select>
          <s-select
            label="Source"
            value={filters.source}
            onChange={(event) => setFilter({ source: event.currentTarget.value })}
          >
            <s-option value="">All sources</s-option>
            {sourceOptions.map((option) => (
              <s-option key={option.value} value={option.value}>
                {option.label}
              </s-option>
            ))}
          </s-select>
          <s-select
            label="Sync status"
            value={filters.status}
            onChange={(event) => setFilter({ status: event.currentTarget.value })}
          >
            {STATUS_FILTERS.map((status) => (
              <s-option key={status.value || "any"} value={status.value}>
                {status.label}
              </s-option>
            ))}
          </s-select>
        </s-grid>
      </s-section>

      <s-section heading="How did you first hear about Hemlock & Oak?">
        {sources.total === 0 ? (
          <s-paragraph>No responses in this period.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Source</s-table-header>
              <s-table-header format="numeric">Responses</s-table-header>
              <s-table-header format="numeric">Share</s-table-header>
              <s-table-header>Follow-up split</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {sources.breakdown.map((row) => (
                <s-table-row key={row.value}>
                  <s-table-cell>{row.label}</s-table-cell>
                  <s-table-cell>{row.count}</s-table-cell>
                  <s-table-cell>{percent(row.share)}</s-table-cell>
                  <s-table-cell>
                    {row.details.length
                      ? row.details.map((d) => `${d.label}: ${d.count}`).join(" · ")
                      : ""}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="What made today the day?">
        {triggers.total === 0 ? (
          <s-paragraph>No responses in this period.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Trigger</s-table-header>
              <s-table-header format="numeric">Responses</s-table-header>
              <s-table-header format="numeric">Share</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {triggers.breakdown.map((row) => (
                <s-table-row key={row.value || "none"}>
                  <s-table-cell>{row.label}</s-table-cell>
                  <s-table-cell>{row.count}</s-table-cell>
                  <s-table-cell>{percent(row.share)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Responses">
        {responses.rows.length === 0 ? (
          <s-paragraph>No responses match these filters.</s-paragraph>
        ) : (
          <s-table
            paginate
            hasNextPage={responses.hasNextPage}
            hasPreviousPage={responses.hasPreviousPage}
            onNextPage={() => setFilter({ page: String(filters.page + 1) })}
            onPreviousPage={() => setFilter({ page: String(filters.page - 1) })}
          >
            <s-table-header-row>
              <s-table-header listSlot="primary">Answered ({timeZone})</s-table-header>
              <s-table-header>Order</s-table-header>
              <s-table-header listSlot="secondary">Source</s-table-header>
              <s-table-header>Follow-up</s-table-header>
              <s-table-header>Free text</s-table-header>
              <s-table-header>Trigger</s-table-header>
              <s-table-header>Page</s-table-header>
              <s-table-header listSlot="labeled">Sync</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {responses.rows.map((row) => (
                <s-table-row key={row.id}>
                  <s-table-cell>{row.answeredAtLabel}</s-table-cell>
                  <s-table-cell>
                    <s-link href={`shopify:admin/orders/${row.orderId}`}>
                      {row.orderId}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{row.sourceLabel}</s-table-cell>
                  <s-table-cell>{row.detailLabel}</s-table-cell>
                  <s-table-cell>{row.sourceText}</s-table-cell>
                  <s-table-cell>{row.triggerLabel}</s-table-cell>
                  <s-table-cell>{row.surfaceLabel}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={statusTone(row.syncStatus)}>{row.statusLabel}</s-badge>
                    {row.syncStatus === "FAILED" && row.lastError ? (
                      <s-text color="subdued"> {row.lastError}</s-text>
                    ) : null}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

// eslint-disable-next-line react/prop-types
function Stat({ label, value, tone }) {
  return (
    <s-box border="base" borderRadius="base" padding="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        {tone ? (
          <s-badge tone={tone} size="large">{String(value)}</s-badge>
        ) : (
          <s-heading>{String(value)}</s-heading>
        )}
      </s-stack>
    </s-box>
  );
}

function statusTone(status) {
  if (status === "SYNCED") return "success";
  if (status === "FAILED") return "critical";
  return "info";
}

function percent(share) {
  return `${Math.round(share * 100)}%`;
}

function periodLabel(period) {
  return PERIODS.find((p) => p.value === period)?.label.toLowerCase() ?? period;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

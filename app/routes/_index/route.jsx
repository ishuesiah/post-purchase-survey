import { Form, Link, data, redirect, useLoaderData } from "react-router";
import { requireDashboardUser } from "../../lib/dashboard-auth.server";
import { dashboardShop, loadDashboardData } from "../../lib/responses.server";
import { SOURCE_OPTIONS } from "../../lib/survey-labels.server";
import { PERIODS, STATUS_FILTERS, parseFilters } from "../../lib/survey-filters";
import styles from "../../styles/dashboard.module.css";

// Public dashboard at "/", behind Google sign-in (see dashboard-auth.server).
// Same data as the embedded admin page (app._index.jsx), rendered as plain
// HTML because Polaris web components only exist inside Shopify admin.

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  // Shopify still lands installs here with ?shop=...; hand those to the app.
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  const { user, headers } = await requireDashboardUser(request);
  const filters = parseFilters(url);
  const dashboard = await loadDashboardData(dashboardShop(), filters);
  // admin.shopify.com/store/<handle>/orders/<id>; the handle is the myshopify subdomain.
  const storeHandle = (dashboardShop() || "").replace(/\.myshopify\.com$/, "");
  return data(
    {
      user,
      filters,
      ...dashboard,
      sourceOptions: SOURCE_OPTIONS,
      query: url.search,
      storeHandle,
    },
    { headers },
  );
};

export default function PublicDashboard() {
  const {
    user,
    filters,
    stats,
    sources,
    triggers,
    responses,
    sourceOptions,
    timeZone,
    query,
    storeHandle,
  } = useLoaderData();

  const pageLink = (page) => {
    const params = new URLSearchParams(query);
    if (page > 1) params.set("page", String(page));
    else params.delete("page");
    const search = params.toString();
    return search ? `/?${search}` : "/";
  };

  const exportHref = (() => {
    const params = new URLSearchParams(query);
    params.delete("page");
    const search = params.toString();
    return search ? `/export.csv?${search}` : "/export.csv";
  })();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.brand}>Hemlock &amp; Oak</p>
          <h1 className={styles.headerTitle}>Survey responses</h1>
        </div>
        <div className={styles.headerRight}>
          {user.picture ? (
            <img className={styles.avatar} src={user.picture} alt="" referrerPolicy="no-referrer" />
          ) : null}
          <span className={styles.muted}>{user.email}</span>
          <Form method="post" action="/logout">
            <button className={styles.buttonSecondary} type="submit">
              Sign out
            </button>
          </Form>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.card} aria-label="Overview">
          <div className={styles.stats}>
            <Stat label={`Responses (${periodLabel(filters.period)})`} value={stats.filtered} />
            <Stat label="Responses (all time)" value={stats.total} />
            <Stat label="Waiting to sync" value={stats.pending} tone={stats.pending ? "info" : ""} />
            <Stat label="Failed to sync" value={stats.failed} tone={stats.failed ? "critical" : ""} />
          </div>
          <p className={`${styles.muted} ${styles.empty}`} style={{ marginTop: 12 }}>
            Every answer is also written to the order as survey.* metafields and to the
            customer&apos;s Klaviyo profile. Pending rows are usually Thank-you page answers
            whose order hasn&apos;t been created yet; a worker retries them every minute.
          </p>
        </section>

        <section className={styles.card} aria-label="Filters">
          <Form method="get" action="/" className={styles.filters}>
            <label className={styles.field}>
              Period
              <select className={styles.select} name="period" defaultValue={filters.period}>
                {PERIODS.map((period) => (
                  <option key={period.value} value={period.value}>
                    {period.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Source
              <select className={styles.select} name="source" defaultValue={filters.source}>
                <option value="">All sources</option>
                {sourceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Sync status
              <select className={styles.select} name="status" defaultValue={filters.status}>
                {STATUS_FILTERS.map((status) => (
                  <option key={status.value || "any"} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button className={styles.button} type="submit">
                Apply
              </button>
              <a className={styles.buttonSecondary} href={exportHref}>
                Export CSV
              </a>
            </div>
          </Form>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>How did you first hear about Hemlock &amp; Oak?</h2>
          {sources.total === 0 ? (
            <p className={styles.empty}>No responses in this period.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th className={styles.numeric}>Responses</th>
                    <th className={styles.numeric}>Share</th>
                    <th>Follow-up split</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.breakdown.map((row) => (
                    <tr key={row.value}>
                      <td>{row.label}</td>
                      <td className={styles.numeric}>{row.count}</td>
                      <td className={styles.numeric}>{percent(row.share)}</td>
                      <td className={styles.muted}>
                        {row.details.map((d) => `${d.label}: ${d.count}`).join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>What made today the day?</h2>
          {triggers.total === 0 ? (
            <p className={styles.empty}>No responses in this period.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Trigger</th>
                    <th className={styles.numeric}>Responses</th>
                    <th className={styles.numeric}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {triggers.breakdown.map((row) => (
                    <tr key={row.value || "none"}>
                      <td>{row.label}</td>
                      <td className={styles.numeric}>{row.count}</td>
                      <td className={styles.numeric}>{percent(row.share)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Responses</h2>
          {responses.rows.length === 0 ? (
            <p className={styles.empty}>No responses match these filters.</p>
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Answered ({timeZone})</th>
                      <th>Order</th>
                      <th>Source</th>
                      <th>Follow-up</th>
                      <th>Free text</th>
                      <th>Trigger</th>
                      <th>Suggestions</th>
                      <th>Page</th>
                      <th>Sync</th>
                    </tr>
                  </thead>
                  <tbody>
                    {responses.rows.map((row) => (
                      <tr key={row.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{row.answeredAtLabel}</td>
                        <td>
                          <a
                            className={styles.link}
                            href={`https://admin.shopify.com/store/${storeHandle}/orders/${row.orderId}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {row.orderId}
                          </a>
                        </td>
                        <td>{row.sourceLabel}</td>
                        <td>{row.detailLabel}</td>
                        <td>{row.sourceText}</td>
                        <td>{row.triggerLabel}</td>
                        <td>{row.suggestions}</td>
                        <td>{row.surfaceLabel}</td>
                        <td>
                          <span className={`${styles.badge} ${statusClass(row.syncStatus)}`}>
                            {row.statusLabel}
                          </span>
                          {row.syncStatus === "FAILED" && row.lastError ? (
                            <span className={styles.errorText}>{row.lastError}</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <nav className={styles.pagination} aria-label="Pagination">
                {responses.hasPreviousPage ? (
                  <Link className={styles.buttonSecondary} to={pageLink(filters.page - 1)}>
                    Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className={styles.muted}>Page {filters.page}</span>
                {responses.hasNextPage ? (
                  <Link className={styles.buttonSecondary} to={pageLink(filters.page + 1)}>
                    Next
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

// eslint-disable-next-line react/prop-types
function Stat({ label, value, tone }) {
  const toneClass =
    tone === "info" ? styles.statValueInfo : tone === "critical" ? styles.statValueCritical : "";
  return (
    <div className={styles.stat}>
      <p className={styles.statLabel}>{label}</p>
      <p className={`${styles.statValue} ${toneClass}`}>{value}</p>
    </div>
  );
}

function statusClass(status) {
  if (status === "SYNCED") return styles.badgeSuccess;
  if (status === "FAILED") return styles.badgeCritical;
  return styles.badgeInfo;
}

function percent(share) {
  return `${Math.round(share * 100)}%`;
}

function periodLabel(period) {
  return PERIODS.find((p) => p.value === period)?.label.toLowerCase() ?? period;
}

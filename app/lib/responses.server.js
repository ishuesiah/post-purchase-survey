import db from "../db.server";
import {
  sourceLabel,
  detailLabel,
  triggerLabel,
  surfaceLabel,
  statusLabel,
} from "./survey-labels.server";
import { PERIODS, STATUS_FILTERS, parseFilters } from "./survey-filters";

export { PERIODS, STATUS_FILTERS, parseFilters };

// Read-model for the admin dashboard. Everything here is read-only and
// scoped to one shop; writes stay in api.survey.jsx / sync.server.js.

export const PAGE_SIZE = 25;
export const EXPORT_LIMIT = 10000;
export const TIME_ZONE = process.env.SHOP_TIMEZONE || "America/Vancouver";

/**
 * Shop scope for the public dashboard, which has no Shopify session to read
 * the shop from. This app is single-store, so SHOP_DOMAIN is the answer;
 * if it is unset, queries are not scoped (null = no shop filter).
 */
export function dashboardShop() {
  return process.env.SHOP_DOMAIN || null;
}

function whereFor(shop, { period, source, status }) {
  const where = shop ? { shop } : {};
  if (period !== "all") {
    const days = Number(period);
    where.answeredAt = { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
  }
  if (source) where.source = source;
  if (status) where.syncStatus = status;
  return where;
}

/**
 * Headline numbers. Sync counts are all-time (a stuck row matters
 * regardless of which period is selected); the response count follows
 * the current filters.
 */
export async function loadStats(shop, filters) {
  const all = shop ? { shop } : {};
  const [filtered, total, pending, failed] = await Promise.all([
    db.surveyResponse.count({ where: whereFor(shop, filters) }),
    db.surveyResponse.count({ where: all }),
    db.surveyResponse.count({ where: { ...all, syncStatus: "PENDING" } }),
    db.surveyResponse.count({ where: { ...all, syncStatus: "FAILED" } }),
  ]);
  return { filtered, total, pending, failed };
}

/**
 * Q1 breakdown for the selected period/status (ignores the source filter
 * so the table always shows the full channel split). Each row also splits
 * the follow-up answer so paid vs organic is visible per channel.
 */
export async function loadSourceBreakdown(shop, filters) {
  const where = whereFor(shop, { ...filters, source: "" });
  const rows = await db.surveyResponse.groupBy({
    by: ["source", "sourceDetail"],
    where,
    _count: { _all: true },
  });

  const bySource = new Map();
  let total = 0;
  for (const row of rows) {
    const count = row._count._all;
    total += count;
    const entry = bySource.get(row.source) ?? {
      value: row.source,
      label: sourceLabel(row.source),
      count: 0,
      details: [],
    };
    entry.count += count;
    if (row.sourceDetail) {
      entry.details.push({
        label: detailLabel(row.source, row.sourceDetail),
        count,
      });
    }
    bySource.set(row.source, entry);
  }

  const breakdown = [...bySource.values()]
    .map((entry) => ({
      ...entry,
      share: total ? entry.count / total : 0,
      details: entry.details.sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.count - a.count);

  return { total, breakdown };
}

/** Q2 breakdown for the current filters (Q2 is optional, so unanswered is shown). */
export async function loadTriggerBreakdown(shop, filters) {
  const where = whereFor(shop, filters);
  const rows = await db.surveyResponse.groupBy({
    by: ["trigger"],
    where,
    _count: { _all: true },
  });
  const total = rows.reduce((sum, row) => sum + row._count._all, 0);
  const breakdown = rows
    .map((row) => ({
      value: row.trigger ?? "",
      label: row.trigger ? triggerLabel(row.trigger) : "Not answered",
      count: row._count._all,
      share: total ? row._count._all / total : 0,
    }))
    .sort((a, b) => b.count - a.count);
  return { total, breakdown };
}

/** One page of responses, newest first. Fetches one extra row to know if a next page exists. */
export async function loadResponses(shop, filters) {
  const rows = await db.surveyResponse.findMany({
    where: whereFor(shop, filters),
    orderBy: { answeredAt: "desc" },
    skip: (filters.page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
  });
  const hasNextPage = rows.length > PAGE_SIZE;
  return {
    rows: rows.slice(0, PAGE_SIZE).map(presentRow),
    hasNextPage,
    hasPreviousPage: filters.page > 1,
  };
}

/**
 * Everything a dashboard page needs, in one call. Used by both the embedded
 * admin page and the public Google-authenticated page so they can't drift.
 */
export async function loadDashboardData(shop, filters, timeZone = TIME_ZONE) {
  const [stats, sources, triggers, responses] = await Promise.all([
    loadStats(shop, filters),
    loadSourceBreakdown(shop, filters),
    loadTriggerBreakdown(shop, filters),
    loadResponses(shop, filters),
  ]);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  return {
    stats,
    sources,
    triggers,
    responses: {
      ...responses,
      rows: responses.rows.map((row) => ({
        ...row,
        answeredAtLabel: formatter.format(new Date(row.answeredAt)),
      })),
    },
    timeZone,
  };
}

function presentRow(row) {
  return {
    id: row.id,
    orderId: row.orderId,
    answeredAt: row.answeredAt.toISOString(),
    source: row.source,
    sourceLabel: sourceLabel(row.source),
    detailLabel: detailLabel(row.source, row.sourceDetail),
    sourceText: row.sourceText ?? "",
    triggerLabel: triggerLabel(row.trigger),
    suggestions: row.suggestions ?? "",
    surfaceLabel: surfaceLabel(row.surface),
    syncStatus: row.syncStatus,
    statusLabel: statusLabel(row.syncStatus),
    lastError: row.lastError ?? "",
  };
}

/** CSV of every response matching the filters (capped at EXPORT_LIMIT). */
export async function exportCsv(shop, filters) {
  const rows = await db.surveyResponse.findMany({
    where: whereFor(shop, filters),
    orderBy: { answeredAt: "desc" },
    take: EXPORT_LIMIT,
  });

  const header = [
    "answered_at",
    "order_id",
    "source",
    "source_label",
    "source_detail",
    "source_detail_label",
    "source_text",
    "trigger",
    "trigger_label",
    "suggestions",
    "surface",
    "sync_status",
    "last_error",
  ];

  const lines = rows.map((row) =>
    [
      row.answeredAt.toISOString(),
      row.orderId,
      row.source,
      sourceLabel(row.source),
      row.sourceDetail ?? "",
      detailLabel(row.source, row.sourceDetail),
      row.sourceText ?? "",
      row.trigger ?? "",
      triggerLabel(row.trigger),
      row.suggestions ?? "",
      row.surface,
      row.syncStatus,
      row.lastError ?? "",
    ]
      .map(csvCell)
      .join(","),
  );

  return { csv: [header.join(","), ...lines].join("\r\n"), count: rows.length };
}

function csvCell(value) {
  let text = String(value ?? "");
  // Neutralise spreadsheet formula injection from customer free text.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

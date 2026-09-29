// Dashboard filter definitions shared by the server loader and the client
// component. Keep this file free of server-only imports (no Prisma, no env).

export const PERIODS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export const STATUS_FILTERS = [
  { value: "", label: "Any sync status" },
  { value: "SYNCED", label: "Synced" },
  { value: "PENDING", label: "Pending" },
  { value: "FAILED", label: "Failed" },
];

/** Parses dashboard filters from a URL, falling back to safe defaults. */
export function parseFilters(url) {
  const params = url.searchParams;
  const period = PERIODS.some((p) => p.value === params.get("period"))
    ? params.get("period")
    : "30";
  const source = params.get("source") || "";
  const status = STATUS_FILTERS.some((s) => s.value === params.get("status"))
    ? params.get("status")
    : "";
  const page = Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1);
  return { period, source, status, page };
}

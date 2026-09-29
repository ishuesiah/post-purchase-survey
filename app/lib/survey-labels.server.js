// Human-readable labels for stored survey values, for the admin dashboard
// and CSV export. Sourced from the extension's questions.js so the labels
// can never drift from what customers actually saw. The extension file is
// plain ESM with no browser dependencies, so importing it server-side is safe.

import {
  Q1_OPTIONS,
  Q1_PINNED,
  FOLLOW_UPS,
  Q2_OPTIONS,
} from "../../extensions/post-purchase-survey/src/questions.js";

const toMap = (options) =>
  Object.fromEntries(options.map((option) => [option.value, option.label]));

export const SOURCE_LABELS = toMap([...Q1_OPTIONS, ...Q1_PINNED]);
export const TRIGGER_LABELS = toMap(Q2_OPTIONS);

// Follow-up values overlap between groups ("unsure" exists in both), so
// resolve detail labels through the source that produced them.
const FOLLOW_UP_BY_SOURCE = Object.fromEntries(
  Q1_OPTIONS.filter((option) => option.followUp).map((option) => [
    option.value,
    toMap(FOLLOW_UPS[option.followUp].options),
  ]),
);

export const SURFACE_LABELS = {
  thank_you: "Thank-you page",
  order_status: "Order status page",
};

export const STATUS_LABELS = {
  SYNCED: "Synced",
  PENDING: "Pending",
  FAILED: "Failed",
};

/** Ordered list for filter dropdowns: same order as the spec table, pinned last. */
export const SOURCE_OPTIONS = [...Q1_OPTIONS, ...Q1_PINNED].map((option) => ({
  value: option.value,
  label: option.label,
}));

export function sourceLabel(value) {
  return SOURCE_LABELS[value] ?? value ?? "";
}

export function detailLabel(source, value) {
  if (!value) return "";
  return FOLLOW_UP_BY_SOURCE[source]?.[value] ?? value;
}

export function triggerLabel(value) {
  if (!value) return "";
  return TRIGGER_LABELS[value] ?? value;
}

export function surfaceLabel(value) {
  return SURFACE_LABELS[value] ?? value ?? "";
}

export function statusLabel(value) {
  return STATUS_LABELS[value] ?? value ?? "";
}

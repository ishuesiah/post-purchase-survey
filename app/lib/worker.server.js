import db from "../db.server";
import { syncOrder } from "./sync.server";

// Backstop for the fire-and-forget + webhook sync paths: sweeps due
// PENDING rows on an interval. Safe on Sevalla (persistent Node
// container). Runs in-process; a singleton guard on globalThis prevents
// double-starting under Vite dev-server module reloads.

const SWEEP_INTERVAL_MS = 60 * 1000;
const BATCH_SIZE = 20;
const WEBHOOK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

let sweeping = false;

async function sweep() {
  if (sweeping) return; // skip if the previous sweep is still running
  sweeping = true;
  try {
    const due = await db.surveyResponse.findMany({
      where: { syncStatus: "PENDING", nextRetryAt: { lte: new Date() } },
      orderBy: { nextRetryAt: "asc" },
      take: BATCH_SIZE,
    });

    for (const row of due) {
      // Sequential on purpose: keeps Admin API usage well under rate limits.
      await syncOrder(row.orderId);
    }

    // Piggybacked housekeeping: drop webhook dedupe rows older than 7 days.
    await db.processedWebhook.deleteMany({
      where: { processedAt: { lt: new Date(Date.now() - WEBHOOK_RETENTION_MS) } },
    });
  } catch (error) {
    console.error("[survey] worker sweep failed:", error);
  } finally {
    sweeping = false;
  }
}

export function startSurveyWorker() {
  if (globalThis.__surveyWorkerStarted) return;
  globalThis.__surveyWorkerStarted = true;

  console.log("[survey] retry worker started (interval 60s)");
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  timer.unref?.(); // never keep the process alive just for the worker
}

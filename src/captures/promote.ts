import { addActivity } from "../storage.js";
import type { DayWorklog, FlogConfig, PeriodName } from "../types.js";
import { listPending, setCaptureStatus } from "./storage.js";
import type { CaptureEntry } from "./types.js";

export async function promoteCapture(
  dataDir: string,
  date: string,
  captureId: string,
  id: string,
  description: string,
  period: PeriodName,
  config: FlogConfig,
  now = new Date()
): Promise<{ entry: CaptureEntry; day: DayWorklog }> {
  const pending = await listPending(dataDir, date);
  const target = pending.find((entry) => entry.id === captureId);
  if (!target) {
    throw new Error(`Pending capture not found for ${date}: ${captureId}`);
  }

  const day = await addActivity(dataDir, date, period, id, description, config, now);
  const entry = await setCaptureStatus(dataDir, date, captureId, "promoted", {
    promotedAt: now.toISOString(),
    activityPeriod: period
  });
  return { entry, day };
}

export async function discardCapture(
  dataDir: string,
  date: string,
  captureId: string,
  now = new Date()
): Promise<CaptureEntry> {
  const pending = await listPending(dataDir, date);
  const target = pending.find((entry) => entry.id === captureId);
  if (!target) {
    throw new Error(`Pending capture not found for ${date}: ${captureId}`);
  }
  return setCaptureStatus(dataDir, date, captureId, "discarded", {
    discardedAt: now.toISOString()
  });
}

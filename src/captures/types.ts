import type { PeriodName } from "../types.js";

export type CaptureStatus = "pending" | "promoted" | "discarded";

export type CaptureEntry = {
  id: string;
  raw: string;
  capturedAt: string;
  status: CaptureStatus;
  promotedAt?: string;
  discardedAt?: string;
  activityPeriod?: PeriodName;
};

export type DayCaptures = {
  schemaVersion: 1;
  date: string;
  captures: CaptureEntry[];
};

export type CapturePatternsFile = {
  patterns: string[];
};

import { minutesFromHHMM } from "../time.js";
import type { DayWorklog, PeriodName } from "../types.js";

/** Local clock time vs morning.end: before end → morning, at/after end → afternoon. */
export function defaultPeriodForCapture(capturedAt: string, day: DayWorklog): PeriodName {
  const local = localHHMMFromCapture(capturedAt);
  if (minutesFromHHMM(local) < minutesFromHHMM(day.morning.end)) {
    return "morning";
  }
  return "afternoon";
}

export function localHHMMFromCapture(capturedAt: string): string {
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid capture timestamp: ${capturedAt}`);
  }
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

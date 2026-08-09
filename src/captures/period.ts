import { minutesFromHHMM } from "../time.js";
import type { DayWorklog, PeriodName } from "../types.js";

export function defaultPeriodForCapture(capturedAt: string, day: DayWorklog): PeriodName {
  const local = localHHMM(capturedAt);
  if (minutesFromHHMM(local) < minutesFromHHMM(day.afternoon.start)) {
    return "morning";
  }
  return "afternoon";
}

function localHHMM(capturedAt: string): string {
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid capture timestamp: ${capturedAt}`);
  }
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

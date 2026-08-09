import { todayIso } from "../time.js";
import { loadCapturePatterns, matchesPattern } from "./patterns.js";
import { appendCapture } from "./storage.js";

export type CaptureOutcome = "captured" | "duplicate" | "no-match";

export async function captureCommand(
  dataDir: string,
  raw: string,
  now = new Date(),
  date = todayIso(now)
): Promise<CaptureOutcome> {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    throw new Error("Capture text is required.");
  }

  const patterns = await loadCapturePatterns();
  if (!matchesPattern(trimmed, patterns)) {
    return "no-match";
  }

  const entry = await appendCapture(dataDir, date, trimmed, now);
  return entry ? "captured" : "duplicate";
}

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateDate } from "../time.js";
import type { PeriodName } from "../types.js";
import type { CaptureEntry, CaptureStatus, DayCaptures } from "./types.js";

export type CaptureStatusExtra = {
  promotedAt?: string;
  discardedAt?: string;
  activityPeriod?: PeriodName;
};

export function captureDayPath(dataDir: string, date: string): string {
  validateDate(date);
  const [year, month] = date.split("-");
  return path.join(dataDir, "captures", year, month, `${date}.json`);
}

export async function readDayCaptures(dataDir: string, date: string): Promise<DayCaptures> {
  validateDate(date);
  const file = captureDayPath(dataDir, date);
  try {
    const raw = await readFile(file, "utf8");
    return normalizeDayCaptures(JSON.parse(raw), date, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyDayCaptures(date);
    }
    throw error;
  }
}

export async function appendCapture(
  dataDir: string,
  date: string,
  raw: string,
  now = new Date()
): Promise<CaptureEntry | undefined> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  const day = await readDayCaptures(dataDir, date);
  const duplicate = day.captures.some(
    (entry) => entry.status === "pending" && entry.raw === trimmed
  );
  if (duplicate) {
    return undefined;
  }
  const entry: CaptureEntry = {
    id: randomUUID(),
    raw: trimmed,
    capturedAt: now.toISOString(),
    status: "pending"
  };
  day.captures.push(entry);
  await writeDayCaptures(dataDir, day);
  return entry;
}

export async function setCaptureStatus(
  dataDir: string,
  date: string,
  id: string,
  status: CaptureStatus,
  extra: CaptureStatusExtra = {}
): Promise<CaptureEntry> {
  const day = await readDayCaptures(dataDir, date);
  const entry = day.captures.find((item) => item.id === id);
  if (!entry) {
    throw new Error(`Capture not found for ${date}: ${id}`);
  }
  entry.status = status;
  if (extra.promotedAt !== undefined) {
    entry.promotedAt = extra.promotedAt;
  }
  if (extra.discardedAt !== undefined) {
    entry.discardedAt = extra.discardedAt;
  }
  if (extra.activityPeriod !== undefined) {
    entry.activityPeriod = extra.activityPeriod;
  }
  await writeDayCaptures(dataDir, day);
  return entry;
}

export async function listPending(dataDir: string, date: string): Promise<CaptureEntry[]> {
  const day = await readDayCaptures(dataDir, date);
  return day.captures.filter((entry) => entry.status === "pending");
}

async function writeDayCaptures(dataDir: string, day: DayCaptures): Promise<void> {
  const file = captureDayPath(dataDir, day.date);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, `${JSON.stringify(day, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

function emptyDayCaptures(date: string): DayCaptures {
  return { schemaVersion: 1, date, captures: [] };
}

function normalizeDayCaptures(raw: unknown, date: string, file: string): DayCaptures {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid capture day file ${file}: expected an object.`);
  }
  const candidate = raw as Partial<DayCaptures>;
  if (!Array.isArray(candidate.captures)) {
    throw new Error(`Invalid capture day file ${file}: expected captures array.`);
  }
  return {
    schemaVersion: 1,
    date: validateDate(candidate.date ?? date),
    captures: candidate.captures
  };
}

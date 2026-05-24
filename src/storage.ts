import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DayWorklog, FlogConfig, PeriodName, WorkPeriod } from "./types.js";
import { durationMinutes, validateDate, validateHHMM } from "./time.js";

export function dayPath(dataDir: string, date: string): string {
  validateDate(date);
  const [year, month] = date.split("-");
  return path.join(dataDir, year, month, `${date}.json`);
}

export function createEmptyDay(date: string, config: FlogConfig): DayWorklog {
  validateDate(date);
  return {
    schemaVersion: 1,
    date,
    morning: createPeriod(config.defaults.morningStart, config.defaults.morningEnd),
    afternoon: createPeriod(config.defaults.afternoonStart, config.defaults.afternoonEnd)
  };
}

export async function readDay(dataDir: string, date: string, config: FlogConfig): Promise<DayWorklog> {
  const file = dayPath(dataDir, date);
  try {
    const raw = await readFile(file, "utf8");
    return normalizeDay(JSON.parse(raw), date, config);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createEmptyDay(date, config);
    }
    throw error;
  }
}

export async function writeDay(dataDir: string, day: DayWorklog): Promise<void> {
  const file = dayPath(dataDir, day.date);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, `${JSON.stringify(day, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

export async function addActivity(
  dataDir: string,
  date: string,
  period: PeriodName,
  id: string,
  description: string,
  config: FlogConfig,
  now = new Date()
): Promise<DayWorklog> {
  if (!id.trim()) {
    throw new Error("Activity id is required.");
  }
  if (!description.trim()) {
    throw new Error("Activity description is required.");
  }
  const day = await readDay(dataDir, date, config);
  day[period].activities.push({
    id: id.trim(),
    description: description.trim(),
    createdAt: now.toISOString()
  });
  await writeDay(dataDir, day);
  return day;
}

export async function setPeriodTime(
  dataDir: string,
  date: string,
  period: PeriodName,
  field: "start" | "end",
  value: string,
  config: FlogConfig
): Promise<DayWorklog> {
  validateHHMM(value);
  const day = await readDay(dataDir, date, config);
  day[period][field] = value;
  durationMinutes(day[period].start, day[period].end);
  await writeDay(dataDir, day);
  return day;
}

export async function readExistingDay(dataDir: string, date: string): Promise<DayWorklog | undefined> {
  try {
    return JSON.parse(await readFile(dayPath(dataDir, date), "utf8")) as DayWorklog;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function listDayFiles(dataDir: string): Promise<string[]> {
  const years = await safeReaddir(dataDir);
  const files: string[] = [];
  for (const year of years) {
    if (!/^\d{4}$/.test(year)) {
      continue;
    }
    const yearDir = path.join(dataDir, year);
    for (const month of await safeReaddir(yearDir)) {
      if (!/^\d{2}$/.test(month)) {
        continue;
      }
      const monthDir = path.join(yearDir, month);
      for (const file of await safeReaddir(monthDir)) {
        if (/^\d{4}-\d{2}-\d{2}\.json$/.test(file)) {
          files.push(path.join(monthDir, file));
        }
      }
    }
  }
  return files.sort();
}

export async function undoLastActivity(dataDir: string): Promise<{ day: DayWorklog; activityId: string } | undefined> {
  const files = await listDayFiles(dataDir);
  let latest:
    | {
        file: string;
        day: DayWorklog;
        period: PeriodName;
        index: number;
        createdAt: string;
      }
    | undefined;

  for (const file of files) {
    const day = JSON.parse(await readFile(file, "utf8")) as DayWorklog;
    for (const period of ["morning", "afternoon"] as const) {
      day[period].activities.forEach((activity, index) => {
        if (!latest || activity.createdAt > latest.createdAt) {
          latest = { file, day, period, index, createdAt: activity.createdAt };
        }
      });
    }
  }

  if (!latest) {
    return undefined;
  }

  const [removed] = latest.day[latest.period].activities.splice(latest.index, 1);
  await writeFile(latest.file, `${JSON.stringify(latest.day, null, 2)}\n`, "utf8");
  return { day: latest.day, activityId: removed.id };
}

export function activePeriods(day: DayWorklog): Array<{ period: PeriodName; value: WorkPeriod }> {
  return (["morning", "afternoon"] as const)
    .map((period) => ({ period, value: day[period] }))
    .filter(({ value }) => value.activities.length > 0);
}

export function dayTotalMinutes(day: DayWorklog): number {
  return activePeriods(day).reduce((total, { value }) => total + durationMinutes(value.start, value.end), 0);
}

function createPeriod(start: string, end: string): WorkPeriod {
  validateHHMM(start);
  validateHHMM(end);
  durationMinutes(start, end);
  return { start, end, activities: [] };
}

function normalizeDay(raw: unknown, date: string, config: FlogConfig): DayWorklog {
  const fallback = createEmptyDay(date, config);
  if (!raw || typeof raw !== "object") {
    return fallback;
  }
  const candidate = raw as Partial<DayWorklog>;
  return {
    schemaVersion: 1,
    date: validateDate(candidate.date ?? date),
    morning: normalizePeriod(candidate.morning, fallback.morning),
    afternoon: normalizePeriod(candidate.afternoon, fallback.afternoon)
  };
}

function normalizePeriod(raw: unknown, fallback: WorkPeriod): WorkPeriod {
  if (!raw || typeof raw !== "object") {
    return fallback;
  }
  const candidate = raw as Partial<WorkPeriod>;
  return {
    start: candidate.start ? validateHHMM(candidate.start) : fallback.start,
    end: candidate.end ? validateHHMM(candidate.end) : fallback.end,
    activities: Array.isArray(candidate.activities) ? candidate.activities : [],
    ...(candidate.notes ? { notes: candidate.notes } : {})
  };
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

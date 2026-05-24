export function todayIso(now = new Date()): string {
  return formatDateLocal(now);
}

export function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function validateDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date: ${value}. Use YYYY-MM-DD.`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date: ${value}.`);
  }
  return value;
}

export function validateHHMM(value: string): string {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    throw new Error(`Invalid time: ${value}. Use HH:MM.`);
  }
  const [hour, minute] = value.split(":").map(Number);
  if (hour > 23 || minute > 59) {
    throw new Error(`Invalid time: ${value}.`);
  }
  return value;
}

export function minutesFromHHMM(value: string): number {
  validateHHMM(value);
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function durationMinutes(start: string, end: string): number {
  const minutes = minutesFromHHMM(end) - minutesFromHHMM(start);
  if (minutes <= 0) {
    throw new Error(`End time (${end}) must be after start time (${start}).`);
  }
  return minutes;
}

export function durationSeconds(start: string, end: string): number {
  return durationMinutes(start, end) * 60;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${rest}m`;
  }
  if (rest === 0) {
    return `${hours}h`;
  }
  return `${hours}h${String(rest).padStart(2, "0")}`;
}

export function startTimeWithSeconds(hhmm: string): string {
  validateHHMM(hhmm);
  return `${hhmm}:00`;
}

export function normalizeWeekId(input?: string, now = new Date()): string {
  const currentYear = isoWeekYear(now);
  if (!input) {
    const week = isoWeekNumber(now);
    return `${currentYear}-W${String(week).padStart(2, "0")}`;
  }
  if (/^\d{4}-W\d{2}$/.test(input)) {
    const week = Number(input.slice(-2));
    if (week < 1 || week > 53) {
      throw new Error(`Invalid week: ${input}.`);
    }
    return input;
  }
  if (/^W?\d{1,2}$/.test(input)) {
    const week = Number(input.replace(/^W/, ""));
    if (week < 1 || week > 53) {
      throw new Error(`Invalid week: ${input}.`);
    }
    return `${currentYear}-W${String(week).padStart(2, "0")}`;
  }
  throw new Error(`Invalid week: ${input}. Use W21 or 2026-W21.`);
}

export function weekDates(weekId: string): string[] {
  const normalized = normalizeWeekId(weekId);
  const year = Number(normalized.slice(0, 4));
  const week = Number(normalized.slice(-2));
  const monday = isoWeekMonday(year, week);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

export function weekdayName(date: string): string {
  const parsed = parseDateUtc(date);
  return new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(parsed);
}

export function displayDate(date: string): string {
  const parsed = parseDateUtc(date);
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC"
  }).format(parsed);
}

export function weekdayIndex(date: string): number {
  const day = parseDateUtc(date).getUTCDay();
  return day === 0 ? 7 : day;
}

function parseDateUtc(value: string): Date {
  validateDate(value);
  return new Date(`${value}T00:00:00.000Z`);
}

function isoWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  return monday;
}

function isoWeekNumber(date: Date): number {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  return Math.ceil(((copy.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function isoWeekYear(date: Date): number {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  return copy.getUTCFullYear();
}

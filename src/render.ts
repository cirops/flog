import Table from "cli-table3";
import colors from "picocolors";
import type { DayWorklog, FlogConfig, WorklogPayload } from "./types.js";
import { activePeriods, dayTotalMinutes } from "./storage.js";
import { displayDate, durationMinutes, formatDuration, weekdayName } from "./time.js";

export function renderDay(day: DayWorklog): string {
  const periods = activePeriods(day);
  if (periods.length === 0) {
    return `No activities for ${day.date}.`;
  }

  const lines = [`${displayDate(day.date)} (${weekdayName(day.date)})`];
  for (const { period, value } of periods) {
    lines.push("");
    lines.push(`${colors.bold(period)} ${value.start}-${value.end} (${formatDuration(durationMinutes(value.start, value.end))})`);
    for (const activity of value.activities) {
      lines.push(`  ${activity.id} - ${activity.description}`);
    }
    if (value.notes) {
      lines.push(`  Notes: ${value.notes}`);
    }
  }
  lines.push("");
  lines.push(`Total billable time: ${formatDuration(dayTotalMinutes(day))}`);
  return lines.join("\n");
}

export function renderWeek(days: DayWorklog[], weekId: string, config: FlogConfig): string {
  const activeDays = days.filter((day) => activePeriods(day).length > 0);
  if (activeDays.length === 0) {
    return `No activities for ${weekId}.`;
  }

  const chunks = activeDays.map(renderDay);
  chunks.push(renderWeekTotals(activeDays, weekId, config));
  return chunks.join("\n\n");
}

export function renderWeekTotals(days: DayWorklog[], weekId: string, config: FlogConfig): string {
  const table = new Table({
    head: ["Scope", "Billable time", "Target", "Delta"],
    style: { head: [] }
  });

  const billableMinutes = days.reduce((total, day) => total + dayTotalMinutes(day), 0);
  const target = days.length * config.defaults.dailyTargetHours * 60;
  const delta = billableMinutes - target;

  table.push([
    weekId,
    formatDuration(billableMinutes),
    formatDuration(target),
    delta === 0 ? "0m" : `${delta > 0 ? "+" : "-"}${formatDuration(Math.abs(delta))}`
  ]);

  return table.toString();
}

export function renderPayloadPreview(payloads: WorklogPayload[], skippedKeys = new Set<string>()): string {
  if (payloads.length === 0) {
    return "No worklogs to review.";
  }

  const lines: string[] = [];
  for (const [index, payload] of payloads.entries()) {
    const status = skippedKeys.has(payload.key) ? "skipped" : "pending";
    lines.push(`--- worklog ${index + 1}/${payloads.length} (${status}) ---`);
    lines.push(`destination: ${payload.destination}`);
    lines.push(`duplicate key: ${payload.key}`);
    const billableTime = formatPayloadDuration(payload);
    if (billableTime) {
      lines.push(`billable time: ${billableTime}`);
    }
    lines.push(`POST ${payload.endpoint}`);
    lines.push(JSON.stringify(payload.body, null, 2));
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function formatPayloadDuration(payload: WorklogPayload): string | undefined {
  const timeSpentSeconds = payload.body.timeSpentSeconds;
  if (typeof timeSpentSeconds !== "number" || !Number.isFinite(timeSpentSeconds)) {
    return undefined;
  }
  return formatDuration(Math.round(timeSpentSeconds / 60));
}

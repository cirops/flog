import Table from "cli-table3";
import colors from "picocolors";
import type { DayWorklog, FlogConfig, SubmissionRecord, WorklogPayload } from "./types.js";
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
      lines.push(`  ${activity.id ? `${activity.id} - ${activity.description}` : activity.description}`);
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

export function renderPayloadHuman(
  payloads: WorklogPayload[],
  submissions: Map<string, SubmissionRecord>,
  config: FlogConfig
): string {
  if (payloads.length === 0) {
    return "No worklogs to review.";
  }

  const issueLabel = formatIssueLabel(config);
  const lines: string[] = [];
  for (const payload of payloads) {
    const submission = submissions.get(payload.key);
    const status = submission ? `skipped (already submitted${submission.externalId ? ` as ${submission.externalId}` : ""})` : "pending";
    const startTime = String(payload.body.startTime ?? "").slice(0, 5);
    const billable = formatPayloadDuration(payload) ?? "";
    const range = startTime ? `${startTime}–${addMinutes(startTime, payload.body.timeSpentSeconds)}` : "";

    lines.push(`${displayDate(payload.date)} (${weekdayName(payload.date)}) — ${colors.bold(payload.period)} ${range}${billable ? ` (${billable})` : ""}`);
    if (issueLabel) {
      lines.push(`  Issue:    ${issueLabel}`);
    }
    if (billable) {
      lines.push(`  Billable: ${billable}`);
    }
    lines.push(`  Status:   ${status}`);
    const description = typeof payload.body.description === "string" ? payload.body.description : "";
    if (description) {
      lines.push(`  Atividades:`);
      for (const item of description.split("\n")) {
        lines.push(`    • ${item}`);
      }
    }
    lines.push("");
  }

  const totalMinutes = payloads.reduce((total, payload) => {
    const seconds = payload.body.timeSpentSeconds;
    return total + (typeof seconds === "number" && Number.isFinite(seconds) ? Math.round(seconds / 60) : 0);
  }, 0)

  lines.push(`Total billable time: ${formatDuration(totalMinutes)}`);

  return lines.join("\n").trimEnd();
}

function formatIssueLabel(config: FlogConfig): string {
  const { issueKey, issueId } = config.tempo;
  if (issueKey && issueId) {
    return `${issueKey} (id ${issueId})`;
  }
  if (issueKey) {
    return issueKey;
  }
  if (issueId) {
    return `id ${issueId}`;
  }
  return "";
}

function addMinutes(startHHMM: string, timeSpentSeconds: unknown): string {
  if (typeof timeSpentSeconds !== "number" || !Number.isFinite(timeSpentSeconds)) {
    return "";
  }
  const [h, m] = startHHMM.split(":").map(Number);
  const total = h * 60 + m + Math.round(timeSpentSeconds / 60);
  const endH = Math.floor(total / 60) % 24;
  const endM = total % 60;
  return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
}

function formatPayloadDuration(payload: WorklogPayload): string | undefined {
  const timeSpentSeconds = payload.body.timeSpentSeconds;
  if (typeof timeSpentSeconds !== "number" || !Number.isFinite(timeSpentSeconds)) {
    return undefined;
  }
  return formatDuration(Math.round(timeSpentSeconds / 60));
}

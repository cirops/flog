import { readDay } from "../storage.js";
import { durationSeconds, startTimeWithSeconds } from "../time.js";
import type { Destination, SubmitResult } from "./types.js";
import type { FlogConfig, PeriodName, TempoConfig, WorkPeriod, WorklogPayload } from "../types.js";

export function createTempoDestination(dataDir: string, config: FlogConfig): Destination {
  return {
    name: "tempo",
    validateConfig(targetConfig: FlogConfig): void {
      validateTempoConfig(targetConfig.tempo, Boolean(process.env.TEMPO_TOKEN));
    },
    async buildPayloads(dates: string[]): Promise<WorklogPayload[]> {
      validateTempoConfig(config.tempo, true, { allowMissingToken: true });
      const payloads: WorklogPayload[] = [];
      for (const date of dates) {
        const day = await readDay(dataDir, date, config);
        for (const period of ["morning", "afternoon"] as const) {
          const value = day[period];
          if (value.activities.length === 0) {
            continue;
          }
          payloads.push(buildTempoPayload(config.tempo, date, period, value));
        }
      }
      return payloads;
    },
    async submit(payload: WorklogPayload): Promise<SubmitResult> {
      validateTempoConfig(config.tempo, Boolean(process.env.TEMPO_TOKEN));
      const response = await fetch(config.tempo.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.TEMPO_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload.body)
      });
      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(`Tempo request failed with HTTP ${response.status}${bodyText ? `: ${bodyText}` : ""}`);
      }
      const body = parseJsonObject(bodyText);
      const externalId = body?.tempoWorklogId ?? body?.id;
      return externalId === undefined ? {} : { externalId: String(externalId) };
    }
  };
}

export function buildTempoPayload(
  tempo: TempoConfig,
  date: string,
  period: PeriodName,
  value: WorkPeriod
): WorklogPayload {
  const timeSpentSeconds = durationSeconds(value.start, value.end);
  const billableSeconds = tempo.billableMode === "none" ? 0 : timeSpentSeconds;
  const description = value.activities
    .map((activity) =>
      tempo.descriptionFormat.replaceAll("{id}", activity.id).replaceAll("{desc}", activity.description)
    )
    .join("\n");

  const body: Record<string, unknown> = {
    issueId: tempo.issueId,
    authorAccountId: tempo.authorAccountId,
    startDate: date,
    startTime: startTimeWithSeconds(value.start),
    timeSpentSeconds,
    billableSeconds,
    description
  };

  if (tempo.attributes !== undefined) {
    body.attributes = tempo.attributes;
  }

  return {
    key: duplicateKey(date, period, "tempo"),
    destination: "tempo",
    date,
    period,
    summary: `${date} ${period} ${value.start}-${value.end}`,
    endpoint: tempo.apiUrl,
    body
  };
}

export function duplicateKey(date: string, period: PeriodName, destination: "tempo"): string {
  return `${destination}:${date}:${period}`;
}

export function validateTempoConfig(
  tempo: TempoConfig,
  hasToken: boolean,
  options: { allowMissingToken?: boolean } = {}
): void {
  const missing: string[] = [];
  if (!tempo.apiUrl) missing.push("TEMPO_API_URL");
  if (!tempo.issueId) missing.push("TEMPO_ISSUE_ID");
  if (!tempo.authorAccountId) missing.push("TEMPO_AUTHOR_ACCOUNT_ID");
  if (!options.allowMissingToken && !hasToken) missing.push("TEMPO_TOKEN");
  if (missing.length > 0) {
    throw new Error(`Missing Tempo configuration: ${missing.join(", ")}.`);
  }
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  if (!value.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

import { readFileSync } from "node:fs";
import { Agent } from "undici";
import { readDay } from "../storage.js";
import { durationSeconds, startTimeWithSeconds } from "../time.js";
import type { Destination, SubmitResult } from "./types.js";
import type { FlogConfig, PeriodName, TempoConfig, WorkPeriod, WorklogPayload } from "../types.js";

let cachedDispatcher: { caPath: string; agent: Agent } | undefined;

export function getTempoDispatcher(): Agent | undefined {
  const caPath = process.env.FLOG_CA_BUNDLE;
  if (!caPath) {
    return undefined;
  }
  if (cachedDispatcher && cachedDispatcher.caPath === caPath) {
    return cachedDispatcher.agent;
  }
  const ca = readFileSync(caPath, "utf8");
  const agent = new Agent({ connect: { ca } });
  cachedDispatcher = { caPath, agent };
  return agent;
}

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
      const dispatcher = getTempoDispatcher();
      const response = await fetch(config.tempo.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.TEMPO_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload.body),
        ...(dispatcher ? { dispatcher } : {})
      } as RequestInit);
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
      activity.id
        ? tempo.descriptionFormat.replaceAll("{id}", activity.id).replaceAll("{desc}", activity.description)
        : activity.description
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

export type RemoteWorklog = {
  tempoWorklogId: number | string;
  issueId?: number;
  startDate: string;
  startTime: string;
  timeSpentSeconds: number;
  description: string;
  createdAt?: string;
};

export async function fetchTempoWorklogs(
  config: FlogConfig,
  from: string,
  to: string
): Promise<RemoteWorklog[]> {
  validateTempoConfig(config.tempo, Boolean(process.env.TEMPO_TOKEN));
  const accountId = config.tempo.authorAccountId!;
  const issueId = config.tempo.issueId;
  const base = config.tempo.apiUrl.replace(/\/worklogs\/?$/, "/worklogs");
  const dispatcher = getTempoDispatcher();
  const results: RemoteWorklog[] = [];
  const limit = 100;
  let offset = 0;

  while (true) {
    const url = `${base}/user/${encodeURIComponent(accountId)}?from=${from}&to=${to}&limit=${limit}&offset=${offset}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.TEMPO_TOKEN}`,
        Accept: "application/json"
      },
      ...(dispatcher ? { dispatcher } : {})
    } as RequestInit);
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`Tempo GET failed with HTTP ${response.status}${bodyText ? `: ${bodyText}` : ""}`);
    }
    const parsed = parseJsonObject(bodyText);
    const items = Array.isArray(parsed?.results) ? (parsed!.results as Record<string, unknown>[]) : [];
    for (const item of items) {
      const issue = item.issue as { id?: number } | undefined;
      if (issueId && issue?.id && issue.id !== issueId) {
        continue;
      }
      results.push({
        tempoWorklogId: (item.tempoWorklogId ?? item.id) as number | string,
        issueId: issue?.id,
        startDate: String(item.startDate ?? ""),
        startTime: String(item.startTime ?? ""),
        timeSpentSeconds: Number(item.timeSpentSeconds ?? 0),
        description: typeof item.description === "string" ? item.description : "",
        createdAt: typeof item.createdAt === "string" ? item.createdAt : undefined
      });
    }
    if (items.length < limit) {
      break;
    }
    offset += limit;
  }
  return results;
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

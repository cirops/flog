import { fetchTempoWorklogs, type RemoteWorklog } from "./destinations/tempo.js";
import { readDay, writeDay } from "./storage.js";
import { appendSubmission, readSubmissions } from "./submissions.js";
import { minutesFromHHMM } from "./time.js";
import type { FlogConfig, PeriodName, SubmissionRecord } from "./types.js";

export type SyncStats = {
  synced: number;
  alreadyKnown: number;
  localPopulated: number;
  localConflicts: number;
  remoteCount: number;
};

export type SyncOptions = {
  populateLocal?: boolean;
};

export async function syncFromTempo(
  config: FlogConfig,
  dataDir: string,
  dates: string[],
  options: SyncOptions = {}
): Promise<SyncStats> {
  const populateLocal = options.populateLocal ?? true;
  const from = dates[0];
  const to = dates[dates.length - 1];
  const remote = await fetchTempoWorklogs(config, from, to);

  const submissions = await readSubmissions(dataDir);
  const knownSubmittedKeys = new Set(
    submissions.filter((record) => record.status === "submitted").map((record) => record.key)
  );

  const stats: SyncStats = {
    synced: 0,
    alreadyKnown: 0,
    localPopulated: 0,
    localConflicts: 0,
    remoteCount: remote.length
  };

  for (const worklog of remote) {
    if (!dates.includes(worklog.startDate)) {
      continue;
    }
    const period = detectPeriod(worklog.startTime);
    const key = `tempo:${worklog.startDate}:${period}`;

    if (knownSubmittedKeys.has(key)) {
      stats.alreadyKnown += 1;
    } else {
      const record: SubmissionRecord = {
        schemaVersion: 1,
        key,
        destination: "tempo",
        date: worklog.startDate,
        period,
        status: "submitted",
        submittedAt: worklog.createdAt ?? new Date().toISOString(),
        externalId: String(worklog.tempoWorklogId),
        payloadHash: ""
      };
      await appendSubmission(dataDir, record);
      knownSubmittedKeys.add(key);
      stats.synced += 1;
    }

    if (populateLocal) {
      const populated = await populateLocalDay(config, dataDir, worklog, period);
      if (populated === "populated") {
        stats.localPopulated += 1;
      } else if (populated === "conflict") {
        stats.localConflicts += 1;
      }
    }
  }

  return stats;
}

function detectPeriod(startTime: string): PeriodName {
  const hh = startTime.slice(0, 5);
  try {
    return minutesFromHHMM(hh) < 12 * 60 ? "morning" : "afternoon";
  } catch {
    return "morning";
  }
}

async function populateLocalDay(
  config: FlogConfig,
  dataDir: string,
  worklog: RemoteWorklog,
  period: PeriodName
): Promise<"populated" | "conflict" | "noop"> {
  const day = await readDay(dataDir, worklog.startDate, config);
  if (day[period].activities.length > 0) {
    return "conflict";
  }
  const startHHMM = worklog.startTime.slice(0, 5);
  const endHHMM = addMinutesHHMM(startHHMM, Math.round(worklog.timeSpentSeconds / 60));
  day[period].start = startHHMM;
  day[period].end = endHHMM;
  const lines = worklog.description.split("\n").filter((line) => line.trim().length > 0);
  const activities = lines.length > 0 ? lines : [worklog.description];
  for (const line of activities) {
    const match = /^(\d+)\s*-\s*(.+)$/.exec(line);
    day[period].activities.push({
      id: match ? match[1] : "",
      description: match ? match[2].trim() : line.trim(),
      createdAt: worklog.createdAt ?? new Date().toISOString()
    });
  }
  await writeDay(dataDir, day);
  return "populated";
}

function addMinutesHHMM(start: string, minutes: number): string {
  const [h, m] = start.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const endH = Math.floor(total / 60) % 24;
  const endM = total % 60;
  return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
}

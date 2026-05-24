import path from "node:path";
import process from "node:process";
import Conf from "conf";
import dotenv from "dotenv";
import envPaths from "env-paths";
import type { FlogConfig, TempoBillableMode } from "./types.js";

export const defaultConfig: FlogConfig = {
  destination: "tempo",
  defaults: {
    morningStart: "08:00",
    morningEnd: "12:00",
    afternoonStart: "13:30",
    afternoonEnd: "17:30",
    dailyTargetHours: 8
  },
  tempo: {
    apiUrl: "https://api.tempo.io/4/worklogs",
    descriptionFormat: "{id} - {desc}",
    billableMode: "equal"
  }
};

const paths = envPaths("flog", { suffix: "" });

export function loadEnv(): void {
  dotenv.config({ path: process.env.FLOG_ENV_FILE ?? path.join(process.cwd(), ".env") });
}

export function createConfigStore(): Conf<FlogConfig> {
  return new Conf<FlogConfig>({
    projectName: "flog",
    cwd: process.env.FLOG_CONFIG_DIR,
    defaults: defaultConfig
  });
}

export function loadConfig(): FlogConfig {
  loadEnv();
  const stored = createConfigStore().store;
  const tempoBillableMode = envBillableMode(process.env.TEMPO_BILLABLE_MODE) ?? stored.tempo.billableMode;
  return {
    ...defaultConfig,
    ...stored,
    defaults: {
      ...defaultConfig.defaults,
      ...stored.defaults
    },
    tempo: {
      ...defaultConfig.tempo,
      ...stored.tempo,
      apiUrl: process.env.TEMPO_API_URL ?? stored.tempo.apiUrl ?? defaultConfig.tempo.apiUrl,
      issueId: envNumber(process.env.TEMPO_ISSUE_ID) ?? stored.tempo.issueId,
      issueKey: process.env.TEMPO_ISSUE_KEY ?? stored.tempo.issueKey,
      authorAccountId: process.env.TEMPO_AUTHOR_ACCOUNT_ID ?? stored.tempo.authorAccountId,
      descriptionFormat:
        process.env.TEMPO_DESCRIPTION_FORMAT ??
        stored.tempo.descriptionFormat ??
        defaultConfig.tempo.descriptionFormat,
      billableMode: tempoBillableMode,
      attributes: envJson(process.env.TEMPO_ATTRIBUTES) ?? stored.tempo.attributes
    }
  };
}

export function resolveDataDir(config: FlogConfig): string {
  return path.resolve(process.env.FLOG_DATA_DIR ?? config.dataDir ?? path.join(process.cwd(), "worklogs"));
}

export function configPathDescription(): string {
  if (process.env.FLOG_CONFIG_DIR) {
    return path.resolve(process.env.FLOG_CONFIG_DIR);
  }
  return paths.config;
}

function envNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("TEMPO_ISSUE_ID must be a positive integer.");
  }
  return parsed;
}

function envBillableMode(value: string | undefined): TempoBillableMode | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "equal" || value === "none") {
    return value;
  }
  throw new Error("TEMPO_BILLABLE_MODE must be equal or none.");
}

function envJson(value: string | undefined): unknown {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("TEMPO_ATTRIBUTES must be valid JSON.");
  }
}

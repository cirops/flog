import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Conf from "conf";
import dotenv from "dotenv";
import envPaths from "env-paths";
import type { FlogConfig, TempoBillableMode, TempoConfig } from "./types.js";

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

export type ConfigSource = "env" | "conf" | "default" | "missing";

export type EffectiveConfig = {
  config: FlogConfig;
  sources: {
    dataDir: ConfigSource;
    destination: ConfigSource;
    defaults: Record<keyof FlogConfig["defaults"], ConfigSource>;
    tempo: Record<keyof TempoConfig, ConfigSource>;
    tempoToken: ConfigSource;
    caBundle: ConfigSource;
  };
  paths: {
    envFile: string | undefined;
    confStore: string;
    dataDir: string;
  };
  deprecated: string[];
};

const DEPRECATED_ENV_VARS = [
  "TEMPO_API_URL",
  "TEMPO_ISSUE_ID",
  "TEMPO_ISSUE_KEY",
  "TEMPO_AUTHOR_ACCOUNT_ID",
  "TEMPO_DESCRIPTION_FORMAT",
  "TEMPO_BILLABLE_MODE",
  "TEMPO_ATTRIBUTES"
] as const;

export function getInstallRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function resolveEnvFile(): string | undefined {
  if (process.env.FLOG_ENV_FILE) {
    return process.env.FLOG_ENV_FILE;
  }
  const candidates = [
    path.join(getInstallRoot(), ".env"),
    path.join(os.homedir(), ".flog", ".env"),
    path.join(process.cwd(), ".env")
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function loadEnv(): void {
  const file = resolveEnvFile();
  if (file) {
    dotenv.config({ path: file });
  }
}

export function createConfigStore(): Conf<FlogConfig> {
  return new Conf<FlogConfig>({
    projectName: "flog",
    cwd: process.env.FLOG_CONFIG_DIR,
    defaults: defaultConfig
  });
}

export function detectDeprecatedEnvVars(): string[] {
  return DEPRECATED_ENV_VARS.filter((name) => process.env[name] !== undefined && process.env[name] !== "");
}

export function loadConfig(): FlogConfig {
  loadEnv();
  const stored = createConfigStore().store;
  return mergeConfig(stored);
}

function mergeConfig(stored: Partial<FlogConfig>): FlogConfig {
  return {
    dataDir: stored.dataDir,
    destination: stored.destination ?? defaultConfig.destination,
    defaults: {
      ...defaultConfig.defaults,
      ...(stored.defaults ?? {})
    },
    tempo: {
      ...defaultConfig.tempo,
      ...(stored.tempo ?? {})
    }
  };
}

export function inspectConfig(): EffectiveConfig {
  const envFile = resolveEnvFile();
  loadEnv();
  const deprecated = detectDeprecatedEnvVars();
  const store = createConfigStore();
  const stored = store.store as Partial<FlogConfig>;
  const config = mergeConfig(stored);
  const resolvedDataDir = resolveDataDir(config);

  const dataDirSource: ConfigSource = process.env.FLOG_DATA_DIR
    ? "env"
    : stored.dataDir
      ? "conf"
      : "default";
  const destinationSource: ConfigSource = stored.destination ? "conf" : "default";

  const defaultsSource = {} as Record<keyof FlogConfig["defaults"], ConfigSource>;
  for (const key of Object.keys(defaultConfig.defaults) as Array<keyof FlogConfig["defaults"]>) {
    defaultsSource[key] = stored.defaults && stored.defaults[key] !== undefined ? "conf" : "default";
  }

  const tempoSource = {} as Record<keyof TempoConfig, ConfigSource>;
  for (const key of Object.keys(defaultConfig.tempo) as Array<keyof TempoConfig>) {
    const storedHas = stored.tempo && (stored.tempo as Record<string, unknown>)[key] !== undefined;
    const defaultHas = (defaultConfig.tempo as Record<string, unknown>)[key] !== undefined;
    tempoSource[key] = storedHas ? "conf" : defaultHas ? "default" : "missing";
  }
  for (const key of ["issueId", "issueKey", "authorAccountId", "attributes"] as Array<keyof TempoConfig>) {
    if (!tempoSource[key]) {
      const storedHas = stored.tempo && (stored.tempo as Record<string, unknown>)[key] !== undefined;
      tempoSource[key] = storedHas ? "conf" : "missing";
    }
  }

  const tempoToken: ConfigSource = process.env.TEMPO_TOKEN ? "env" : "missing";
  const caBundle: ConfigSource = process.env.FLOG_CA_BUNDLE ? "env" : "missing";

  return {
    config,
    sources: {
      dataDir: dataDirSource,
      destination: destinationSource,
      defaults: defaultsSource,
      tempo: tempoSource,
      tempoToken,
      caBundle
    },
    paths: {
      envFile,
      confStore: store.path,
      dataDir: resolvedDataDir
    },
    deprecated
  };
}

export function resolveDataDir(config: FlogConfig): string {
  return path.resolve(
    process.env.FLOG_DATA_DIR ?? config.dataDir ?? path.join(getInstallRoot(), "worklogs")
  );
}

export function configPathDescription(): string {
  if (process.env.FLOG_CONFIG_DIR) {
    return path.resolve(process.env.FLOG_CONFIG_DIR);
  }
  return paths.config;
}

export function isValidBillableMode(value: string): value is TempoBillableMode {
  return value === "equal" || value === "none";
}

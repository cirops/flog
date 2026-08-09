#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { input, select } from "@inquirer/prompts";
import ora from "ora";
import colors from "picocolors";
import {
  createConfigStore,
  configPathDescription,
  detectDeprecatedEnvVars,
  inspectConfig,
  isValidBillableMode,
  loadConfig,
  resolveDataDir,
  resolveEnvFile,
  getInstallRoot
} from "./config.js";
import { captureCommand } from "./captures/capture.js";
import { createTempoDestination } from "./destinations/tempo.js";
import { addActivity, readDay, readExistingDay, setPeriodTime, undoLastActivity } from "./storage.js";
import { appendSubmission, hasSubmitted, payloadHash, readSubmissions } from "./submissions.js";
import { renderDay, renderPayloadHuman, renderPayloadPreview, renderWeek } from "./render.js";
import { syncFromTempo } from "./sync.js";
import { formatDateLocal, normalizeWeekId, todayIso, validateDate, validateHHMM, weekDates } from "./time.js";
import type { FlogConfig, PeriodName, WorklogPayload } from "./types.js";

type DateOption = { date?: string };

export function expandRelativeDateArgs(argv: string[], now = new Date()): string[] {
  const out: string[] = [];
  for (const token of argv) {
    const match = /^-(\d+)$/.exec(token);
    if (match) {
      const offset = Number(match[1]);
      const date = new Date(now);
      date.setDate(date.getDate() - offset);
      out.push("--date", formatDateLocal(date));
    } else {
      out.push(token);
    }
  }
  return out;
}

export async function main(argv = process.argv): Promise<void> {
  const expanded = [...argv.slice(0, 2), ...expandRelativeDateArgs(argv.slice(2))];
  argv = expanded;
  warnDeprecatedEnvOnce();
  const program = new Command();
  program
    .name("flog")
    .description("Local JSON worklogs with review and Tempo push support.")
    .version("0.1.0")
    .showHelpAfterError();

  activityCommand(program, "morning", "m", "morning");
  activityCommand(program, "afternoon", "a", "afternoon");
  timeCommand(program, "morning-start", "ms", "morning", "start");
  timeCommand(program, "morning-end", "me", "morning", "end");
  timeCommand(program, "afternoon-start", "as", "afternoon", "start");
  timeCommand(program, "afternoon-end", "ae", "afternoon", "end");

  program
    .command("today")
    .description("Show today's worklog.")
    .option("--date <date>", "show a different date")
    .action(async (options: DateOption) => {
      const { config, dataDir } = context();
      const date = options.date ? validateDate(options.date) : todayIso();
      console.log(renderDay(await readDay(dataDir, date, config)));
    });

  program
    .command("week [week]")
    .description("Show worklogs and billable time for an ISO week.")
    .action(async (week?: string) => {
      const { config, dataDir } = context();
      const weekId = normalizeWeekId(week);
      const days = await Promise.all(weekDates(weekId).map((date) => readDay(dataDir, date, config)));
      console.log(renderWeek(days, weekId, config));
    });

  program
    .command("review <scope> [dateOrWeek]")
    .description("Preview destination payloads for a day or week.")
    .option("--date <date>", "day to review")
    .option("--json", "show the raw destination payload JSON")
    .action(async (scope: string, dateOrWeek: string | undefined, options: DateOption & { json?: boolean }) => {
      const { config, dataDir } = context();
      const payloads = await buildPayloads(config, dataDir, scope, dateOrWeek, options.date);
      const submissions = new Map<string, import("./types.js").SubmissionRecord>();
      for (const record of await readSubmissions(dataDir)) {
        if (record.status === "submitted") {
          submissions.set(record.key, record);
        }
      }
      if (options.json) {
        const skipped = new Set<string>(submissions.keys());
        console.log(renderPayloadPreview(payloads, skipped));
      } else {
        console.log(renderPayloadHuman(payloads, submissions, config));
      }
    });

  program
    .command("push <scope> [dateOrWeek]")
    .description("Push worklogs to the configured destination.")
    .option("--date <date>", "day to push")
    .option("--force", "submit even when a matching submission exists")
    .action(async (scope: string, dateOrWeek: string | undefined, options: DateOption & { force?: boolean }) => {
      const { config, dataDir } = context();
      const destination = createTempoDestination(dataDir, config);
      destination.validateConfig(config);
      const payloads = await buildPayloads(config, dataDir, scope, dateOrWeek, options.date);
      let submitted = 0;
      let skipped = 0;
      let failed = 0;
      for (const payload of payloads) {
        const duplicate = await hasSubmitted(dataDir, payload.key);
        if (duplicate && !options.force) {
          console.error(colors.yellow(`skipped ${payload.summary}; already submitted as ${duplicate.externalId ?? payload.key}`));
          skipped += 1;
          continue;
        }
        const spinner = ora(`pushing ${payload.summary}`).start();
        try {
          const result = await destination.submit(payload);
          await appendSubmission(dataDir, {
            schemaVersion: 1,
            key: payload.key,
            destination: payload.destination,
            date: payload.date,
            period: payload.period,
            status: "submitted",
            submittedAt: new Date().toISOString(),
            externalId: result.externalId,
            payloadHash: payloadHash(payload)
          });
          spinner.succeed(`submitted ${payload.summary}${result.externalId ? ` (${result.externalId})` : ""}`);
          submitted += 1;
        } catch (error) {
          await appendSubmission(dataDir, {
            schemaVersion: 1,
            key: payload.key,
            destination: payload.destination,
            date: payload.date,
            period: payload.period,
            status: "failed",
            submittedAt: new Date().toISOString(),
            payloadHash: payloadHash(payload),
            error: error instanceof Error ? error.message : String(error)
          });
          spinner.fail(`failed ${payload.summary}`);
          failed += 1;
        }
      }
      console.error(`${submitted} submitted, ${skipped} skipped, ${failed} failed.`);
      if (failed > 0) {
        process.exitCode = 1;
      }
    });

  program
    .command("sync <scope> [dateOrWeek]")
    .description("Pull worklogs from Tempo and record them locally to avoid duplicates.")
    .option("--date <date>", "day to sync")
    .option("--no-populate", "skip creating/updating local day files")
    .action(
      async (
        scope: string,
        dateOrWeek: string | undefined,
        options: DateOption & { populate?: boolean }
      ) => {
        const { config, dataDir } = context();
        const dates = resolveSyncDates(scope, dateOrWeek, options.date);
        const spinner = ora(`syncing ${scope} ${dates[0]}${dates.length > 1 ? `..${dates[dates.length - 1]}` : ""}`).start();
        try {
          const stats = await syncFromTempo(config, dataDir, dates, {
            populateLocal: options.populate !== false
          });
          spinner.succeed(
            `${stats.synced} synced, ${stats.alreadyKnown} already known, ${stats.localPopulated} days populated, ${stats.localConflicts} local conflicts (skipped merge)`
          );
        } catch (error) {
          spinner.fail(`sync failed: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
      }
    );

  program
    .command("doctor")
    .description("Print the effective configuration with the source of each value.")
    .action(async () => doctor());

  program
    .command("setup")
    .description("Configure local non-secret defaults and edit the .env for secrets.")
    .action(async () => setup());

  program
    .command("undo")
    .description("Remove the most recently created activity.")
    .action(async () => {
      const { dataDir } = context();
      const result = await undoLastActivity(dataDir);
      if (!result) {
        throw new Error("No activity to undo.");
      }
      console.error(`Removed activity ${result.activityId} from ${result.day.date}.`);
    });

  program
    .command("capture [raw...]")
    .description("Capture a matching shell command as a pending entry for the day.")
    .option("--date <date>", "capture for a different date")
    .action(async (rawParts: string[], options: DateOption) => {
      const { dataDir } = context();
      const date = options.date ? validateDate(options.date) : todayIso();
      const outcome = await captureCommand(dataDir, (rawParts ?? []).join(" "), new Date(), date);
      if (outcome === "captured") {
        console.error(`Captured pending entry for ${date}.`);
      }
    });

  await program.parseAsync(argv);
}

function activityCommand(program: Command, name: string, alias: string, period: PeriodName): void {
  program
    .command(`${name} <content...>`)
    .alias(alias)
    .description(`Add a ${period} activity.`)
    .option("--date <date>", "record activity for a different date")
    .action(async (contentParts: string[], options: DateOption) => {
      const { config, dataDir } = context();
      const date = options.date ? validateDate(options.date) : todayIso();
      const content = contentParts.join(" ");
      await addActivity(dataDir, date, period, "", content, config);
      console.error(`Added ${period} activity for ${date}: ${content}`);
    });
}

function timeCommand(
  program: Command,
  name: string,
  alias: string,
  period: PeriodName,
  field: "start" | "end"
): void {
  program
    .command(`${name} <time>`)
    .alias(alias)
    .description(`Set ${period} ${field} time.`)
    .option("--date <date>", "set time for a different date")
    .action(async (time: string, options: DateOption) => {
      const { config, dataDir } = context();
      const date = options.date ? validateDate(options.date) : todayIso();
      await setPeriodTime(dataDir, date, period, field, validateHHMM(time), config);
      console.error(`Set ${period} ${field} for ${date} to ${time}.`);
    });
}

function context(): { config: FlogConfig; dataDir: string } {
  const config = loadConfig();
  return { config, dataDir: resolveDataDir(config) };
}

async function buildPayloads(
  config: FlogConfig,
  dataDir: string,
  scope: string,
  dateOrWeek: string | undefined,
  dateOption: string | undefined
): Promise<WorklogPayload[]> {
  const destination = createTempoDestination(dataDir, config);
  if (scope === "day") {
    const date = resolveDayDate(dateOrWeek, dateOption);
    return destination.buildPayloads([date]);
  }
  if (scope === "week") {
    return destination.buildPayloads(weekDates(normalizeWeekId(dateOrWeek)));
  }
  throw new Error("Scope must be day or week.");
}

function resolveSyncDates(
  scope: string,
  positional: string | undefined,
  dateOption: string | undefined
): string[] {
  if (scope === "day") {
    return [resolveDayDate(positional, dateOption)];
  }
  if (scope === "week") {
    return weekDates(normalizeWeekId(positional));
  }
  throw new Error("Scope must be day or week.");
}

function resolveDayDate(positionalDate: string | undefined, dateOption: string | undefined): string {
  if (positionalDate && dateOption) {
    throw new Error("Provide the day date either as a positional argument or --date, not both.");
  }
  if (positionalDate) {
    return validateDate(positionalDate);
  }
  if (dateOption) {
    return validateDate(dateOption);
  }
  return todayIso();
}

function warnDeprecatedEnvOnce(): void {
  const deprecated = detectDeprecatedEnvVars();
  if (deprecated.length === 0) {
    return;
  }
  console.error(
    colors.yellow(
      `warning: ${deprecated.join(", ")} found in environment but no longer used. Run 'flog setup' to migrate to the Conf store, then remove them from your .env or shell.`
    )
  );
}

async function doctor(): Promise<void> {
  const info = inspectConfig();
  const lines: string[] = [];
  lines.push(colors.bold("Paths"));
  lines.push(`  .env file:    ${info.paths.envFile ?? colors.dim("(not found)")}`);
  lines.push(`  Conf store:   ${info.paths.confStore}`);
  lines.push(`  Data dir:     ${info.paths.dataDir} ${tag(info.sources.dataDir)}`);
  lines.push("");

  lines.push(colors.bold("Secrets (env-only)"));
  lines.push(`  TEMPO_TOKEN:     ${maskSecret(process.env.TEMPO_TOKEN)} ${tag(info.sources.tempoToken)}`);
  lines.push(`  FLOG_CA_BUNDLE:  ${process.env.FLOG_CA_BUNDLE ?? colors.dim("(unset)")} ${tag(info.sources.caBundle)}`);
  lines.push("");

  lines.push(colors.bold("Tempo (Conf store)"));
  for (const key of Object.keys(info.config.tempo) as Array<keyof typeof info.config.tempo>) {
    const raw = info.config.tempo[key];
    const value = raw === undefined ? colors.dim("(missing)") : typeof raw === "object" ? JSON.stringify(raw) : String(raw);
    lines.push(`  ${key.padEnd(20)} ${value} ${tag(info.sources.tempo[key])}`);
  }
  lines.push("");

  lines.push(colors.bold("Defaults (Conf store)"));
  for (const key of Object.keys(info.config.defaults) as Array<keyof typeof info.config.defaults>) {
    lines.push(`  ${key.padEnd(20)} ${info.config.defaults[key]} ${tag(info.sources.defaults[key])}`);
  }
  lines.push("");

  lines.push(colors.bold("Destination"));
  lines.push(`  destination:         ${info.config.destination} ${tag(info.sources.destination)}`);

  if (info.deprecated.length > 0) {
    lines.push("");
    lines.push(colors.yellow(colors.bold("Deprecated env vars still set (ignored)")));
    for (const name of info.deprecated) {
      lines.push(colors.yellow(`  ${name}`));
    }
    lines.push(colors.dim("  → run 'flog setup' to migrate these into the Conf store."));
  }

  console.log(lines.join("\n"));
}

function tag(source: import("./config.js").ConfigSource): string {
  const label = `[${source}]`;
  if (source === "env") return colors.cyan(label);
  if (source === "conf") return colors.green(label);
  if (source === "default") return colors.dim(label);
  return colors.red(label);
}

function maskSecret(value: string | undefined): string {
  if (!value) return colors.dim("(unset)");
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}…${value.slice(-3)}`;
}

async function setup(): Promise<void> {
  const config = loadConfig();
  const store = createConfigStore();

  const deprecated = detectDeprecatedEnvVars();
  if (deprecated.length > 0) {
    console.error(colors.yellow(`Migrating deprecated env vars into the Conf store: ${deprecated.join(", ")}`));
  }

  console.log(colors.bold("\n— Paths and destination —"));
  const dataDir = await input({
    message: "Worklog data directory",
    default: config.dataDir ?? resolveDataDir(config)
  });
  const destination = await select({
    message: "Active destination",
    choices: [{ name: "Tempo", value: "tempo" as const }],
    default: config.destination
  });

  console.log(colors.bold("\n— Tempo (non-secret) —"));
  const apiUrl = await input({
    message: "Tempo API URL",
    default: process.env.TEMPO_API_URL ?? config.tempo.apiUrl
  });
  const issueId = await input({
    message: "Tempo issue id",
    default: legacyDefault(process.env.TEMPO_ISSUE_ID, config.tempo.issueId)
  });
  const issueKey = await input({
    message: "Tempo issue key",
    default: process.env.TEMPO_ISSUE_KEY ?? config.tempo.issueKey ?? ""
  });
  const authorAccountId = await input({
    message: "Tempo author account id",
    default: process.env.TEMPO_AUTHOR_ACCOUNT_ID ?? config.tempo.authorAccountId ?? ""
  });
  const descriptionFormat = await input({
    message: "Tempo description format",
    default: process.env.TEMPO_DESCRIPTION_FORMAT ?? config.tempo.descriptionFormat
  });
  const billableModeInput = await select({
    message: "Tempo billable mode",
    choices: [
      { name: "equal (billable = total)", value: "equal" as const },
      { name: "none (billable = 0)", value: "none" as const }
    ],
    default: process.env.TEMPO_BILLABLE_MODE && isValidBillableMode(process.env.TEMPO_BILLABLE_MODE)
      ? process.env.TEMPO_BILLABLE_MODE
      : config.tempo.billableMode
  });

  console.log(colors.bold("\n— Daily defaults —"));
  const morningStart = await input({ message: "Morning start (HH:MM)", default: config.defaults.morningStart });
  const morningEnd = await input({ message: "Morning end (HH:MM)", default: config.defaults.morningEnd });
  const afternoonStart = await input({ message: "Afternoon start (HH:MM)", default: config.defaults.afternoonStart });
  const afternoonEnd = await input({ message: "Afternoon end (HH:MM)", default: config.defaults.afternoonEnd });
  const dailyTargetHours = await input({
    message: "Daily target hours",
    default: String(config.defaults.dailyTargetHours)
  });

  console.log(colors.bold("\n— Secrets (written to .env) —"));
  const tempoToken = await input({
    message: "TEMPO_TOKEN (leave blank to keep current)",
    default: ""
  });
  const caBundle = await input({
    message: "FLOG_CA_BUNDLE path (leave blank to keep current)",
    default: ""
  });

  store.set("dataDir", dataDir);
  store.set("destination", destination);
  store.set("defaults", {
    morningStart: validateHHMM(morningStart),
    morningEnd: validateHHMM(morningEnd),
    afternoonStart: validateHHMM(afternoonStart),
    afternoonEnd: validateHHMM(afternoonEnd),
    dailyTargetHours: Number(dailyTargetHours)
  });
  store.set("tempo", {
    apiUrl,
    issueId: issueId ? Number(issueId) : undefined,
    issueKey: issueKey || undefined,
    authorAccountId: authorAccountId || undefined,
    descriptionFormat,
    billableMode: billableModeInput,
    attributes: config.tempo.attributes
  });

  const envUpdates: Record<string, string> = {};
  if (tempoToken.trim()) envUpdates.TEMPO_TOKEN = tempoToken.trim();
  if (caBundle.trim()) envUpdates.FLOG_CA_BUNDLE = caBundle.trim();
  const envFilePath = await writeEnvUpdates(envUpdates);

  console.log("");
  console.log(colors.green(`Saved Conf store to ${configPathDescription()}/config.json.`));
  if (Object.keys(envUpdates).length > 0 && envFilePath) {
    console.log(colors.green(`Updated secrets in ${envFilePath}.`));
  } else {
    console.log(colors.dim(`Secrets untouched. Edit ${resolveEnvFile() ?? path.join(getInstallRoot(), ".env")} manually to change TEMPO_TOKEN/FLOG_CA_BUNDLE.`));
  }
  if (deprecated.length > 0) {
    console.log(colors.yellow(`You can now remove these from your .env / shell: ${deprecated.join(", ")}`));
  }
  console.log(colors.dim(`Run 'flog doctor' to inspect the effective configuration.`));
}

function legacyDefault(envValue: string | undefined, confValue: number | undefined): string | undefined {
  if (envValue) return envValue;
  if (confValue !== undefined) return String(confValue);
  return undefined;
}

async function writeEnvUpdates(updates: Record<string, string>): Promise<string | undefined> {
  if (Object.keys(updates).length === 0) {
    return undefined;
  }
  const { readFile, writeFile } = await import("node:fs/promises");
  const target = resolveEnvFile() ?? path.join(getInstallRoot(), ".env");
  let body = "";
  try {
    body = await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const lines = body.length > 0 ? body.split("\n") : [];
  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`^\\s*${key}\\s*=.*$`);
    const index = lines.findIndex((line) => pattern.test(line));
    const newLine = `${key}=${value}`;
    if (index >= 0) {
      lines[index] = newLine;
    } else {
      if (lines.length > 0 && lines[lines.length - 1] !== "") {
        lines.push("");
      }
      lines.push(newLine);
    }
  }
  if (lines[lines.length - 1] !== "") {
    lines.push("");
  }
  await writeFile(target, lines.join("\n"), "utf8");
  return target;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(colors.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}

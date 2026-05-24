#!/usr/bin/env node
import { Command } from "commander";
import { input, select } from "@inquirer/prompts";
import ora from "ora";
import colors from "picocolors";
import { createConfigStore, configPathDescription, loadConfig, resolveDataDir } from "./config.js";
import { createTempoDestination } from "./destinations/tempo.js";
import { addActivity, readDay, readExistingDay, setPeriodTime, undoLastActivity } from "./storage.js";
import { appendSubmission, hasSubmitted, payloadHash } from "./submissions.js";
import { renderDay, renderPayloadPreview, renderWeek } from "./render.js";
import { normalizeWeekId, todayIso, validateDate, validateHHMM, weekDates } from "./time.js";
import type { FlogConfig, PeriodName, WorklogPayload } from "./types.js";

type DateOption = { date?: string };

export async function main(argv = process.argv): Promise<void> {
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
    .action(async (scope: string, dateOrWeek: string | undefined, options: DateOption) => {
      const { config, dataDir } = context();
      const payloads = await buildPayloads(config, dataDir, scope, dateOrWeek, options.date);
      const skipped = new Set<string>();
      for (const payload of payloads) {
        if (await hasSubmitted(dataDir, payload.key)) {
          skipped.add(payload.key);
        }
      }
      console.log(renderPayloadPreview(payloads, skipped));
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
    .command("setup")
    .description("Configure local non-secret defaults.")
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

  await program.parseAsync(argv);
}

function activityCommand(program: Command, name: string, alias: string, period: PeriodName): void {
  program
    .command(`${name} <id> <description...>`)
    .alias(alias)
    .description(`Add a ${period} activity.`)
    .option("--date <date>", "record activity for a different date")
    .action(async (id: string, descriptionParts: string[], options: DateOption) => {
      const { config, dataDir } = context();
      const date = options.date ? validateDate(options.date) : todayIso();
      const description = descriptionParts.join(" ");
      await addActivity(dataDir, date, period, id, description, config);
      console.error(`Added ${period} activity for ${date}: ${id} - ${description}`);
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

async function setup(): Promise<void> {
  const config = loadConfig();
  const store = createConfigStore();
  const dataDir = await input({
    message: "Worklog data directory",
    default: config.dataDir ?? resolveDataDir(config)
  });
  const destination = await select({
    message: "Active destination",
    choices: [{ name: "Tempo", value: "tempo" as const }],
    default: config.destination
  });
  const issueId = await input({
    message: "Tempo issue id",
    default: config.tempo.issueId ? String(config.tempo.issueId) : undefined
  });
  const issueKey = await input({
    message: "Tempo issue key",
    default: config.tempo.issueKey
  });
  const authorAccountId = await input({
    message: "Tempo author account id",
    default: config.tempo.authorAccountId
  });

  store.set("dataDir", dataDir);
  store.set("destination", destination);
  store.set("tempo", {
    ...config.tempo,
    issueId: issueId ? Number(issueId) : undefined,
    issueKey: issueKey || undefined,
    authorAccountId: authorAccountId || undefined
  });

  console.log(`Saved config to ${configPathDescription()}. Put TEMPO_TOKEN in .env or your shell environment.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(colors.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}

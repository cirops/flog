import { checkbox, input, select } from "@inquirer/prompts";
import { readDay } from "../storage.js";
import type { FlogConfig, PeriodName } from "../types.js";
import { defaultPeriodForCapture } from "./period.js";
import { prefillFromRaw } from "./prefill.js";
import { discardCapture, promoteCapture } from "./promote.js";
import { listPending } from "./storage.js";
import type { CaptureEntry } from "./types.js";

export type PendingAction = "promote" | "discard" | "cancel";

export type PendingChoice = {
  name: string;
  value: string;
};

export type PendingPrompts = {
  checkbox: (config: {
    message: string;
    choices: Array<{ name: string; value: string }>;
  }) => Promise<string[]>;
  input: (config: { message: string; default?: string }) => Promise<string>;
  select: (config: {
    message: string;
    choices: Array<{ name: string; value: string }>;
    default?: string;
  }) => Promise<string>;
};

export type RunPendingCliOptions = {
  dataDir: string;
  config: FlogConfig;
  date: string;
  prompts?: PendingPrompts;
  log?: (message: string) => void;
  now?: Date;
};

const defaultPrompts: PendingPrompts = { checkbox, input, select };

export async function pendingChoices(dataDir: string, date: string): Promise<PendingChoice[]> {
  const pending = await listPending(dataDir, date);
  return pending.map((entry) => ({
    name: formatCaptureChoice(entry),
    value: entry.id
  }));
}

export async function runPendingCli(options: RunPendingCliOptions): Promise<void> {
  const {
    dataDir,
    config,
    date,
    prompts = defaultPrompts,
    log = (message) => console.error(message),
    now = new Date()
  } = options;

  const choices = await pendingChoices(dataDir, date);
  if (choices.length === 0) {
    log(`Nothing pending for ${date}.`);
    return;
  }

  const selectedIds = await prompts.checkbox({
    message: `Pending captures for ${date}`,
    choices
  });
  if (selectedIds.length === 0) {
    log("No captures selected.");
    return;
  }

  const action = (await prompts.select({
    message: "Action for selection",
    choices: [
      { name: "Promote", value: "promote" as const },
      { name: "Discard", value: "discard" as const },
      { name: "Cancel", value: "cancel" as const }
    ]
  })) as PendingAction;

  if (action === "cancel") {
    log("Cancelled. Pending captures unchanged.");
    return;
  }

  if (action === "discard") {
    for (const id of selectedIds) {
      await discardCapture(dataDir, date, id, now);
    }
    log(`Discarded ${selectedIds.length} capture(s) for ${date}.`);
    return;
  }

  const pending = await listPending(dataDir, date);
  const byId = new Map(pending.map((entry) => [entry.id, entry]));
  for (const id of selectedIds) {
    const entry = byId.get(id);
    if (!entry) {
      continue;
    }
    const promoted = await promoteOne({
      dataDir,
      config,
      date,
      entry,
      prompts,
      now,
      log
    });
    if (!promoted) {
      log("Promote cancelled. Remaining selected captures stay pending.");
      return;
    }
  }
}

async function promoteOne(options: {
  dataDir: string;
  config: FlogConfig;
  date: string;
  entry: CaptureEntry;
  prompts: PendingPrompts;
  now: Date;
  log: (message: string) => void;
}): Promise<boolean> {
  const { dataDir, config, date, entry, prompts, now, log } = options;
  const prefill = prefillFromRaw(entry.raw);
  const day = await readDay(dataDir, date, config);
  const defaultPeriod = defaultPeriodForCapture(entry.capturedAt, day);

  try {
    const id = await prompts.input({
      message: `Activity id for: ${entry.raw}`,
      default: prefill.id
    });
    const description = await prompts.input({
      message: `Description for: ${entry.raw}`,
      default: prefill.description
    });
    const period = (await prompts.select({
      message: "Period",
      choices: [
        { name: "morning", value: "morning" as const },
        { name: "afternoon", value: "afternoon" as const }
      ],
      default: defaultPeriod
    })) as PeriodName;

    await promoteCapture(dataDir, date, entry.id, id, description, period, config, now);
    log(`Promoted capture into ${period} for ${date}.`);
    return true;
  } catch (error) {
    if (isPromptCancel(error)) {
      return false;
    }
    throw error;
  }
}

function formatCaptureChoice(entry: CaptureEntry): string {
  const time = entry.capturedAt.includes("T")
    ? entry.capturedAt.slice(11, 16)
    : entry.capturedAt;
  return `${time}  ${entry.raw}`;
}

function isPromptCancel(error: unknown): boolean {
  return error instanceof Error && error.name === "ExitPromptError";
}

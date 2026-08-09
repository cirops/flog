import assert from "node:assert/strict";
import { closeSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  pendingChoices,
  runPendingCli,
  type PendingPrompts
} from "../src/captures/pending-cli.js";
import { appendCapture, listPending, setCaptureStatus } from "../src/captures/storage.js";
import { defaultConfig } from "../src/config.js";
import { readDay } from "../src/storage.js";
import type { FlogConfig } from "../src/types.js";

let dataDir: string;
let configDir: string;
const config: FlogConfig = { ...defaultConfig };

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "flog-pending-data-"));
  configDir = await mkdtemp(path.join(os.tmpdir(), "flog-pending-config-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  await rm(configDir, { recursive: true, force: true });
});

describe("pendingChoices", () => {
  it("returns only pending captures for the target day", async () => {
    const a = await appendCapture(dataDir, "2026-05-23", "git checkout -b feature/a");
    const b = await appendCapture(dataDir, "2026-05-23", "git checkout -b feature/b");
    assert.ok(a && b);
    await setCaptureStatus(dataDir, "2026-05-23", b.id, "discarded", {
      discardedAt: new Date().toISOString()
    });
    await appendCapture(dataDir, "2026-05-24", "git checkout -b feature/other-day");

    const choices = await pendingChoices(dataDir, "2026-05-23");
    assert.equal(choices.length, 1);
    assert.equal(choices[0].value, a.id);
    assert.match(choices[0].name, /git checkout -b feature\/a/);
  });
});

describe("runPendingCli", () => {
  it("prints a success message when nothing is pending", async () => {
    const lines: string[] = [];
    await runPendingCli({
      dataDir,
      config,
      date: "2026-05-23",
      log: (message) => lines.push(message)
    });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /nothing pending/i);
    assert.match(lines[0], /2026-05-23/);
  });

  it("discards selected captures and leaves unselected pending", async () => {
    const keep = await appendCapture(dataDir, "2026-05-23", "git checkout -b keep");
    const junk = await appendCapture(dataDir, "2026-05-23", "git checkout -b junk");
    assert.ok(keep && junk);

    await runPendingCli({
      dataDir,
      config,
      date: "2026-05-23",
      prompts: fakePrompts({
        selectedIds: [junk.id],
        action: "discard"
      })
    });

    const pending = await listPending(dataDir, "2026-05-23");
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, keep.id);
  });

  it("cancel leaves all selected statuses unchanged", async () => {
    const entry = await appendCapture(dataDir, "2026-05-23", "git checkout -b stay");
    assert.ok(entry);

    await runPendingCli({
      dataDir,
      config,
      date: "2026-05-23",
      prompts: fakePrompts({
        selectedIds: [entry.id],
        action: "cancel"
      })
    });

    const pending = await listPending(dataDir, "2026-05-23");
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, entry.id);
  });

  it("promotes a selected capture with prefill defaults", async () => {
    const entry = await appendCapture(
      dataDir,
      "2026-05-23",
      "git checkout -b feature/icms-ui_tax4b_120999",
      new Date("2026-05-23T10:00:00")
    );
    assert.ok(entry);

    await runPendingCli({
      dataDir,
      config,
      date: "2026-05-23",
      prompts: fakePrompts({
        selectedIds: [entry.id],
        action: "promote",
        acceptDefaults: true
      })
    });

    const pending = await listPending(dataDir, "2026-05-23");
    assert.equal(pending.length, 0);
    const day = await readDay(dataDir, "2026-05-23", config);
    assert.equal(day.morning.activities.length, 1);
    assert.equal(day.morning.activities[0].id, "120999");
    assert.match(day.morning.activities[0].description, /icms/i);
  });

  it("mid-promote cancel leaves the current capture pending", async () => {
    const first = await appendCapture(dataDir, "2026-05-23", "git checkout -b feature/one_1");
    const second = await appendCapture(dataDir, "2026-05-23", "git checkout -b feature/two_2");
    assert.ok(first && second);

    await runPendingCli({
      dataDir,
      config,
      date: "2026-05-23",
      prompts: fakePrompts({
        selectedIds: [first.id, second.id],
        action: "promote",
        cancelOnDescriptionForId: first.id
      })
    });

    const pending = await listPending(dataDir, "2026-05-23");
    assert.equal(pending.length, 2);
    assert.deepEqual(
      pending.map((item) => item.id).sort(),
      [first.id, second.id].sort()
    );
  });
});

describe("flog pending CLI", () => {
  it("exits successfully with a message when nothing is pending for a date", async () => {
    const result = await runCli(["pending", "--date", "2026-05-23"]);
    assert.match(result.stderr + result.stdout, /nothing pending/i);
  });
});

function fakePrompts(options: {
  selectedIds: string[];
  action: "promote" | "discard" | "cancel";
  acceptDefaults?: boolean;
  cancelOnDescriptionForId?: string;
}): PendingPrompts {
  let actionAsked = false;
  return {
    async checkbox() {
      return options.selectedIds;
    },
    async select(config) {
      if (!actionAsked) {
        actionAsked = true;
        return options.action;
      }
      return config.default ?? "morning";
    },
    async input(config) {
      const message = String(config.message ?? "");
      if (
        options.cancelOnDescriptionForId &&
        message.toLowerCase().includes("description")
      ) {
        const error = new Error("User force closed the prompt");
        error.name = "ExitPromptError";
        throw error;
      }
      return String(config.default ?? "");
    }
  };
}

async function runCli(
  args: string[],
  expectedCode = 0
): Promise<{ stdout: string; stderr: string }> {
  const captureBase = path.join(dataDir, `capture-${process.pid}-${Date.now()}-${Math.random()}`);
  const stdoutPath = `${captureBase}.stdout`;
  const stderrPath = `${captureBase}.stderr`;
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");
  const env: Record<string, string | undefined> = {
    ...process.env,
    FLOG_DATA_DIR: dataDir,
    FLOG_CONFIG_DIR: configDir,
    FLOG_ENV_FILE: "/dev/null",
    NO_COLOR: "1"
  };
  for (const key of [
    "TEMPO_TOKEN",
    "TEMPO_API_URL",
    "TEMPO_ISSUE_ID",
    "TEMPO_ISSUE_KEY",
    "TEMPO_AUTHOR_ACCOUNT_ID",
    "TEMPO_DESCRIPTION_FORMAT",
    "TEMPO_BILLABLE_MODE",
    "TEMPO_ATTRIBUTES",
    "FLOG_CA_BUNDLE"
  ]) {
    delete env[key];
  }
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    cwd: path.resolve("."),
    env: env as NodeJS.ProcessEnv,
    stdio: ["ignore", stdoutFd, stderrFd]
  });
  closeSync(stdoutFd);
  closeSync(stderrFd);
  const stdout = readFileSync(stdoutPath, "utf8");
  const stderr = readFileSync(stderrPath, "utf8");
  unlinkSync(stdoutPath);
  unlinkSync(stderrPath);
  assert.equal(result.status, expectedCode, stderr);
  return { stdout, stderr };
}

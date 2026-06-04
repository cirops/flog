import assert from "node:assert/strict";
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

let tmp: string;
let configDir: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "flog-cli-data-"));
  configDir = await mkdtemp(path.join(os.tmpdir(), "flog-cli-config-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  await rm(configDir, { recursive: true, force: true });
});

describe("CLI aliases", () => {
  it("supports m/a and ms/me/as/ae aliases with single-arg content", async () => {
    await run(["m", "--date", "2026-05-23", "123 - Morning task"]);
    await run(["a", "--date", "2026-05-23", "456 - Afternoon task"]);
    await run(["ms", "--date", "2026-05-23", "07:30"]);
    await run(["me", "--date", "2026-05-23", "13:00"]);
    await run(["as", "--date", "2026-05-23", "13:50"]);
    await run(["ae", "--date", "2026-05-23", "19:00"]);

    const raw = JSON.parse(await readFile(path.join(tmp, "2026", "05", "2026-05-23.json"), "utf8"));
    assert.equal(raw.morning.start, "07:30");
    assert.equal(raw.morning.end, "13:00");
    assert.equal(raw.afternoon.start, "13:50");
    assert.equal(raw.afternoon.end, "19:00");
    assert.equal(raw.morning.activities[0].id, "");
    assert.equal(raw.morning.activities[0].description, "123 - Morning task");
    assert.equal(raw.afternoon.activities[0].id, "");
    assert.equal(raw.afternoon.activities[0].description, "456 - Afternoon task");
  });

  it("expands -N into --date YYYY-MM-DD relative to today", async () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yyyy = yesterday.getFullYear();
    const mm = String(yesterday.getMonth() + 1).padStart(2, "0");
    const dd = String(yesterday.getDate()).padStart(2, "0");
    const iso = `${yyyy}-${mm}-${dd}`;

    await run(["a", "-1", "Some task from yesterday"]);
    const raw = JSON.parse(await readFile(path.join(tmp, yyyy.toString(), mm, `${iso}.json`), "utf8"));
    assert.equal(raw.afternoon.activities[0].description, "Some task from yesterday");
  });
});

describe("review day", () => {
  it("accepts a positional date and shows a human-readable summary by default", async () => {
    seedTempoConfig();
    await run(["m", "--date", "2026-05-23", "123 - Morning task"]);
    await run(["ms", "--date", "2026-05-23", "08:00"]);
    await run(["me", "--date", "2026-05-23", "10:30"]);

    const result = await run(["review", "day", "2026-05-23"]);
    const output = stripAnsi(result.stdout);

    assert.match(output, /morning 08:00.10:30 \(2h30\)/);
    assert.match(output, /123 - Morning task/);
    assert.doesNotMatch(output, /"timeSpentSeconds"/);
  });

  it("dumps the raw payload when --json is passed", async () => {
    seedTempoConfig();
    await run(["m", "--date", "2026-05-23", "123 - Morning task"]);
    await run(["ms", "--date", "2026-05-23", "08:00"]);
    await run(["me", "--date", "2026-05-23", "10:30"]);

    const result = await run(["review", "day", "2026-05-23", "--json"]);

    assert.match(result.stdout, /"timeSpentSeconds": 9000/);
  });

  it("rejects both positional date and --date together", async () => {
    const result = await run(
      ["review", "day", "2026-05-23", "--date", "2026-05-24"],
      undefined,
      1
    );

    assert.match(result.stderr, /positional argument or --date, not both/);
  });
});

describe("week totals", () => {
  it("counts Saturday activity in the main weekly billable total", async () => {
    await run(["m", "--date", "2026-05-23", "123 - Saturday task"]);
    await run(["ms", "--date", "2026-05-23", "08:00"]);
    await run(["me", "--date", "2026-05-23", "10:30"]);

    const result = await run(["week", "2026-W21"]);
    const output = stripAnsi(result.stdout);

    assert.match(output, /2026-W21\s+│\s+2h30\s+│\s+8h\s+│\s+-5h30/);
    assert.doesNotMatch(output, /Weekend/);
  });
});

function seedTempoConfig(): void {
  const json = {
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
      billableMode: "equal",
      issueId: 12345,
      issueKey: "PROJ-123",
      authorAccountId: "account-1"
    }
  };
  writeFileSync(path.join(configDir, "config.json"), JSON.stringify(json));
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

async function run(
  args: string[],
  extraEnv: Record<string, string> = {},
  expectedCode = 0
): Promise<{ stdout: string; stderr: string }> {
  const captureBase = path.join(tmp, `capture-${process.pid}-${Date.now()}-${Math.random()}`);
  const stdoutPath = `${captureBase}.stdout`;
  const stderrPath = `${captureBase}.stderr`;
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");
  const env: Record<string, string | undefined> = {
    ...process.env,
    FLOG_DATA_DIR: tmp,
    FLOG_CONFIG_DIR: configDir,
    FLOG_ENV_FILE: "/dev/null",
    NO_COLOR: "1",
    ...extraEnv
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
    if (!(key in extraEnv)) {
      delete env[key];
    }
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

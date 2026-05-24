import assert from "node:assert/strict";
import { closeSync, openSync, readFileSync, unlinkSync } from "node:fs";
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
  it("supports m/a and ms/me/as/ae aliases", async () => {
    await run(["m", "--date", "2026-05-23", "123", "Morning task"]);
    await run(["a", "--date", "2026-05-23", "456", "Afternoon task"]);
    await run(["ms", "--date", "2026-05-23", "07:30"]);
    await run(["me", "--date", "2026-05-23", "13:00"]);
    await run(["as", "--date", "2026-05-23", "13:50"]);
    await run(["ae", "--date", "2026-05-23", "19:00"]);

    const raw = JSON.parse(await readFile(path.join(tmp, "2026", "05", "2026-05-23.json"), "utf8"));
    assert.equal(raw.morning.start, "07:30");
    assert.equal(raw.morning.end, "13:00");
    assert.equal(raw.afternoon.start, "13:50");
    assert.equal(raw.afternoon.end, "19:00");
    assert.equal(raw.morning.activities[0].description, "Morning task");
    assert.equal(raw.afternoon.activities[0].id, "456");
  });
});

describe("review day", () => {
  it("accepts a positional date and shows readable billable time with the raw payload", async () => {
    await run(["m", "--date", "2026-05-23", "123", "Morning task"]);
    await run(["ms", "--date", "2026-05-23", "08:00"]);
    await run(["me", "--date", "2026-05-23", "10:30"]);

    const result = await run(["review", "day", "2026-05-23"], tempoEnv());

    assert.match(result.stdout, /billable time: 2h30/);
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
    await run(["m", "--date", "2026-05-23", "123", "Saturday task"]);
    await run(["ms", "--date", "2026-05-23", "08:00"]);
    await run(["me", "--date", "2026-05-23", "10:30"]);

    const result = await run(["week", "2026-W21"]);
    const output = stripAnsi(result.stdout);

    assert.match(output, /2026-W21\s+│\s+2h30\s+│\s+8h\s+│\s+-5h30/);
    assert.doesNotMatch(output, /Weekend/);
  });
});

function tempoEnv(): Record<string, string> {
  return {
    TEMPO_ISSUE_ID: "12345",
    TEMPO_AUTHOR_ACCOUNT_ID: "account-1"
  };
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
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      FLOG_DATA_DIR: tmp,
      FLOG_CONFIG_DIR: configDir,
      NO_COLOR: "1",
      ...extraEnv
    },
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

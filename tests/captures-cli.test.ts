import assert from "node:assert/strict";
import { closeSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { HOOK_END_MARKER, HOOK_START_MARKER } from "../src/captures/hooks.js";

let tmp: string;
let configDir: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "flog-cap-cli-data-"));
  configDir = await mkdtemp(path.join(os.tmpdir(), "flog-cap-cli-config-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  await rm(configDir, { recursive: true, force: true });
});

describe("flog capture", () => {
  it("captures a matching command for the given date", async () => {
    const result = await run([
      "capture",
      "--date",
      "2026-05-23",
      "--",
      "git",
      "checkout",
      "-b",
      "feature/x_1"
    ]);
    assert.match(result.stderr, /captured/i);

    const raw = JSON.parse(
      await readFile(path.join(tmp, "captures", "2026", "05", "2026-05-23.json"), "utf8")
    );
    assert.equal(raw.captures.length, 1);
    assert.equal(raw.captures[0].raw, "git checkout -b feature/x_1");
    assert.equal(raw.captures[0].status, "pending");
  });

  it("exits non-zero when capture text is empty", async () => {
    const result = await run(["capture"], {}, 1);
    assert.match(result.stderr, /capture text is required/i);
  });

  it("exits 0 quietly on no-match", async () => {
    const result = await run(["capture", "--date", "2026-05-23", "git", "status"]);
    assert.equal(result.stdout.trim(), "");
    await assert.rejects(
      () => readFile(path.join(tmp, "captures", "2026", "05", "2026-05-23.json"), "utf8"),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT"
    );
  });
});

describe("flog hook", () => {
  it("installs a marked block into a temp rc and removes it on uninstall", async () => {
    const rcPath = path.join(configDir, ".zshrc");
    await writeFile(rcPath, "# user rc\n", "utf8");

    await run(["hook", "install", "--rc", rcPath]);
    const installed = await readFile(rcPath, "utf8");
    assert.match(installed, new RegExp(HOOK_START_MARKER));
    assert.match(installed, new RegExp(HOOK_END_MARKER));
    assert.match(installed, /capture-wrappers\.sh/);
    assert.match(installed, /# user rc/);

    const wrappers = await readFile(path.join(configDir, "capture-wrappers.sh"), "utf8");
    assert.match(wrappers, /command git "\$@"/);

    await run(["hook", "uninstall", "--rc", rcPath]);
    const removed = await readFile(rcPath, "utf8");
    assert.doesNotMatch(removed, new RegExp(HOOK_START_MARKER));
    assert.doesNotMatch(removed, new RegExp(HOOK_END_MARKER));
    assert.match(removed, /# user rc/);
  });
});

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

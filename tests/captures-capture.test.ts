import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { captureCommand } from "../src/captures/capture.js";
import { listPending, readDayCaptures } from "../src/captures/storage.js";

let dataDir: string;
let configDir: string;
let previousConfigDir: string | undefined;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "flog-capture-data-"));
  configDir = await mkdtemp(path.join(os.tmpdir(), "flog-capture-config-"));
  previousConfigDir = process.env.FLOG_CONFIG_DIR;
  process.env.FLOG_CONFIG_DIR = configDir;
});

afterEach(async () => {
  if (previousConfigDir === undefined) {
    delete process.env.FLOG_CONFIG_DIR;
  } else {
    process.env.FLOG_CONFIG_DIR = previousConfigDir;
  }
  await rm(dataDir, { recursive: true, force: true });
  await rm(configDir, { recursive: true, force: true });
});

describe("captureCommand", () => {
  it("throws when raw is empty or whitespace", async () => {
    await assert.rejects(() => captureCommand(dataDir, ""), /capture text is required/i);
    await assert.rejects(() => captureCommand(dataDir, "   "), /capture text is required/i);
  });

  it("returns no-match and writes nothing when pattern does not match", async () => {
    const outcome = await captureCommand(dataDir, "git status");
    assert.equal(outcome, "no-match");
    const day = await readDayCaptures(dataDir, todayFromEnv());
    assert.equal(day.captures.length, 0);
  });

  it("returns captured and appends a pending row on match", async () => {
    const outcome = await captureCommand(dataDir, "git checkout -b feature/x");
    assert.equal(outcome, "captured");
    const pending = await listPending(dataDir, todayFromEnv());
    assert.equal(pending.length, 1);
    assert.equal(pending[0].raw, "git checkout -b feature/x");
  });

  it("returns duplicate for same-day identical pending raw", async () => {
    const first = await captureCommand(dataDir, "git switch -c feature/y");
    const second = await captureCommand(dataDir, "git switch -c feature/y");
    assert.equal(first, "captured");
    assert.equal(second, "duplicate");
    const pending = await listPending(dataDir, todayFromEnv());
    assert.equal(pending.length, 1);
  });
});

function todayFromEnv(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

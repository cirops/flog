import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import {
  addUserCapturePattern,
  commandRoots,
  defaultCapturePatterns,
  loadCapturePatterns,
  matchesPattern,
  patternsPath
} from "../src/captures/patterns.js";

let configDir: string;
let previousConfigDir: string | undefined;

beforeEach(async () => {
  configDir = await mkdtemp(path.join(os.tmpdir(), "flog-patterns-"));
  previousConfigDir = process.env.FLOG_CONFIG_DIR;
  process.env.FLOG_CONFIG_DIR = configDir;
});

afterEach(async () => {
  if (previousConfigDir === undefined) {
    delete process.env.FLOG_CONFIG_DIR;
  } else {
    process.env.FLOG_CONFIG_DIR = previousConfigDir;
  }
  await rm(configDir, { recursive: true, force: true });
});

describe("defaultCapturePatterns", () => {
  it("includes git checkout -b and git switch -c", () => {
    const defaults = defaultCapturePatterns();
    assert.ok(defaults.includes("git checkout -b"));
    assert.ok(defaults.includes("git switch -c"));
  });
});

describe("loadCapturePatterns", () => {
  it("returns defaults only when user file is missing", async () => {
    const patterns = await loadCapturePatterns();
    assert.deepEqual(patterns, defaultCapturePatterns());
  });

  it("merges user patterns uniquely with defaults", async () => {
    await writeFile(
      patternsPath(configDir),
      JSON.stringify({ patterns: ["git clone", "git checkout -b", "t14ss -b"] }),
      "utf8"
    );
    const patterns = await loadCapturePatterns();
    assert.deepEqual(patterns, ["git checkout -b", "git switch -c", "git clone", "t14ss -b"]);
  });

  it("throws a clear error for corrupt JSON", async () => {
    await writeFile(patternsPath(configDir), "{not-json", "utf8");
    await assert.rejects(() => loadCapturePatterns(), /capture-patterns\.json|JSON|parse/i);
  });
});

describe("matchesPattern", () => {
  const patterns = ["git checkout -b", "git switch -c", "t14ss -b"];

  it("matches when raw equals a pattern", () => {
    assert.equal(matchesPattern("git checkout -b", patterns), true);
  });

  it("matches when pattern is a prefix followed by whitespace", () => {
    assert.equal(matchesPattern("git checkout -b feature/x", patterns), true);
    assert.equal(matchesPattern("  git switch -c  foo  ", patterns), true);
  });

  it("does not match longer tokens that share a prefix without boundary", () => {
    assert.equal(matchesPattern("git checkout -branch", patterns), false);
    assert.equal(matchesPattern("git status", patterns), false);
  });
});

describe("commandRoots", () => {
  it("returns unique first tokens", () => {
    assert.deepEqual(commandRoots(["git checkout -b", "git switch -c", "t14ss -b"]), ["git", "t14ss"]);
  });
});

describe("addUserCapturePattern", () => {
  it("creates the user file and appends a pattern", async () => {
    const result = await addUserCapturePattern("git clone");
    assert.equal(result.added, true);
    assert.equal(result.pattern, "git clone");
    assert.equal(result.needsHookReinstall, false);
    const raw = JSON.parse(await readFile(patternsPath(configDir), "utf8"));
    assert.deepEqual(raw.patterns, ["git clone"]);
    const loaded = await loadCapturePatterns();
    assert.ok(loaded.includes("git clone"));
  });

  it("is idempotent when the pattern already exists", async () => {
    await addUserCapturePattern("t14ss -b");
    const again = await addUserCapturePattern("t14ss -b");
    assert.equal(again.added, false);
    assert.equal(again.alreadyPresent, true);
    assert.equal(again.needsHookReinstall, false);
    const raw = JSON.parse(await readFile(patternsPath(configDir), "utf8"));
    assert.deepEqual(raw.patterns, ["t14ss -b"]);
  });

  it("flags needsHookReinstall when a new command root appears", async () => {
    const result = await addUserCapturePattern("t14ss -b");
    assert.equal(result.added, true);
    assert.equal(result.needsHookReinstall, true);
  });

  it("rejects empty pattern text", async () => {
    await assert.rejects(() => addUserCapturePattern("   "), /Pattern text is required/);
  });
});

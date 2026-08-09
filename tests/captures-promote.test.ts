import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { appendCapture, listPending, readDayCaptures } from "../src/captures/storage.js";
import { discardCapture, promoteCapture } from "../src/captures/promote.js";
import { defaultConfig } from "../src/config.js";
import { buildTempoPayload } from "../src/destinations/tempo.js";
import { readDay } from "../src/storage.js";
import type { FlogConfig } from "../src/types.js";

let tmp: string;
const config: FlogConfig = {
  ...defaultConfig,
  tempo: {
    ...defaultConfig.tempo,
    issueId: 12345,
    issueKey: "PROJ-123",
    authorAccountId: "account-1"
  }
};

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "flog-promote-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("promoteCapture", () => {
  it("writes an activity and marks the capture promoted while retaining the raw row", async () => {
    const entry = await appendCapture(tmp, "2026-05-23", "git checkout -b feature/x_120");
    assert.ok(entry);

    const result = await promoteCapture(
      tmp,
      "2026-05-23",
      entry.id,
      "120",
      "ICMS work",
      "morning",
      config
    );

    assert.equal(result.entry.status, "promoted");
    assert.equal(result.entry.raw, "git checkout -b feature/x_120");
    assert.equal(result.entry.activityPeriod, "morning");
    assert.ok(result.entry.promotedAt);

    const day = await readDay(tmp, "2026-05-23", config);
    assert.equal(day.morning.activities.length, 1);
    assert.equal(day.morning.activities[0].id, "120");
    assert.equal(day.morning.activities[0].description, "ICMS work");

    const captures = await readDayCaptures(tmp, "2026-05-23");
    assert.equal(captures.captures.length, 1);
    assert.equal(captures.captures[0].status, "promoted");
  });

  it("creates a missing day worklog via addActivity defaults", async () => {
    const entry = await appendCapture(tmp, "2026-05-24", "git switch -c feature/new");
    assert.ok(entry);
    await promoteCapture(tmp, "2026-05-24", entry.id, "", "New work", "afternoon", config);
    const day = await readDay(tmp, "2026-05-24", config);
    assert.equal(day.afternoon.activities[0].description, "New work");
    assert.equal(day.morning.start, config.defaults.morningStart);
  });
});

describe("discardCapture", () => {
  it("marks discarded without creating an activity", async () => {
    const entry = await appendCapture(tmp, "2026-05-23", "git checkout -b junk");
    assert.ok(entry);
    const discarded = await discardCapture(tmp, "2026-05-23", entry.id);
    assert.equal(discarded.status, "discarded");
    assert.ok(discarded.discardedAt);

    const day = await readDay(tmp, "2026-05-23", config);
    assert.equal(day.morning.activities.length, 0);
    assert.equal(day.afternoon.activities.length, 0);
    assert.equal((await listPending(tmp, "2026-05-23")).length, 0);
  });
});

describe("Tempo payloads ignore captures", () => {
  it("builds payloads from day activities only", async () => {
    const kept = await appendCapture(tmp, "2026-05-23", "git checkout -b keep_1");
    const junk = await appendCapture(tmp, "2026-05-23", "git checkout -b junk_2");
    assert.ok(kept && junk);
    await promoteCapture(tmp, "2026-05-23", kept.id, "1", "Promoted work", "morning", config);
    await discardCapture(tmp, "2026-05-23", junk.id);

    const day = await readDay(tmp, "2026-05-23", config);
    const payload = buildTempoPayload(config.tempo, "2026-05-23", "morning", day.morning);
    assert.equal(payload.body.description, "1 - Promoted work");
    assert.doesNotMatch(String(payload.body.description), /git checkout|junk|pending/i);
  });
});

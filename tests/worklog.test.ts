import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { addActivity, dayPath, readDay, setPeriodTime } from "../src/storage.js";
import { defaultConfig } from "../src/config.js";
import { durationSeconds, normalizeWeekId, weekDates } from "../src/time.js";
import { buildTempoPayload } from "../src/destinations/tempo.js";
import { appendSubmission, hasSubmitted, payloadHash } from "../src/submissions.js";
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
  tmp = await mkdtemp(path.join(os.tmpdir(), "flog-test-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("JSON worklogs", () => {
  it("creates morning and afternoon activities in a day JSON file", async () => {
    await addActivity(tmp, "2026-05-23", "morning", "123", "Morning work", config);
    await addActivity(tmp, "2026-05-23", "afternoon", "456", "Afternoon work", config);

    const raw = JSON.parse(await readFile(dayPath(tmp, "2026-05-23"), "utf8"));
    assert.equal(raw.schemaVersion, 1);
    assert.equal(raw.date, "2026-05-23");
    assert.equal(raw.morning.activities[0].id, "123");
    assert.equal(raw.afternoon.activities[0].description, "Afternoon work");
  });

  it("overrides block times and computes period duration from start and end", async () => {
    await setPeriodTime(tmp, "2026-05-23", "morning", "start", "07:30", config);
    await setPeriodTime(tmp, "2026-05-23", "morning", "end", "13:00", config);
    await setPeriodTime(tmp, "2026-05-23", "afternoon", "start", "13:50", config);
    await setPeriodTime(tmp, "2026-05-23", "afternoon", "end", "19:00", config);

    const day = await readDay(tmp, "2026-05-23", config);
    assert.equal(durationSeconds(day.morning.start, day.morning.end), 19_800);
    assert.equal(durationSeconds(day.afternoon.start, day.afternoon.end), 18_600);
  });
});

describe("week handling", () => {
  it("resolves week ids and returns weekly dates", () => {
    assert.equal(normalizeWeekId("2026-W21"), "2026-W21");
    assert.deepEqual(weekDates("2026-W21"), [
      "2026-05-18",
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
      "2026-05-22",
      "2026-05-23",
      "2026-05-24"
    ]);
  });
});

describe("Tempo payloads", () => {
  it("generates one Tempo payload per active period with all activities in the description", async () => {
    await setPeriodTime(tmp, "2026-05-23", "morning", "start", "08:00", config);
    await setPeriodTime(tmp, "2026-05-23", "morning", "end", "12:00", config);
    await addActivity(tmp, "2026-05-23", "morning", "123", "First task", config);
    await addActivity(tmp, "2026-05-23", "morning", "456", "Second task", config);
    const day = await readDay(tmp, "2026-05-23", config);

    const payload = buildTempoPayload(config.tempo, "2026-05-23", "morning", day.morning);
    assert.equal(payload.key, "tempo:2026-05-23:morning");
    assert.equal(payload.body.timeSpentSeconds, 14_400);
    assert.equal(payload.body.billableSeconds, 14_400);
    assert.equal(payload.body.description, "123 - First task\n456 - Second task");
  });

  it("detects duplicate submitted worklogs from JSONL history", async () => {
    await addActivity(tmp, "2026-05-23", "morning", "123", "First task", config);
    const day = await readDay(tmp, "2026-05-23", config);
    const payload = buildTempoPayload(config.tempo, "2026-05-23", "morning", day.morning);
    await appendSubmission(tmp, {
      schemaVersion: 1,
      key: payload.key,
      destination: "tempo",
      date: payload.date,
      period: payload.period,
      status: "submitted",
      submittedAt: "2026-05-24T00:00:00.000Z",
      externalId: "999",
      payloadHash: payloadHash(payload)
    });

    const duplicate = await hasSubmitted(tmp, "tempo:2026-05-23:morning");
    assert.equal(duplicate?.externalId, "999");
  });

  it("validates config without exposing token values", async () => {
    const { validateTempoConfig } = await import("../src/destinations/tempo.js");
    assert.throws(
      () =>
        validateTempoConfig(
          {
            ...defaultConfig.tempo,
            issueId: 123
          },
          false
        ),
      (error) => {
        assert(error instanceof Error);
        assert.match(error.message, /TEMPO_AUTHOR_ACCOUNT_ID/);
        assert.match(error.message, /TEMPO_TOKEN/);
        assert.doesNotMatch(error.message, /secret|Bearer|abc123/);
        return true;
      }
    );
  });
});

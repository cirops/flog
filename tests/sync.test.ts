import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { defaultConfig } from "../src/config.js";
import { readSubmissions } from "../src/submissions.js";
import { syncFromTempo } from "../src/sync.js";
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
  tmp = await mkdtemp(path.join(os.tmpdir(), "flog-sync-"));
  process.env.TEMPO_TOKEN = "test-token";
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("syncFromTempo", () => {
  it("records remote worklogs as submissions and populates empty local days", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              tempoWorklogId: 999,
              issue: { id: 12345 },
              startDate: "2026-05-23",
              startTime: "08:00:00",
              timeSpentSeconds: 14_400,
              description: "123 - First task\n456 - Second task",
              createdAt: "2026-05-23T12:00:00.000Z"
            },
            {
              tempoWorklogId: 1000,
              issue: { id: 12345 },
              startDate: "2026-05-23",
              startTime: "13:30:00",
              timeSpentSeconds: 14_400,
              description: "789 - Afternoon task",
              createdAt: "2026-05-23T18:00:00.000Z"
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;

    try {
      const stats = await syncFromTempo(config, tmp, ["2026-05-23"]);
      assert.equal(stats.synced, 2);
      assert.equal(stats.alreadyKnown, 0);
      assert.equal(stats.localPopulated, 2);

      const submissions = await readSubmissions(tmp);
      assert.equal(submissions.length, 2);
      assert.equal(submissions[0].key, "tempo:2026-05-23:morning");
      assert.equal(submissions[0].externalId, "999");
      assert.equal(submissions[1].key, "tempo:2026-05-23:afternoon");

      const raw = JSON.parse(await readFile(path.join(tmp, "2026", "05", "2026-05-23.json"), "utf8"));
      assert.equal(raw.morning.start, "08:00");
      assert.equal(raw.morning.end, "12:00");
      assert.equal(raw.morning.activities[0].id, "123");
      assert.equal(raw.morning.activities[0].description, "First task");
      assert.equal(raw.morning.activities[1].id, "456");
      assert.equal(raw.afternoon.start, "13:30");
      assert.equal(raw.afternoon.end, "17:30");
      assert.equal(raw.afternoon.activities[0].id, "789");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("skips already-known submissions on a second sync", async () => {
    const payload = {
      results: [
        {
          tempoWorklogId: 999,
          issue: { id: 12345 },
          startDate: "2026-05-24",
          startTime: "08:00:00",
          timeSpentSeconds: 14_400,
          description: "x",
          createdAt: "2026-05-24T12:00:00.000Z"
        }
      ]
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;

    try {
      const first = await syncFromTempo(config, tmp, ["2026-05-24"]);
      assert.equal(first.synced, 1);
      const second = await syncFromTempo(config, tmp, ["2026-05-24"]);
      assert.equal(second.synced, 0);
      assert.equal(second.alreadyKnown, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

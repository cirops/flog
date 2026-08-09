import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  appendCapture,
  captureDayPath,
  listPending,
  readDayCaptures,
  setCaptureStatus
} from "../src/captures/storage.js";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "flog-captures-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("captureDayPath", () => {
  it("places day files under dataDir/captures/YYYY/MM/date.json", () => {
    assert.equal(
      captureDayPath(tmp, "2026-05-23"),
      path.join(tmp, "captures", "2026", "05", "2026-05-23.json")
    );
  });
});

describe("appendCapture", () => {
  it("creates a pending row with UUID id, raw, and capturedAt", async () => {
    const now = new Date("2026-05-23T10:15:00.000Z");
    const entry = await appendCapture(tmp, "2026-05-23", "git checkout -b feature/x", now);
    assert.ok(entry);
    assert.match(entry.id, /^[0-9a-f-]{36}$/i);
    assert.equal(entry.raw, "git checkout -b feature/x");
    assert.equal(entry.capturedAt, now.toISOString());
    assert.equal(entry.status, "pending");

    const onDisk = JSON.parse(await readFile(captureDayPath(tmp, "2026-05-23"), "utf8"));
    assert.equal(onDisk.schemaVersion, 1);
    assert.equal(onDisk.date, "2026-05-23");
    assert.equal(onDisk.captures.length, 1);
    assert.equal(onDisk.captures[0].id, entry.id);
  });

  it("quietly skips duplicate pending raw on the same day", async () => {
    const first = await appendCapture(tmp, "2026-05-23", "git switch -c feature/y");
    const second = await appendCapture(tmp, "2026-05-23", "git switch -c feature/y");
    assert.ok(first);
    assert.equal(second, undefined);
    const day = await readDayCaptures(tmp, "2026-05-23");
    assert.equal(day.captures.length, 1);
  });
});

describe("setCaptureStatus and listPending", () => {
  it("marks promoted/discarded without deleting the row", async () => {
    const entry = await appendCapture(tmp, "2026-05-23", "git checkout -b keep-me");
    assert.ok(entry);
    const promoted = await setCaptureStatus(tmp, "2026-05-23", entry.id, "promoted", {
      promotedAt: "2026-05-23T18:00:00.000Z",
      activityPeriod: "morning"
    });
    assert.equal(promoted.status, "promoted");
    assert.equal(promoted.promotedAt, "2026-05-23T18:00:00.000Z");
    assert.equal(promoted.activityPeriod, "morning");
    assert.equal(promoted.raw, "git checkout -b keep-me");

    const day = await readDayCaptures(tmp, "2026-05-23");
    assert.equal(day.captures.length, 1);
    assert.equal(day.captures[0].status, "promoted");
  });

  it("listPending returns only pending captures", async () => {
    const a = await appendCapture(tmp, "2026-05-23", "git checkout -b one");
    const b = await appendCapture(tmp, "2026-05-23", "git checkout -b two");
    assert.ok(a && b);
    await setCaptureStatus(tmp, "2026-05-23", a.id, "discarded", {
      discardedAt: "2026-05-23T19:00:00.000Z"
    });
    const pending = await listPending(tmp, "2026-05-23");
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, b.id);
    assert.equal(pending[0].status, "pending");
  });
});

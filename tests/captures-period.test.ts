import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultPeriodForCapture } from "../src/captures/period.js";
import type { DayWorklog } from "../src/types.js";

const day: DayWorklog = {
  schemaVersion: 1,
  date: "2026-05-23",
  morning: { start: "08:00", end: "12:00", activities: [] },
  afternoon: { start: "13:30", end: "17:30", activities: [] }
};

describe("defaultPeriodForCapture", () => {
  it("returns morning when capturedAt local time is before afternoon.start", () => {
    assert.equal(defaultPeriodForCapture("2026-05-23T13:29:00", day), "morning");
  });

  it("returns afternoon when capturedAt local time is at or after afternoon.start", () => {
    assert.equal(defaultPeriodForCapture("2026-05-23T13:30:00", day), "afternoon");
    assert.equal(defaultPeriodForCapture("2026-05-23T16:00:00", day), "afternoon");
  });
});

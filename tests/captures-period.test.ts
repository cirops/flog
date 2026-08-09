import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { defaultPeriodForCapture, localHHMMFromCapture } from "../src/captures/period.js";
import type { DayWorklog } from "../src/types.js";

const day: DayWorklog = {
  schemaVersion: 1,
  date: "2026-05-23",
  morning: { start: "08:00", end: "12:00", activities: [] },
  afternoon: { start: "13:30", end: "17:30", activities: [] }
};

describe("defaultPeriodForCapture", () => {
  it("returns morning when local time is before morning.end", () => {
    assert.equal(defaultPeriodForCapture("2026-05-23T11:59:00", day), "morning");
  });

  it("returns afternoon at morning.end and through the lunch gap into afternoon", () => {
    assert.equal(defaultPeriodForCapture("2026-05-23T12:00:00", day), "afternoon");
    assert.equal(defaultPeriodForCapture("2026-05-23T12:08:00", day), "afternoon");
    assert.equal(defaultPeriodForCapture("2026-05-23T13:30:00", day), "afternoon");
    assert.equal(defaultPeriodForCapture("2026-05-23T16:00:00", day), "afternoon");
  });

  it("maps UTC ISO captures through local timezone for display and period", () => {
    // 15:08Z is 12:08 in America/Sao_Paulo → after morning.end → afternoon
    const script = `
      import { defaultPeriodForCapture, localHHMMFromCapture } from "./src/captures/period.ts";
      const day = {
        schemaVersion: 1,
        date: "2026-08-09",
        morning: { start: "08:00", end: "12:00", activities: [] },
        afternoon: { start: "13:30", end: "17:30", activities: [] }
      };
      const iso = "2026-08-09T15:08:00.000Z";
      if (localHHMMFromCapture(iso) !== "12:08") process.exit(2);
      if (defaultPeriodForCapture(iso, day) !== "afternoon") process.exit(3);
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, TZ: "America/Sao_Paulo" },
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});

describe("localHHMMFromCapture", () => {
  it("formats local hours and minutes from a timestamp", () => {
    assert.equal(localHHMMFromCapture("2026-05-23T09:05:00"), "09:05");
  });
});

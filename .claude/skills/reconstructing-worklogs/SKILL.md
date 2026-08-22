---
name: reconstructing-worklogs
description: Use when flog worklog days or periods are missing, empty, or have start/end times that do not match when the work actually happened — backfilling a past week, a flog week total below target, or reconstructing days later what was worked on.
---

# Reconstructing Worklogs

## Overview

Past work leaves timestamped traces: agent transcripts, `flog` captures, shell history,
git commits. This skill turns them into `flog` commands.

**Reconstruct, never invent.** Every activity line must trace to an artifact you can
point at. An invented-but-plausible line is worse than a gap — on review the person
cannot tell it from a real one.

**The person decides what gets written.** You produce commands and evidence; they choose
whether you run them.

## When to Use

- `flog week` shows empty periods, missing days, or a total below target
- Period times do not bracket the real work (activity before `morningStart`, after
  `afternoonEnd`, or across lunch)
- "Fill in last week for me"

Not for today's work you still remember (just run `flog m`/`flog a`), and never bundled
with `flog push` — pushing is always its own decision.

## Step 1 — Anchor the Local Offset (required)

Transcript timestamps are UTC. **The system timezone is not evidence**: WSL, containers,
and CI images routinely report UTC while the person is hours away. A wrong offset shifts
every reported time and silently corrupts the result.

Git stamps each commit with the author's real offset — use it:

```bash
git log -200 --format=%ad --date=iso | awk '{print $3}' | sort | uniq -c | sort -rn
```

Never infer the offset from `createdAt`/`capturedAt` sitting inside working hours.
Retroactive edits (`flog m --date`) write today's time into another day's file, so those
fields cannot constrain it, and fractional candidates score indistinguishably — that
heuristic invents offsets like UTC-2.5.

## Step 2 — Gather Evidence

```bash
flog doctor      # data dir, default period windows, descriptionFormat
scripts/worklog-evidence.mjs --from YYYY-MM-DD --to YYYY-MM-DD --data-dir <dataDir>
```

Reports per day: activity envelope, period-boundary crossings, idle gaps, which periods
are already filled, captures, and per-session topic seeds. `--help` for flags; it anchors
the offset itself and says so when it could not.

Corroborate seeds against captures (branch names carry issue ids), git log across the
repos worked in, and shell history.

## Step 3 — Resolve Titles From the Tracker

When an id appears in a branch, commit, or prompt, fetch its **real title** and use it
verbatim — via a configured tracker skill/CLI, else the tracker REST API. If a title
cannot be resolved, log the activity with no id and say so. Never pair an id with a
title you composed.

## Step 4 — Write the Review File, Then Ask

Match `descriptionFormat`. An empty `id` field makes flog use the description verbatim,
so ids go inline: `flog m "12345 - Real Title"`.

The file contains, in order:

1. **Sources and offset** — what was scanned, the offset, how it was anchored.
2. **Resolved ids** — id, type, exact tracker title.
3. **One section per day** — the runnable command block (period-time commands before
   activity commands), then the evidence each activity rests on.
4. **Gaps** — what the evidence does not cover.

Then summarize in the reply and **ask whether to run the commands**. Completeness is not
consent.

## Meetings Cannot Be Reconstructed

Local evidence has no calendar. Report idle gaps as idle gaps — a gap is a meeting, work
outside the agent, or a long background job, and nothing distinguishes them. Hand over
the gap table and let the person label it.

## Red Flags — Stop

- An activity line you cannot point at an artifact for
- An issue id paired with a title you wrote instead of the tracker's
- A `Meeting`/`Reunião` line derived from an idle gap
- Running `flog m`/`a`/`ms`/`me`/`as`/`ae` before the person said to
- `flog push` in the same breath as the reconstruction
- Reporting times from an offset you did not anchor

## Common Mistakes

| Mistake | Fix |
|---|---|
| Trusting the system timezone | Anchor on git author offset |
| Times plausible but uniformly shifted | Bogus fractional offset — re-anchor |
| Counting harness noise as activity | Drop task notifications, image refs, session-continuation preambles |
| Padding a period to hit the daily target | Report the shortfall; the person decides |
| Filing a whole day when one period is filled | Check `already logged` per period first |

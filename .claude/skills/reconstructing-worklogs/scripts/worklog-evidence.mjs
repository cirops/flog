#!/usr/bin/env node
// Extract worklog evidence from Claude Code transcripts for a date range.
// Emits, per local day: activity envelope, period-boundary crossings, idle gaps,
// and session topic seeds. Read-only: never writes worklogs.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, basename, dirname } from "node:path";

const HELP = `worklog-evidence — mine local evidence for retroactive worklog entries

Usage:
  worklog-evidence.mjs --from YYYY-MM-DD --to YYYY-MM-DD [options]

Options:
  --from, --to        Local date range (inclusive). Required.
  --offset <hours>    Local UTC offset, e.g. -3, +5.5. Overrides the git anchor.
  --transcripts <dir> Claude Code projects dir. Default: ~/.claude/projects
  --data-dir <dir>    flog worklogs dir (from 'flog doctor'). Marks which periods
                      are already filled and includes same-day captures.
  --anchor-repo <dir> Git repo whose commits anchor the local UTC offset.
                      Default: cwd. Git records the author's real offset, so this
                      is the only self-evident source. Use --offset to override.
  --morning <s-e>     Default period window, e.g. 08:00-12:00
  --afternoon <s-e>   Default period window, e.g. 13:30-17:30
  --gap <minutes>     Idle-gap threshold to report. Default: 50
  --topics <n>        Topic seeds per period. Default: 8
  --json              Emit JSON instead of a text report.
  --help
`;

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const o = {
    transcripts: join(homedir(), ".claude", "projects"),
    morning: "08:00-12:00",
    afternoon: "13:30-17:30",
    gap: 50,
    topics: 8,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--json") o.json = true;
    else if (a === "--from") o.from = next();
    else if (a === "--to") o.to = next();
    else if (a === "--offset") o.offset = Number(next());
    else if (a === "--transcripts") o.transcripts = next();
    else if (a === "--data-dir") o.dataDir = next();
    else if (a === "--anchor-repo") o.anchorRepo = next();
    else if (a === "--morning") o.morning = next();
    else if (a === "--afternoon") o.afternoon = next();
    else if (a === "--gap") o.gap = Number(next());
    else if (a === "--topics") o.topics = Number(next());
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

const isDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s ?? "")) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const fromMin = (n) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const window_ = (spec) => {
  const [s, e] = spec.split("-");
  return { start: s, end: e, startMin: toMin(s), endMin: toMin(e) };
};

// ------------------------------------------------------- file walking

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

// Prompts that are harness plumbing, not the human describing work.
const NOISE = [
  /^<task-notification/,
  /^<local-command/,
  /^<command-(name|message|args)/,
  /^<system-reminder/,
  /^<fork-boilerplate/,
  /^<cross-session-message/,
  /^\[Image/,
  /^\[Request interrupted/,
  /^\[Your previous response had no visible output/,
  /^## Context Usage/,
  /^Base directory for this skill:/,
  /^This session is being continued from a previous conversation/,
  /^Continue from where you left off\.?$/,
  /^Caveat: The messages below were generated/,
];
const isNoise = (t) => NOISE.some((r) => r.test(t));

function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  // A block list containing tool_result is a tool response, not a human turn.
  if (content.some((b) => b?.type === "tool_result")) return "";
  return content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join(" ");
}

function collectPrompts(files, offsetMs, from, to) {
  const rows = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (rec.type !== "user" || !rec.timestamp) continue;
      const ms = Date.parse(rec.timestamp);
      if (Number.isNaN(ms)) continue;
      const local = new Date(ms + offsetMs);
      const day = local.toISOString().slice(0, 10);
      if (day < from || day > to) continue;
      let body = extractText(rec.message?.content);
      if (!body) continue;
      body = body.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
      if (!body || isNoise(body)) continue;
      rows.push({
        day,
        time: local.toISOString().slice(11, 16),
        minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
        project: basename(dirname(file)),
        session: basename(file, ".jsonl").slice(0, 8),
        text: body.replace(/\s+/g, " ").slice(0, 400),
      });
    }
  }
  rows.sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));
  return rows;
}

// --------------------------------------------- flog worklogs (optional)

function readWorklogs(dataDir, from, to) {
  const out = new Map();
  if (!dataDir || !existsSync(dataDir)) return out;
  const stack = [dataDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "captures") stack.push(p);
        continue;
      }
      const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(e.name);
      if (!m || m[1] < from || m[1] > to) continue;
      try {
        out.set(m[1], JSON.parse(readFileSync(p, "utf8")));
      } catch {
        /* ignore unreadable day */
      }
    }
  }
  return out;
}

function readCaptures(dataDir, from, to) {
  const out = new Map();
  const root = dataDir ? join(dataDir, "captures") : null;
  if (!root || !existsSync(root)) return out;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(p);
        continue;
      }
      const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(e.name);
      if (!m || m[1] < from || m[1] > to) continue;
      try {
        out.set(m[1], JSON.parse(readFileSync(p, "utf8")).captures ?? []);
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

// ----------------------------------------------------------- calibrate

// Why this is its own step: the system timezone is NOT a reliable source. WSL,
// containers, and CI images routinely report UTC while the person lives hours
// away, and every downstream time in this report would be silently wrong.

// Strongest signal: git stamps each commit with the author's real UTC offset.
function offsetFromGit(repoDir) {
  try {
    const out = execFileSync(
      "git",
      ["-C", repoDir, "log", "-200", "--format=%ad", "--date=iso"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    const tally = new Map();
    for (const line of out.split("\n")) {
      const m = /([+-])(\d{2})(\d{2})\s*$/.exec(line.trim());
      if (!m) continue;
      const hours = (m[1] === "-" ? -1 : 1) * (Number(m[2]) + Number(m[3]) / 60);
      tally.set(hours, (tally.get(hours) ?? 0) + 1);
    }
    if (!tally.size) return null;
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((n, [, c]) => n + c, 0);
    return { offset: ranked[0][0], commits: ranked[0][1], total, repo: repoDir };
  } catch {
    return null;
  }
}

function resolveOffset(opts) {
  if (Number.isFinite(opts.offset)) {
    return { offset: opts.offset, source: "--offset (explicit)", confirmed: true };
  }
  const git = offsetFromGit(opts.anchorRepo ?? process.cwd());
  if (git) {
    return {
      offset: git.offset,
      source: `git author offset in ${git.repo} (${git.commits}/${git.total} commits)`,
      confirmed: true,
      git,
    };
  }
  return {
    offset: -new Date().getTimezoneOffset() / 60,
    source: "system timezone -- NO git anchor found",
    confirmed: false,
  };
}

// Sanity check, not a calibration: a badly wrong offset pushes prompts into the
// small hours. Catches gross errors without pretending sub-hour precision.
function plausibility(rows) {
  if (!rows.length) return null;
  const waking = rows.filter((r) => r.minute >= 300 && r.minute <= 1380).length;
  return { share: waking / rows.length, prompts: rows.length };
}

// -------------------------------------------------------------- report

function analyse(rows, opts, morning, afternoon, worklogs, captures) {
  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day).push(r);
  }
  const days = [];
  for (const [day, list] of [...byDay.entries()].sort()) {
    const minutes = [...new Set(list.map((r) => r.minute))].sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < minutes.length; i++) {
      const g = minutes[i] - minutes[i - 1];
      if (g >= opts.gap) {
        const lunch =
          minutes[i - 1] <= afternoon.startMin && minutes[i] >= morning.endMin;
        gaps.push({
          from: fromMin(minutes[i - 1]),
          to: fromMin(minutes[i]),
          minutes: g,
          spansLunch: lunch,
        });
      }
    }

    const existing = worklogs.get(day);
    const filled = (p) => {
      const period = existing?.[p];
      if (!period) return null;
      return {
        start: period.start,
        end: period.end,
        activities: (period.activities ?? []).map((a) => a.description),
      };
    };

    const inPeriod = (r, p) =>
      p === "morning"
        ? r.minute < afternoon.startMin
        : r.minute >= afternoon.startMin;

    const seeds = (p) => {
      const bySession = new Map();
      for (const r of list.filter((x) => inPeriod(x, p))) {
        const key = `${r.session}|${r.project}`;
        if (!bySession.has(key)) bySession.set(key, []);
        bySession.get(key).push(r);
      }
      return [...bySession.values()]
        .sort((a, b) => a[0].time.localeCompare(b[0].time))
        .slice(0, opts.topics)
        .map((g) => ({
          from: g[0].time,
          to: g[g.length - 1].time,
          prompts: g.length,
          project: g[0].project,
          seed: g[0].text.slice(0, 200),
        }));
    };

    days.push({
      day,
      prompts: list.length,
      first: fromMin(minutes[0]),
      last: fromMin(minutes[minutes.length - 1]),
      crossings: {
        beforeMorningStart: minutes.filter((m) => m < morning.startMin).map(fromMin),
        betweenPeriods: minutes
          .filter((m) => m > morning.endMin && m < afternoon.startMin)
          .map(fromMin),
        afterAfternoonEnd: minutes.filter((m) => m > afternoon.endMin).map(fromMin),
      },
      gaps,
      existing: existing ? { morning: filled("morning"), afternoon: filled("afternoon") } : null,
      captures: (captures.get(day) ?? []).map((c) => ({
        at: new Date(Date.parse(c.capturedAt) + opts.offsetMs)
          .toISOString()
          .slice(11, 16),
        raw: c.raw,
        status: c.status,
      })),
      seeds: { morning: seeds("morning"), afternoon: seeds("afternoon") },
    });
  }
  return days;
}

function renderText(days, meta) {
  const L = [];
  const sign = (n) => `UTC${n >= 0 ? "+" : ""}${n}`;
  L.push(`# Worklog evidence ${meta.from} .. ${meta.to}`);
  L.push(`Local offset: ${sign(meta.tz.offset)}  <- ${meta.tz.source}`);
  const pl = meta.tz.plausibility;
  if (pl && pl.share < 0.9) {
    L.push(
      `  !! Only ${(pl.share * 100).toFixed(0)}% of ${pl.prompts} prompts land in 05:00-23:00 local -- offset looks wrong.`
    );
  }
  if (!meta.tz.confirmed) {
    L.push("  !! OFFSET NOT ANCHORED -- every time below may be wrong.");
    L.push("  !! This is not a weak signal to weigh against others: anchor it on a repo");
    L.push("  !! the person commits to (--anchor-repo), or pass --offset <hours>.");
  }
  L.push(`Windows: morning ${meta.morning}, afternoon ${meta.afternoon}`);
  L.push(`Scanned ${meta.transcriptFiles} transcript files, kept ${meta.prompts} prompts.`);
  L.push("");
  if (!days.length) L.push("No prompts found in range.");
  for (const d of days) {
    L.push(`## ${d.day}  (${d.prompts} prompts)`);
    L.push(`envelope: ${d.first} -> ${d.last}`);
    const c = d.crossings;
    const cross = [];
    if (c.beforeMorningStart.length)
      cross.push(`before morning start: ${c.beforeMorningStart.join(", ")}`);
    if (c.betweenPeriods.length)
      cross.push(`between periods: ${c.betweenPeriods.join(", ")}`);
    if (c.afterAfternoonEnd.length)
      cross.push(`after afternoon end: ${c.afterAfternoonEnd.join(", ")}`);
    L.push(cross.length ? `boundary crossings: ${cross.join(" | ")}` : "boundary crossings: none");
    if (d.gaps.length) {
      L.push(
        `idle gaps: ${d.gaps
          .map((g) => `${g.from}->${g.to} (${g.minutes}m${g.spansLunch ? ", spans lunch" : ""})`)
          .join("  ")}`
      );
    }
    if (d.existing) {
      for (const p of ["morning", "afternoon"]) {
        const e = d.existing[p];
        if (!e) continue;
        const n = e.activities.length;
        L.push(
          `already logged ${p}: ${e.start}-${e.end}, ${n === 0 ? "EMPTY" : e.activities.join(" / ")}`
        );
      }
    } else {
      L.push("already logged: no worklog file for this day");
    }
    if (d.captures.length) {
      L.push("captures:");
      for (const cap of d.captures) L.push(`  ${cap.at}  ${cap.raw}`);
    }
    for (const p of ["morning", "afternoon"]) {
      if (!d.seeds[p].length) continue;
      L.push(`${p} topic seeds:`);
      for (const s2 of d.seeds[p]) {
        L.push(`  [${s2.from}-${s2.to}] n=${s2.prompts} ${s2.project}`);
        L.push(`     ${s2.seed}`);
      }
    }
    L.push("");
  }
  return L.join("\n");
}

// ---------------------------------------------------------------- main

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }
  if (!isDate(opts.from) || !isDate(opts.to)) {
    process.stderr.write("Error: --from and --to are required as real YYYY-MM-DD dates.\n\n" + HELP);
    process.exitCode = 2;
    return;
  }
  if (opts.from > opts.to) {
    process.stderr.write(`Error: --from (${opts.from}) is after --to (${opts.to}).\n`);
    process.exitCode = 2;
    return;
  }
  const morning = window_(opts.morning);
  const afternoon = window_(opts.afternoon);

  const tz = resolveOffset(opts);
  opts.offsetMs = tz.offset * 3600 * 1000;

  const files = walk(opts.transcripts);
  const rows = collectPrompts(files, opts.offsetMs, opts.from, opts.to);
  const worklogs = readWorklogs(opts.dataDir, opts.from, opts.to);
  const captures = readCaptures(opts.dataDir, opts.from, opts.to);
  const days = analyse(rows, opts, morning, afternoon, worklogs, captures);
  tz.plausibility = plausibility(rows);

  const meta = {
    from: opts.from,
    to: opts.to,
    tz,
    morning: opts.morning,
    afternoon: opts.afternoon,
    transcriptFiles: files.length,
    prompts: rows.length,
  };
  if (opts.json) process.stdout.write(JSON.stringify({ meta, days }, null, 2) + "\n");
  else process.stdout.write(renderText(days, meta) + "\n");
}

try {
  main();
} catch (err) {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exitCode = 1;
}

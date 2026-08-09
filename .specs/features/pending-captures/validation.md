# Pending Captures Validation

**Date**: 2026-08-09
**Spec**: `.specs/features/pending-captures/spec.md`
**Diff range**: `3625118^..e8720fe` (base before feature: `aebfc98`)
**Verifier**: independent sub-agent (author ≠ verifier)
**Result**: PASS ✅

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1: Capture domain types | ✅ Done | All Done-when boxes checked |
| T2: Pattern loader | ✅ Done | - |
| T3: Capture day storage | ✅ Done | - |
| T4: captureCommand | ✅ Done | - |
| T5: Wire `flog capture` CLI | ✅ Done | - |
| T6: Smart prefill | ✅ Done | - |
| T7: Default period helper | ✅ Done | - |
| T8: Promote and discard | ✅ Done | - |
| T9: `flog pending` triage CLI | ✅ Done | - |
| T10: Hook install/uninstall | ✅ Done | - |
| T11: Wire `flog hook` CLI | ✅ Done | - |
| T12: Document captures in README | ✅ Done | - |

**Tasks**: 12/12 complete, 0 blocked, 0 partial.

---

## Spec-Anchored Acceptance Criteria

### P1: Capture matching commands as pending

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| CAP-01: match → append capture for current day with raw, timestamp, status `pending`, stable id | `status === "pending"`, UUID id, raw preserved, `capturedAt` set | `tests/captures-storage.test.ts:38-41` - `assert.equal(entry.status, "pending")` + UUID/raw/`capturedAt`; `tests/captures-capture.test.ts:45-48` - `assert.equal(outcome, "captured")` + pending raw | ✅ PASS |
| CAP-02: `flog capture <raw>` match → same pending shape as wrapper | pending row with raw + status `pending` | `tests/captures-cli.test.ts:40-42` - `assert.equal(raw.captures[0].raw, "git checkout -b feature/x_1")` + `status === "pending"` | ✅ PASS |
| CAP-03: empty raw → non-zero exit + "capture text is required" | exit ≠ 0; message matches required-text | `tests/captures-cli.test.ts:46-47` - `expectedCode = 1` + `/capture text is required/i`; `tests/captures-capture.test.ts:32-33` - rejects with same message | ✅ PASS |
| CAP-04: identical pending raw same day → no duplicate row | second append quiet skip / `"duplicate"`; length 1 | `tests/captures-storage.test.ts:54-56` - `second === undefined` + `captures.length === 1`; `tests/captures-capture.test.ts:55-57` - `second === "duplicate"` | ✅ PASS |
| CAP-05: patterns from built-ins + user-level config home; no project git file required | load from `FLOG_CONFIG_DIR` / Conf path; missing user file → defaults | `tests/captures-patterns.test.ts:42-43` - `deepEqual(patterns, defaultCapturePatterns())` under temp `FLOG_CONFIG_DIR` | ✅ PASS |
| CAP-06: built-in defaults match `git checkout -b` and `git switch -c` | defaults include both strings | `tests/captures-patterns.test.ts:35-36` - `defaults.includes("git checkout -b")` + `includes("git switch -c")` | ✅ PASS |
| CAP-07: `flog hook install` → wrapper integration for roots, not full history | marked rc block + wrappers with `command <root>` + best-effort capture | `tests/captures-cli.test.ts:67-73` - markers + `capture-wrappers.sh` + `command git`; `tests/captures-hooks.test.ts:31-35` - roots only | ✅ PASS |
| CAP-08: `flog hook uninstall` → remove integration | markers absent; user rc kept | `tests/captures-cli.test.ts:76-79` - `doesNotMatch` markers; `tests/captures-hooks.test.ts:76-79` - same | ✅ PASS |
| CAP-09: per-day durable file under data dir; retained after promote/discard | path `captures/YYYY/MM/date.json`; row remains after status change | `tests/captures-storage.test.ts:26-29` - path layout; `:73-75` - length 1 after promoted; `tests/captures-promote.test.ts:57-59` - retained after promote | ✅ PASS |

### P1: Triage pending into real activities

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| PEND-01: `flog pending` no date → only `pending` for today | list only status `pending` for target day (CLI defaults date via `todayIso`) | `tests/captures-pending.test.ts:42-45` - `choices.length === 1` + id of pending only; discarded excluded | ✅ PASS |
| PEND-02: `--date` / relative `-N` → pending for that day | only pending for target day; `--date` exercised; `-N` via shared argv expander | `tests/captures-pending.test.ts:42-45` + `:157-158` (`pending --date`); `tests/cli.test.ts:51-53` - `-1` expands for day-scoped commands | ✅ PASS |
| PEND-03: multi-select promote → activity with confirmed id/description, same shape as `m`/`a` | activity appended via `addActivity` with id + description | `tests/captures-promote.test.ts:52-55` - morning activity id/description; `tests/captures-pending.test.ts:125-127` - promoted activity fields | ✅ PASS |
| PEND-04: prefill id from trailing ticket; description from cleaned hint/raw; confirm/edit before write | id `"120999"`, cleaned description; empty id when no ticket; prompts before promote | `tests/captures-prefill.test.ts:8-9` - id/description; `:14` - empty id; `tests/captures-pending.test.ts:126-127` - promote via prompts accepts defaults | ✅ PASS |
| PEND-05: default period from timestamp vs afternoon.start; allow override before write | `< afternoon.start` → morning; `>=` → afternoon; period select before write | `tests/captures-period.test.ts:15` / `:19-20`; `tests/captures-pending.test.ts:125-126` - 10:00 capture → morning activity | ✅ PASS |
| PEND-06: successful promote → status `promoted`, raw row kept | `status === "promoted"`, raw unchanged, file length 1 | `tests/captures-promote.test.ts:48-49` + `:57-59` | ✅ PASS |
| PEND-07: discard → status `discarded`, raw kept, no activity | `status === "discarded"`; activities length 0 | `tests/captures-promote.test.ts:77-82` | ✅ PASS |
| PEND-08: promoted/discarded not shown in pending list | `listPending` / choices exclude non-pending | `tests/captures-storage.test.ts:85-88`; `tests/captures-pending.test.ts:42-45` | ✅ PASS |
| PEND-09: no pending → success + nothing-pending message | exit 0; message matches `/nothing pending/i` | `tests/captures-pending.test.ts:58-60` + `:157-158` | ✅ PASS |
| PEND-10: captures never in Tempo review/push payloads | payload description from activities only; no capture raw/status text | `tests/captures-promote.test.ts:96-98` - `buildTempoPayload` description + `doesNotMatch` capture noise | ✅ PASS |

### P2: Personal pattern customization

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| ------------------------- | -------------------- | ----------------------- | ------ |
| PAT-01: user-level additional patterns captured like defaults | merge includes `git clone`, `t14ss -b` uniquely with defaults | `tests/captures-patterns.test.ts:53` - `deepEqual(..., ["git checkout -b", "git switch -c", "git clone", "t14ss -b"])` | ✅ PASS |
| PAT-02: document patterns path + how to add (incl. `git clone`, `t14ss -b`) | README documents path, merge, examples | `README.md:84` path; `:89` examples; `:93` merge/missing behavior; `:47-50` commands | ✅ PASS |
| PAT-03: missing user patterns file → defaults only, no fail | defaults returned; no throw | `tests/captures-patterns.test.ts:42-43` - `deepEqual(patterns, defaultCapturePatterns())` | ✅ PASS |

**Status**: ✅ All ACs covered (22/22). 0 spec-precision gaps flagged.

**Non-blocking notes** (not FAIL):
- PEND-01 does not have a dedicated integration assertion that omitting `--date` resolves to the calendar today; CLI uses the shared `todayIso()` wire (`src/cli.ts:234`), and list filtering is covered with an explicit target day.
- PEND-05 period *override* to a non-default period is not asserted via prompts (default path + `promoteCapture(..., "afternoon", ...)` API coverage exist).

---

## Discrimination Sensor

Isolated scratch: `git worktree add /tmp/flog-pending-captures-sensor-* e8720fe` with `node_modules` symlink. Real worktree never mutated. Pre/post `git status --porcelain` identical:

```
?? .specs/STATE.md
?? .specs/features/pending-captures/context.md
?? .specs/features/pending-captures/design.md
```

| Mutation | File:line | Description | Killed? |
| -------- | --------- | ----------- | ------- |
| 1 | `src/captures/storage.ts` (dedup gate) | Forced `duplicate = false` so identical pending raw always appends | ✅ Killed — `quietly skips duplicate…` + `returns duplicate…` failed (`MUT1_EXIT=1`) |
| 2 | `src/captures/patterns.ts` (`matchesPattern`) | Always `return true` | ✅ Killed — `does not match longer tokens…` + `returns no-match…` failed (`MUT2_EXIT=1`) |
| 3 | `src/captures/promote.ts` (`promoteCapture`) | Skip `setCaptureStatus`; return pending `target` unchanged | ✅ Killed — expected `status === "promoted"` failed in promote + pending CLI (`MUT3_EXIT=1`) |

Worktree removed with `git worktree remove --force`. Scratch gone; porcelain matched baseline.

**Sensor depth**: lightweight (3 behavior-level mutations)
**Result**: 3/3 killed - PASS ✅

---

## Interactive UAT Results

Not performed. Backend/CLI feature; automated gate + sensor sufficient per validate.md.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ Domain split into focused modules (`patterns`, `storage`, `capture`, `prefill`, `period`, `promote`, `pending-cli`, `hooks`) without unused abstractions |
| Surgical changes | ✅ Feature scoped to `src/captures/*`, CLI wires, README, tests |
| No scope creep | ✅ No Azure title fetch, no project-local overlays, Tempo payload shape unchanged |
| Matches patterns | ✅ Temp dirs + `FLOG_DATA_DIR` / `FLOG_CONFIG_DIR` mirror existing CLI tests |
| Spec-anchored outcome check | ✅ Assertions target status/raw/id/exit codes from spec |
| Per-layer Coverage Expectation | ✅ Domain unit 1:1; CLI happy + empty/error paths for capture/pending/hook |
| Every test maps to a spec requirement | ✅ Capture test suite maps to CAP/PEND/PAT + listed edges; pre-existing tests untouched |
| Documented guidelines followed | ✅ none (`AGENTS.md` / CONTRIBUTING absent) — strong defaults applied per tasks.md |

Would a senior engineer approve? Yes.

---

## Edge Cases

- [x] Non-matching command → no capture (`tests/captures-capture.test.ts:37-40`); wrapper still runs underlying via `command <root>` (`tests/captures-hooks.test.ts:31`)
- [x] Promote cancelled mid-edit → stays `pending`, no partial activity (`tests/captures-pending.test.ts:146-151`)
- [x] Missing day worklog on promote → created via `addActivity` defaults (`tests/captures-promote.test.ts:65-68`)
- [x] No ticket-like token → empty id prefill (`tests/captures-prefill.test.ts:14`)
- [x] Idempotent `hook install` → single marked block (`tests/captures-hooks.test.ts:63-64`)

---

## Gate Check

- **Gate command**: `npm run typecheck && npm test`
- **Result**: typecheck pass; **54** passed, **0** failed, **0** skipped
- **Test count before feature** (`aebfc98`): 14
- **Test count after feature** (`e8720fe` / HEAD): 54
- **Delta**: +40 new tests
- **Skipped tests**: none
- **Failures**: none

---

## Fix Plans

None. No surviving mutants, no uncovered ACs.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| CAP-01 … CAP-09 | Verified (author) | ✅ Verified (independent) |
| PEND-01 … PEND-10 | Verified (author) | ✅ Verified (independent) |
| PAT-01 … PAT-03 | Verified (author) | ✅ Verified (independent) |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 22/22 ACs matched spec outcome | 0 spec-precision gaps
**Sensor**: 3/3 mutations killed
**Gate**: 54 passed

**What works**: Capture match/dedup/storage, CLI capture/pending/hook, prefill + period defaults, promote/discard retention, Tempo isolation, user pattern merge + docs.

**Issues found**: None blocking.

**Next steps**: Feature can be marked done; optional follow-up to add a pending CLI default-today / period-override prompt assertion (non-blocking).

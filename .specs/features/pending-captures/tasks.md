# Pending Captures Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/pending-captures/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: none (`AGENTS.md` / CONTRIBUTING absent) - strong defaults applied. Style floor from `tests/worklog.test.ts`, `tests/cli.test.ts` (node:test + temp dirs + `FLOG_DATA_DIR` / `FLOG_CONFIG_DIR`).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Capture domain (patterns, storage, capture, prefill, period, promote) | unit | All branches; 1:1 to mapped spec ACs; every listed edge case that lands in the module | `tests/captures-*.test.ts` | `npm test` |
| CLI commands (`capture`, `pending`, `hook`) | integration | Happy path + empty/error paths for each new command | `tests/captures-cli.test.ts` (or extend `tests/cli.test.ts`) | `npm test` |
| Types / config path constants | none | Build gate only | - | `npm run typecheck` |
| README docs | none | Build gate only | - | build gate |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After domain unit-test tasks | `npm test` |
| Full | After CLI integration tasks | `npm test` |
| Build | After phase completion or types/docs-only tasks | `npm run typecheck && npm test` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Foundation

```
T1 → T2 → T3
```

### Phase 2: Capture command

```
T4 → T5
```

### Phase 3: Prefill and promote

```
T6 → T7 → T8
```

### Phase 4: Pending CLI and hooks

```
T9 → T10 → T11
```

### Phase 5: Docs

```
T12
```

---

## Task Breakdown

### Phase 1: Foundation

### T1: Add capture domain types

**What**: Define `CaptureStatus`, `CaptureEntry`, `DayCaptures`, and patterns file shape.
**Where**: `src/captures/types.ts`
**Depends on**: None
**Reuses**: `src/types.ts` style (`DayWorklog`, `Activity`)
**Requirement**: CAP-01, CAP-09

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [x] Types match design models (`schemaVersion: 1`, status union, optional promote metadata)
- [x] Types export cleanly for other capture modules
- [x] `npm run typecheck` passes

**Tests**: none
**Gate**: build

---

### T2: Implement pattern loader

**What**: Built-in defaults, user-level `capture-patterns.json` merge, prefix match, command roots.
**Where**: `src/captures/patterns.ts`
**Depends on**: T1
**Reuses**: `FLOG_CONFIG_DIR` / Conf config directory convention from `src/config.ts`
**Requirement**: CAP-05, CAP-06, PAT-01, PAT-03

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] Defaults include `git checkout -b` and `git switch -c`
- [ ] Missing user file → defaults only (no throw)
- [ ] User file patterns merge uniquely with defaults
- [ ] `matchesPattern` implements literal prefix rule from design
- [ ] `commandRoots` returns unique first tokens
- [ ] Corrupt JSON throws a clear error
- [ ] Unit tests in `tests/captures-patterns.test.ts` cover defaults, merge, missing file, match/non-match, roots, corrupt JSON
- [ ] Gate check passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T3: Implement capture day storage

**What**: Per-day capture JSON under `{dataDir}/captures/YYYY/MM/date.json` with append, dedup, status updates, list pending.
**Where**: `src/captures/storage.ts`
**Depends on**: T2
**Reuses**: Atomic temp+rename write from `src/storage.ts`; `validateDate` from `src/time.ts`
**Requirement**: CAP-01, CAP-04, CAP-09, PEND-06, PEND-07, PEND-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] Path layout matches design
- [ ] Append creates pending row with UUID id, raw, capturedAt
- [ ] Same-day identical raw while status `pending` returns quiet duplicate (no second row)
- [ ] `setCaptureStatus` marks promoted/discarded without deleting the row
- [ ] `listPending` returns only `pending`
- [ ] Unit tests in `tests/captures-storage.test.ts` cover path, append, dedup, status retain, listPending
- [ ] Gate check passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### Phase 2: Capture command

### T4: Implement captureCommand

**What**: Normalize raw text, match patterns, append or return duplicate/no-match; reject empty raw.
**Where**: `src/captures/capture.ts`
**Depends on**: T3
**Reuses**: `src/captures/patterns.ts`, `src/captures/storage.ts`, `todayIso()`
**Requirement**: CAP-01, CAP-02, CAP-03, CAP-04

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] Empty/whitespace raw throws
- [ ] No match → `"no-match"` and no write
- [ ] Match → append and `"captured"`
- [ ] Duplicate pending raw → `"duplicate"`
- [ ] Unit tests in `tests/captures-capture.test.ts` cover empty, no-match, captured, duplicate
- [ ] Gate check passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T5: Wire `flog capture` CLI

**What**: Add `flog capture` command that joins raw args, calls `captureCommand`, maps outcomes to exit/messages.
**Where**: `src/cli.ts`
**Depends on**: T4
**Reuses**: `context()`, existing CLI error style; `tests/cli.test.ts` harness patterns
**Requirement**: CAP-02, CAP-03

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] `flog capture -- git checkout -b feature/x_1` captures for today (or `--date` if exposed; default today)
- [ ] Empty capture exits non-zero with required-text error
- [ ] No-match and duplicate exit 0 (wrapper-friendly)
- [ ] Integration tests in `tests/captures-cli.test.ts` cover capture happy path, empty error, no-match quiet
- [ ] Gate check passes: `npm test`

**Tests**: integration
**Gate**: full

---

### Phase 3: Prefill and promote

### T6: Implement smart prefill

**What**: Derive promote `id` and `description` defaults from raw command text.
**Where**: `src/captures/prefill.ts`
**Depends on**: T5
**Reuses**: None (pure functions)
**Requirement**: PEND-04

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] Trailing `_digits` / ticket-like token prefills `id`
- [ ] No ticket → empty `id`
- [ ] Branch-create raw yields cleaned description hint; otherwise raw
- [ ] Unit tests in `tests/captures-prefill.test.ts` cover example `git checkout -b feature/icms-ui_tax4b_120999`, no-ticket case, non-git raw
- [ ] Gate check passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T7: Implement default period helper

**What**: Choose morning/afternoon from capture timestamp vs day period bounds.
**Where**: `src/captures/period.ts`
**Depends on**: T6
**Reuses**: `DayWorklog` bounds; align with design (`< afternoon.start` → morning)
**Requirement**: PEND-05

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] Timestamp before `afternoon.start` → `morning`
- [ ] Timestamp at/after `afternoon.start` → `afternoon`
- [ ] Unit tests in `tests/captures-period.test.ts` cover both sides of the boundary
- [ ] Gate check passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T8: Implement promote and discard use-cases

**What**: Promote a capture into an activity via `addActivity` and mark status; discard marks discarded without activity.
**Where**: `src/captures/promote.ts`
**Depends on**: T7
**Reuses**: `addActivity` / `readDay` from `src/storage.ts`; capture storage status updates
**Requirement**: PEND-03, PEND-05, PEND-06, PEND-07, PEND-10

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] Promote writes activity with confirmed id/description/period; marks `promoted`; retains raw row
- [ ] Missing day worklog is created via existing `addActivity`/`readDay` behavior
- [ ] Discard marks `discarded`, no activity
- [ ] Cancel is CLI-level (no partial write in this module - promote is all-or-nothing per call)
- [ ] Unit tests cover promote → activity + status, discard → status only, and that Tempo payload builder still ignores captures (build from day only)
- [ ] Gate check passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### Phase 4: Pending CLI and hooks

### T9: Implement `flog pending` triage CLI

**What**: List pending for today/`--date`/`-N`; checkbox → promote|discard|cancel; promote edit loop with prefill + period default.
**Where**: `src/captures/pending-cli.ts`
**Depends on**: T8
**Reuses**: `@inquirer/prompts` (`checkbox`, `input`, `select`); `expandRelativeDateArgs` already in CLI argv path
**Requirement**: PEND-01, PEND-02, PEND-03, PEND-04, PEND-05, PEND-08, PEND-09

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] Exported runner used by `src/cli.ts` command registration (thin wire in same task if needed for the command to exist - keep interactive logic in this file)
- [ ] Empty pending → success message, no crash
- [ ] Lists only `pending` for target day
- [ ] Promote/discard call `promote.ts` helpers; cancel leaves statuses unchanged
- [ ] Mid-promote cancel leaves current item `pending`
- [ ] Integration test: empty pending for a date; unit/integration for list filtering if prompts are injected or bypassed via exported non-interactive helpers
- [ ] Gate check passes: `npm test`

**Tests**: integration
**Gate**: full

---

### T10: Implement hook install/uninstall

**What**: Generate wrapper script for command roots; idempotent marked-block install/uninstall in shell rc.
**Where**: `src/captures/hooks.ts`
**Depends on**: T9
**Reuses**: `commandRoots` from patterns; config dir paths
**Requirement**: CAP-07, CAP-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] `renderWrapperScript` uses `command <root>` and best-effort `flog capture`
- [ ] Install writes wrappers file + marked rc block; second install does not duplicate blocks
- [ ] Uninstall removes marked block
- [ ] Unit tests in `tests/captures-hooks.test.ts` cover render roots, idempotent install, uninstall (temp rc file)
- [ ] Gate check passes: `npm test`

**Tests**: unit
**Gate**: quick

---

### T11: Wire `flog hook` CLI commands

**What**: Register `flog hook install` and `flog hook uninstall` on the Commander program.
**Where**: `src/cli.ts`
**Depends on**: T10
**Reuses**: `src/captures/hooks.ts`
**Requirement**: CAP-07, CAP-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] Both subcommands callable
- [ ] Integration test installs against temp rc / config dirs via env overrides and asserts marked block present/absent
- [ ] Gate check passes: `npm test`

**Tests**: integration
**Gate**: full

---

### Phase 5: Docs

### T12: Document captures in README

**What**: Document `capture`, `pending`, `hook install/uninstall`, patterns file path, and examples including `git clone` / `t14ss -b`.
**Where**: `README.md`
**Depends on**: T11
**Reuses**: Existing README command list style
**Requirement**: PAT-02

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] Commands listed
- [ ] User-level `capture-patterns.json` path and merge behavior documented
- [ ] Examples include personal patterns (`git clone`, `t14ss -b`)
- [ ] Gate check passes: `npm run typecheck && npm test`

**Tests**: none
**Gate**: build

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5

Phase 1:  T1 → T2 → T3
Phase 2:  T4 → T5
Phase 3:  T6 → T7 → T8
Phase 4:  T9 → T10 → T11
Phase 5:  T12
```

Execution is strictly sequential - there is no intra-phase parallelism.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: Capture types | 1 file / types | ✅ Granular |
| T2: Pattern loader | 1 module + tests | ✅ Granular |
| T3: Capture storage | 1 module + tests | ✅ Granular |
| T4: captureCommand | 1 module + tests | ✅ Granular |
| T5: CLI capture | 1 command wire + tests | ✅ Granular |
| T6: Prefill | 1 module + tests | ✅ Granular |
| T7: Period helper | 1 module + tests | ✅ Granular |
| T8: Promote/discard | 1 module + tests | ✅ Granular |
| T9: Pending CLI | 1 module + tests | ✅ Granular |
| T10: Hooks | 1 module + tests | ✅ Granular |
| T11: Hook CLI wire | 1 file modify + tests | ✅ Granular |
| T12: README | 1 doc file | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | (root) | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | (cross-phase) | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | (cross-phase) | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |
| T9 | T8 | (cross-phase) | ✅ Match |
| T10 | T9 | T9 → T10 | ✅ Match |
| T11 | T10 | T10 → T11 | ✅ Match |
| T12 | T11 | (cross-phase) | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | Types | none | none | ✅ OK |
| T2 | Capture domain | unit | unit | ✅ OK |
| T3 | Capture domain | unit | unit | ✅ OK |
| T4 | Capture domain | unit | unit | ✅ OK |
| T5 | CLI commands | integration | integration | ✅ OK |
| T6 | Capture domain | unit | unit | ✅ OK |
| T7 | Capture domain | unit | unit | ✅ OK |
| T8 | Capture domain | unit | unit | ✅ OK |
| T9 | CLI commands | integration | integration | ✅ OK |
| T10 | Capture domain | unit | unit | ✅ OK |
| T11 | CLI commands | integration | integration | ✅ OK |
| T12 | README docs | none | none | ✅ OK |

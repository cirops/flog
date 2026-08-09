# Pending Captures Context

**Gathered:** 2026-08-09
**Spec:** `.specs/features/pending-captures/spec.md`
**Status:** Ready for design

---

## Feature Boundary

Capture selected shell commands as **pending** day entries via configurable hooks, then triage them later with `flog pending` into real morning/afternoon activities (same shape as `flog m` / `flog a`). Existing manual logging and Tempo `review`/`push` stay unchanged; pending never becomes billable until promoted.

---

## Implementation Decisions

### Capture surface

- Ship shell wrappers installed by `flog hook install` (e.g. into the user’s shell rc).
- Also ship `flog capture` for explicit/manual capture without a wrapper.
- Do not use per-repo git hooks as the primary mechanism.
- Do not wrap entire shell history.

### What gets captured

- Pattern list is **configurable from day one**.
- Built-in defaults cover git branch creates (`git checkout -b`, `git switch -c`).
- User’s personal list will include at least: branch creates, `git clone`, and `t14ss -b`.
- Matching is against the command the user ran (raw text retained on the pending entry).

### Personal patterns file

- User-level only — under flog’s existing config home (e.g. `~/.config/flog-nodejs/…`).
- Not stored in the flog git repo; no project-local overlay in v1.

### Review CLI

- Primary command: `flog pending`.
- Leave `flog review day|week` exclusively for Tempo payload preview (no `review pending` alias in v1).

### Triage interaction

- Multi-select open pending rows for the chosen day.
- For each selected item: edit **id** + **description**, choose **period** (morning/afternoon), then promote to a normal activity.
- Unselected items remain pending.
- Explicit discard action for junk (does not promote).

### Smart prefill on promote

- Prefill `id` from a trailing ticket-like numeric token when present (e.g. `_120999` in a branch name).
- Prefill description from a cleaned module/branch hint when parseable; otherwise start from the raw command text.
- User always confirms/edits before promote completes.

### Lifecycle & history

- `flog pending` defaults to **today** only.
- Older days via `--date YYYY-MM-DD` or relative `-1`, `-2`, etc. (same expansion style as existing flog commands).
- With `--date` / `-N`, triage works the same as for today for that day.
- Raw captures are stored **per day** in durable files kept for history/consultation.
- Promote and discard **do not delete** the raw row; they mark status (`pending` → `promoted` / `discarded`).
- `flog pending` lists only open `pending` status for the selected day.
- Untouched/promoted/discarded captures never affect Tempo, `flog review`, or `push`.

### Agent's Discretion

- Exact schema of the per-day capture file (fields beyond raw command, timestamp, status).
- Hook installer details (wrapper generation, how wrappers call into `flog capture`).
- Pattern match syntax in the user config file (prefix vs regex) — pick the simplest approach that supports the listed commands.
- Dedup of identical raw command text on the same day (warn vs silent skip) — prefer quiet same-day dedup unless it hurts the workflow.
- Whether `flog hook uninstall` ships in the same MVP slice.

### Declined / Undiscussed Gray Areas → Assumptions

- Same-day dedup of identical raw command text: on (quiet) — reduces branch-hop noise.
- Period default on promote: inferred from capture timestamp against the day’s morning/afternoon bounds; user can override.
- No Azure DevOps (or other) title fetch in this feature — description stays manual/smart-prefill only.

---

## Specific References

- Example capture signal: `git checkout -b feature/icms-ui_tax4b_120999` stored raw, later promoted to something like `flog m` style `120999 - ICMS - Adiciona coluna ao relatório de ajustes automatizados`.
- Personal extra patterns called out: `git clone`, `t14ss -b`.
- Relative dates: reuse existing `-1`, `-2` argv expansion.

---

## Deferred Ideas

- Auto-fetch work-item titles from Azure DevOps (or similar) during promote.
- Project-local pattern overlays.
- `flog review pending` alias.
- Capturing arbitrary non-whitelisted shell history.
- Auto-expire / carry-forward of open pendings across days in the default list.

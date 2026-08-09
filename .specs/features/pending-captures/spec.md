# Pending Captures Specification

## Problem Statement

Manual `flog m` / `flog a` works, but starting work often begins with a shell command (branch create, clone, custom tools) long before a clean activity description exists. Those signals are easy to forget by end of day. This feature captures matching commands as pending day entries and lets the user promote them into normal activities later.

## Goals

- [ ] Matching configured shell commands append a durable pending capture for the calendar day of the capture
- [ ] `flog pending` lets the user multi-select, edit, and promote captures into morning/afternoon activities identical in shape to `flog m` / `flog a`
- [ ] Pending captures never appear in Tempo review/push until promoted
- [ ] Raw capture history for each day remains available after promote or discard

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Azure DevOps / remote title fetch on promote | Deferred; description stays manual + local smart-prefill |
| Project-local pattern overlays | v1 is user-level config only |
| `flog review pending` alias | Tempo `review` stays day/week only |
| Wrapping full shell history | Noise; whitelist patterns only |
| Per-repo git hooks as primary capture | Shell wrappers are the chosen surface |
| Auto-expire or carry-forward in the default pending list | Default list is the selected day only |
| Changing Tempo payload shape or period duration rules | Unrelated to capture/triage |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Same-day dedup of identical raw command text | Quiet skip (no second pending row) | Avoids spam from repeated checkouts | y (context) |
| Period default on promote | Infer from capture timestamp vs day morning/afternoon bounds; user can override | Matches when the signal happened | y (context) |
| Pattern match syntax | Simplest form that supports listed commands (agent discretion at design) | User cares about which commands, not match engine | y (agent discretion) |
| Hook uninstall in MVP | Include `flog hook uninstall` alongside install | Symmetry; low cost | y (agent discretion) |
| Capture file schema extras | Beyond raw command, timestamp, status: stable id + optional promote metadata | Needed for triage and history | y (agent discretion) |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Capture matching commands as pending ⭐ MVP

**User Story**: As a developer, I want configured shell commands to create a pending capture for the day so that I do not lose the signal of what I started.

**Why P1**: Without capture, triage has nothing to work on.

**Acceptance Criteria**:

1. WHEN a wrapped command matches a configured pattern THEN the system SHALL append a capture for the current local calendar day with the raw command text, a capture timestamp, status `pending`, and a stable capture id
2. WHEN `flog capture <raw>` is invoked with non-empty raw text that matches a configured pattern THEN the system SHALL append the same shape of pending capture as a wrapper would
3. IF `flog capture` is invoked with empty raw text THEN the system SHALL reject the command with a non-zero exit and an error message stating that capture text is required
4. IF the raw command text already exists as a `pending` capture for that same day THEN the system SHALL not append a duplicate row
5. The system SHALL load capture patterns from built-in defaults plus the user-level patterns file under the flog config home, and SHALL NOT require any file inside a project git repository
6. The system SHALL ship built-in default patterns that match `git checkout -b` and `git switch -c` branch-create invocations
7. WHEN `flog hook install` succeeds THEN the system SHALL install shell wrapper integration that routes matching user commands through capture without wrapping entire shell history
8. WHEN `flog hook uninstall` succeeds THEN the system SHALL remove the shell wrapper integration installed by `flog hook install`
9. The system SHALL persist captures in a per-day durable file under the flog data directory and SHALL retain that file after promote or discard

**Independent Test**: Install hooks (or call `flog capture` directly), run a matching command, confirm a pending row exists for today in the day capture store.

---

### P1: Triage pending into real activities ⭐ MVP

**User Story**: As a developer, I want to review today's pending captures and promote selected ones into normal activities so that my worklog matches what I would have typed with `flog m` / `flog a`.

**Why P1**: Capture without promotion does not produce billable worklog entries.

**Acceptance Criteria**:

1. WHEN `flog pending` runs with no date option THEN the system SHALL list only captures with status `pending` for today
2. WHEN `flog pending` runs with `--date YYYY-MM-DD` or a relative `-N` date THEN the system SHALL list only `pending` captures for that target day
3. WHILE the pending list for the target day is non-empty, WHEN the user multi-selects one or more items and completes promote for an item THEN the system SHALL append an activity to the chosen period on that day with the confirmed `id` and `description`, using the same activity shape as `flog m` / `flog a`
4. WHEN promoting a capture THEN the system SHALL prefill `id` from a trailing ticket-like numeric token in the raw command when present, SHALL prefill `description` from a cleaned branch/module hint when parseable otherwise from the raw command, AND SHALL require the user to confirm or edit both fields before the activity is written
5. WHEN promoting a capture THEN the system SHALL default the period from the capture timestamp against that day's morning/afternoon bounds and SHALL allow the user to override the period before the activity is written
6. WHEN a capture is successfully promoted THEN the system SHALL mark that capture status as `promoted` and SHALL keep the raw capture row in the day file
7. WHEN the user discards a pending capture THEN the system SHALL mark that capture status as `discarded`, SHALL keep the raw row, and SHALL NOT create an activity
8. WHILE a capture has status `promoted` or `discarded`, the system SHALL NOT show it in the `flog pending` list for that day
9. IF the target day has no `pending` captures THEN `flog pending` SHALL exit successfully and print a message that there is nothing pending for that day
10. The system SHALL NOT include pending, promoted, or discarded captures in Tempo destination payloads built by `flog review` or `flog push`

**Independent Test**: Seed two pending captures for today; promote one with edited id/description into morning; discard the other; confirm day worklog has one new activity, pending list is empty, both raw rows remain with updated statuses, and `flog review day` is unchanged by the remaining history.

---

### P2: Personal pattern customization

**User Story**: As a developer, I want to extend the pattern list in my user-level config so that commands like `git clone` and `t14ss -b` are captured without changing the flog repository.

**Why P2**: Defaults cover the primary git branch-create case; personal tools need a supported extension path in v1.

**Acceptance Criteria**:

1. WHEN the user-level patterns file defines additional patterns THEN matching commands SHALL be captured the same way as built-in defaults
2. The system SHALL document the user-level patterns file path and how to add patterns (including examples for `git clone` and `t14ss -b`)
3. IF the user-level patterns file is missing THEN the system SHALL use built-in defaults only and SHALL NOT fail capture or `flog pending`

**Independent Test**: Add `git clone` and `t14ss -b` to the user-level file; run matching commands; confirm pending rows; remove the file and confirm defaults still capture branch creates.

---

## Edge Cases

- IF a wrapped command does not match any pattern THEN the system SHALL run the underlying command without creating a capture
- IF promote is cancelled mid-edit THEN the system SHALL leave that capture as `pending` and SHALL NOT write a partial activity
- IF the day worklog file does not exist yet WHEN a capture is promoted THEN the system SHALL create the day worklog using the same defaults as other flog activity commands before appending the activity
- WHEN the raw command contains no ticket-like numeric token THEN the system SHALL leave the id prefill empty for the user to fill during promote
- IF `flog hook install` is run when wrappers are already installed THEN the system SHALL leave the user with a single active integration (idempotent install) and SHALL NOT duplicate capture side effects for one command

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| CAP-01 | P1: Capture matching commands | Design | Verified |
| CAP-02 | P1: Capture matching commands | Design | Verified |
| CAP-03 | P1: Capture matching commands | Design | Verified |
| CAP-04 | P1: Capture matching commands | Design | Verified |
| CAP-05 | P1: Capture matching commands | Design | Verified |
| CAP-06 | P1: Capture matching commands | Design | Verified |
| CAP-07 | P1: Capture matching commands | Design | Pending |
| CAP-08 | P1: Capture matching commands | Design | Pending |
| CAP-09 | P1: Capture matching commands | Design | Verified |
| PEND-01 | P1: Triage pending into activities | Design | Pending |
| PEND-02 | P1: Triage pending into activities | Design | Pending |
| PEND-03 | P1: Triage pending into activities | Design | Verified |
| PEND-04 | P1: Triage pending into activities | Design | Verified |
| PEND-05 | P1: Triage pending into activities | Design | Verified |
| PEND-06 | P1: Triage pending into activities | Design | Verified |
| PEND-07 | P1: Triage pending into activities | Design | Verified |
| PEND-08 | P1: Triage pending into activities | Design | Verified |
| PEND-09 | P1: Triage pending into activities | Design | Pending |
| PEND-10 | P1: Triage pending into activities | Design | Verified |
| PAT-01 | P2: Personal pattern customization | Design | Verified |
| PAT-02 | P2: Personal pattern customization | Design | Pending |
| PAT-03 | P2: Personal pattern customization | Design | Verified |

**Coverage:** 22 total, 0 mapped to tasks, 22 unmapped

---

## Success Criteria

- [ ] A matching `git checkout -b feature/…_120999` (via hook or `flog capture`) creates a pending row for today with the raw command preserved
- [ ] `flog pending` promotes a selected row into a morning/afternoon activity with user-confirmed id and description
- [ ] After promote/discard, the day capture file still contains the raw rows with updated status
- [ ] `flog review` / `flog push` behavior for activities is unchanged and ignores capture history
- [ ] User-level patterns can add `git clone` and `t14ss -b` without committing anything to the flog repo

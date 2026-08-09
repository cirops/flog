# STATE

## Decisions

### AD-001
- **Decision**: Pending command captures live in a dedicated per-day store under `{dataDir}/captures/`, never inside `DayWorklog` JSON.
- **Reason**: Keeps Tempo review/push and day rendering isolated from triage state; promote is the only bridge into activities.
- **Trade-off**: Two files per active day instead of one; callers must know which store to use.
- **Scope**: Capture/pending feature and any future signal ingestion that is not yet a billable activity
- **Date**: 2026-08-09
- **Status**: active

## Handoff

- **Feature**: pending-captures (`.specs/features/pending-captures/`)
- **Phase / Task**: Execute complete — Verifier PASS
- **Completed**: T1–T12 + validation.md
- **In-progress**: none
- **Next step**: Optional UAT — `flog hook install`, use matching commands, `flog pending` triage
- **Blockers**: none
- **Uncommitted files**: status/handoff updates if any
- **Branch**: main

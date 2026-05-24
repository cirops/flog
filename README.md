# flog

`flog` is a local-first worklog CLI for recording morning and afternoon work blocks, reviewing billable time, and pushing period-based worklogs to Tempo.

The source of truth is one JSON file per day:

```text
worklogs/2026/05/2026-05-23.json
```

Each day contains `morning` and `afternoon` periods. A period has a `start`, `end`, and activity list. Duration is calculated from the period times; activities describe what happened inside that block.

## Install

```bash
npm install -g flog
```

For local development:

```bash
npm install
npm run build
npm link
```

## Commands

```bash
flog morning <id> <description>       # alias: flog m
flog afternoon <id> <description>     # alias: flog a

flog morning-start <HH:MM>            # alias: flog ms
flog morning-end <HH:MM>              # alias: flog me
flog afternoon-start <HH:MM>          # alias: flog as
flog afternoon-end <HH:MM>            # alias: flog ae

flog today
flog week [Wxx|YYYY-Wxx]
flog review day [YYYY-MM-DD]
flog review week [Wxx|YYYY-Wxx]
flog push day [YYYY-MM-DD] [--force]
flog push week [Wxx|YYYY-Wxx] [--force]
flog setup
flog undo
```

Use `--date YYYY-MM-DD` on activity, block, `today`, `review day`, and `push day` commands for retroactive edits. Day review and push commands also accept the date as a positional argument.

## Examples

```bash
flog ms 07:30
flog m 123456 "Implement invoice import"
flog me 12:00

flog as 13:30
flog a 123456 "Review Tempo payloads"
flog ae 17:30

flog today
flog week 2026-W21
```

## Tempo

Run setup for non-secret local defaults:

```bash
flog setup
```

Copy `.env.example` to `.env` and set `TEMPO_TOKEN`. You can also set these in the shell:

```bash
TEMPO_TOKEN=
TEMPO_ISSUE_ID=
TEMPO_AUTHOR_ACCOUNT_ID=
TEMPO_ISSUE_KEY=
```

Review before pushing:

```bash
flog review day 2026-05-23
flog review day --date 2026-05-23
flog review week 2026-W21
flog push day 2026-05-23
flog push day --date 2026-05-23
```

Tempo submissions create one worklog per active period. A morning block with three activities becomes one Tempo worklog whose description lists all three activities. Successful submissions are recorded in append-only JSONL at `worklogs/submissions.jsonl`; repeated pushes are skipped by duplicate key unless `--force` is used.

## Configuration

Local config is managed with `conf`. Secrets belong in `.env` or the shell environment, not in the config store.

Useful environment variables:

```bash
FLOG_DATA_DIR=./worklogs
FLOG_CONFIG_DIR=./.flog-config
FLOG_ENV_FILE=./.env
TEMPO_TOKEN=
```

## Development

```bash
npm run typecheck
npm run test
npm run build
```

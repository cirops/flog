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

flog capture [--date] -- <raw command...>
flog pending [--date]
flog hook add <pattern...>
flog hook install [--rc <path>] [--shell zsh|bash]
flog hook uninstall [--rc <path>] [--shell zsh|bash]
```

Use `--date YYYY-MM-DD` on activity, block, `today`, `review day`, `push day`, `capture`, and `pending` commands for retroactive edits. Relative `-N` (for example `-1`) expands to `--date` for those same day-scoped commands. Day review and push commands also accept the date as a positional argument.

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

## Pending captures

`flog` can capture matching shell commands as pending day entries, then promote them into normal morning/afternoon activities later. Captures live under the data directory (`captures/YYYY/MM/date.json`) and never appear in Tempo `review` / `push` until promoted.

```bash
flog hook install                 # add marked wrappers to ~/.zshrc (or --rc / --shell bash)
flog hook add "git clone"         # append to user-level capture-patterns.json
flog hook add "t14ss -b"          # re-run flog hook install if the command root is new
flog capture -- git checkout -b feature/icms-ui_120999
flog pending                      # checkbox → promote | discard | cancel
flog hook uninstall
```

Built-in patterns cover `git checkout -b` and `git switch -c`. Extra patterns live in the user-level file next to the Conf store (created/updated by `flog hook add`):

```text
~/.config/flog-nodejs/capture-patterns.json   # Linux default; respects FLOG_CONFIG_DIR
```

```json
{
  "patterns": ["git clone", "t14ss -b"]
}
```

Missing file → built-in defaults only. Present file → unique merge of defaults plus your patterns. Examples above capture `git clone …` and `t14ss -b …` the same way as branch creates.

## Tempo

```bash
flog setup           # interactive: writes Conf store + edits .env for secrets
flog doctor          # prints effective config with the source of each value
flog review day 2026-05-23
flog push day 2026-05-23
flog sync day 2026-05-23
```

Tempo submissions create one worklog per active period. A morning block with three activities becomes one Tempo worklog whose description lists all three activities. Successful submissions are recorded in append-only JSONL at `worklogs/submissions.jsonl`; repeated pushes are skipped by duplicate key unless `--force` is used.

## Configuration

`flog` keeps two configuration channels and one bootstrap channel:

1. **`.env` — secrets only.** `TEMPO_TOKEN` lives here. `FLOG_CA_BUNDLE` lives
   here too (path to a CA bundle for corporate MITM proxies).
2. **Conf store — everything else.** Tempo issue/author/format/billableMode,
   default block times, daily target hours and the worklog data directory.
   Edit with `flog setup` (interactive) or directly in
   `~/.config/flog-nodejs/config.json` on Linux.
3. **Bootstrap env vars.** `FLOG_DATA_DIR`, `FLOG_CONFIG_DIR`, `FLOG_ENV_FILE`
   tell `flog` where the config files live (mostly for tests).

Older releases let you override Tempo settings via `TEMPO_*` env vars. Those
are now ignored — `flog doctor` will flag any that are still set so you can
remove them, and `flog setup` will offer to migrate the values into the Conf
store.

`flog` looks for `.env` in (in order): `FLOG_ENV_FILE`, the flog install root,
`~/.flog/.env`, and finally `$PWD/.env`. The default `worklogs/` directory sits
next to the flog install, so the CLI works from any directory.

### Corporate TLS / Zscaler

If your environment uses a MITM proxy (e.g. Zscaler on WSL), set `FLOG_CA_BUNDLE`
in your `.env` to the path of the CA bundle. `flog` will pass it to the HTTP
client used for Tempo requests, so the shell alias does not need
`NODE_EXTRA_CA_CERTS`:

```bash
alias flog='node /home/you/flog/dist/cli.js'
```

### Debugging configuration

```bash
flog doctor
```

prints the effective configuration with a `[env]`, `[conf]`, `[default]`, or
`[missing]` tag next to every value, plus the resolved `.env` path, Conf store
path, and worklog data directory. Use this first when something is not picking
up the value you expect.

## Development

```bash
npm run typecheck
npm run test
npm run build
```

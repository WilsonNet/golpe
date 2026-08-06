---
name: herdr-dev-workspace
description: "Use when starting, inspecting or stopping this project's dev servers (Vite :8084 and the Geckos game server :9208), or when you need to read a running server's output. Runs them in visible herdr panes instead of detached background processes, and exposes their logs non-interactively. Triggers on: run the dev server, start the game, npm run dev, dev:all, background process, server logs, is the server running, herdr, workspace, pane, tab, terminal multiplexer, port 8084, port 9208."
license: MIT
---

# Herdr Dev Workspace

Run this project's dev servers inside a [herdr](https://herdr.dev) workspace
rather than as detached background processes.

## Why not just background them

A `npm run dev &` server is invisible and, worse, *misleadingly* invisible:

- You cannot watch Vite recompile or see the game server's `[MATCH]` lines.
- A crashed server leaves no trace in your terminal.
- `pgrep -f "tsx server/index.ts"` **matches its own shell command line**, so a
  naive liveness check reports "running" when nothing is listening.

That combination has already produced a false result in this repo: the physics
diagnostic reported `PASS` for three consecutive online runs against a server
that was dead, because no snapshots means no reconciliation and therefore no
jitter. Panes you can actually look at make that failure obvious.

## Commands

```bash
npm run dev:herdr           # create the "dev" tab, start both servers, wait for ports
npm run dev:herdr:status    # pane liveness + real port checks
npm run dev:herdr:logs      # tail both panes
npm run dev:herdr:down      # ctrl+c both panes and close the tab

node scripts/dev-herdr.mjs logs server --lines=60   # one service, more history
node scripts/dev-herdr.mjs logs vite
```

`up` is idempotent — it closes a previous `dev` tab instead of stacking
duplicates — and it reports **real readiness** by polling the ports, not by
assuming the spawn worked. If a port never opens it prints that pane's tail so
you see the error immediately.

State (workspace/tab/pane ids) lives in `.herdr/dev.json`, which is gitignored
because pane ids are machine-local.

## Layout it creates

```
workspace "vento-aureo"
└── tab "dev"
    ├── pane "vite :8084"     npm run dev
    └── pane "geckos :9208"   npm run dev:server
```

It reuses the existing `vento-aureo` workspace when there is one, so the dev tab
sits beside whatever agents are already working in that project.

## Herdr model

| Concept | Meaning |
|---|---|
| Session | Persistent namespace. `herdr` attaches to the default one; `herdr session list` shows named ones. |
| Workspace | Top-level project container — one per repo or investigation. |
| Tab | A layout inside a workspace. Idiomatically split by role: `agents`, `server`, `logs`. |
| Pane | An actual terminal process. Survives client detach. |

Client/server: a background server owns the panes and process state; the
terminal UI is just a client. Detach with `ctrl+b q` and the servers keep
running; `herdr` reattaches.

## The scriptable API

Everything above the UI is available over herdr's socket API, which is what
`scripts/dev-herdr.mjs` drives. Most commands emit a JSON envelope
(`{"id":..., "result":...}`):

```bash
herdr status server                     # is a server running (plain text)
herdr workspace list                    # -> result.workspaces[].workspace_id / .label
herdr tab list --workspace w1           # -> result.tabs[]
herdr tab create --workspace w1 --cwd "$PWD" --label dev --no-focus
                                        # -> result.tab.tab_id, result.root_pane.pane_id
herdr pane split w1:pA --direction down --ratio 0.5 --cwd "$PWD"
                                        # -> result.pane.pane_id
herdr pane rename w1:pA "vite :8084"
herdr pane run w1:pA npm run dev  # command is argv, not a shell string
herdr pane send-keys w1:pA ctrl+c
herdr pane list                         # -> result.panes[] with agent_status
herdr tab close w1:tA
```

### Two ways a stale server lies to you

Both of these have already burned a session, and both look like a *code* bug.

**1. `up` can report "ready :9208" for a server that just died.** The pane's
`npm run dev:server` exits with `EADDRINUSE` because a previous server process
still holds the port — and the readiness check polls the *port*, which is open,
because the old process is holding it. The room you then connect to is running
**the code from before your change**.

The symptom is spectacular and points nowhere near the truth: a change to
`online/wire.ts` (adding one packed field) made the client and the zombie server
disagree about every field index after it, and the probe reported *160 melee
prediction desyncs* and a feature that "did not work at all". The feature was
fine. Read the pane before believing a probe that suddenly fails everywhere:

```bash
node scripts/dev-herdr.mjs logs server --lines=20   # EADDRINUSE says it outright
ss -lptn 'sport = :9208'                            # who actually holds it
```

**Restart the server for `src/game/online/wire.ts` too.** The rule in AGENTS.md
lists `server/`, `src/game/simulation/`, `src/game/characters/` and
`src/game/training/` — but the server imports the wire format as well, and a
half-updated wire is the worst of all of them because the failure is silent
divergence rather than a crash.

**2. `pkill -f "tsx server/index.ts"` kills the shell that ran it.** The pattern
matches the agent's own command line, exactly as the `pgrep` note below warns —
the tool call dies mid-chain with exit 144 and every command *after* it is
silently skipped. That is how a `git stash push … ; … ; git stash pop` chain left
a whole session's work sitting in a stash. Use `npm run dev:herdr:down`, which
sends ctrl+c to the panes and does not pattern-match anything.

### Gotchas found the hard way

- **`herdr pane read` returns plain text, not JSON.** Parsing it as JSON throws.
- **Use `--source visible`.** The default `recent` source returns *empty* for a
  long-running process that is simply sitting there logging. `--lines` applies
  to the JSON sources, so slice the text yourself.
- **`pane run` takes argv**, e.g. `pane run w1:pA npm run dev` — not a
  quoted shell string.
- A workspace/tab/pane id is `w1`, `w1:t5`, `w1:p5`. Ids are per-session and are
  not stable across a server restart, hence the state file.
- Requires a running herdr server. `scripts/dev-herdr.mjs` fails with a clear
  message rather than hanging if there isn't one.

## When NOT to use this

If no herdr server is running and you only need a one-shot command (a single
`vite build`, a test run), just run it directly. This is for long-lived
processes you need to watch.

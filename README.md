# Vento Áureo

A 2D sword-fighting game — GunZ: The Duel's K-Style rebuilt in two dimensions —
on PixiJS 8 + React, with a custom deterministic AABB physics simulation shared
verbatim between the client and an authoritative Geckos.io server.

**Online first:** every match runs through the server, including single player —
the server fills the other slot with a bot. Playing the game is dogfooding the
netcode.

## Documentation

| Doc | What's in it |
|---|---|
| [Specs](specs/README.md) | **Source of truth for intended behaviour** — movement, sword combat, ranged combat, arena, netcode. |
| [Running the game](docs/running-the-game.md) | Every way to launch it: player vs AI, AI vs AI, player vs player, online AI vs AI. Dev servers, controls, URL parameters, debug hooks, troubleshooting. |
| [AGENTS.md](AGENTS.md) | The index every agent session loads: the rules that bite, commands, controls, and where to find everything else. Also loaded as `CLAUDE.md`. |
| [Architecture](docs/architecture.md) | Module map, the client/server boundary, and the online-first model. |
| [Invariants](docs/invariants.md) | Every rule that was written by a real bug, with the bug that motivated it. |
| [Diagnostics](docs/diagnostics.md) | The physics diagnostic tool: console hooks, reading the report, and the traps that produce false results. |
| [Agent config](docs/agent-config.md) | The write-once/run-everywhere symlink layout for OpenCode and Claude Code. |
| [Feedback loop](.agents/skills/feedback-loop/SKILL.md) | The physics diagnostic: how to measure a bug before fixing it, and the catalogue of root causes already found. |
| [Herdr dev workspace](.agents/skills/herdr-dev-workspace/SKILL.md) | Running the dev servers in visible herdr panes instead of background processes. |
| [Knowledge sharpener](.agents/skills/knowledge-sharpener/SKILL.md) | End-of-session routine for folding what was learned back into the docs. |

## Quick start

```bash
npm install
npm run dev:herdr      # or: npm run dev:all

# then open one of (all served by the authoritative server):
#   http://localhost:8080/                        solo vs server bot
#   http://localhost:8080/?ai=true                AI vs AI, one tab
#   http://localhost:8080/?mode=tdm&bots=7        team deathmatch, two sides
#   http://localhost:8080/?online=true            player vs player (two tabs)
#   http://localhost:8080/?online=true&ai=true    AI vs AI, two clients
#   http://localhost:8080/?offline=true           escape hatch, no server
```

Verify a change with `npm run verify` (typechecks the client *and* the server,
then tests and builds), plus `npm run diagnose` for anything touching physics or
netcode.

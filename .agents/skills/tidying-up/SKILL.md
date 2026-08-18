---
name: tidying-up
description: "Run a tidying day on Golpe: aggressive dead-code removal with knip, performance work (build speed, ECS hygiene, parallelism), DRY/single-source-of-truth consolidation with named constants, Biome noMagicNumbers enforcement, and a markdown/docs leanness pass. Ends with the full verify pipeline plus the online feedback-loop probes, because a cleanup that broke the game is not a cleanup. Triggers on: tidy, tidying, cleanup, dead code, refactor, DRY, constants, magic numbers, knip, unused, performance, parallel, docs review, AGENTS.md lean."
license: MIT
---

# Tidying Up

A maintenance session: **remove, consolidate and enforce** — no new features.
The goal is a tree with less code, fewer copies of a number, and rules that
keep it that way. Architecture is on the table: if a structure earns its keep
only by habit, delete it and see what breaks.

## The order that works

1. **Baseline first.** `pnpm run verify` (typecheck both projects + tests +
   build + knip) and note the timings. A tidying session that cannot show a
   before/after is guessing.
2. **Dead code (knip).** This is the biggest win and it is mechanical.
3. **Constants / single source of truth.** Named constants, one definition per
   number, shared across every file that uses it.
4. **Biome enforcement.** Turn the rules on so the tidy stays tidy.
5. **Performance.** Build speed, hot-loop hygiene, parallelism verdicts.
6. **Docs pass.** AGENTS.md, specs/, docs/, skills — lean and current.
7. **Prove it.** Full verify + the online probes. A cleanup that broke the
   game is not a cleanup.

## Step 2 — kill dead code with knip

Biome's unused rules are intra-file only. They cannot see an unused **export**,
an unused **file**, or an unused **dependency** — that is knip's job, and it is
the only maintained tool left that does it (ts-prune and depcheck are archived
and tell you to use knip).

### The setup

```json
// knip.json
{
	"$schema": "https://unpkg.com/knip@6/schema.json",
	"entry": ["scripts/*.mjs", "vite/*.mjs"],
	"project": ["src/**/*.{ts,tsx}", "server/**/*.ts", "scripts/**/*.mjs"],
	"vitest": true,
	"ignoreBinaries": ["herdr"]
}
```

`src/main.tsx` and `server/index.ts` are auto-detected (vite plugin, tsx in
package.json scripts) — listing them earns a configuration hint. `vitest: true`
makes every `*.test.ts` an entry root, so test-only helpers are not reported
dead.

### The traps

- **`server/physics.ts` is `export *` — knip cannot see through it.** Every
  name it re-exports looks unused. This is *why* the explicit re-export block
  in `src/game/simulation/Physics.ts` is load-bearing: the server reaches
  those names through the shim. When knip flags a name at a `Physics.ts`
  re-export line, trace it (`npx knip --trace-export <name>`) and check
  `server/GameRoom.ts`'s `./physics.js` import before deleting.
- **`knip --trace-export <name>` is the verifier.** Before cutting anything,
  trace it. "USED" may mean the name is imported from its home module directly
  (fine — trim the facade) rather than through the facade (keep it).
- **An "unused export" is two different things.** Either nobody imports it
  (delete the `export` keyword — the symbol stays for internal use) or nobody
  uses it at all (delete the symbol). Check internal references first.
- **Tests count as users.** `rectsOverlap` looked dead until the `.js`-suffixed
  import in `Physics.test.ts` was noticed. Trust the trace, then the typecheck.
- **The duplicate-exports report is real.** `SCREEN_W` and `WORLD_RIGHT` were
  the same 800px; one survived, its users renamed.
- **Run `npx knip --fix` last, if at all** — auto-deleting files is how the
  careful version of this session stopped being careful. Verify each item
  manually; the list is short.

### The session's haul, as a yardstick

One tidy day removed ~90 exports, a whole deprecated type alias, a duplicated
bot-personality block, and a debug overlay nobody rendered — every one found by
knip, every one verified by `--trace-export`, and `pnpm run verify` stayed green
throughout.

## Step 3 — constants and single source of truth

**The simulation layer already does this right** (every tuning value in
`Physics.ts`, `Melee.ts`, `Ultimate.ts` is a named export). The work is
elsewhere: AI brains, the server, the client wiring.

### The patterns that earn their keep

- **Unit conversions live once.** `MS_PER_SECOND = 1000` and
  `SECONDS_PER_MINUTE = 60` in `src/game/simulation/units.ts` — a module that
  imports nothing, so `Physics` and `Melee` (which cannot import each other)
  both use it without a cycle. `Physics` re-exports `MS_PER_SECOND` so client
  code keeps one entry point. `dt * 1000` was the single most common literal
  in the codebase; it is now one definition.
- **`MAX_HP = 100` in `Physics.ts`.** The same literal sat in five files
  (server spawns, match reset, client fallbacks). One definition, one import.
- **`GAME_SERVER_PORT` in `online/types.ts`** — the server binds it and the
  client dials it; the number lives beside the wire format both sides share.
  It cannot live in a client file the server cannot import.
- **Shared behaviour, not shared numbers.** `randomBotConfig()` in
  `AIConfig.ts` replaced two hand-rolled copies of the same five random ranges
  (server bots and offline AI-vs-AI). A tune that moved one copy and not the
  other made online and offline bots play differently.
- **Name the decision table.** `EnemyBrain`'s 49 literals — HP bands, range
  bands, chance rolls, stuck thresholds — became ~30 named constants grouped
  under one "Decision table" header. The state machine reads as a table now.
  Same for `MeleeBrain`'s personality knobs and `server/index.ts`'s URL
  guardrails (`FREEZE_TIME_MAX_S`, `SCORE_LIMIT_DEFAULT`, ...).
- **A constant whose only job is documentation is fine** — but prefer a
  comment on the *single* declaration over a comment per call site.

### What NOT to name

- **Art data.** Pixel coordinates, colour channels, swing arc angles, strip
  frame tables: the numbers ARE the art and the declaration site documents
  them. `MeleeFx.ts`'s `SWING` table and `assets.ts`'s drawing calls stayed
  literal on purpose.
- **Test expectations.** A literal `expect(x).toBe(2)` is verification data.
  The rule is disabled for `*.test.ts` by config, not by hand.
- **Spec constants.** The UUID fallback in `online/room.ts` is RFC 4122 layout
  — byte offsets and nibbles are the spec, and the rule is disabled for that
  file with the reason written in `biome.json`.

## Step 4 — Biome enforcement

`noMagicNumbers` (2.x, `style` group, not in recommended) has **no
configuration options** — the allowlist (0, 1, 2, 10, 24, 60, array indices,
enum values, initial values, object property values, JSX) is hardcoded. What
you can do is scope it by directory, which is the whole trick:

- **ON where a number is a game rule:** `server/`, `simulation/`,
  `characters/`, `combat/`, `online/`.
- **OFF where a number is art, measurement or wiring:** `render/`, `ui/`,
  `ecs/`, `input/`, `diagnostics/`, `training/`, `teamPalette.ts`, plus
  tests/scripts and the RFC-4122 file. Each override carries a JSONC comment
  explaining why (biome.json accepts comments).

Scope first, then fix what the rule flags. On the first day this produced
~650 warnings across the tree; after scoping and the constants pass, zero.

Gotchas learned the hard way:

- **The console reporter truncates** (~20 sites per rule) — use
  `--reporter=json` and count by file before believing the list is short.
- **`4` is not flagged in arithmetic** (`4 * a * c` passes) but `Math.PI / 4`
  ... is inconsistent — always verify a biome-ignore is actually needed, or
  the `suppressions/unused` warning comes back to bite.
- **Biome's "fix" is not always safe.** `useLiteralKeys` suggests dot
  notation that `noPropertyAccessFromIndexSignature` forbids. Leave those.

## Step 5 — performance

Measured verdicts, not folklore:

- **Build: esbuild, not terser.** Terser with `passes: 2` costs ~5-20x the
  time for a few percent fewer bytes nobody reads on the wire. The prod config
  now minifies with esbuild; the feedback loop rebuilds faster. Terser was
  removed from devDependencies.
- **Tests are already parallel.** Vitest 4 defaults to the `forks` pool with
  `fileParallelism` on — 20 files in ~0.8s. Nothing to do. If a test ever
  binds the Geckos port, give it a unique port per file rather than disabling
  parallelism.
- **Do NOT restructure the simulation.** Data-oriented SoA (`Float64Array`
  per field) pays off only when iterating one field across thousands of
  entities; this game has 16 fighters and the netcode rewinds *whole state
  objects*. AoS with fixed shapes is the right call, and miniplex's
  archetype queries are already cached at module level (never call
  `world.with(...)` inside a tick), never `where()` + reindex in a hot loop,
  and iterate `for...of` (reverse order, removal-safe). The ECS layer passed
  review unchanged.
- **Do NOT add worker_threads.** A 16-fighter 60Hz sim is microseconds per
  tick; postMessage serialization costs more than the work, and rollback
  rewinds one shared mutable state by definition. Threads would be for asset
  baking or CI, neither of which is the bottleneck.
- **The ECS boundary is load-bearing** — the simulation stays plain data and
  pure functions; that is what makes rewind-and-replay a three-line loop. A
  tidying day that "improves" this by moving state into component stores is a
  regression in disguise.

## Step 6 — the docs pass

Every tidying day ends by re-reading the markdown:

- **AGENTS.md is an index** — one-liners pointing at specs/docs/skills. If a
  paragraph grows beyond two lines, it belongs in the doc it links and the
  AGENTS.md line should be the pointer. Verify the commands block still names
  every script and the skills list matches `.agents/skills/`.
- **Stray files die.** This session deleted a tracked `README copy.md` from a
  completely different project (it had been living in git for who knows how
  long) and the gitignored `fight-logs*.txt` dumps.
- **Specs stay the source of truth.** If the tidy *changed a number's value*,
  the spec changes in the same commit. Renaming a constant to keep its value
  is not a behaviour change and needs no spec edit — but double-check, because
  "tuning a constant counts as changing behaviour" and it is easy to let one
  slip while moving things around.
- **Invariants get the new lessons.** A tidy day that discovers a rule
  ("knip cannot see through `export *`", "the explicit re-export block is
  load-bearing") writes it into `docs/invariants.md` in the same session, or
  the next tidy day re-learns it at full cost.
- **The knowledge-sharpener skill is the handoff.** When the session is
  substantial, run it at the end — it folds the lessons into specs/docs/
  skills and verifies the indexes, which is what this skill is for.

## Step 7 — prove it

```
pnpm run verify
node scripts/diagnose.mjs --mode=online --runs=3       # the canonical run
node scripts/diagnose.mjs --mode=online --ultCharge=100
node scripts/deathmatch-probe.mjs                      # at scale
node scripts/ultimate-probe.mjs                        # if Ultimate.ts was touched
node scripts/tdm-probe.mjs                             # if GameRoom was touched
```

The probes matter in a specific way after a tidy: knip and the constants pass
touch the *server* (`GameRoom`, `index.ts`) and the *brains* (`EnemyBrain`,
`MeleeBrain`) — exactly the files whose breakage a green unit suite cannot
see. An online PASS with damage dealt (`hpTrace` moving, `meleeSummary` counts
> 0) is the proof the cleanup did not change behaviour.

## When NOT to use this skill

- When the task is a feature or a bug: that is `feedback-loop` territory, and
  this skill's rule changes would muddy a fix.
- When the tree is mid-feature and unstable: tidying is for a tree that
  works, so the before/after of every step is measurable.

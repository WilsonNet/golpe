---
name: specs
description: "Use whenever behaviour changes, or before implementing a feature, to keep specs/ authoritative. The specs are the source of truth — code is volatile and gets rewritten, so intent is stated in English and the code is only its current implementation. Covers writing a spec, verifying spec numbers against the code, and the change-behaviour-change-the-spec rule. Triggers on: spec, specs folder, source of truth, intent, requirements, design doc, what should this do, is this documented, behaviour change, tuning constant, drift."
license: MIT
---

# Specs as Source of Truth

`specs/` states what the game **should** do. `src/` is only how it currently
does it.

Code is volatile — refactored, rewritten, regenerated. Intent expressed in
English survives all of that. So when the two disagree, the spec is not
automatically wrong: decide which one drifted, then make them agree **in the
same change**.

## The rule

> **Change behaviour → change the spec, in the same commit.**

A spec updated "later" is a spec nobody trusts, and an untrusted spec is worse
than none: it teaches the next reader to ignore the whole folder.

This is not bureaucracy. This repo's specs went stale once and claimed walk speed
160, jump −330, gravity 300 and "damage model: to be implemented" — long after
all four were false. Anyone reading them would have been actively misled.

## Layout

| Spec | Covers |
|---|---|
| `specs/README.md` | Index and these rules |
| `specs/movement.md` | Walking, jumping, dashing, wall jumps, collision |
| `specs/combat.md` | Stances, projectiles, damage, rounds, AI behaviour |
| `specs/arena.md` | World bounds, platform layout, reachability invariants |
| `specs/netcode.md` | Online-first model, prediction, reconciliation, bots |

A new subsystem gets a new file plus a row in `specs/README.md`.

## Writing a spec

**Intent first, numbers second.** The intent is what has to survive a rewrite;
the numbers are this implementation's way of achieving it.

> A jump must clear the ledge above it — 136px, from `JUMP_VELOCITY² / 2·GRAVITY`.

beats

> `JUMP_VELOCITY = -700`.

**Record why a number holds**, especially when other things depend on it.
Gravity and jump velocity determine level reachability; changing them silently
breaks the arena. That dependency belongs in the spec, not only in a comment.

**Mark gaps explicitly.** Every spec ends with a *Not implemented* section, so a
missing feature is never mistaken for a regression — and so nobody "fixes" a
deliberate omission.

**Say who owns a behaviour.** "The server spawns all bullets; `Player` must
never spawn its own" prevents a whole class of bug.

**Don't paste code.** If a spec has to quote an implementation detail to be
understood, the detail belongs in a comment next to the code, with the spec
pointing at it.

## Verifying a spec against the code

Specs drift silently, so check them rather than trusting them. The numbers live
in a small number of places:

```bash
# Movement / combat constants
grep -E "^export const" src/game/simulation/Physics.ts

# Arena geometry
grep -E "^\s+\{ x:" src/game/simulation/Arena.ts

# Netcode timings
grep -rE "^const [A-Z_]+ =" src/game/online/ server/
```

For each number in the spec, confirm it still matches. When they differ, work out
which changed and fix the other — do not silently overwrite the spec, because
sometimes the *code* is the regression.

Behavioural claims are better checked by test than by eye:
`src/game/simulation/Physics.test.ts` asserts jump height, reachability, the
narrow-gap invariant and determinism, so a spec claim backed by a test cannot
rot unnoticed.

## When to run this skill

- **Before implementing** anything non-trivial: read the relevant spec first, and
  write down the intended behaviour if it is not there yet.
- **After changing behaviour**, including tuning a constant. A constant change is
  a behaviour change.
- **When code and spec disagree** — resolve it rather than working around it.
- **During knowledge upkeep**, alongside the `knowledge-sharpener` skill.

## Relationship to the other knowledge files

| File | Answers |
|---|---|
| `specs/` | **What the game should do**, in English |
| `AGENTS.md` | How to work in this repo: invariants, architecture, commands |
| `.agents/skills/*` | How to carry out a specific workflow |
| Code comments | Why *this* line is the way it is |

Keep them disjoint. A rule duplicated in two places will be updated in one.

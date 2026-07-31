# Specs

**These documents are the source of truth. The code is the implementation.**

Code is volatile — it gets refactored, rewritten and regenerated. Intent stated
in English survives all of that. When a spec and the code disagree, that is a
defect: either the code drifted, or the spec was not updated when the behaviour
was deliberately changed. Both are bugs, and both are fixed by making the two
agree again in the *same* change.

Every spec here states intent first and numbers second, because the intent is
what has to survive; the numbers are how this implementation currently achieves
it.

## Index

| Spec | Covers |
|---|---|
| [controls.md](controls.md) | Default bindings, rebinding, the Esc menu, and what a binding may never touch |
| [movement.md](movement.md) | Walking, jumping, dashing, wall jumps, the feel constants and why they hold |
| [combat.md](combat.md) | Stances, ranged attacks, damage, round lifecycle |
| [melee.md](melee.md) | Sword combat: frame data, blocking, parries, the butterfly, the Massive Strike |
| [arena.md](arena.md) | World bounds, platform layout, reachability rules, spawn points |
| [deathmatch.md](deathmatch.md) | 16 fighters, frags, respawns, the win condition, names, the podium |
| [netcode.md](netcode.md) | Online-first model, rollback, reconciliation, the wire format, projectiles, bots |
| [training-room.md](training-room.md) | The scriptable practice dummy, its beat format, and the agent API |

## Rules

- **Change behaviour, change the spec, in the same commit.** A spec updated
  later is a spec nobody trusts.
- **State the intent, then the number.** "A jump must clear the ledge above it
  (136px)" outlives "JUMP_VELOCITY = -700".
- **Record why a number holds**, especially when other things depend on it.
  Gravity and jump velocity determine level reachability, so changing them
  silently breaks the arena.
- **Mark what is not built** explicitly as *Not implemented*, so a gap is never
  mistaken for a regression.
- Verify against the code with the `specs` skill before trusting any number here.

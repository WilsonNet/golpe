# Combat Mechanics

**Intent:** a sword duel across a vertical arena, with a gun as the answer to
distance. Reads and positioning decide fights; the ranged game exists to stop
turtling at range, not to win on its own.

Sword combat is large enough to own a document — see **[melee.md](melee.md)**
for the GunZ-derived frame data, blocking, parries, the butterfly and the
Massive Strike. This file covers the ranged half, damage and the round
lifecycle.

## Authority

**There is exactly one source of bullets:**

- **Online (every normal match):** the server spawns, simulates and resolves all
  bullets. Clients only draw them.
- **`?offline=true` escape hatch only:** `combat/BulletSystem`.

Nothing else may spawn a ranged projectile. The fighter classes used to, which
produced a second sprite nothing simulated — it froze on screen forever.

## Stance system

- **Q**: sword stance. **E**: gun stance. Default at spawn: **sword** — this is
  a sword game first, and the gun is the answer to a range problem.
- Switching is instant and has no cooldown, but it is not free: it **cancels a
  cancellable melee move**, which is GunZ's slash-shot. It cannot escape the
  recovery of a heavy move.
- Blocking requires the sword; firing requires the gun.
- **The burst gesture follows the stance**: double-tap dashes with the sword out
  and tumbles with the gun out. The tumble is the gunner's spacing tool — slower
  than the dash, affected by gravity, with a reduced hitbox while rolling — and
  the whole trade-off lives in [movement.md](movement.md).

## Ranged combat

- **Left-click** fires toward the cursor, in gun stance only. The bullet's
  heading is fixed at spawn from the aim angle the client sent, so a shot goes
  exactly where the cursor was — see the cursor→world conversion in
  [movement.md](movement.md), and `scripts/aim-probe.mjs`, which measures the
  angle a bullet actually left with against the angle the cursor asked for.
- Bullet speed **600 px/s**, damage **10** per hit.
- Attack cooldown **250ms**, shared by all attacks.
- Unlimited ammunition.
- Bullets fly in a straight line: **no gravity, no bounce, no collision
  response.** This is what makes their position a closed-form function of time,
  and it is why they are dead-reckoned rather than interpolated
  (see [netcode.md](netcode.md)).
- A bullet is destroyed on contact with a platform, on hitting a fighter, on
  being absorbed by a guard, or on leaving the world bounds.
- **A raised block stops a bullet outright**, front only, exactly as it stops a
  slash: 0 damage, and the shot is consumed. A bullet travelling right arrives
  from the left, so it is blocked by a fighter facing left; a purely vertical
  shot has no side to come from and is not blocked.
  - **There is no parry against a bullet.** A guard break is the sword's answer
    to the sword — the attacker spends a second helpless and the defender
    collects a Massive, which is worthless at gun range and would make holding
    block strictly dominant against a gunner. A bullet a guard stops is simply
    gone.
  - **No knockback.** Bullets apply none, and a blocked one is no exception.
  - This does not make the gun useless, because every cost of blocking is still
    paid: it covers one side, it slows you to 55% walk speed, it does nothing
    against an uppercut or a Massive's blast, and — decisively — **it requires the
    sword, so a fighter absorbing shots cannot return fire**. The answer to a
    guard is to move around it, not to out-damage it.
  - *Not implemented:* an impact effect for an absorbed shot. The effect path
    carries a `MeleeMove`, which a bullet is not.
- Bullets spawn at the **centre** of the firing body, not its top-left corner.
- Sprites come from a recycled pool; a bullet sprite is bound to a bullet **id**,
  never to a position in an array.
- `EventBus` emits `bullet-fired` per shot, for the React UI.

## Melee combat

Specified in full in **[melee.md](melee.md)**. In summary: slash, uppercut,
Massive Strike and the plunge bomb, each with startup/active/recovery frame
data; a front-only block that guard-breaks any sword attack it stops and grants
the defender a free Massive; and slash-into-block cancelling that produces the
butterfly. The server is the sole judge of a melee hit, exactly as it is for
bullets.

## Damage and death

- Fighters start at **100 HP**. Bullet damage **10**, so ten clean hits is a KO;
  melee damage ranges from 7 (slash) to 24 (Massive Strike).
- HP is clamped at 0; a dead fighter is drawn at **0.3 alpha**.
- Damage is applied server-side and is **not** logged as `[FIGHT]` — read HP from
  `window.__gameState()` to confirm an online fight is happening.
- **A deathmatch respawns the fighter, not the arena.** At 0 HP the server credits
  a frag, holds that fighter down for **2s** as an ordinary stun, and returns it to
  a spawn point. Nobody else is touched. See [deathmatch.md](deathmatch.md).
- **A training room keeps the round.** At 0 HP it waits **1.5s**, resets both
  fighters to their scenario spawns at full HP, clears all bullets and broadcasts
  `round-reset` — because a scenario is the unit of measurement, and one that
  respawned a single fighter mid-run while the other kept its score would measure
  nothing. Suppressed entirely by `disableRoundReset`.
- **A whole-arena reset also starts a new match**, after the podium.
- **Offline escape hatch:** reset after **2s**, logged as `=== FIGHT RESET ===`.

## AI fighters

`EnemyBrain` drives every AI fighter — the offline enemy, the local `?ai=true`
fighter and the server-hosted bots — with a state machine: IDLE, CHASE, RETREAT,
ATTACK, EVADE, ZONE. Tuned via `AIConfig`
(`skillLevel`, `reactionTime`, `accuracy`, `aggressiveness`, `dodgeChance`),
randomised per match so no two fights are identical.

- Aim is jittered by accuracy; a perfect bot would be unplayable.
- The brain will not fire without line of sight.
- **It reasons about exactly one enemy.** That was the whole world at two
  fighters; at sixteen the caller chooses, and the choice is *the nearest living
  opponent* — recomputed every tick, on the server for bots and on the client for
  `?ai=true`. Any fixed choice reads as commuting across the arena rather than
  fighting.
- **It picks its stance by range**: sword inside melee reach, gun outside it. A
  bot that never drew its sword would leave the entire system in
  [melee.md](melee.md) untested by the AI-vs-AI feedback loop, which is the only
  place it gets exercised.
- **It sword-fights rather than mashing:** butterflies to close, blocks a swing
  it reads coming, uppercuts an opponent who is blocking, charges a Massive only
  at a safe distance, and punishes a whiffed heavy move.
- **It breaks away and takes height.** Cautious fighters disengage more, dash to
  create the gap, climb to a specific ledge, and fight with the gun from there.
  Without this the state machine could only ever close and swing: two bots met in
  the middle and stayed there, using 11% of the arena's width, one of its nine
  surfaces, and firing not a single shot. The whole ranged game and every
  platform went untested by the canonical run.
- **Jump intent is held for 240ms, then force-released for 60ms.** Jump height is
  analogue and edge-triggered, so an AI emitting `jump` on scattered single
  frames could only ever produce a minimum-height hop and could never reach the
  upper ledges.
- Walking into a wall while grounded triggers a jump, turning an obstacle into a
  route instead of somewhere the AI grinds to a halt.

## Not implemented

- Knockback from **bullets** (melee knockback exists — see [melee.md](melee.md)).
- Invincibility frames against **bullets** (melee has 180ms of them).
- Ammunition or reloading.
- Lag compensation on hit detection, ranged or melee.

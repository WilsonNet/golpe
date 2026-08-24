# Combat Mechanics

**Intent:** a sword duel across a vertical arena, with a gun as the answer to
distance. Reads and positioning decide fights; the ranged game exists to stop
turtling at range, not to win on its own.

Sword combat is large enough to own a document — see **[melee.md](melee.md)**
for the GunZ-derived frame data, blocking, parries, the butterfly and the
Massive Strike. This file covers the ranged half, damage and the round
lifecycle.

Since the arrival of heroes the game is a **hero shooter**: which melee weapon
and which ranged weapon a fighter carries is decided by their hero (see
[heroes.md](heroes.md), [anands.md](anands.md) and [jeffs.md](jeffs.md)). The
stance system below is the *slot* system — melee weapon out or ranged weapon
out — and what fires is the hero's weapon. Lia's rifle is the semi-automatic
described here; Anands' is the machine gun, faster and weaker per round; Jeffs'
is the shotgun — six pellets in a fixed cone, slow, lethal at point blank (see
[jeffs.md](jeffs.md)). Every weapon also carries a magazine and an auto-reload
(see below).

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
  [movement.md](movement.md), and `scripts/aim-probe.ts`, which measures the
  angle a bullet actually left with against the angle the cursor asked for.
- Bullet speed **600 px/s**, damage **10** per hit, and a **12-round
  magazine** whose whole-magazine **clip reload** takes **890ms** — see the
  reload section below.
- Attack cooldown **250ms**, shared by all attacks.
- **Limited ammunition: `magazinesPerLife` magazines per life.** One is loaded
  at spawn; the rest are a reserve the reload draws from. When both run out the
  gun is **dry** until the next life — the lever that forces the fight back to
  the sword.
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
- **A shotgun fires a deterministic fan of pellets.** A pellet is an ordinary
  bullet; the cone is six fixed angles spread ±16° around the aim, fired at
  once. The weapon's cooldown, pellet damage and pellet speed are its stat
  card (`RANGED_WEAPONS.shotgun`), and the fan is fixed so client and server
  always spawn the same pattern from the same aim. It is the one weapon with a
  **distance damage falloff**: a pellet's damage is the card's, read at the
  distance it has flown from the muzzle (`pelletDamageAt`), sliding from full
  within `falloffStartPx` down to a `minDamage` floor by `falloffEndPx`. Only
  the shotgun carries one; a rifle or machine-gun round is its card damage at
  any range.

## The magazine and the reload

Every weapon carries **`magazinesPerLife` magazines per life** and an **auto**
reload: there is no pick-up and no manual reload key (R is the ultimate). One
magazine is loaded at spawn and the rest form the reserve — measured in rounds.
The reload is the **TF2 pair**, and the two halves behave differently:

- **`clip` weapons reload the whole magazine in one action — full magazine
  or nothing.** One timer runs (`reloadMs`) and the ammo does not move until
  it completes, so an interruption produces nothing: a mid-reload stance
  switch resets all progress, and a one-round top-up costs the same rack an
  empty-to-full one does — close to full is not cheaper. The reserve is
  debited once, at completion, for only the rounds the magazine was missing.
- **`shell` weapons reload one round per cycle**, and a landed round is a
  real round: the partial reload that can shoot, and firing mid-reload keeps
  the shells already loaded.

A gun that has spent its last round is **dry** until the next life, which is
the whole of how the game forces the fight back to the sword.

| Weapon | Magazine | Magazines per life | Reload |
|---|---|---|---|
| Lia's rifle | 12 | 4 | **Clip** — the whole magazine in **890ms** |
| Anands' machine gun | 30 | 4 | **Clip** — the whole magazine in **1860ms** |
| Jeffs' shotgun | 5 | 4 | **Shell** — 1200ms each, 1300ms for the rack from empty |

The rules, in the order a player meets them:

- **Holding fire delays the reload.** The fighter shoots until the trigger is
  released — TF2's auto-reload waits for the button to stop. An **empty**
  magazine is the exception: there is nothing to shoot, so the reload runs
  even while it is held, and the held trigger fires the moment rounds land.
- **Firing mid-reload aborts the load — TF2's clip-abort-by-fire.** The
  rounds the magazine already holds stay and the shot goes, the load in
  progress is discarded, and a fresh reload starts when the trigger stops
  again. For a shell weapon that is the whole "shoot in the middle of
  reload": the shotgun always has its next blast close, and the interruption
  is the only cost — the round never left the reserve.
- **The reload draws only what the reserve has left, and never wastes.**
  A clip reload's reserve debit is sized to what the magazine was actually
  missing (a close-to-full gun takes one), a shell reload's to the shell that
  landed; a reload that runs the reserve short fills what it can and stops.
  When the reserve is empty the gun has only what is in the magazine, and a
  **dry** gun (empty magazine, no reserve) stays dry until the next life.
- **A clip reload completes in one action**, after the weapon's `reloadMs` —
  interrupt it and it contributes nothing. **A shell reload completes one
  round per cycle**, after `reloadRoundMs` — or, from an empty magazine, after
  the slower `reloadFirstRoundMs` (the rack from empty is the slow one, the
  rounds that follow it the fast ones). The shotgun's rounds take *longer*
  than the 900ms between its blasts, so an emptied shotgun is a long silence;
  the rifle and the machine gun reload faster than they fire, so their
  magazine is never the bottleneck — the reserve is.
- **The reload only runs while the gun is out, and a stance switch cancels
  it.** The gun left the hand, so the load in progress is dropped where it
  stands. For a clip weapon that is the whole "resets all progress": nothing
  had loaded yet, so nothing is kept, and the next reload starts from zero
  when the gun comes back out. For a shell weapon the rounds that already
  landed stay — the shotgun's loaded shells survive a stance switch exactly
  as they survive a shot — and the reload restarts from the shells that are
  left. Death and stun cancel the reload the same way. A respawn, a round
  reset and a hero change refill the magazine **and the reserve** — in
  deathmatch a round is a life, so a dry gun is dry only until death.
- The state (`ammo`, `reserveRounds`, `reloadTimer`) rides the wire so every
  client draws the HUD's ammo count, reserve and reload bar, but **only the
  server ticks it** — the fire that spends a round is the server's decision,
  so the reload is too, exactly like the ultimate meter. The client never
  simulates ammo.
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
- **It respects a swing it failed to read.** The guard is a *read* and the read
  fails; the third answer to a live hitbox is distance — a skill-scaled
  backstep, rolled **once per incoming swing** like the guard itself and
  refused while the guard is going to stop it. A bot that only ever blocked or
  swung back stood and ate every swing it missed; a per-tick roll instead
  turned every active window into a step back, and two bots backing out of
  each other's swings never traded a hit.
- **It closes with the burst, not just the walk.** The double-tap dash (or the
  tumble, which the stance decides) is the approach tool: a bot whose foe is
  grounded and in neutral bursts to cover the gap instead of walking the whole
  arena at walk speed — from **both** ATTACK and CHASE, because a walk-chase
  at equal speed against a fleeing foe never closes. A fleeing foe is worth a
  stronger roll: it is not going to turn and swing at the approach. A hurt bot
  *retreats* with the burst for the same reason — a walk retreat is a
  walk-forward chase, and the burst is the only tool that creates separation
  against an equal-speed pursuer.
- **A chase shoots.** The sword holsters beyond ~280px, so a chaser at range is
  a gunner by stance — and it presses the trigger whenever it has a live gun
  and a sightline. Without this the chase standoff sat at 400-500px forever:
  the runner flees at walk speed plus dashes, the equal-speed walk never
  closes, and the gun was the range answer the standoff needed.
- **It flees with exits, not forever.** EVADE is a ~600ms dodge on a cooldown —
  a reaction, not a way of life. RETREAT is a *kite*: back off and shoot back,
  for at most ~2.2s, and the moment the escape is walled the flee is over —
  a cornered bot commits to the fight for ~1.6s rather than standing at the
  wall, because with the runway gone, the sword is the only option that
  exists.
- **A dry gun never zones.** The perception carries the magazine and the
  reserve, and zoning is the ranged game — with neither round left, a bot
  pressing a trigger that answers nothing is not zoning, it is hiding. The
  only decision left is the fight.
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
- Ammunition pick-ups. Ammo is finite per life by design — `magazinesPerLife`
  is the whole economy, and a dry gun is the game's way of saying "use the
  sword".
- Lag compensation on hit detection, ranged or melee.

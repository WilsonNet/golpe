# Combat Mechanics

**Intent:** ranged duelling across a vertical arena, where positioning and
line-of-sight matter more than reflexes. Projectiles must read as instant and
travel dead straight.

## Authority

**There is exactly one source of bullets:**

- **Online (every normal match):** the server spawns, simulates and resolves all
  bullets. Clients only draw them.
- **`?offline=true` escape hatch only:** the scene's `BulletSystem`.

`Player` and `AIEnemy` must never spawn ranged projectiles themselves. They used
to, producing a second sprite nothing simulated, which froze on screen forever.

## Stance system

- **Q**: melee stance. **E**: ranged stance. Default at spawn: **ranged**.
- Switching is instant, no cooldown.

## Ranged combat

- **Left-click** fires toward the cursor.
- Bullet speed **600 px/s**, damage **10** per hit.
- Attack cooldown **250ms**, shared by all attacks.
- Unlimited ammunition.
- Bullets fly in a straight line: **no gravity, no bounce, no collision
  response.** This is what makes their position a closed-form function of time,
  and it is why they are dead-reckoned rather than interpolated
  (see [netcode.md](netcode.md)).
- A bullet is destroyed on contact with a platform, on hitting a fighter, or on
  leaving the world bounds.
- Bullets spawn at the **centre** of the firing body, not its top-left corner.
- Sprites come from a recycled pool; a bullet sprite is bound to a bullet **id**,
  never to a position in an array.
- `EventBus` emits `bullet-fired` per shot, for the React UI.

## Melee combat

- Requires melee stance.
- **Left-click** swings a hitbox **30px** in front of the facing direction.
- Hitbox lives **150ms** and follows the fighter while active.
- Only triggered within **100px** of the target.

## Blocking

- Requires melee stance. **Right-click (hold)** enters the blocking state.
- While blocking the fighter is forced to idle animation.
- *Damage reduction is not implemented* — blocking currently has no defensive
  effect.

## Damage and rounds

- Fighters start at **100 HP**. Bullet damage **10**, so ten clean hits is a KO.
- HP is clamped at 0; a dead fighter is drawn at **0.3 alpha**.
- **Online:** at 0 HP the server waits **1.5s**, resets both fighters to their
  spawns at full HP, clears all bullets, and broadcasts `round-reset`. Damage is
  applied server-side and is **not** logged as `[FIGHT]` — read HP from
  `window.__gameState()` to confirm an online fight is happening.
- **Offline escape hatch:** reset after **2s**, logged as `=== FIGHT RESET ===`.

## AI fighters

`EnemyBrain` drives both the offline enemy and the server-hosted bots, with a
state machine: IDLE, CHASE, RETREAT, ATTACK, EVADE. Tuned via `AIConfig`
(`skillLevel`, `reactionTime`, `accuracy`, `aggressiveness`, `dodgeChance`),
randomised per round so no two fights are identical.

- Aim is jittered by accuracy; a perfect bot would be unplayable.
- The brain will not fire without line of sight.
- **Jump intent is held for 240ms, then force-released for 60ms.** Jump height is
  analogue and edge-triggered, so an AI emitting `jump` on scattered single
  frames could only ever produce a minimum-height hop and could never reach the
  upper ledges.
- Walking into a wall while grounded triggers a jump, turning an obstacle into a
  route instead of somewhere the AI grinds to a halt.

## Not implemented

- Blocking damage reduction.
- Knockback on hit.
- Invincibility frames.
- Ammunition or reloading.

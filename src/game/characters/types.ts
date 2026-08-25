/**
 * The input-source contract every AI reads and writes.
 *
 * Shared by `EnemyBrain`, the training dummy and any future input source: one
 * perception shape in, one output shape out, so the simulation cannot tell a
 * bot from a dummy from a human. Server-side imports reach through this file,
 * so every relative import carries a `.js` extension and everything here is a
 * named export — see docs/invariants.md on the default-export trap.
 *
 * The perception is built **from simulation state only** (see `GameRoom.perceive`
 * and `Match.perceive`). It deliberately includes the things a *brain* needs to
 * be more than a brawler — air jumps, ultimate charge, teammates, every enemy,
 * open black holes — because each of those has a corresponding module in
 * `EnemyBrain`. A future weapon gets a module here and a module in the brain;
 * the wire format is untouched, since none of this travels over it.
 */

import type { HeroId } from "../simulation/Heroes.js";
import type { MeleeAction, MeleePhase } from "../simulation/Melee.js";
import type { TeamId } from "../simulation/Teams.js";

/** A teammate, for team play. Empty in a free-for-all. */
export interface AllyInfo {
	id: string;
	x: number;
	y: number;
	hp: number;
	alive: boolean;
	distance: number;
	/**
	 * Which hero the ally is, so the team brain can lean on the side's most
	 * ranged kit for the support slot and a jeffs support can know its sword
	 * is the last stand.
	 */
	hero: HeroId;
}

/** A living enemy. `foes.length` is how outnumbered the brain is. */
export interface FoeInfo {
	id: string;
	x: number;
	y: number;
	hp: number;
	distance: number;
	/**
	 * This foe is standing in its own side's smoke and is therefore
	 * **invisible to this viewer** (`smokeHidesFrom`).
	 *
	 * A brain must not shoot, throw at, ultimate or hunt a fighter it cannot
	 * see — the smoke's concealment hides the fighter from a bot exactly as it
	 * fades the sprite from a human. The concealment is computed per viewer in
	 * the perception build, so every bot's `foes` rows answer *its own* vision.
	 */
	concealed: boolean;
}

/**
 * An open black hole.
 *
 * `hostile` has already applied the friendly-fire rule (`fieldAffects`), so a
 * bot can tell its own side's hole from the enemy's without re-deriving a rule
 * the simulation owns.
 */
interface FieldInfo {
	x: number;
	y: number;
	hostile: boolean;
}

/**
 * Which job a bot does on its team.
 *
 * A side plays complementary rather than mirror: the vanguard holds the sword
 * and the line between the enemy and the support, and the support keeps the gun
 * at range and shoots over it. Two fighters doing the same thing in a team room
 * is the failure this exists to prevent.
 */
export type TeamRole = "vanguard" | "support";

export interface AIInput {
	playerX: number;
	playerY: number;
	selfX: number;
	selfY: number;
	distanceToPlayer: number;
	playerFacingDirection: number;
	touchingDown: boolean;
	touchingLeft: boolean;
	touchingRight: boolean;
	hasLineOfSight: boolean;
	selfHP: number;
	enemyHP: number;
	/** What the opponent is doing with their sword, for reads and punishes. */
	enemyAction: MeleeAction;
	enemyPhase: MeleePhase;
	enemyBlocking: boolean;
	enemyStunned: boolean;
	/** The enemy is mid-dive: a bomb is coming down somewhere nearby. */
	enemyPlunging: boolean;
	/** The enemy is planted with the sword in the ground: open season. */
	enemyStuck: boolean;
	/** Own melee state, so the brain does not fight its own animations. */
	selfAction: MeleeAction;
	/**
	 * The sword's charge is accumulating (or the massive is armed). A stance
	 * switch cancels a charge, so a brain that flips weapons mid-charge would
	 * spend the whole charge nothing — the gate every stance decision needs.
	 */
	selfCharging: boolean;
	selfStunned: boolean;
	selfPlunging: boolean;
	selfStuck: boolean;
	selfMassiveReady: boolean;
	/** Who this fighter is, for stable team ordering. */
	selfId: string;
	/** Which hero this fighter is — the brain's weapon modules branch on it. */
	selfHero: HeroId;
	/** The enemy's hero, so a sword brain can read a dagger's options. */
	enemyHero: HeroId;
	/**
	 * The foe the brain is reasoning about is standing in its own side's smoke
	 * — invisible to this viewer.
	 *
	 * The field exists because `hasLineOfSight` is geometry, and geometry
	 * cannot say "I know exactly where the enemy is, I just cannot see them".
	 * The gates that lean on it decide the *weapons*; modules that need to
	 * know whether the enemy is a real, visible target (the ultimate's cluster
	 * scan, the kill thirst) read this.
	 */
	enemyConcealed: boolean;
	/** Whether the enemy has the floor under it — the read for jumping a thrust. */
	enemyGrounded: boolean;
	/** Air jumps left. `AIR_JUMPS` means a double jump is still available. */
	selfAirJumps: number;
	/** Ultimate charge, 0..cap. The hero's armed threshold, so a brain never
	 * hard-codes a full meter. */
	selfUltCharge: number;
	/**
	 * The charge at which this fighter's ultimate arms (100 for the hole and
	 * the dragon, lower for the blossom). The blossom is the cheap one — it
	 * needs less charge, so it *charges faster* — and the brain reads armed
	 * against this, not a constant.
	 */
	selfUltCap: number;
	/**
	 * A hostile round is heading at this fighter — the read that turns the
	 * guard into a *proactive* anti-spam tool. A raised guard blocks bullets
	 * and feeds a little ultimate charge, so a bot that knows it is being shot
	 * at can choose to eat the stream and farm the meter instead of dodging it.
	 * True while any bullet fired by a foe is on a line that reaches this
	 * fighter's body within the perception's corridor.
	 */
	incomingFire: boolean;
	/** The enemy's velocity, for leading a shot to where it will be. */
	enemyVX: number;
	enemyVY: number;
	/**
	 * Own side, or `null` in a free-for-all.
	 */
	selfTeam: TeamId | null;
	/**
	 * The team deathmatch round, 1-based. A free-for-all has no rounds, so
	 * this is the room's best guess and no team logic reads it there.
	 *
	 * The round number is what makes a *coin flip* possible without any shared
	 * state: both members of a side see the same number, the sides see
	 * different teams, and `(round + team) % 2` hands them opposite halves of
	 * every round — a fair coin across a match, with no random that two
	 * independent brains could fail to match.
	 */
	roundNumber: number;
	/** Teammates. Empty in a free-for-all. */
	allies: AllyInfo[];
	/** Every living enemy. `foes.length` is the number the brain is up against. */
	foes: FoeInfo[];
	/** Open black holes. */
	fields: FieldInfo[];
	/** Hostile floor traps. Pre-filtered by the friendly-fire predicate. */
	traps: { x: number; y: number }[];
	/** Item charges left this life, so the brain knows when it has one to spend. */
	selfItemCharges: number;
	/**
	 * Rounds left in the magazine. The gun's ranged game is finite per life,
	 * so every decision that leans on the gun — zoning, kiting, shooting a
	 * fleeing runner — must know whether the gun can still produce damage.
	 */
	selfAmmo: number;
	/**
	 * Rounds in the reserve. `selfAmmo + selfReserveRounds === 0` is the DRY
	 * gun: the fight has to come back to the sword, and a brain that does not
	 * know that keeps pressing a trigger nothing answers.
	 */
	selfReserveRounds: number;
}

export interface AIOutput {
	moveLeft: boolean;
	moveRight: boolean;
	jump: boolean;
	/** Slash, or release a charged Massive Strike. */
	attack: boolean;
	block: boolean;
	uppercut: boolean;
	/** Absolute stance request, never a toggle — see specs/netcode.md. */
	swordStance: boolean;
	/** -1/1 to face that way, 0 to let movement decide. */
	face: number;
	/** Dash impulse: -1, 1, or 0. */
	dash: number;
	aimAngle: number;
	evadeActive: boolean;
	/**
	 * The ultimate button, held.
	 *
	 * The hold is the aim phase — the cast fires on the *release*, server-side,
	 * at the angle of the last input that held it. A brain that never sets this
	 * is a brain that never casts, so the ultimate is a first-class button here
	 * rather than a wire-only field.
	 */
	ultimate: boolean;
	/**
	 * The item button, on the press. The server spends a charge on the press
	 * edge and owns the throw or placement, exactly like the ultimate's cast —
	 * so a brain that never sets this is a brain that never uses its item.
	 */
	item: boolean;
}

/**
 * What the team module needs of whichever melee module is running.
 *
 * `MeleeBrain` (sword) and `DaggerBrain` (dagger) both answer this — the team
 * layer's cover guard and its stance reading are weapon-agnostic, so it should
 * not know which one it is talking to.
 */
export interface MeleeModuleView {
	/** Is the melee weapon drawn? Sword for Lia, dagger for Anands. */
	swordDrawn: boolean;
	/** Drop whatever rhythm is playing and raise the guard (sword) or decline (dagger). */
	interruptWithGuard(output: AIOutput): void;
}

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
}

/** A living enemy. `foes.length` is how outnumbered the brain is. */
export interface FoeInfo {
	id: string;
	x: number;
	y: number;
	hp: number;
	distance: number;
}

/**
 * An open black hole.
 *
 * `hostile` has already applied the friendly-fire rule (`fieldAffects`), so a
 * bot can tell its own side's hole from the enemy's without re-deriving a rule
 * the simulation owns.
 */
export interface FieldInfo {
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
	/** Own melee state, so the brain does not fight its own animations. */
	selfAction: MeleeAction;
	selfStunned: boolean;
	selfMassiveReady: boolean;
	/** Who this fighter is, for stable team ordering. */
	selfId: string;
	/** Air jumps left. `AIR_JUMPS` means a double jump is still available. */
	selfAirJumps: number;
	/** Ultimate charge, 0..100. `ULT_MAX_CHARGE` means the ult is armed. */
	selfUltCharge: number;
	/** The enemy's velocity, for leading a shot to where it will be. */
	enemyVX: number;
	enemyVY: number;
	/** Own side, or `null` in a free-for-all. */
	selfTeam: TeamId | null;
	/** Teammates. Empty in a free-for-all. */
	allies: AllyInfo[];
	/** Every living enemy. `foes.length` is the number the brain is up against. */
	foes: FoeInfo[];
	/** Open black holes. */
	fields: FieldInfo[];
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
}

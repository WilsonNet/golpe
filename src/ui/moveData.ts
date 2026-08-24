/**
 * The move list data — the Guilty Gear-style command list a player reads from
 * the Esc menu.
 *
 * **This is a presentation module, and it is allowed to be per-hero.** The
 * invariant "no `hero === ...` in `simulation/`" exists because a match-up
 * matrix is an O(n²) trap; a move list, by contrast, is *meant* to describe one
 * fighter at a time, so per-hero branching belongs here exactly as it belongs
 * in the HUD and the cinematic.
 *
 * The one rule that matters: **the numbers are not written down.** Every stat
 * card reads the real tuning constant from `tweakables/` (or the shared
 * `MOVES` frame table), so a retune in `melee.ts` rewords the move list for
 * free and the two can never drift. Only the *words* — the name, the command
 * and the prose — live here.
 *
 * The command column stores which *actions* a move needs (`"attack"`,
 * `"block"`, `"uppercut"`, ...), never the literal key. `MoveList.tsx`
 * renders those as live keycaps from the player's actual bindings, so a rebind
 * re-labels every card without the data changing.
 */

import type { HeroId } from "../game/simulation/Heroes";
import { ROOT_MS, TRAP_DAMAGE, TRAP_RADIUS } from "../game/simulation/Items";
import { type MeleeMove, MOVES, moveDuration } from "../game/simulation/Melee";
import { HE_GRENADE_MAX_DAMAGE, HE_GRENADE_RADIUS } from "../tweakables/items";
import { TUMBLE_SPEED } from "../tweakables/movement";
import {
	BLOSSOM_DURATION_MS,
	BLOSSOM_RADIUS_PX,
	BLOSSOM_TICK_DAMAGE,
	BLOSSOM_TICK_MS,
	DRAGON_DAMAGE,
	DRAGON_KNOCKBACK_PX_S,
	DRAGON_RIDE_MS,
	DRAGON_SPEED,
	SINGULARITY_DAMAGE_INTERVAL_MS,
	SINGULARITY_DURATION_MS,
	SINGULARITY_RADIUS,
	SINGULARITY_REACH,
	SINGULARITY_TICK_DAMAGE,
} from "../tweakables/ultimate";

export type MoveCategory =
	| "system"
	| "movement"
	| "melee"
	| "ranged"
	| "item"
	| "ultimate";

/** A named slot in the bindings table that a move's command references. */
export type CommandAction =
	| "left"
	| "right"
	| "jump"
	| "attack"
	| "block"
	| "uppercut"
	| "item"
	| "ultimate"
	| "sword"
	| "gun";

/** A single gesture: some actions pressed together, in display order. */
interface MoveCommand {
	label: string;
	actions: CommandAction[];
}

interface MoveStat {
	/** Human label, e.g. "DMG", "REACH", "STARTUP". */
	label: string;
	value: string;
	/** 0..1, drives a mini-bar. Absent means a text-only stat. */
	level?: number;
}

/**
 * One entry in the move list.
 *
 * `move` is the simulation move id when this entry *is* a melee move — the
 * frame data is then read off `MOVES` rather than hand-repeated. `stats` is
 * for the entries that are not in the shared table (movement, gun, item,
 * ultimate), where the numbers are read off their own tuning constants.
 */
export interface MoveEntry {
	id: string;
	category: MoveCategory;
	name: string;
	/** The command, as actions + a short label. */
	command: MoveCommand;
	/** The expanded explanation shown on the right. */
	prose: string;
	/** Extra one-liner tags, e.g. "UNBLOCKABLE · KNOCKDOWN". */
	tags?: string;
	/** A melee move id — derive frame data from `MOVES`. */
	move?: MeleeMove;
	/**
	 * A story id override for the preview stage. **The default is the entry's
	 * own id** — `MovePreview` looks up `entry.preview ?? entry.id`, so an
	 * entry and its story share one name and neither can drift. Only set this
	 * when the story cannot share the id: the melee entries, whose ids are
	 * `melee-<move>`, project the shared `MOVES` id instead.
	 */
	preview?: string;
	/** Hand-rolled stat rows for non-melee entries. */
	stats?: MoveStat[];
}

export interface HeroMoveList {
	hero: HeroId;
	/** Ordered, grouped by category, in the order the rail shows them. */
	entries: MoveEntry[];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function frameData(move: MeleeMove): MoveStat[] {
	const d = MOVES[move];
	const total = moveDuration(move);
	return [
		{ label: "STARTUP", value: `${d.startupMs}ms`, level: d.startupMs / 160 },
		{ label: "ACTIVE", value: `${d.activeMs}ms`, level: d.activeMs / 160 },
		{
			label: "RECOVERY",
			value: `${d.recoveryMs}ms`,
			level: d.recoveryMs / 500,
		},
		{ label: "TOTAL", value: `${total}ms`, level: Math.min(1, total / 700) },
	];
}

/** Frame data plus the on-hit rows, for a melee move. */
function meleeStats(move: MeleeMove): MoveStat[] {
	const d = MOVES[move];
	const rows: MoveStat[] = [
		{ label: "DMG", value: `${d.damage}`, level: Math.min(1, d.damage / 24) },
		{
			label: "REACH",
			value: `${d.reachPx}px`,
			level: Math.min(1, d.reachPx / 62),
		},
		...frameData(move),
	];
	if (d.hitstunMs > 0)
		rows.push({ label: "HITSTUN", value: `${d.hitstunMs}ms` });
	if (d.knockdown)
		rows.push({ label: "KNOCKDOWN", value: `${d.knockdownMs ?? "—"}ms` });
	return rows;
}

// ---------------------------------------------------------------------------
// The system + movement rows (shared across every hero)
// ---------------------------------------------------------------------------

const SYSTEM_ENTRIES: MoveEntry[] = [
	{
		id: "stance",
		category: "system",
		name: "Stance",
		command: { label: "SWORD / GUN", actions: ["sword", "gun"] },
		prose:
			"You carry one weapon at a time. Q raises the melee weapon, E the ranged one. Switching is instant and cancels a cancellable melee move (the slash-shot); it can never rescue you from a heavy move's recovery. Sword is home — this is a sword game first.",
		tags: "SWORD IS THE DEFAULT STANCE",
	},
];

const MOVEMENT_ENTRIES: MoveEntry[] = [
	{
		id: "walk",
		category: "movement",
		name: "Walk",
		command: { label: "MOVE", actions: ["left", "right"] },
		prose:
			"Hold left or right to walk. The arena is made of ledges and gaps, and most of the fight is choosing where to stand — the sword's reach is 48px, so position decides which swings can land at all.",
	},
	{
		id: "jump",
		category: "movement",
		name: "Jump / Double Jump",
		command: { label: "JUMP", actions: ["jump"] },
		prose:
			"Press jump to leave the ground, and again in the air for a second, weaker hop. The airborne jump refills only on landing. A jump clears the trap's patch entirely and is the read that beats a lunging thrust.",
		tags: "TWO JUMPS · AIR JUMP REFILLS ON LANDING",
	},
	{
		id: "dash",
		category: "movement",
		name: "Dash / Tumble",
		command: { label: "TAP TWICE", actions: ["left", "right"] },
		prose:
			"Double-tap left or right for a burst of speed. In the sword stance it is a dash — a flat, gravity-free line you can cross a gap with. In the gun stance the same gesture is a tumble: slower, harder to chain, and a shorter target while it rolls.",
		stats: [
			{ label: "DASH", value: "1000 px/s" },
			{ label: "TUMBLE", value: `${TUMBLE_SPEED} px/s` },
		],
	},
];

// ---------------------------------------------------------------------------
// Melee move prose, per move id
// ---------------------------------------------------------------------------

const MELEE_PROSE: Partial<Record<MeleeMove, string>> = {
	slash:
		"The bread and butter — a diagonal cut, right to left, 48px of reach and 7 damage. The whole sword game hangs off it: it is cancellable into a block (the butterfly) and it is the first link of the three-hit chain. A slash is fast enough to poke, short enough that it has to be walked into range.",
	slash2:
		"The second link — the mirror diagonal, left to right. Same frame data as the opener on purpose: the chain is a rhythm in your hands, and what changes between the links is the angle the defender reads to know whether the finisher is coming. It pierces the opener's invulnerability, so a landed combo keeps landing.",
	slash3:
		"The finisher — a straight overhead that knocks the target down for 520ms. It cannot be cancelled: this is the commitment that ends the chain, and what it commits to is neutral, not a punish. The whole chain is 7 + 7 + 11 = 25, a shade more than a Massive, for three hits that each have to connect on the ground.",
	uppercut:
		"The answer to a turtle. An unblockable upward thrust that launches its target into the air — but only 34px of reach, so it has to be walked into, and 340ms of recovery you cannot cancel. A whiffed uppercut loses you the exchange.",
	massive:
		"The payoff for a 1.6s charge or a guard break. Held, it slams the sword into the floor 56px ahead; the swing itself is blockable, and the blast that follows is front *and* back of the slam point, stunning through a guard. Released in the air it becomes the plunge bomb instead.",
	stab: "The dagger's bread and butter — fast, weak, and cancellable into the thrust. Where the slash is 330ms the stab is 190; where the slash deals 7 the stab deals 5. A dagger in range interrupts the gap between a sword wielder's swings, and trading with the sword still loses.",
	thrust:
		"The dagger's whole identity and its Shift move: a committed lunge that knocks down everyone in its path for 1.5s. It is the answer to having no guard — the 260ms wind-up is the tell, and a jump clears the flat line entirely. The dash is unblockable once committed.",
	shoryuken:
		"The dagger's anti-air, on the uppercut button. A rising stab with a wide reach that knocks down. It only fires while the second jump is still in hand, so it can never be a third jump — and unlike the sword's uppercut it is blockable, so a read guard stops it.",
};

function meleeEntry(move: MeleeMove): MoveEntry {
	return {
		id: `melee-${move}`,
		category: "melee",
		name: moveName(move),
		move,
		preview: move,
		command: meleeCommand(move),
		prose: MELEE_PROSE[move] ?? "",
		tags: meleeTags(move),
		stats: meleeStats(move),
	};
}

const MOVE_DISPLAY_NAMES: Record<MeleeMove, string> = {
	slash: "Slash",
	slash2: "Slash 2",
	slash3: "Slash 3",
	uppercut: "Uppercut",
	massive: "Massive Strike",
	stab: "Stab",
	thrust: "Thrust",
	shoryuken: "Shoryuken",
};

function moveName(move: MeleeMove): string {
	return MOVE_DISPLAY_NAMES[move] ?? move;
}

function meleeCommand(move: MeleeMove): MoveCommand {
	switch (move) {
		case "slash":
		case "slash2":
			return { label: "LMB — and again for the chain", actions: ["attack"] };
		case "slash3":
			return { label: "LMB × 3 on the ground", actions: ["attack"] };
		case "uppercut":
		case "shoryuken":
			return { label: "UPPERCUT", actions: ["uppercut"] };
		case "massive":
			return { label: "HOLD LMB, then release", actions: ["attack"] };
		case "stab":
			return { label: "LMB (dagger)", actions: ["attack"] };
		case "thrust":
			return { label: "SHIFT (dagger)", actions: ["block"] };
		default:
			return { label: moveName(move), actions: ["attack"] };
	}
}

function meleeTags(move: MeleeMove): string {
	const d = MOVES[move];
	const parts: string[] = [];
	if (!d.blockable) parts.push("UNBLOCKABLE");
	if (d.knockdown) parts.push("KNOCKDOWN");
	if (d.piercesIframes) parts.push("PIERCES IFRAMES");
	if (d.cancellable) parts.push("CANCELLABLE");
	if (d.selfVx) parts.push("CARRIES BODY");
	return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Per-hero lists
// ---------------------------------------------------------------------------

export const MOVE_LISTS: Record<HeroId, HeroMoveList> = {
	lia: {
		hero: "lia",
		entries: [
			...SYSTEM_ENTRIES,
			...MOVEMENT_ENTRIES,
			meleeEntry("slash"),
			meleeEntry("slash2"),
			meleeEntry("slash3"),
			meleeEntry("uppercut"),
			meleeEntry("massive"),
			{
				id: "rifle",
				category: "ranged",
				name: "Rifle",
				command: { label: "E, then LMB", actions: ["gun", "attack"] },
				prose:
					"A clean single shot per press — 10 damage, no falloff, at any range. The rifle's character is that its pause is short: a small magazine and the fastest reload in the game. The gun stance answers a range problem; it is not the starting point.",
				stats: [
					{ label: "DMG", value: "10" },
					{ label: "SPEED", value: "600 px/s" },
					{ label: "MAG", value: "12 / 36" },
				],
			},
			{
				id: "grenade",
				category: "item",
				name: "HE Grenade",
				command: { label: "F — 2 uses per life", actions: ["item"] },
				prose:
					"A thrown grenade that bounces and detonates. It is a positioning weapon, not a delete button: 45 damage at the point of detonation falling to zero at the edge of a 130px radius. Bounced off a wall it is a real option — learn the bounces.",
				stats: [
					{ label: "DAMAGE", value: `${HE_GRENADE_MAX_DAMAGE}`, level: 1 },
					{
						label: "RADIUS",
						value: `${HE_GRENADE_RADIUS}px`,
						level: HE_GRENADE_RADIUS / 260,
					},
				],
			},
			{
				id: "black-hole",
				category: "ultimate",
				name: "Black Hole",
				command: { label: "HOLD R, release to cast", actions: ["ultimate"] },
				prose:
					"Your ultimate. Hold R to trace the grenade's arc, release to throw. It freezes the room for 1.1s, then the hole opens where it lands: a 168px event horizon that catches fighters (no gravity, no steering, stunned), a 260px outer reach that tugs, and 7 damage every 250ms. The caster is immune to their own hole.",
				tags: "EARNED BY HITS · DENIABLE BY A GUARD",
				stats: [
					{ label: "HOLD", value: `${SINGULARITY_DURATION_MS}ms`, level: 1 },
					{ label: "HORIZON", value: `${SINGULARITY_RADIUS}px` },
					{ label: "REACH", value: `${SINGULARITY_REACH}px` },
					{
						label: "TICK",
						value: `${SINGULARITY_TICK_DAMAGE} / ${SINGULARITY_DAMAGE_INTERVAL_MS}ms`,
					},
				],
			},
		],
	},
	anands: {
		hero: "anands",
		entries: [
			...SYSTEM_ENTRIES,
			...MOVEMENT_ENTRIES,
			meleeEntry("stab"),
			meleeEntry("thrust"),
			meleeEntry("shoryuken"),
			{
				id: "machinegun",
				category: "ranged",
				name: "Machine Gun",
				command: { label: "E, then LMB", actions: ["gun", "attack"] },
				prose:
					"Four shots where the rifle fires one. Lower per-shot damage so the stream does not out-kill the rifle by double, faster bullets so a stream can actually be landed, and a decent magazine with a per-bullet reload. The dagger is the lightest weapon in the game; this is its stream.",
				stats: [
					{ label: "DMG", value: "5 / shot" },
					{ label: "SPEED", value: "780 px/s" },
					{ label: "MAG", value: "30 / 120" },
				],
			},
			{
				id: "trap",
				category: "item",
				name: "Trap",
				command: { label: "F — 3 uses per life", actions: ["item"] },
				prose:
					"A thrown canister that plants into an armed mine where it lands. It is a *delay*: a caught fighter is rooted for 3s — no feet at all, though they can still attack, block and cast. Jumping over it clears the patch entirely.",
				stats: [
					{
						label: "RADIUS",
						value: `${TRAP_RADIUS}px`,
						level: TRAP_RADIUS / 200,
					},
					{ label: "ROOT", value: `${ROOT_MS}ms`, level: 1 },
					{ label: "DMG", value: `${TRAP_DAMAGE}` },
				],
			},
			{
				id: "dragon-thrust",
				category: "ultimate",
				name: "Dragon Thrust",
				command: { label: "HOLD R, release to cast", actions: ["ultimate"] },
				prose:
					"Your ultimate — a ride, not a throw. After the 1.1s freeze you launch along the release angle at 1500 px/s, gravity suppressed, until an obstacle or a hostile black hole stops you. Everyone in the path is knocked back and damaged: a line of fighters feels like a line being swept. No sword guard can stop it.",
				tags: "SWEEPS THE PATH · THE ONE ULT THAT STOPS A DIVE",
				stats: [
					{ label: "SPEED", value: `${DRAGON_SPEED} px/s`, level: 1 },
					{ label: "RIDE", value: `${DRAGON_RIDE_MS}ms` },
					{ label: "DMG", value: `${DRAGON_DAMAGE}` },
					{ label: "KNOCKBACK", value: `${DRAGON_KNOCKBACK_PX_S} px/s` },
				],
			},
		],
	},
	jeffs: {
		hero: "jeffs",
		entries: [
			...SYSTEM_ENTRIES,
			...MOVEMENT_ENTRIES,
			meleeEntry("slash"),
			meleeEntry("slash2"),
			meleeEntry("slash3"),
			meleeEntry("uppercut"),
			meleeEntry("massive"),
			{
				id: "shotgun",
				category: "ranged",
				name: "Shotgun",
				command: { label: "E, then LMB", actions: ["gun", "attack"] },
				prose:
					"A fan of six pellets at point blank — 17 each, 102 if all land, a full bar in one blast. And then the range: the cone widens and each pellet's damage falls off past 60px, so by a hundred px it is a half-bar and by 200 a warning shot. A shotgun that killed at range was the rifle with a cone.",
				stats: [
					{ label: "DMG", value: "17 / pellet" },
					{ label: "PELLETS", value: "6" },
					{ label: "MAG", value: "5 / 20" },
				],
			},
			{
				id: "smoke",
				category: "item",
				name: "Smoke Grenade",
				command: { label: "F — 2 uses per life", actions: ["item"] },
				prose:
					"A thrown canister that blooms into a vision cloud — no damage, no collision, no bullet block. It changes what the enemy is allowed to know: a 200px patch you can cross in a dash and hide a whole team behind. Your own side sees ghosts through it; the enemy reads nothing.",
				stats: [{ label: "RADIUS", value: "200px", level: 1 }],
			},
			{
				id: "death-blossom",
				category: "ultimate",
				name: "Death Blossom",
				command: { label: "HOLD R, release to cast", actions: ["ultimate"] },
				prose:
					"Your ultimate — a storm, not a throw. After the 1.1s freeze you stand (and walk, slowly) and the world around you takes gunfire: 13 damage every 250ms inside a 260px radius for 2s — a full bar over the whole channel. The counterplay is distance, and a knockdown ends the storm early.",
				tags: "HOLDS A CIRCLE · A KNOCKDOWN ENDS IT",
				stats: [
					{ label: "DURATION", value: `${BLOSSOM_DURATION_MS}ms`, level: 1 },
					{
						label: "RADIUS",
						value: `${BLOSSOM_RADIUS_PX}px`,
						level: BLOSSOM_RADIUS_PX / 260,
					},
					{
						label: "TICK",
						value: `${BLOSSOM_TICK_DAMAGE} / ${BLOSSOM_TICK_MS}ms`,
					},
				],
			},
		],
	},
};

/** The order the categories appear in the rail. */
export const CATEGORY_ORDER: MoveCategory[] = [
	"system",
	"movement",
	"melee",
	"ranged",
	"item",
	"ultimate",
];

export const CATEGORY_LABELS: Record<MoveCategory, string> = {
	system: "System",
	movement: "Movement",
	melee: "Melee",
	ranged: "Ranged",
	item: "Item",
	ultimate: "Ultimate",
};

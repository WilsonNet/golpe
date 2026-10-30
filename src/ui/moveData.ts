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
import { kitFor } from "../game/simulation/Heroes";
import { ROOT_MS, TRAP_DAMAGE, TRAP_RADIUS } from "../game/simulation/Items";
import { type MeleeMove, MOVES, moveDuration } from "../game/simulation/Melee";
import { reserveRoundsFor } from "../game/simulation/Physics";
import { HE_GRENADE_MAX_DAMAGE, HE_GRENADE_RADIUS } from "../tweakables/items";
import {
	GUARD_CRUSH_DAMAGE_FRACTION,
	GUARD_CRUSH_STUN_MS,
	KNOCKDOWN_MS,
	SUNDER_CHARGE_MS,
} from "../tweakables/melee";
import { TUMBLE_SPEED } from "../tweakables/movement";
import {
	BERSERK_DAMAGE_TAKEN,
	BERSERK_FRACTION,
	BLOODLUST_ATTACK_SPEED_BONUS,
	BLOODLUST_FULL_RANGE_PX,
	BLOODLUST_MOVE_SPEED_BONUS,
	BLOODLUST_ZERO_RANGE_PX,
} from "../tweakables/passive";
import {
	AXE_CHARGE_MS,
	AXE_GRAVITY,
	AXE_MIN_DAMAGE,
	AXE_MIN_SPEED,
	RANGED_WEAPONS,
} from "../tweakables/ranged";
import {
	BLOSSOM_DURATION_MS,
	BLOSSOM_RADIUS_PX,
	BLOSSOM_TICK_DAMAGE,
	BLOSSOM_TICK_MS,
	DRAGON_DAMAGE,
	DRAGON_KNOCKBACK_PX_S,
	DRAGON_RIDE_MS,
	DRAGON_SPEED,
	RUPTURE_CAST_DAMAGE,
	RUPTURE_DAMAGE_PER_PX,
	RUPTURE_DURATION_MS,
	SINGULARITY_DAMAGE_INTERVAL_MS,
	SINGULARITY_DURATION_MS,
	SINGULARITY_RADIUS,
	SINGULARITY_REACH,
	SINGULARITY_TICK_DAMAGE,
	ULT_CAP,
} from "../tweakables/ultimate";

export type MoveCategory =
	| "system"
	| "movement"
	| "melee"
	| "ranged"
	| "item"
	| "ultimate";

/** A named slot in the bindings table that a move's command references. */
type CommandAction =
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
export interface MoveCommand {
	label: string;
	actions: CommandAction[];
	/**
	 * How the chips join: `then` for a sequence (stance, then fire), `or` for
	 * alternatives (left or right; sword or gun). The old renderer always said
	 * "then", which taught `A then D` as a dash.
	 */
	join?: "then" | "or";
	/**
	 * Alternatives that are each a short sequence, e.g. a double-tap is
	 * `[left, left]` or `[right, right]`. Wins over `actions` when present.
	 */
	groups?: CommandAction[][];
}

interface MoveStat {
	/** Human label, e.g. "DMG", "REACH", "STARTUP". */
	label: string;
	value: string;
	/** 0..1, drives a mini-bar. Absent means a text-only stat. */
	level?: number;
}

/**
 * The chip groups a command renders: each inner array is a short sequence, and
 * `join` says how the groups read. A pure function so the grouping can be
 * tested without a browser.
 */
export function commandGroups(command: MoveCommand): CommandAction[][] {
	if (command.groups) return command.groups;
	if (command.actions.length === 0) return [];
	if (command.join === "or") return command.actions.map((a) => [a]);
	return [command.actions];
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
		{
			label: "STARTUP",
			value: `${d.startupMs}ms`,
			level: Math.min(1, d.startupMs / 160),
		},
		{
			label: "ACTIVE",
			value: `${d.activeMs}ms`,
			level: Math.min(1, d.activeMs / 160),
		},
		{
			label: "RECOVERY",
			value: `${d.recoveryMs}ms`,
			level: Math.min(1, d.recoveryMs / 500),
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
	if (d.selfVx || d.selfVy)
		rows.push({
			label: "CARRY",
			value: `${Math.round(Math.hypot(d.selfVx ?? 0, d.selfVy ?? 0))} px/s`,
		});
	if (d.knockdown)
		rows.push({
			label: "KNOCKDOWN",
			value: d.knockdownOnLanding
				? `${d.knockdownMs ?? KNOCKDOWN_MS}ms ON LANDING`
				: `${d.knockdownMs ?? KNOCKDOWN_MS}ms`,
		});
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
		command: {
			label: "SWORD or GUN",
			actions: ["sword", "gun"],
			join: "or",
		},
		prose:
			"You carry one weapon at a time. One key raises the melee weapon, another the ranged one. Switching is instant and cancels a cancellable melee move (the slash-shot); it can never rescue you from a heavy move's recovery. Sword is home — this is a sword game first.",
		tags: "SWORD IS THE DEFAULT STANCE",
	},
];

/** The guard, for the weapons that have one. The dagger's block key is a lunge. */
function guardEntry(hero: HeroId): MoveEntry[] {
	const weapon = kitFor(hero).melee;
	if (!weapon.blockable) return [];
	return [
		{
			id: "guard",
			category: "system",
			name: "Guard",
			command: { label: "HOLD to guard", actions: ["block"] },
			prose:
				"Hold block and face the swing. The guard covers the side you are facing and nothing else. A sword attack that hits it guard-breaks the **attacker** for a full second — and hands **you** the free heavy: a Massive for Lia and Jeffs, a Sunder for Ibiriki. Walk around a held guard and the same swing goes through its back.",
			tags: "FACING ONLY · A BLOCKED SWING BREAKS THE ATTACKER",
		},
	];
}

/**
 * The feet. The dash's speed is the hero's own — the dagger bursts at 1100
 * px/s where the swords manage 900 — so this cannot be one shared card with a
 * hardcoded number.
 */
function movementEntries(hero: HeroId): MoveEntry[] {
	const weapon = kitFor(hero).melee;
	const opener = weapon.chain?.[0] ?? weapon.moves[0];
	const reach = opener ? MOVES[opener].reachPx : 0;
	const dash = weapon.burst.speed;
	return [
		{
			id: "walk",
			category: "movement",
			name: "Walk",
			command: {
				label: "HOLD A DIRECTION",
				actions: ["left", "right"],
				join: "or",
			},
			prose: `Hold left or right to walk. The arena is made of ledges and gaps, and most of the fight is choosing where to stand — your opener reaches ${reach}px, so position decides which swings can land at all.`,
		},
		{
			id: "jump",
			category: "movement",
			name: "Jump / Double Jump",
			command: { label: "JUMP", actions: ["jump"] },
			prose:
				"Press jump to leave the ground, and again in the air for a second, weaker hop. The airborne jump refills only on landing. A jump clears the trap's patch entirely and is the read that beats a lunging thrust. **Launched by an anti-air?** Press jump **on the way down** for the **safe fall**: the knockdown is dropped and you land on your feet. Press it too early and the launch owns the rise; leave it too late and an airborne swing can cut the arc into the **Insta Fall**.",
			tags: "TWO JUMPS · AIR JUMP REFILLS ON LANDING · SAFE FALL",
		},
		{
			id: "dash",
			category: "movement",
			name: "Dash / Tumble",
			command: {
				label: "DOUBLE-TAP a direction",
				actions: ["left", "right"],
				groups: [
					["left", "left"],
					["right", "right"],
				],
				join: "or",
			},
			prose:
				"Double-tap left or right for a burst of speed. In the sword stance it is a dash — a flat, gravity-free line you can cross a gap with. In the gun stance the same gesture is a tumble: slower, harder to chain, and a shorter target while it rolls.",
			stats: [
				{ label: "DASH", value: `${dash} px/s` },
				{ label: "TUMBLE", value: `${TUMBLE_SPEED} px/s` },
			],
		},
	];
}

/** The rows every hero carries, in rail order: system, then movement. */
function sharedEntries(hero: HeroId): MoveEntry[] {
	return [
		...SYSTEM_ENTRIES,
		...guardEntry(hero),
		...movementEntries(hero),
	];
}

// ---------------------------------------------------------------------------
// Melee move prose, per move id
// ---------------------------------------------------------------------------

const MELEE_PROSE: Partial<Record<MeleeMove, string>> = {
	slash:
		"The bread and butter — a diagonal cut, right to left, 48px of reach and 7 damage. The whole sword game hangs off it: it is cancellable into a block (the butterfly) and it is the first link of the three-hit chain. A slash is fast enough to poke, short enough that it has to be walked into range. It is also the swing that becomes the **Insta Fall** in the air: catch a launched foe with it while your feet are off the floor and the arc is cut short, the knockdown locked.",
	slash2:
		"The second link — the mirror diagonal, left to right. Same frame data as the opener on purpose: the chain is a rhythm in your hands, and what changes between the links is the angle the defender reads to know whether the finisher is coming. It pierces the opener's invulnerability, so a landed combo keeps landing.",
	slash3:
		"The finisher — a straight overhead that knocks the target down for 520ms. It cannot be cancelled: this is the commitment that ends the chain, and what it commits to is neutral, not a punish. The whole chain is 7 + 7 + 11 = 25, a shade more than a Massive, for three hits that each have to connect on the ground.",
	uppercut:
		"The answer to a turtle. An unblockable upward thrust that launches its target a jump's own height — but only 34px of reach, so it has to be walked into, and 340ms of recovery you cannot cancel. The foe goes up **horizontal** and comes down on the floor: the knockdown is paid when their feet return. Unless they press jump on the way down — the **safe fall** cancels it. Follow them into the air and land a swing instead and the arc is **cut short**: the **Insta Fall**, a spike no jump can cancel. A whiffed uppercut loses you the exchange.",
	massive:
		"The payoff for a 1.6s charge or a guard break. Held, it slams the sword into the floor 56px ahead; the swing itself is blockable, and the blast that follows is front *and* back of the slam point, stunning through a guard. Released in the air it becomes the plunge bomb instead.",
	stab: "The dagger's bread and butter — fast, weak, and cancellable into the thrust. Where the slash is 330ms the stab is 190; where the slash deals 7 the stab deals 5. A dagger in range interrupts the gap between a sword wielder's swings, and trading with the sword still loses.",
	thrust:
		`The dagger's whole identity and its lunge: a committed dash that knocks down everyone in its path for ${MOVES.thrust.knockdownMs ?? 1500}ms. It is the answer to having no guard — the ${MOVES.thrust.startupMs}ms wind-up is the tell, and a jump clears the flat line entirely. The dash is unblockable once committed.`,
	shoryuken:
		"The dagger's anti-air, on the uppercut button. A rising stab with a wide reach that **launches like the sword's uppercut** — the same arc, the same horizontal body, the same 700ms floor time, and the same safe fall and Insta Fall to escape or punish it. It only fires while the second jump is still in hand, so it can never be a third jump — and unlike the sword's uppercut it is blockable, so a read guard stops it.",
	hew: "The viking sword's opener — heavier than a slash in every way. Slower to start (120ms), 10 damage, and a 300ms stagger instead of a flinch, so a landed hew holds its victim for the next one. Cancellable into the guard, and the first link of the hew chain.",
	hew2: "The backhand — the second link, the same rhythm as the opener. It pierces the opener's invulnerability, so a landed chain keeps landing.",
	hew3: "The finisher — an overhead chop that knocks down. It cannot be cancelled; the whole hew chain is 10 + 10 + 15 = 35, heavier than the katana's 25, for three slower swings that each have to land on the ground.",
	sunder: `Hold the attack button and the sword goes up over his head while blood-red motes stream into it; after ${SUNDER_CHARGE_MS / 1000}s it is armed, and the release brings it down top to bottom. **It goes through blocks**: a front guard is crushed — the blocker takes ${Math.round(GUARD_CRUSH_DAMAGE_FRACTION * 100)}% and a ${GUARD_CRUSH_STUN_MS}ms mini stun — instead of guard breaking you. Stop an attacker's swing with **your** guard and the free heavy it earns you is a Sunder.`,
	rend: "**Berserk only** — some foe is below the berserk line: Ibiriki drops the axes' throw, dual wields, and the attack button runs the frenzy: sword, axe, both. **Hold it down and it never stops.** Every hit is a mini stun, and a guard cannot stop it — the blocker takes chip and is walked backwards. Out of axes, the sword swings alone at half speed.",
	rend2:
		"**Berserk only** — the second link of the frenzy: the axe in the off hand.",
	rend3:
		"**Berserk only** — sword and axe together in an X. The frenzy's last link shoves the victim away.",
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
	hew: "Hew",
	hew2: "Hew 2",
	hew3: "Hew 3",
	sunder: "Sunder",
	rend: "Frenzy (sword)",
	rend2: "Frenzy (axe)",
	rend3: "Frenzy (X-cut)",
};

function moveName(move: MeleeMove): string {
	return MOVE_DISPLAY_NAMES[move] ?? move;
}

function meleeCommand(move: MeleeMove): MoveCommand {
	switch (move) {
		case "slash":
		case "slash2":
			return { label: "and again for the chain", actions: ["attack"] };
		case "slash3":
			return { label: "three on the ground", actions: ["attack"] };
		case "uppercut":
		case "shoryuken":
			return { label: "UPPERCUT", actions: ["uppercut"] };
		case "massive":
			return { label: "hold, then release", actions: ["attack"] };
		case "stab":
			return { label: "(dagger)", actions: ["attack"] };
		case "thrust":
			return { label: "(dagger)", actions: ["block"] };
		case "hew":
		case "hew2":
			return { label: "and again for the chain", actions: ["attack"] };
		case "hew3":
			return { label: "three on the ground", actions: ["attack"] };
		case "sunder":
			return {
				label: `hold ${SUNDER_CHARGE_MS / 1000}s, then release`,
				actions: ["attack"],
			};
		case "rend":
		case "rend2":
			return { label: "while BERSERK", actions: ["attack"] };
		case "rend3":
			return { label: "hold while BERSERK", actions: ["attack"] };
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
	if (d.guardCrush) parts.push("CRUSHES GUARDS");
	if (d.guardChip) parts.push("GRINDS GUARDS");
	return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Per-hero lists
// ---------------------------------------------------------------------------

export const MOVE_LISTS: Record<HeroId, HeroMoveList> = {
	lia: {
		hero: "lia",
		entries: [
			...sharedEntries("lia"),
			meleeEntry("slash"),
			meleeEntry("slash2"),
			meleeEntry("slash3"),
			meleeEntry("uppercut"),
			meleeEntry("massive"),
			{
				id: "rifle",
				category: "ranged",
				name: "Rifle",
				command: { label: "then attack", actions: ["gun", "attack"] },
				prose: `A clean single shot per press — ${RANGED_WEAPONS.rifle.damage} damage, no falloff, at any range. The rifle's character is that its pause is short: a small magazine and the fastest reload in the game. The gun stance answers a range problem; it is not the starting point.`,
				stats: [
					{ label: "DMG", value: `${RANGED_WEAPONS.rifle.damage}` },
					{ label: "SPEED", value: `${RANGED_WEAPONS.rifle.speed} px/s` },
					{
						label: "MAG",
						value: `${RANGED_WEAPONS.rifle.magazine} / ${reserveRoundsFor(RANGED_WEAPONS.rifle)}`,
					},
				],
			},
			{
				id: "grenade",
				category: "item",
				name: "HE Grenade",
				command: { label: "2 uses per life", actions: ["item"] },
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
				command: { label: "hold, release to cast", actions: ["ultimate"] },
				prose:
					"Your ultimate. Hold to trace the grenade's arc, release to throw. It freezes the room for 1.1s, then the hole opens where it lands: a 168px event horizon that catches fighters (no gravity, no steering, stunned), a 260px outer reach that tugs, and 7 damage every 250ms. The caster is immune to their own hole.",
				tags: "EARNED BY HITS · DENIABLE BY A GUARD",
				stats: [
					{ label: "COST", value: `${ULT_CAP["black-hole"]}` },
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
			...sharedEntries("anands"),
			meleeEntry("stab"),
			meleeEntry("thrust"),
			meleeEntry("shoryuken"),
			{
				id: "machinegun",
				category: "ranged",
				name: "Machine Gun",
				command: { label: "then attack", actions: ["gun", "attack"] },
				prose: `About ${Math.round(RANGED_WEAPONS.rifle.cooldownMs / RANGED_WEAPONS.machinegun.cooldownMs * 10) / 10}× the rifle's rate, at ${RANGED_WEAPONS.machinegun.damage} damage a round. Lower per-shot damage so the stream does not out-kill the rifle by double, faster bullets so a stream can actually be landed, and a decent magazine with a whole-magazine rack. The dagger is the lightest weapon in the game; this is its stream.`,
				stats: [
					{
						label: "DMG",
						value: `${RANGED_WEAPONS.machinegun.damage} / shot`,
					},
					{
						label: "SPEED",
						value: `${RANGED_WEAPONS.machinegun.speed} px/s`,
					},
					{
						label: "MAG",
						value: `${RANGED_WEAPONS.machinegun.magazine} / ${reserveRoundsFor(RANGED_WEAPONS.machinegun)}`,
					},
				],
			},
			{
				id: "trap",
				category: "item",
				name: "Trap",
				command: { label: "3 uses per life", actions: ["item"] },
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
				command: { label: "hold, release to cast", actions: ["ultimate"] },
				prose:
					"Your ultimate — a ride, not a throw. After the 1.1s freeze you launch along the release angle at 1500 px/s, gravity suppressed, until an obstacle or a hostile black hole stops you. Everyone in the path is knocked back and damaged: a line of fighters feels like a line being swept. No sword guard can stop it.",
				tags: "SWEEPS THE PATH · STOPS A DIVE",
				stats: [
					{ label: "COST", value: `${ULT_CAP["dragon-thrust"]}` },
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
			...sharedEntries("jeffs"),
			meleeEntry("slash"),
			meleeEntry("slash2"),
			meleeEntry("slash3"),
			meleeEntry("uppercut"),
			meleeEntry("massive"),
			{
				id: "shotgun",
				category: "ranged",
				name: "Shotgun",
				command: { label: "then attack", actions: ["gun", "attack"] },
				prose: `A fan of ${RANGED_WEAPONS.shotgun.pellets} pellets at point blank — ${RANGED_WEAPONS.shotgun.damage} each, ${(RANGED_WEAPONS.shotgun.pellets ?? 1) * RANGED_WEAPONS.shotgun.damage} if all land, a full bar in one blast. And then the range: the cone widens and each pellet's damage falls off past ${RANGED_WEAPONS.shotgun.falloffStartPx}px, so by a hundred px it is most of a bar and by 200 a warning shot. A shotgun that killed at range was the rifle with a cone.`,
				stats: [
					{
						label: "DMG",
						value: `${RANGED_WEAPONS.shotgun.damage} / pellet`,
					},
					{ label: "PELLETS", value: `${RANGED_WEAPONS.shotgun.pellets}` },
					{
						label: "MAG",
						value: `${RANGED_WEAPONS.shotgun.magazine} / ${reserveRoundsFor(RANGED_WEAPONS.shotgun)}`,
					},
				],
			},
			{
				id: "smoke",
				category: "item",
				name: "Smoke Grenade",
				command: { label: "2 uses per life", actions: ["item"] },
				prose:
					"A thrown canister that blooms into a vision cloud — no damage, no collision, no bullet block. It changes what the enemy is allowed to know: a 200px patch you can cross in a dash and hide a whole team behind. You can see through your own cloud; the enemy reads nothing.",
				stats: [{ label: "RADIUS", value: "200px", level: 1 }],
			},
			{
				id: "death-blossom",
				category: "ultimate",
				name: "Death Blossom",
				command: { label: "hold, release to cast", actions: ["ultimate"] },
				prose:
					"Your ultimate — a storm, not a throw. After the 1.1s freeze you stand (and walk, slowly) and the ground where you cast it takes gunfire: 13 damage every 250ms inside a 260px radius for 2s — a full bar over the whole channel. The counterplay is distance, and a knockdown ends the storm early.",
				tags: "HOLDS A CIRCLE · A KNOCKDOWN ENDS IT",
				stats: [
					{ label: "COST", value: `${ULT_CAP["death-blossom"]}` },
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
	ibiriki: {
		hero: "ibiriki",
		entries: [
			...SYSTEM_ENTRIES,
			...guardEntry("ibiriki"),
			{
				id: "bloodlust",
				category: "system",
				name: "Bloodlust (passive)",
				command: { label: "ALWAYS ON", actions: [] },
				prose: `Ibiriki smells the blood in the room, and the smell fades with distance. Each foe's HP sets a lure; how close they are scales it down — full within ${BLOODLUST_FULL_RANGE_PX}px, gone by ${BLOODLUST_ZERO_RANGE_PX}px — and the strongest lure wins. The lower their HP and the nearer they are, the faster he walks (up to +${Math.round(BLOODLUST_MOVE_SPEED_BONUS * 100)}%) and swings (up to +${Math.round(BLOODLUST_ATTACK_SPEED_BONUS * 100)}%). A foe below ${Math.round(BERSERK_FRACTION * 100)}% **and close enough** makes him **berserk**: dumb with bloodlust, he is forced into melee (no axe throws), his eyes glow, a blood-red aura rises, he dual wields the sword and an axe, a held attack button runs the frenzy without end, and he takes ${Math.round((1 - BERSERK_DAMAGE_TAKEN) * 100)}% less damage. He still dashes and still lays his trap. The HUD meter under his HP shows the bloodlust and what it buys, and a prey pin marks every bleeding foe — an edge arrow when they are outside the frame.`,
				tags: "HP × PROXIMITY · BERSERK <30% IN REACH",
			},
			...movementEntries("ibiriki"),
			meleeEntry("hew"),
			meleeEntry("hew2"),
			meleeEntry("hew3"),
			meleeEntry("uppercut"),
			meleeEntry("sunder"),
			meleeEntry("rend"),
			meleeEntry("rend2"),
			meleeEntry("rend3"),
			{
				id: "axe",
				category: "ranged",
				name: "Throwing Axe",
				command: {
					label: "hold, then release",
					actions: ["gun", "attack"],
				},
				prose: `Hold to charge, release to throw. A tap is a ${AXE_MIN_SPEED} px/s lob for ${AXE_MIN_DAMAGE}; a full ${AXE_CHARGE_MS / 1000}s charge flies flat and far at ${RANGED_WEAPONS.axe.speed} px/s for ${RANGED_WEAPONS.axe.damage} — almost a whole bar — wreathed in embers, and it **crushes a guard**, still going through for half its damage and a mini stun. Three axes a life and no reload: every axe sticks where it lands until **an axe-bearer walks over it** and takes it back — anyone carrying axes can claim any resting axe, and they stay when you die.`,
				tags: "CHARGED · BALLISTIC · PICK THEM BACK UP",
				stats: [
					{
						label: "DMG",
						value: `${AXE_MIN_DAMAGE}–${RANGED_WEAPONS.axe.damage}`,
						level: 1,
					},
					{
						label: "SPEED",
						value: `${AXE_MIN_SPEED}–${RANGED_WEAPONS.axe.speed} px/s`,
					},
					{ label: "GRAVITY", value: `${AXE_GRAVITY} px/s²` },
					{ label: "AXES", value: `${RANGED_WEAPONS.axe.magazine}` },
				],
			},
			{
				id: "trap",
				category: "item",
				name: "Trap",
				command: { label: "3 uses per life", actions: ["item"] },
				prose:
					"The hunter's snare: a thrown canister that plants into an armed mine. A caught fighter is rooted for 3s — no feet, but they can still swing and block — which is exactly long enough to walk a Sunder into them.",
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
				id: "rupture",
				category: "ultimate",
				name: "Rupture",
				command: { label: "hold, release to cast", actions: ["ultimate"] },
				prose: `Your ultimate — a curse on the whole room. After the freeze Ibiriki stomps with both weapons drawn, and every enemy alive is ruptured for ${RUPTURE_DURATION_MS / 1000}s: **every pixel they move costs blood** (${RUPTURE_DAMAGE_PER_PX} HP per px — a second of walking is ~20). Standing still costs nothing. Knockback and falls count — it is the body that moved. Global: no aim, no dodge but patience.`,
				tags: "GLOBAL · MOVING HURTS · CANNOT BE GUARDED",
				stats: [
					{ label: "COST", value: `${ULT_CAP["rupture"]}` },
					{ label: "DURATION", value: `${RUPTURE_DURATION_MS}ms`, level: 1 },
					{ label: "BLEED", value: `${RUPTURE_DAMAGE_PER_PX} / px` },
					{ label: "CAST", value: `${RUPTURE_CAST_DAMAGE}` },
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

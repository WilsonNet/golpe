/**
 * The objective builders — the vocabulary a lesson is written in.
 *
 * Content files never construct an `Objective` by hand. They call a builder,
 * which fills in the id, the phrasing, the keycaps and the question about the
 * counters, and lets the lesson override the words when the drill needs its
 * own. That is what keeps eighty-odd objectives across three heroes phrased
 * consistently, and what makes adding a campaign mission a matter of composing
 * verbs rather than inventing them.
 *
 * Every builder is pure and every `count` is a pure read of `LessonCounters`,
 * so the whole content layer is testable in the unit suite with no browser,
 * no server and no Pixi — see `Campaign.test.ts`.
 */

import type { Action } from "../input/Bindings.js";
import type { MeleeMove } from "../simulation/Melee.js";
import type { LessonCounters, Objective } from "./types.js";

/** Overrides any builder accepts. */
interface Opts {
	id?: string;
	text?: string;
	keys?: Action[];
	hint?: string;
}

function build(
	id: string,
	text: string,
	target: number,
	count: (c: LessonCounters) => number,
	opts: Opts = {},
): Objective {
	const { keys, hint } = opts;
	return {
		id: opts.id ?? id,
		text: opts.text ?? text,
		target,
		count,
		...(keys === undefined ? {} : { keys }),
		...(hint === undefined ? {} : { hint }),
	};
}

/** "N times" or nothing at all, so a one-shot objective reads as a sentence. */
function times(n: number): string {
	return n === 1 ? "" : ` ${n} times`;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/**
 * Cover ground on foot. Measured in whole *paces* — 40px, a little over a
 * body's width — because a pixel target would fill its bar before the sentence
 * had been read.
 */
export const walk = (paces = 8, opts: Opts = {}): Objective =>
	build(
		"walk",
		"Walk left and right",
		paces,
		(c) => Math.floor(c.walkedPx / PACE_PX),
		{ keys: ["left", "right"], ...opts },
	);

/** One pace, in world pixels. */
const PACE_PX = 40;

export const jump = (target = 1, opts: Opts = {}): Objective =>
	build("jump", `Jump${times(target)}`, target, (c) => c.jumps, {
		keys: ["jump"],
		...opts,
	});

export const doubleJump = (target = 1, opts: Opts = {}): Objective =>
	build(
		"double-jump",
		`Double jump — press jump again in the air${times(target)}`,
		target,
		(c) => c.airJumps,
		{ keys: ["jump"], ...opts },
	);

export const dash = (target = 1, opts: Opts = {}): Objective =>
	build(
		"dash",
		`Dash — double-tap a direction${times(target)}`,
		target,
		(c) => c.dashes,
		{ keys: ["left", "right"], ...opts },
	);

export const airDash = (target = 1, opts: Opts = {}): Objective =>
	build(
		"air-dash",
		`Dash in the air — jump first, then double-tap${times(target)}`,
		target,
		(c) => c.airDashes,
		{ keys: ["jump", "left", "right"], ...opts },
	);

export const tumble = (target = 1, opts: Opts = {}): Objective =>
	build(
		"tumble",
		`Tumble — the same double-tap, in gun stance${times(target)}`,
		target,
		(c) => c.tumbles,
		{ keys: ["gun", "left", "right"], ...opts },
	);

export const switchStance = (target = 2, opts: Opts = {}): Objective =>
	build(
		"stance",
		`Switch stance${times(target)}`,
		target,
		(c) => c.stanceSwitches,
		{ keys: ["sword", "gun"], ...opts },
	);

// ---------------------------------------------------------------------------
// Melee
// ---------------------------------------------------------------------------

/** Start a move — a whiff counts. For teaching the button, not the aim. */
export const perform = (
	move: MeleeMove,
	label: string,
	target = 1,
	opts: Opts = {},
): Objective =>
	build(
		`perform-${move}`,
		`Throw ${label}${times(target)}`,
		target,
		(c) => c.movesStarted[move],
		opts,
	);

/** Land a move — the server judged it. For teaching range and timing. */
export const land = (
	move: MeleeMove,
	label: string,
	target = 1,
	opts: Opts = {},
): Objective =>
	build(
		`land-${move}`,
		`Land ${label}${times(target)}`,
		target,
		(c) => c.movesLanded[move],
		opts,
	);

export const block = (target = 1, opts: Opts = {}): Objective =>
	build(
		"block",
		`Raise your guard${times(target)}`,
		target,
		(c) => c.blocksRaised,
		{
			keys: ["block"],
			...opts,
		},
	);

export const parry = (target = 1, opts: Opts = {}): Objective =>
	build(
		"parry",
		`Guard-break the dummy's swing${times(target)}`,
		target,
		(c) => c.parries,
		{ keys: ["block"], ...opts },
	);

export const butterfly = (target = 1, opts: Opts = {}): Objective =>
	build(
		"butterfly",
		`Cancel a swing into a guard${times(target)}`,
		target,
		(c) => c.butterflies,
		{ keys: ["attack", "block"], ...opts },
	);

export const backstab = (target = 1, opts: Opts = {}): Objective =>
	build(
		"backstab",
		`Hit from behind${times(target)}`,
		target,
		(c) => c.backstabs,
		{
			...opts,
		},
	);

export const knockdown = (target = 1, opts: Opts = {}): Objective =>
	build(
		"knockdown",
		`Knock the dummy down${times(target)}`,
		target,
		(c) => c.knockdowns,
		opts,
	);

export const armMassive = (target = 1, opts: Opts = {}): Objective =>
	build(
		"massive-armed",
		`Charge the Massive Strike until it flashes${times(target)}`,
		target,
		(c) => c.massiveArmed,
		{ keys: ["attack"], ...opts },
	);

export const blast = (target = 1, opts: Opts = {}): Objective =>
	build(
		"blast",
		`Catch the dummy in a Massive Strike's blast${times(target)}`,
		target,
		(c) => c.blasts,
		{ keys: ["attack"], ...opts },
	);

export const plunge = (target = 1, opts: Opts = {}): Objective =>
	build(
		"plunge",
		`Dive with the plunge bomb${times(target)}`,
		target,
		(c) => c.plunges,
		{ keys: ["jump", "attack"], ...opts },
	);

export const bomb = (target = 1, opts: Opts = {}): Objective =>
	build(
		"bomb",
		`Catch the dummy with a plunge bomb${times(target)}`,
		target,
		(c) => c.bombs,
		{ keys: ["jump", "attack"], ...opts },
	);

// ---------------------------------------------------------------------------
// Ranged, item, ultimate
// ---------------------------------------------------------------------------

export const shoot = (target = 1, opts: Opts = {}): Objective =>
	build("shoot", `Fire${times(target)}`, target, (c) => c.bulletsFired, {
		keys: ["gun", "attack"],
		...opts,
	});

export const hitShots = (target = 1, opts: Opts = {}): Objective =>
	build("shots-hit", `Land ${target} shots`, target, (c) => c.bulletHits, {
		keys: ["gun", "attack"],
		...opts,
	});

export const reload = (target = 1, opts: Opts = {}): Objective =>
	build(
		"reload",
		`Empty the magazine and let it reload${times(target)}`,
		target,
		(c) => c.reloads,
		{ keys: ["attack"], ...opts },
	);

export const useItem = (target = 1, opts: Opts = {}): Objective =>
	build("item", `Throw your item${times(target)}`, target, (c) => c.itemsUsed, {
		keys: ["item"],
		...opts,
	});

export const explode = (target = 1, opts: Opts = {}): Objective =>
	build(
		"explosion",
		`Detonate it near the dummy${times(target)}`,
		target,
		(c) => c.explosions,
		{ keys: ["item"], ...opts },
	);

export const root = (target = 1, opts: Opts = {}): Objective =>
	build(
		"root",
		`Catch the dummy in a trap${times(target)}`,
		target,
		(c) => c.roots,
		{
			keys: ["item"],
			...opts,
		},
	);

export const castUltimate = (target = 1, opts: Opts = {}): Objective =>
	build(
		"ultimate",
		`Cast your ultimate — hold, aim, release${times(target)}`,
		target,
		(c) => c.ultimates,
		{ keys: ["ultimate"], ...opts },
	);

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export const dealDamage = (target: number, opts: Opts = {}): Objective =>
	build(
		"damage",
		`Deal ${target} damage`,
		target,
		(c) => Math.round(c.damageDealt),
		opts,
	);

export const knockout = (target = 1, opts: Opts = {}): Objective =>
	build(
		"knockout",
		`Take the dummy to zero${times(target)}`,
		target,
		(c) => c.knockouts,
		opts,
	);

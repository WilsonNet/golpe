/**
 * The campaign's vocabulary: what a lesson is, what an objective is, and what a
 * chapter is made of.
 *
 * **This is the content layer, and it is deliberately data.** A lesson knows
 * how to *describe* itself and how to *ask a counter a question*; it owns no
 * simulation, no rendering and no netcode. That split is what makes the
 * tutorial the first chapter of a campaign rather than a one-off screen: a
 * future mission is another `Chapter` in the registry, built from the same
 * objective builders, staged with the same `TrainingConfigPatch`, and run by
 * the same `TutorialDirector`. Nothing in this folder is imported by
 * `simulation/`, and nothing here imports React.
 *
 * The one rule that matters, borrowed from `ui/moveData.ts`: **the numbers are
 * not written down.** A lesson's prose may name a button by its *action*
 * (`"attack"`, `"block"`) and the UI renders the player's real binding; a
 * lesson's targets are counts of things the player did, never frame data
 * copied out of `tweakables/`.
 */

import type { Action } from "../input/Bindings.js";
import type { HeroId } from "../simulation/Heroes.js";
import type { MeleeMove } from "../simulation/Melee.js";
import type { TrainingConfigPatch } from "../training/types.js";

/**
 * Everything a lesson can ask about, accumulated since the lesson began.
 *
 * Every field is a **count since the lesson started** — the director zeroes the
 * whole record when it arms a lesson, so an objective is always "how many times
 * have you done this, here, now" and never has to reason about history. Damage
 * figures are the server's, taken as a delta against the lesson's opening
 * numbers.
 *
 * Adding a field here is how a new kind of objective becomes possible; the
 * builders in `objectives.ts` are the only thing that should read them.
 */
export interface LessonCounters {
	/** ms since the lesson's stage settled. Drives the "survive" objectives. */
	elapsedMs: number;

	// -- what the player started, observed off their own predicted body -------
	/** Melee moves *begun*, by move id. A whiff counts: starting is the skill. */
	movesStarted: Record<MeleeMove, number>;
	/** Melee moves the **server** judged as landing, by move id. */
	movesLanded: Record<MeleeMove, number>;

	/** Ground covered on foot, in world pixels. A dash's carry does not count. */
	walkedPx: number;
	/** Ground jumps (the first one, off a surface). */
	jumps: number;
	/** Air jumps — the second hop, which only exists once you are off the floor. */
	airJumps: number;
	/** Dashes begun (sword stance). */
	dashes: number;
	/** Dashes begun with no ground under them — the flat line. */
	airDashes: number;
	/** Tumbles begun (gun stance). */
	tumbles: number;
	/** Wall jumps — a jump taken off a wall rather than the floor. */
	wallJumps: number;
	/** Stance switches, either direction. */
	stanceSwitches: number;
	/** Guards that actually came up (held past the block's startup). */
	blocksRaised: number;
	/** Melee moves cancelled into a guard — the butterfly. */
	butterflies: number;
	/** The Massive charge completing: the swing is armed. */
	massiveArmed: number;
	/** Plunge bombs begun — a Massive released in the air. */
	plunges: number;

	// -- what the server judged ----------------------------------------------
	/** Attacks of yours the dummy's guard stopped — *your* guard break. */
	guardBreaksSuffered: number;
	/** Attacks of theirs *your* guard stopped — their guard break, your reward. */
	parries: number;
	/** Hits landed from behind a guard. */
	backstabs: number;
	/** Hits of yours that knocked the target down. */
	knockdowns: number;
	/** Massive ground blasts of yours that caught somebody. */
	blasts: number;
	/** Plunge-bomb landings of yours that caught somebody. */
	bombs: number;
	/** Item detonations observed (the HE grenade's blast). */
	explosions: number;
	/** Traps of yours that sprang on somebody. */
	roots: number;
	/** Ultimates you cast — counted at the cast, not the kill. */
	ultimates: number;
	/** Ultimates of yours that a guard or a death took away. */
	denies: number;
	/** Item charges spent. */
	itemsUsed: number;
	/** Reloads begun. */
	reloads: number;

	// -- the server's own tallies, as deltas ---------------------------------
	bulletsFired: number;
	bulletHits: number;
	damageDealt: number;
	damageTaken: number;
	/** Damage your guard turned away. */
	damageBlocked: number;
	/** Times the dummy's HP reached zero. */
	knockouts: number;
}

/**
 * One thing the player has to do, and how many times.
 *
 * `count` is a **pure function of the counters**, which is the whole reason
 * objectives are testable without a browser: the director's job is to keep the
 * counters honest, and an objective's job is to phrase a question about them.
 */
export interface Objective {
	/** Unique within its lesson. Used as a React key and in the probe. */
	id: string;
	/** The instruction, in the imperative: "Land three slashes". */
	text: string;
	/** Buttons named in the instruction, rendered as live keycaps. */
	keys?: Action[];
	/** How many times. 1 means "do it once". */
	target: number;
	/** How many times it has happened, from the lesson's counters. */
	count: (c: LessonCounters) => number;
	/** A nudge shown under the row while it is unfinished. */
	hint?: string;
}

/**
 * One lesson: a stage, a piece of teaching, and the objectives that close it.
 *
 * The stage is an ordinary `TrainingConfigPatch` — the same object the practice
 * room's menu writes — applied over the training defaults and followed by a
 * reset. That is what makes the enemy *interactive*: a lesson about blocking
 * hands the dummy `behaviour: "slash"`, a lesson about anti-air hands it
 * `"jump"`, and a lesson about pressure hands it `"combo"`. The dummy is a
 * server-side input source, so everything it does is played through the same
 * netcode a human opponent would be.
 */
export interface Lesson {
	/** Stable across releases — it is the key progress is stored under. */
	id: string;
	title: string;
	/** One or two sentences of teaching, above the objectives. */
	brief: string;
	/** The room this lesson is played in. Merged over the training defaults. */
	stage: TrainingConfigPatch;
	objectives: Objective[];
	/** Shown for a beat when the lesson closes. */
	outro?: string;
}

/** What a chapter is for. A mission is a campaign fight; a course teaches. */
type ChapterKind = "course" | "mission";

export interface Chapter {
	/** Stable. Prefixed onto nothing — lesson ids are already globally unique. */
	id: string;
	title: string;
	/** One line under the title, on the chapter card. */
	subtitle: string;
	kind: ChapterKind;
	/** The hero this chapter is played as, or null when it suits anyone. */
	hero: HeroId | null;
	lessons: Lesson[];
}

/**
 * A named run of chapters — the unit the menu offers and progress is measured
 * against. The tutorial is one of these; a campaign act would be another.
 */
export interface CampaignModule {
	id: string;
	title: string;
	subtitle: string;
	chapters: Chapter[];
}

/** Every lesson in a module, flattened in play order. */
export function lessonsOf(module: CampaignModule): Lesson[] {
	return module.chapters.flatMap((c) => c.lessons);
}

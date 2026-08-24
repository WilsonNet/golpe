/**
 * The preview stories — declarative input scripts a `FighterStage` performs.
 *
 * This is the move list's Storybook. A **story** is not a video and not a
 * pre-rendered clip: it is a timeline of *intents* — the same `PlayerIntent`
 * a keyboard produces — plus at most two scripted-server cues. The stage feeds
 * the intents through the real `tickPlayer` and renders with the real
 * animation systems, so what a story shows is what the move does, for whatever
 * hero and sheet are current. A new hero needs no new art here and a retune
 * needs no re-render: the preview cannot drift from the game because it *is*
 * the game, one fighter wide.
 *
 * Stories are data on purpose — serializable, probe-able, and writable without
 * knowing anything about Pixi. Anything that needs a renderer lives in
 * `FighterStage`, which interprets the two cues (`throw-item`, `cast-ult`)
 * by running the same simulation functions the server runs.
 */

import { MASSIVE_CHARGE_MS } from "../../tweakables/melee";
import type { PlayerIntent } from "../simulation/Physics";

/**
 * A scripted-server beat. The stage stands in for the server for the one
 * decision a lone fighter cannot make on its own: spawning a world object
 * (an item throw, an ultimate cast). The stage interprets the cue through
 * the hero's own kit, so a story never names a weapon.
 */
type StoryCue = "throw-item" | "cast-ult";

interface StoryStep {
	/** ms into the loop when the step fires. */
	at: number;
	/**
	 * How long `input` stays held. Absent means a press pulse — long enough
	 * for the simulation's press-edge detection to see a press and a release,
	 * never so long that a held charge begins.
	 */
	for?: number;
	/** Intent overrides while the step is live. Absent for cue-only steps. */
	input?: Partial<PlayerIntent>;
	/** A scripted-server beat, fired once as the clock crosses `at`. */
	cue?: StoryCue;
}

export interface Story {
	/**
	 * ms before the loop wraps and the fighter resets to its spawn. Long
	 * enough for the move *and* the recovery after it — a story that cuts
	 * off mid-recovery hides the commitment the card is warning about.
	 */
	loopMs: number;
	steps: readonly StoryStep[];
	/**
	 * Where the loop's fighter spawns. A travelling story asks for a lane
	 * with runway — the dragon ride launched from the default spawn hit the
	 * first pillar 150px in. Absent: open ground on the left.
	 */
	spawnX?: number;
	/**
	 * The angle a `cast-ult` cue launches along, radians from the facing
	 * direction. The arena is dense; the sweep that reads best is a measured
	 * climb, not the flat line a first guess reaches for. Absent: the
	 * stage's own defaults (a lob for the hole, a shallow climb for the ride).
	 */
	castAngle?: number;
}

/**
 * A press pulse: long enough to edge-detect, short enough to never charge.
 * `FighterStage` uses the same value as its default hold, so the definition
 * lives here and nowhere else.
 */
export const PULSE_MS = 110;

/** A charge-and-release hold needs the charge plus a beat of margin. */
const MASSIVE_HOLD_MS = MASSIVE_CHARGE_MS + 50;

function press(
	at: number,
	input: Partial<PlayerIntent>,
	forMs = PULSE_MS,
): StoryStep {
	return { at, for: forMs, input };
}

/**
 * The registry. Keyed by story id — which is a `MoveEntry`'s own id unless
 * the entry overrides it, so the two cannot drift. Module-private: the
 * accessor is `storyFor`.
 */
const STORIES: Record<string, Story> = {
	// ---- system ----
	// `swordStance` is absolute, never a toggle, so every stance change is a
	// *hold* that runs to the next change — a pulse would switch and switch
	// straight back.
	stance: {
		loopMs: 3000,
		steps: [
			press(400, { swordStance: false }, 1400),
			press(1800, { swordStance: true }, 1200),
		],
	},

	// ---- movement ----
	walk: {
		loopMs: 2800,
		steps: [press(300, { right: true }, 900), press(1600, { left: true }, 900)],
	},
	jump: {
		loopMs: 3200,
		steps: [press(400, { up: true }, 150), press(1000, { up: true }, 150)],
	},
	dash: {
		loopMs: 3000,
		steps: [press(400, { dash: 1 }, 80), press(1600, { dash: -1 }, 80)],
	},
	tumble: {
		loopMs: 3200,
		steps: [
			press(300, { swordStance: false }, 2900),
			press(700, { dash: 1 }, 80),
			press(1900, { dash: -1 }, 80),
		],
	},

	// ---- melee (ids are the shared MOVES table's) ----
	slash: { loopMs: 1800, steps: [press(400, { attack: true })] },
	slash2: {
		loopMs: 2400,
		steps: [press(400, { attack: true }), press(900, { attack: true })],
	},
	slash3: {
		loopMs: 3200,
		steps: [
			press(400, { attack: true }),
			press(900, { attack: true }),
			press(1400, { attack: true }),
		],
	},
	uppercut: { loopMs: 2200, steps: [press(400, { uppercut: true })] },
	// Hold the charge, release on the ground: the slam. The hold is the real
	// charge time — a retune re-times the preview with the move.
	massive: {
		loopMs: 4000,
		steps: [press(300, { attack: true }, MASSIVE_HOLD_MS)],
	},
	stab: { loopMs: 1500, steps: [press(400, { attack: true })] },
	// Shift is the dagger's thrust: a committed lunge, so hold the tell.
	thrust: { loopMs: 2600, steps: [press(400, { block: true }, 500)] },
	shoryuken: { loopMs: 2200, steps: [press(400, { uppercut: true })] },

	// ---- ranged: the gun stays out for the rest of the story ----
	rifle: {
		loopMs: 3000,
		steps: [
			press(300, { swordStance: false }, 2700),
			press(700, { attack: true }),
			press(1200, { attack: true }),
			press(1700, { attack: true }),
		],
	},
	machinegun: {
		loopMs: 3000,
		steps: [
			press(300, { swordStance: false }, 2700),
			press(700, { attack: true }, 500),
		],
	},
	shotgun: {
		loopMs: 3200,
		steps: [
			press(300, { swordStance: false }, 2900),
			press(800, { attack: true }),
		],
	},

	// ---- items: the press and the scripted throw ----
	grenade: {
		loopMs: 4200,
		steps: [{ at: 300, input: { item: true }, cue: "throw-item" }],
	},
	trap: {
		loopMs: 4200,
		steps: [{ at: 300, input: { item: true }, cue: "throw-item" }],
	},
	smoke: {
		loopMs: 5200,
		steps: [{ at: 300, input: { item: true }, cue: "throw-item" }],
	},

	// ---- ultimates: hold the aim, release, and the scripted cast ----
	"black-hole": {
		loopMs: 10000,
		steps: [press(400, { ultimate: true }, 800), { at: 1200, cue: "cast-ult" }],
	},
	"dragon-thrust": {
		loopMs: 4800,
		spawnX: 320,
		castAngle: -0.65,
		steps: [press(400, { ultimate: true }, 600), { at: 1000, cue: "cast-ult" }],
	},
	"death-blossom": {
		loopMs: 6000,
		steps: [press(400, { ultimate: true }, 600), { at: 1000, cue: "cast-ult" }],
	},
};

/** Look a story up by id, tolerating an id no story answers yet. */
export function storyFor(id: string): Story | undefined {
	return STORIES[id];
}

/** What a stage plays when no story answers: a standing fighter, breathing. */
export const EMPTY_STORY: Story = { loopMs: 3000, steps: [] };

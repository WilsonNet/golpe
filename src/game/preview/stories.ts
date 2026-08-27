/**
 * The preview stories — declarative input scripts a `FighterStage` performs.
 *
 * This is the move list's Storybook. A **story** is not a video and not a
 * pre-rendered clip: it is a timeline of *intents* — the same `PlayerIntent`
 * a keyboard produces — plus scripted-server cues, plus at most a lane or two
 * of **target dummies** for the move to happen to. The stage feeds the intents
 * through the real `tickPlayer` and renders with the real animation systems,
 * so what a story shows is what the move does, for whatever hero and sheet are
 * current. A new hero needs no new art here and a retune needs no re-render:
 * the preview cannot drift from the game because it *is* the game, one duel
 * wide.
 *
 * Stories are data on purpose — serializable, probe-able, and writable without
 * knowing anything about Pixi. Anything that needs a renderer lives in
 * `FighterStage`, which interprets the cues (`throw-item`, `cast-ult`) by
 * running the same simulation functions the server runs.
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
	 * off mid-recovery hides the commitment the card is warning about, but
	 * no longer: a tail past the action is dead air the player sits through.
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
	 * The x lanes of the preview's target dummies, on the ground floor. The
	 * dummies are what make a preview a demonstration instead of a mime:
	 * melee connects, bullets land, the hole holds, and every reaction is
	 * the real one. Absent: no dummies — the movement stories need none.
	 */
	targets?: readonly number[];
	/**
	 * The aim angle a gun story fires along, radians above the horizon. The
	 * stage aims every shot here the way a match aims along the cursor.
	 * Absent: level with the target dummies.
	 */
	aim?: number;
	/**
	 * The angle a `cast-ult` cue launches along, radians from the facing
	 * direction. Absent: the stage solves the lob onto the first target (the
	 * dragon: a shallow climb that clears the ground-level pillars).
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
	// Every melee story stands a target dummy just inside the move's reach, so
	// the swing lands and the card's damage, stun and knockback are all shown,
	// not claimed. A slash that connects also disables the dummy — the hit
	// state the list says the move inflicts.
	slash: {
		loopMs: 1800,
		targets: [156],
		steps: [press(400, { attack: true })],
	},
	slash2: {
		loopMs: 2400,
		targets: [156],
		steps: [press(400, { attack: true }), press(900, { attack: true })],
	},
	slash3: {
		loopMs: 3200,
		targets: [156],
		steps: [
			press(400, { attack: true }),
			press(900, { attack: true }),
			press(1400, { attack: true }),
		],
	},
	uppercut: {
		loopMs: 2400,
		targets: [150],
		steps: [press(400, { uppercut: true })],
	},
	// Hold the charge, release on the ground: the slam. The hold is the real
	// charge time — a retune re-times the preview with the move. The dummy
	// stands on the slam point, so the blast that follows is shown on it.
	massive: {
		loopMs: 3600,
		targets: [170],
		steps: [press(300, { attack: true }, MASSIVE_HOLD_MS)],
	},
	stab: { loopMs: 1600, targets: [150], steps: [press(400, { attack: true })] },
	// Shift is the dagger's thrust: a committed lunge, so hold the tell. The
	// dummy stands in the lunge's path — the sweep knocks it down.
	thrust: {
		loopMs: 2800,
		targets: [240],
		steps: [press(400, { block: true }, 500)],
	},
	shoryuken: {
		loopMs: 2400,
		targets: [150],
		steps: [press(400, { uppercut: true })],
	},

	// ---- ranged: the gun stays out, and every round flies at the target ----
	rifle: {
		loopMs: 2600,
		targets: [210],
		aim: 0,
		steps: [
			press(300, { swordStance: false }, 2300),
			press(700, { attack: true }),
			press(1200, { attack: true }),
			press(1700, { attack: true }),
		],
	},
	machinegun: {
		loopMs: 2600,
		targets: [210],
		aim: 0,
		steps: [
			press(300, { swordStance: false }, 2300),
			press(700, { attack: true }, 500),
		],
	},
	shotgun: {
		loopMs: 3200,
		targets: [190],
		aim: 0,
		steps: [
			press(300, { swordStance: false }, 2900),
			press(800, { attack: true }),
		],
	},

	// ---- items: the press, the scripted throw, and what it does on landing ----
	grenade: {
		loopMs: 3400,
		targets: [240],
		steps: [{ at: 300, input: { item: true }, cue: "throw-item" }],
	},
	trap: {
		loopMs: 4600,
		targets: [260],
		steps: [{ at: 300, input: { item: true }, cue: "throw-item" }],
	},
	smoke: {
		loopMs: 4600,
		targets: [240],
		steps: [{ at: 300, input: { item: true }, cue: "throw-item" }],
	},

	// ---- ultimates: hold the aim, release, and the scripted cast ----
	// The cast is solved onto the target: the grenade hits the dummy directly
	// and the hole opens on them, so the hold, the ticks and the release are
	// all shown on somebody instead of out past the arena's rim.
	"black-hole": {
		loopMs: 7000,
		targets: [240],
		steps: [press(400, { ultimate: true }, 800), { at: 1200, cue: "cast-ult" }],
	},
	"dragon-thrust": {
		loopMs: 4400,
		spawnX: 320,
		castAngle: -0.35,
		targets: [560],
		steps: [press(400, { ultimate: true }, 600), { at: 1000, cue: "cast-ult" }],
	},
	"death-blossom": {
		loopMs: 4200,
		targets: [210],
		steps: [press(400, { ultimate: true }, 600), { at: 1000, cue: "cast-ult" }],
	},
};

/** Look a story up by id, tolerating an id no story answers yet. */
export function storyFor(id: string): Story | undefined {
	return STORIES[id];
}

/** What a stage plays when no story answers: a standing fighter, breathing. */
export const EMPTY_STORY: Story = { loopMs: 3000, steps: [] };

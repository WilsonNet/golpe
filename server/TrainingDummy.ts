/**
 * The training room's opponent: a scriptable practice dummy.
 *
 * It is **an input source, not a fighter**. It has exactly the contract
 * `EnemyBrain` has — `decide(input, nowMs, dtMs) => AIOutput` — so
 * `GameRoom` picks an input source rather than growing a second code path, and
 * the simulation cannot tell a dummy from a bot from a human. Nothing in
 * `src/game/simulation/` knows this file exists, and nothing in it may.
 *
 * It lives server-side for the same reason the solo bot does: a client-side
 * dummy would bypass prediction, reconciliation and server-owned bullets, which
 * is exactly where the bugs are. The training room is an ordinary online match.
 *
 * **Deterministic on purpose.** No `Math.random`, and `nowMs` is ignored in
 * favour of accumulated `dtMs`: the training room is the tool other measurements
 * are taken with, so a script that produced different events on two runs would
 * launder its own flakiness into every later result.
 */

import type { AIInput, AIOutput } from "../src/game/characters/types.js";
import { scriptFor, slashBeats } from "../src/game/training/scripts.js";
import {
	type DummyBeat,
	type DummyStatus,
	defaultTrainingConfig,
	mergeTrainingConfig,
	type TrainingConfig,
	type TrainingConfigPatch,
} from "../src/game/training/types.js";
import type { PlayerIntent } from "./physics.js";

/** One tick of the *player's* input, as the server actually simulated it. */
export interface ObservedInput extends PlayerIntent {
	aimAngle: number;
}

interface ActiveScript {
	beats: DummyBeat[];
	loop: boolean;
}

/** A recorded frame, and how long the server spent on it. */
interface RecordedFrame {
	input: ObservedInput;
	ms: number;
}

function neutralOutput(): AIOutput {
	return {
		moveLeft: false,
		moveRight: false,
		jump: false,
		attack: false,
		block: false,
		uppercut: false,
		swordStance: true,
		face: 0,
		dash: 0,
		aimAngle: 0,
		evadeActive: false,
		ultimate: false,
	};
}

/** Which config fields change what the dummy is *playing*, as opposed to how the room is set up. */
function rhythmKey(c: TrainingConfig): string {
	return JSON.stringify([c.behaviour, c.script ?? null, c.timing]);
}

export class TrainingDummy {
	private cfg: TrainingConfig;

	/** The rhythm being played, and how far into it we are. */
	private script: ActiveScript | null = null;
	private beatIndex = 0;
	private beatElapsed = 0;
	/** True on the tick a beat starts — dash is an impulse, not a hold. */
	private beatFresh = true;

	/** The player's inputs, kept for `mirror` and `record`/`playback`. */
	private mirrorBuffer: RecordedFrame[] = [];
	private mirrorMs = 0;
	private recorded: RecordedFrame[] = [];
	private recordedMs = 0;
	private playbackIndex = 0;

	/** Reactive state. All of it is derived from `AIInput` transitions. */
	private wasStunned = false;
	/**
	 * Negative until the first perception arrives.
	 *
	 * Seeded with `Infinity` instead, the very first tick compared 100 against it
	 * and read a full-health dummy as having just been hit — so
	 * `blockAfterFirstHit` guarded from the moment it was selected, which is the
	 * one thing it is defined not to do.
	 */
	private lastHp = -1;
	private blockRemaining = 0;
	private counterTimer = -1;
	private enemyWasActive = false;
	private walkDir = 1;

	constructor(patch: TrainingConfigPatch = {}) {
		this.cfg = mergeTrainingConfig(defaultTrainingConfig(), patch);
		this.compile();
	}

	get config(): TrainingConfig {
		return this.cfg;
	}

	/**
	 * Merge a patch in, live.
	 *
	 * The rhythm is recompiled only when the patch actually changed it. A panel
	 * that re-sends its whole state on every keystroke would otherwise restart
	 * the beat list on each one, and a dummy that never gets past beat 0 looks
	 * exactly like a dummy that ignores its script.
	 */
	configure(patch: TrainingConfigPatch): TrainingConfig {
		const before = rhythmKey(this.cfg);
		this.cfg = mergeTrainingConfig(this.cfg, patch);
		if (rhythmKey(this.cfg) !== before) this.compile();
		return this.cfg;
	}

	private compile() {
		const compiled = scriptFor(
			this.cfg.behaviour,
			this.cfg.timing,
			this.cfg.script,
		);
		this.script = compiled
			? { beats: compiled.beats, loop: compiled.loop ?? true }
			: null;
		this.beatIndex = 0;
		this.beatElapsed = 0;
		this.beatFresh = true;
		this.blockRemaining = 0;
		this.counterTimer = -1;
		this.playbackIndex = 0;
	}

	/** Throw away the recorded input buffer, without touching the config. */
	clearRecording() {
		this.recorded = [];
		this.recordedMs = 0;
		this.playbackIndex = 0;
	}

	/**
	 * Back to the start of the session: same config, no history.
	 *
	 * Called on `reset`, which is what makes two runs of the same script
	 * comparable — the determinism check has no meaning if the second run starts
	 * mid-beat.
	 */
	reset() {
		this.compile();
		this.mirrorBuffer = [];
		this.mirrorMs = 0;
		this.wasStunned = false;
		// Back to "unset", not to Infinity — see the field's comment. Seeding it
		// high here would make the first tick after every reset read as a hit.
		this.lastHp = -1;
		this.enemyWasActive = false;
		this.walkDir = 1;
	}

	/**
	 * Watch the player's input for this tick, before `decide`.
	 *
	 * `null` means the server froze the player this tick because no input had
	 * arrived. Recording it would be recording a frame the player never sent, and
	 * a playback of invented frames is not a playback of what they did.
	 */
	observe(input: ObservedInput | null, dtMs: number) {
		if (!input) return;

		this.mirrorBuffer.push({ input, ms: dtMs });
		this.mirrorMs += dtMs;

		if (this.cfg.behaviour !== "record") return;
		if (this.recordedMs >= this.cfg.timing.recordMaxMs) return;
		this.recorded.push({ input, ms: dtMs });
		this.recordedMs += dtMs;
	}

	get status(): DummyStatus {
		return {
			behaviour: this.cfg.behaviour,
			beatIndex: this.script ? this.beatIndex : 0,
			beatCount: this.script?.beats.length ?? 0,
			beatElapsedMs: Math.round(this.beatElapsed),
			recording: this.cfg.behaviour === "record",
			recordedFrames: this.recorded.length,
			recordedMs: Math.round(this.recordedMs),
			playing: this.cfg.behaviour === "playback" && this.recorded.length > 0,
			playbackIndex: this.playbackIndex,
		};
	}

	decide(input: AIInput, _nowMs: number, dtMs: number): AIOutput {
		const out = neutralOutput();
		out.swordStance = this.cfg.dummyStance === "sword";
		out.aimAngle = Math.atan2(
			input.playerY - input.selfY,
			input.playerX - input.selfX,
		);

		switch (this.cfg.behaviour) {
			case "idle":
			case "record":
				break;
			case "walk":
				this.walk(input, out);
				break;
			case "blockAfterFirstHit":
				this.blockAfterFirstHit(input, out, dtMs);
				break;
			case "counterAttack":
				this.counterAttack(input, out, dtMs);
				break;
			case "mirror":
				this.mirror(out);
				break;
			case "playback":
				this.playback(out);
				break;
			default:
				this.playScript(out, dtMs);
				break;
		}

		this.trackHits(input);
		this.trimMirrorBuffer();
		this.applyFacing(input, out);
		return out;
	}

	// -------------------------------------------------------------------------
	// Beat playback
	// -------------------------------------------------------------------------

	/**
	 * Emit the current beat's buttons and advance the rhythm.
	 *
	 * Buttons are *held for the beat*, which is the whole correspondence the
	 * script format rests on: a 1ms `attack` beat is a press, a 470ms one charges
	 * a Massive Strike. A beat list is a recording of a controller, not a list of
	 * commands.
	 */
	private playScript(out: AIOutput, dtMs: number) {
		const beat = this.script?.beats[this.beatIndex];
		if (!this.script || !beat) return;

		out.moveLeft = beat.hold?.moveLeft ?? false;
		out.moveRight = beat.hold?.moveRight ?? false;
		out.jump = beat.hold?.jump ?? false;
		out.attack = beat.hold?.attack ?? false;
		out.block = beat.hold?.block ?? false;
		out.uppercut = beat.hold?.uppercut ?? false;
		if (beat.swordStance !== undefined) out.swordStance = beat.swordStance;
		if (beat.aimAngle !== undefined) out.aimAngle = beat.aimAngle;
		if (beat.face) out.face = beat.face;
		// A dash is an impulse the simulation consumes once. Held for a whole beat
		// it would be re-applied every tick, which is not a dash, it is flight.
		if (beat.dash && this.beatFresh) out.dash = beat.dash;

		this.beatFresh = false;
		this.beatElapsed += dtMs;
		if (this.beatElapsed < beat.ms) return;

		this.beatElapsed = 0;
		this.beatFresh = true;
		this.beatIndex++;
		if (this.beatIndex < this.script.beats.length) return;

		this.beatIndex = 0;
		// A one-shot rhythm is done, and the dummy goes back to standing still.
		if (!this.script.loop) this.script = null;
	}

	private startOneShot(beats: DummyBeat[]) {
		this.script = { beats, loop: false };
		this.beatIndex = 0;
		this.beatElapsed = 0;
		this.beatFresh = true;
	}

	// -------------------------------------------------------------------------
	// Reactive behaviours
	// -------------------------------------------------------------------------

	/** Pace between two x positions, turning at each bound. */
	private walk(input: AIInput, out: AIOutput) {
		const { walkLeftX, walkRightX } = this.cfg.timing;
		const left = Math.min(walkLeftX, walkRightX);
		const right = Math.max(walkLeftX, walkRightX);
		if (input.selfX <= left) this.walkDir = 1;
		else if (input.selfX >= right) this.walkDir = -1;
		out.moveLeft = this.walkDir < 0;
		out.moveRight = this.walkDir > 0;
	}

	/**
	 * Street Fighter's "block after first hit": stand still until something
	 * lands, then guard for a while, then drop it again.
	 *
	 * Taking a hit is read from the *stun* edge rather than from HP, because a
	 * practice dummy is usually invincible and its HP bar therefore never moves —
	 * but `applyMeleeResult` still stuns it, and stun is in the snapshot.
	 */
	private blockAfterFirstHit(input: AIInput, out: AIOutput, dtMs: number) {
		if (this.blockRemaining > 0) {
			this.blockRemaining -= dtMs;
			// A stunned fighter cannot hold anything; asking it to is not a bug, but
			// the guard should start when the stun ends, not run out during it.
			if (input.selfStunned) this.blockRemaining = this.cfg.timing.blockMs;
			out.block = true;
		}
	}

	/**
	 * Punish practice: swing `delayMs` after the player's move becomes active.
	 *
	 * The delay is measured from the *active* frames rather than from the press,
	 * because the punishable window is the recovery — a counter timed from
	 * startup would be a trade, not a punish.
	 */
	private counterAttack(input: AIInput, out: AIOutput, dtMs: number) {
		const active = input.enemyPhase === "active";
		const armed = active && !this.enemyWasActive && this.counterTimer < 0;
		this.enemyWasActive = active;

		if (armed) {
			// Armed on this tick, and *not* decremented on it: counting down from
			// the same tick spent the first interval before any time had passed, so
			// a 100ms delay fired 83ms after the swing went active.
			this.counterTimer = this.cfg.timing.delayMs;
		} else if (this.counterTimer >= 0) {
			this.counterTimer -= dtMs;
			if (this.counterTimer <= 0) {
				this.counterTimer = -1;
				this.startOneShot(slashBeats(this.cfg.timing.periodMs));
			}
		}
		this.playScript(out, dtMs);
	}

	/** Repeat the player's input from `mirrorDelayMs` ago, button for button. */
	private mirror(out: AIOutput) {
		const frame = this.mirrorBuffer[0];
		if (!frame || this.mirrorMs < this.cfg.timing.mirrorDelayMs) return;
		this.applyObserved(frame.input, out);
	}

	/** Replay the recording, one frame per tick, looping. */
	private playback(out: AIOutput) {
		if (this.recorded.length === 0) return;
		const frame = this.recorded[this.playbackIndex];
		this.playbackIndex = (this.playbackIndex + 1) % this.recorded.length;
		if (frame) this.applyObserved(frame.input, out);
	}

	/**
	 * A recorded intent, replayed as the dummy's own output.
	 *
	 * `face` and `aimAngle` are deliberately *not* copied: the player's facing
	 * was chosen relative to where they were standing, and replaying it on a
	 * fighter on the other side of the arena points the guard the wrong way. The
	 * configured facing decides instead, which is what makes a playback usable as
	 * an opponent rather than a puppet.
	 */
	private applyObserved(input: ObservedInput, out: AIOutput) {
		out.moveLeft = input.left;
		out.moveRight = input.right;
		out.jump = input.up;
		out.attack = input.attack;
		out.block = input.block;
		out.uppercut = input.uppercut;
		out.swordStance = input.swordStance;
		out.dash = input.dash;
	}

	// -------------------------------------------------------------------------
	// Shared bookkeeping
	// -------------------------------------------------------------------------

	private trackHits(input: AIInput) {
		const tookHit =
			(input.selfStunned && !this.wasStunned) ||
			(this.lastHp >= 0 && input.selfHP < this.lastHp);
		if (tookHit && this.cfg.behaviour === "blockAfterFirstHit") {
			this.blockRemaining = this.cfg.timing.blockMs;
		}
		this.wasStunned = input.selfStunned;
		this.lastHp = input.selfHP;
	}

	/** Keep only as much input history as `mirror` can possibly need. */
	private trimMirrorBuffer() {
		const keep = this.cfg.timing.mirrorDelayMs;
		while (this.mirrorBuffer.length > 1 && this.mirrorMs > keep) {
			const front = this.mirrorBuffer.shift();
			this.mirrorMs -= front?.ms ?? 0;
		}
	}

	/**
	 * Point the dummy.
	 *
	 * A block covers only the side you face, so this is the difference between
	 * "the guard held" and "the attack came in from behind and ignored it" — and
	 * `away` is what makes the backstab battery row expressible at all.
	 */
	private applyFacing(input: AIInput, out: AIOutput) {
		if (out.face !== 0) return;
		const toFoe = input.playerX >= input.selfX ? 1 : -1;
		switch (this.cfg.facing) {
			case "foe":
				out.face = toFoe;
				break;
			case "away":
				out.face = -toFoe;
				break;
			case "left":
				out.face = -1;
				break;
			case "right":
				out.face = 1;
				break;
		}
	}
}

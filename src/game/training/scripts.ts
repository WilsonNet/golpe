/**
 * Behaviour → beat list.
 *
 * Every canned behaviour that does not need to *see* the game is compiled into
 * the same `DummyScript` an agent could have written by hand. That is the whole
 * design: `script` is the primitive, and the named behaviours are shorthands
 * for it, so there is exactly one playback engine to get right.
 *
 * The rhythms are presses and releases, never sustained truths, because the
 * simulation edge-detects its own buttons: a slash needs a press edge, a
 * Massive Strike fires on *release*, and jump height is analogue. A beat list
 * that holds `attack` forever produces exactly one swing — which is the bug
 * that once made an AI look like it was attacking while dealing no damage.
 *
 * Pure and deterministic. No `Math.random`, no clock: the determinism battery
 * row demands that the same script produce the same events twice.
 */

import {
	MASSIVE_CHARGE_MS,
	MOVES,
	SLASH_CANCELLED_MS,
} from "../simulation/Physics.js";
import type {
	DummyBeat,
	DummyBehaviour,
	DummyScript,
	TrainingTiming,
} from "./types.js";

/**
 * How long a button is held to register as a deliberate press.
 *
 * Three ticks at 60Hz. One tick would be enough for the simulation, but the
 * dummy is driven by the server's `dtMs`, which is not guaranteed to land
 * inside a 16ms beat — a press short enough to be skipped between two ticks is
 * a press that sometimes does not happen, which is indistinguishable from a
 * broken mechanic when it shows up in a report.
 */
export const PRESS_MS = 55;

/** Jump held long enough for a full-height jump, then released to re-arm it. */
export const JUMP_HOLD_MS = 240;
export const JUMP_RELEASE_MS = 60;

/**
 * How long the attack button is held to arm and fire a Massive Strike.
 *
 * `MASSIVE_CHARGE_MS` plus a tick of slack: the charge is compared with `>=`
 * after the timer has been advanced, so landing exactly on the boundary depends
 * on how the server's ticks happen to divide the beat.
 */
export const MASSIVE_HOLD_MS = MASSIVE_CHARGE_MS + 50;

/** A beat's leftover time in a period, never shorter than one press. */
function rest(periodMs: number, usedMs: number): number {
	return Math.max(PRESS_MS, periodMs - usedMs);
}

/**
 * The butterfly: slash, cancel it into a block the instant the hitbox closes,
 * release, repeat.
 *
 * The **gap between the slash and the block is load-bearing**, and getting it
 * wrong produces a rhythm that looks like a butterfly and is not one:
 *
 * - A cancel is illegal during startup, so a block pressed at 55ms is simply
 *   ignored. Worse, the guard is then already *held*, and the cancel is checked
 *   on the block's press edge only — so the slash runs its full 330ms and the
 *   next press lands while the move is still going and is swallowed. Measured,
 *   that rhythm produced seven swings where fifteen were intended.
 * - A cancel during the active frames is legal and throws the hit away.
 *
 * `SLASH_CANCELLED_MS` is the exact moment both are avoided: the hitbox has had
 * its full window, and 170ms of recovery is skipped.
 */
export function butterflyBeats(): DummyBeat[] {
	return [
		{ ms: PRESS_MS, hold: { attack: true } },
		{ ms: Math.max(1, SLASH_CANCELLED_MS - PRESS_MS) },
		{ ms: 95, hold: { block: true } },
		{ ms: 40 },
	];
}

/**
 * The ground chain: three presses, each landing the instant the link before it
 * becomes chainable.
 *
 * The gaps are the technique, and they are derived rather than typed: a link
 * opens when the previous one enters recovery — `startup + active` — so the press
 * has to arrive after that and before the grace window closes. Written as
 * literals they would silently stop being a combo the first time the frame data
 * moved, which is the failure mode this whole file exists to avoid.
 */
export function comboBeats(periodMs: number): DummyBeat[] {
	const link = (from: "slash" | "slash2") =>
		MOVES[from].startupMs + MOVES[from].activeMs;
	const used =
		PRESS_MS * 3 + (link("slash") - PRESS_MS) + (link("slash2") - PRESS_MS);
	return [
		{ ms: PRESS_MS, hold: { attack: true } },
		{ ms: Math.max(1, link("slash") - PRESS_MS) },
		{ ms: PRESS_MS, hold: { attack: true } },
		{ ms: Math.max(1, link("slash2") - PRESS_MS) },
		{ ms: PRESS_MS, hold: { attack: true } },
		{ ms: rest(periodMs, used) },
	];
}

/** A single committed swing, then the rest of the period doing nothing. */
export function slashBeats(periodMs: number): DummyBeat[] {
	return [
		{ ms: PRESS_MS, hold: { attack: true } },
		{ ms: rest(periodMs, PRESS_MS) },
	];
}

export function uppercutBeats(periodMs: number): DummyBeat[] {
	return [
		{ ms: PRESS_MS, hold: { uppercut: true } },
		{ ms: rest(periodMs, PRESS_MS) },
	];
}

/** Charge past `MASSIVE_CHARGE_MS`, then let go — the release is what fires. */
export function massiveBeats(periodMs: number): DummyBeat[] {
	return [
		{ ms: MASSIVE_HOLD_MS, hold: { attack: true } },
		{ ms: rest(periodMs, MASSIVE_HOLD_MS) },
	];
}

export function jumpBeats(periodMs: number): DummyBeat[] {
	return [
		{ ms: JUMP_HOLD_MS, hold: { jump: true } },
		{ ms: JUMP_RELEASE_MS },
		{ ms: rest(periodMs, JUMP_HOLD_MS + JUMP_RELEASE_MS) },
	];
}

/**
 * The rhythm a behaviour plays, or `null` when it has none.
 *
 * `null` means the behaviour is *reactive* — it needs to see the arena, the
 * opponent's state or the opponent's inputs, none of which a beat list can
 * express. Those live in `TrainingDummy`; everything else lives here, where it
 * is pure and can be tested without a server.
 */
export function scriptFor(
	behaviour: DummyBehaviour,
	timing: TrainingTiming,
	custom?: DummyScript,
): DummyScript | null {
	switch (behaviour) {
		case "script":
			return custom ? normaliseScript(custom) : null;
		case "blockAll":
			// Held across the loop boundary, deliberately: the same buttons on
			// consecutive beats produce no release, so the guard never re-arms its
			// parry window. A permanent guard is meant to be blockable, not a free
			// parry every second.
			return { beats: [{ ms: 1000, hold: { block: true } }], loop: true };
		case "butterfly":
			return { beats: butterflyBeats(), loop: true };
		case "combo":
			return { beats: comboBeats(timing.periodMs), loop: true };
		case "slash":
			return { beats: slashBeats(timing.periodMs), loop: true };
		case "uppercut":
			return { beats: uppercutBeats(timing.periodMs), loop: true };
		case "massive":
			return { beats: massiveBeats(timing.periodMs), loop: true };
		case "jump":
			return { beats: jumpBeats(timing.periodMs), loop: true };
		default:
			return null;
	}
}

/**
 * Drop beats that cannot advance and clamp the rest.
 *
 * A zero-length beat is not a fast press, it is an infinite loop: playback
 * advances by elapsed time, so a beat of 0ms is entered and left in the same
 * tick forever.
 */
export function normaliseScript(script: DummyScript): DummyScript {
	return {
		loop: script.loop ?? true,
		beats: script.beats
			.filter((b) => Number.isFinite(b.ms) && b.ms > 0)
			.map((b) => ({ ...b, ms: Math.max(1, b.ms) })),
	};
}

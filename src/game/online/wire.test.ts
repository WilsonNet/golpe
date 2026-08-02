/**
 * The wire format is only safe because it is proved to be lossless.
 *
 * A packer that quietly drops a field lands as unexplained reconciliation error
 * on one client and nothing at all on the server, which is the hardest class of
 * bug this project has. The compiler proves every field is *mentioned*
 * (`STATE_FIELDS`); these tests prove the values survive the round trip.
 */

import { describe, expect, it } from "vitest";
import {
	createPlayerState,
	NEUTRAL_INTENT,
	type PlayerIntent,
	type PlayerPosition,
	tickPlayer,
} from "../simulation/Physics";
import { packIntent, packState, unpackIntent, unpackState } from "./wire";

/** A deterministic pseudo-random generator, so a failure is reproducible. */
function lcg(seed: number) {
	let s = seed;
	return () => {
		s = (s * 1664525 + 1013904223) % 4294967296;
		return s / 4294967296;
	};
}

/**
 * -1, 0 or 1 — and never `-0`.
 *
 * `Math.round` hands back `-0` for anything in (-0.5, 0], which the simulation
 * treats as 0 (`-0 !== 0` is false) but `toEqual` treats as a different value.
 * Generating it here would fail a test about the packer for a reason that has
 * nothing to do with the packer.
 */
function axis(rand: () => number): number {
	return Math.floor(rand() * 3) - 1;
}

function randomIntent(rand: () => number): PlayerIntent {
	return {
		left: rand() < 0.4,
		right: rand() < 0.4,
		up: rand() < 0.3,
		attack: rand() < 0.3,
		block: rand() < 0.2,
		uppercut: rand() < 0.1,
		swordStance: rand() < 0.8,
		face: axis(rand),
		dash: axis(rand),
		ultimate: rand() < 0.05,
	};
}

/**
 * States that have actually been *lived in*, not hand-built.
 *
 * A fresh `createPlayerState` has every timer at zero and every flag false, so
 * it round-trips through a packer that forgot half the fields. Simulating a few
 * hundred random ticks is what puts non-zero values in the corners.
 */
function livedStates(count: number): PlayerPosition[] {
	const rand = lcg(20260729);
	const out: PlayerPosition[] = [];
	let state = createPlayerState(120, 400, 1);
	for (let i = 0; i < count * 4; i++) {
		state = tickPlayer(state, randomIntent(rand), 1 / 60);
		if (i % 4 === 0) out.push(state);
	}
	return out;
}

describe("packIntent", () => {
	it("round-trips every intent the simulation can be handed", () => {
		const rand = lcg(7);
		for (let i = 0; i < 500; i++) {
			const intent = randomIntent(rand);
			expect(unpackIntent(packIntent(intent))).toEqual(intent);
		}
	});

	it("round-trips the neutral intent", () => {
		expect(unpackIntent(packIntent({ ...NEUTRAL_INTENT }))).toEqual({
			...NEUTRAL_INTENT,
		});
	});

	it("keeps only the sign of the analogue axes, which is all the simulation reads", () => {
		const packed = packIntent({ ...NEUTRAL_INTENT, face: 7, dash: -3 });
		expect(unpackIntent(packed).face).toBe(1);
		expect(unpackIntent(packed).dash).toBe(-1);
	});
});

describe("packState", () => {
	it("round-trips states reached by actually simulating", () => {
		for (const state of livedStates(120)) {
			expect(unpackState(packState(state))).toEqual(state);
		}
	});

	it("survives a second trip unchanged, so a relayed snapshot cannot drift", () => {
		for (const state of livedStates(40)) {
			const once = unpackState(packState(state));
			expect(unpackState(packState(once))).toEqual(once);
		}
	});

	it("replays identically from an unpacked state", () => {
		// The property that actually matters: a client that unpacks a snapshot and
		// re-simulates must land exactly where the server did. Anything lossy shows
		// up here as divergence, even if the round trip above looked fine.
		const intent = { ...NEUTRAL_INTENT, right: true, up: true };
		for (const state of livedStates(30)) {
			let direct = state;
			let viaWire = unpackState(packState(state));
			for (let i = 0; i < 30; i++) {
				direct = tickPlayer(direct, intent, 1 / 60);
				viaWire = tickPlayer(viaWire, intent, 1 / 60);
			}
			expect(viaWire).toEqual(direct);
		}
	});

	it("is materially smaller than the object it replaces", () => {
		// The whole reason this file exists. Sixteen fighters of verbatim JSON is a
		// datagram nobody's MTU wants; if that stops being true, so does the case
		// for a packer.
		const state = createPlayerState(123.456, 456.789, -1);
		const verbatim = JSON.stringify(state).length;
		const packed = JSON.stringify(packState(state)).length;
		expect(packed).toBeLessThan(verbatim / 2);
	});
});

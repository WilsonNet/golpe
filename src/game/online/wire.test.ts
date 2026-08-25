/**
 * The wire format is only safe because it is proved to be lossless.
 *
 * A packer that quietly drops a field lands as unexplained reconciliation error
 * on one client and nothing at all on the server, which is the hardest class of
 * bug this project has. The compiler proves every field is *mentioned*
 * (`STATE_FIELDS`); these property tests prove the values survive the round trip
 * over generated inputs — fast-check's arbitraries sweep more of the input space
 * than hand-picked examples, and shrink a failure to the smallest intent that
 * loses data.
 */

import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import {
	createPlayerState,
	NEUTRAL_INTENT,
	type PlayerIntent,
	type PlayerPosition,
	tickPlayer,
} from "../simulation/Physics";
import { packIntent, packState, unpackIntent, unpackState } from "./wire";

/**
 * -1, 0 or 1 — and never `-0`.
 *
 * `Math.round` hands back `-0` for anything in (-0.5, 0], which the simulation
 * treats as 0 (`-0 !== 0` is false) but `toEqual` treats as a different value.
 * This arbitrary pins the two axes to the sign values the packer is lossless
 * for, so a round-trip property tests the packer and nothing else.
 */
const axis = fc.constantFrom(-1, 0, 1);

/**
 * A boolean that is true `p` of the time, so generated intents stay lived-in
 * rather than wild. The simulation *can* be handed contradictory input, but a
 * chain that spams every button has nothing left to vary — matching the old
 * hand-rolled generator's feel keeps states realistic enough to be meaningful.
 */
const bool = (p: number) =>
	fc.integer({ min: 0, max: 99 }).map((n) => n < p * 100);

/** A full, arbitrary intent the simulation can be handed, lossless on the wire. */
const intentArb: fc.Arbitrary<PlayerIntent> = fc.record({
	left: bool(0.4),
	right: bool(0.4),
	up: bool(0.3),
	attack: bool(0.3),
	block: bool(0.2),
	uppercut: bool(0.1),
	swordStance: bool(0.8),
	face: axis,
	dash: axis,
	ultimate: bool(0.05),
	item: bool(0.1),
});

/** A chain of intents to live through — a generated match's raw input. */
const intentChain: fc.Arbitrary<PlayerIntent[]> = fc.array(intentArb, {
	minLength: 0,
	maxLength: 40,
});

/**
 * A `PlayerPosition` that has actually been *lived in*, not hand-built.
 *
 * A fresh `createPlayerState` has every timer at zero and every flag false, so
 * it round-trips through a packer that forgot half the fields. Simulating a
 * chain of generated intents is what puts non-zero values in the corners — and
 * when a round-trip fails, fast-check shrinks the chain to the fewest ticks
 * that expose it.
 */
const livedState: fc.Arbitrary<PlayerPosition> = intentChain.map((chain) => {
	let state = createPlayerState(120, 400, 1);
	for (const intent of chain) state = tickPlayer(state, intent, 1 / 60);
	return state;
});

describe("packIntent", () => {
	test.prop([intentArb])(
		"round-trips every intent the simulation can be handed",
		(intent) => {
			expect(unpackIntent(packIntent(intent))).toEqual(intent);
		},
	);

	it("round-trips the neutral intent", () => {
		expect(unpackIntent(packIntent({ ...NEUTRAL_INTENT }))).toEqual({
			...NEUTRAL_INTENT,
		});
	});

	test.prop([fc.integer(), fc.integer()])(
		"keeps only the sign of the analogue axes, which is all the simulation reads",
		(face, dash) => {
			const packed = packIntent({ ...NEUTRAL_INTENT, face, dash });
			expect(unpackIntent(packed).face).toBe(Math.sign(face));
			expect(unpackIntent(packed).dash).toBe(Math.sign(dash));
		},
	);
});

describe("packState", () => {
	test.prop([livedState])(
		"round-trips states reached by actually simulating",
		(state) => {
			expect(unpackState(packState(state))).toEqual(state);
		},
	);

	test.prop([livedState])(
		"survives a second trip unchanged, so a relayed snapshot cannot drift",
		(state) => {
			const once = unpackState(packState(state));
			expect(unpackState(packState(once))).toEqual(once);
		},
	);

	test.prop([livedState])(
		"replays identically from an unpacked state",
		(state) => {
			// The property that actually matters: a client that unpacks a snapshot
			// and re-simulates must land exactly where the server did. Anything
			// lossy shows up here as divergence, even if the round trip above
			// looked fine.
			const intent = { ...NEUTRAL_INTENT, right: true, up: true };
			let direct = state;
			let viaWire = unpackState(packState(state));
			for (let i = 0; i < 30; i++) {
				direct = tickPlayer(direct, intent, 1 / 60);
				viaWire = tickPlayer(viaWire, intent, 1 / 60);
			}
			expect(viaWire).toEqual(direct);
		},
	);

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

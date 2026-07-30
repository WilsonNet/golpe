/**
 * The reconciler's *verdict* on why a sword state changed.
 *
 * `meleeDiverged` must be zero in every run, so anything that misclassifies a
 * legitimate server correction as divergence turns a healthy match into a FAIL —
 * and a metric that cries wolf is a metric that gets ignored. These tests are
 * about the classification, not about the replay.
 */

import { describe, expect, it } from "vitest";
import {
	createPlayerState,
	NEUTRAL_INTENT,
	type PlayerIntent,
	type PlayerPosition,
} from "../simulation/Physics";
import { PredictedPlayer } from "./Prediction";

const DT = 1 / 60;

/** Predict `n` ticks of `intent`, and return the sequence the last one used. */
function predict(
	player: PredictedPlayer,
	intent: PlayerIntent,
	n: number,
): number {
	let seq = 0;
	for (let i = 0; i < n; i++) seq = player.step(intent, DT);
	return seq;
}

function authoritative(overrides: Partial<PlayerPosition>): PlayerPosition {
	return { ...createPlayerState(100, 480, 1), ...overrides };
}

describe("PredictedPlayer.reconcile", () => {
	it("reports no divergence when the server agrees", () => {
		const player = new PredictedPlayer(100, 480);
		const seq = predict(player, { ...NEUTRAL_INTENT }, 4);
		const result = player.reconcile(
			authoritative({ ...player.state }),
			seq,
			DT,
		);
		expect(result.meleeDiverged).toBe(false);
		expect(result.errorPx).toBeCloseTo(0);
	});

	it("blames stun, not the state machine, when the server says we were hit", () => {
		const player = new PredictedPlayer(100, 480);
		const seq = predict(player, { ...NEUTRAL_INTENT, attack: true }, 4);
		const result = player.reconcile(
			authoritative({ stunTimer: 300, meleeAction: "none" }),
			seq,
			DT,
		);
		expect(result.meleeReplaced).toBe(true);
		expect(result.replaceReason).toBe("stun");
		expect(result.meleeDiverged).toBe(false);
	});

	/**
	 * The case that produced a real FAIL in a sixteen-fighter match.
	 *
	 * A parry the client had not been told about arms a Massive server-side. The
	 * client predicts a plain slash on release; the server produces a Massive; and
	 * by the time the client sees it, `massiveReady` has already been *consumed* by
	 * the strike. Looking only for the flag being newly set finds nothing, so a
	 * correct correction was reported as an unexplained melee desync.
	 */
	it("excuses a Massive the server granted and immediately spent", () => {
		const player = new PredictedPlayer(100, 480);
		const seq = predict(player, { ...NEUTRAL_INTENT, attack: true }, 4);
		expect(player.state.meleeAction).toBe("slash");
		expect(player.state.massiveReady).toBe(false);

		const result = player.reconcile(
			authoritative({ meleeAction: "massive", massiveReady: false }),
			seq,
			DT,
		);

		expect(result.meleeReplaced).toBe(true);
		expect(result.replaceReason).toBe("massive-armed");
		expect(result.meleeDiverged).toBe(false);
	});

	it("still excuses a Massive that was armed but not yet thrown", () => {
		const player = new PredictedPlayer(100, 480);
		const seq = predict(player, { ...NEUTRAL_INTENT }, 2);
		const result = player.reconcile(
			authoritative({ massiveReady: true, blocking: true }),
			seq,
			DT,
		);
		expect(result.replaceReason).toBe("massive-armed");
		expect(result.meleeDiverged).toBe(false);
	});

	/**
	 * The counter has to keep working, or excusing the legitimate cases has just
	 * silenced it. A state machine running differently on the two sides — with no
	 * stun, no invulnerability and no granted Massive to explain it — is the thing
	 * it exists to catch.
	 */
	it("still reports a genuinely unexplained divergence", () => {
		const player = new PredictedPlayer(100, 480);
		const seq = predict(player, { ...NEUTRAL_INTENT, attack: true }, 4);
		const result = player.reconcile(
			authoritative({ meleeAction: "uppercut" }),
			seq,
			DT,
		);
		expect(result.meleeReplaced).toBe(true);
		expect(result.replaceReason).toBe("unexplained");
		expect(result.meleeDiverged).toBe(true);
	});

	it("replays only the inputs the server has not acknowledged", () => {
		const player = new PredictedPlayer(100, 480);
		predict(player, { ...NEUTRAL_INTENT, right: true }, 6);
		// The server has seen the first two of six.
		const result = player.reconcile(authoritative({}), 2, DT);
		expect(result.replayed).toBe(4);
	});
});

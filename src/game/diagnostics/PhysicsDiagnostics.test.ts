import { describe, expect, it } from "vitest";
import {
	createPlayerState,
	MOVES,
	type PlayerPosition,
} from "../simulation/Physics";
import {
	PhysicsDiagnostics,
	RESPAWN_CORRECTION_PX,
} from "./PhysicsDiagnostics";

const DT_MS = 1000 / 60;

interface MeleeSummary {
	frameDataViolations: number;
	stuckActionFrames: number;
	meleeDesyncFrames: number;
	slashes: number;
	massives: number;
	violations: { kind?: string }[];
}

function summarise(diag: PhysicsDiagnostics): MeleeSummary {
	return (diag.peek() as { meleeSummary: MeleeSummary }).meleeSummary;
}

/** Feed one frame of the local fighter's state. Nothing else is under test. */
function record(diag: PhysicsDiagnostics, player: PlayerPosition) {
	diag.record({
		t: 0,
		dt: DT_MS,
		physicsSteps: 1,
		player,
		enemy: null,
		cameraX: 0,
		cameraY: 0,
	});
}

/** A fighter part-way through a move, without running the simulation to get there. */
function midMove(
	move: "massive" | "uppercut" | "slash",
	timerMs: number,
): PlayerPosition {
	const body = createPlayerState(100, 400, 1);
	body.meleeAction = move;
	body.meleeTimer = timerMs;
	return body;
}

describe("PhysicsDiagnostics: melee frame data", () => {
	/**
	 * The metric's whole job: an uncancellable move must not end before its table
	 * says it can. Without this the test below would prove nothing.
	 */
	it("reports an uncancellable move that ends early for no reason", () => {
		const diag = new PhysicsDiagnostics(() => "online");
		diag.startOpen();

		record(diag, midMove("massive", 100));
		record(diag, midMove("massive", 300));
		// An ordinary correction must not excuse anything.
		diag.recordReconciliation(2, 1, false);
		record(diag, createPlayerState(100, 400, 1));

		const melee = summarise(diag);
		expect(melee.frameDataViolations).toBe(1);
		expect(melee.violations[0]?.kind).toBe("uncancellable_move_ended_early");
	});

	/**
	 * A respawn wipes a fighter caught mid-Massive: no stun, no invulnerability,
	 * the move simply gone. That is *identical* in the state to an uncancellable
	 * move ending 400ms early, and it is not a defect.
	 *
	 * `round-reset` announces it, and relying on that announcement alone was the
	 * bug: the announcement is a datagram and the snapshot carrying the respawned
	 * state races it. When the snapshot won, the canonical run reported a frame
	 * data violation in roughly one run in five. The client now derives the same
	 * fact from a correction past 100px, which cannot be dropped or reordered.
	 */
	it("does not report a move wiped by a respawn", () => {
		const diag = new PhysicsDiagnostics(() => "online");
		diag.startOpen();

		record(diag, midMove("massive", 100));
		record(diag, midMove("massive", 300));

		// A respawn-sized correction, and *no* `round-reset` — which is exactly the
		// case that used to fail, because the announcement can lose the race with
		// the snapshot that carries the respawned state.
		diag.recordReconciliation(RESPAWN_CORRECTION_PX + 500, 3, false, {
			reason: "respawn",
			detail: { predictedAction: "massive", actualAction: "none" },
		});

		record(diag, createPlayerState(100, 400, 1));

		expect(summarise(diag).frameDataViolations).toBe(0);
	});

	/** Being hit is the ordinary excuse, and it must keep working. */
	it("does not report a move interrupted by a hit", () => {
		const diag = new PhysicsDiagnostics(() => "online");
		diag.startOpen();

		record(diag, midMove("massive", 100));
		record(diag, midMove("massive", 300));

		const hit = createPlayerState(100, 400, 1);
		hit.stunTimer = MOVES.slash.hitstunMs;
		hit.iframeTimer = 180;
		record(diag, hit);

		expect(summarise(diag).frameDataViolations).toBe(0);
	});

	/** A slash is cancellable by design — the butterfly depends on it. */
	it("does not report a cancelled slash", () => {
		const diag = new PhysicsDiagnostics(() => "online");
		diag.startOpen();

		record(diag, midMove("slash", 100));
		record(diag, midMove("slash", 170));
		record(diag, createPlayerState(100, 400, 1));

		const melee = summarise(diag);
		expect(melee.frameDataViolations).toBe(0);
		expect(melee.slashes).toBe(1);
	});
});

describe("PhysicsDiagnostics: open runs", () => {
	/**
	 * The training room's window is bounded by a reset at one end and a report at
	 * the other, so it needs a collector with no end time — and `peek` must not
	 * stop it.
	 */
	it("keeps collecting after a peek", () => {
		const diag = new PhysicsDiagnostics(() => "online");
		diag.startOpen();
		record(diag, midMove("massive", 100));
		expect(diag.isActive).toBe(true);
		diag.peek();
		expect(diag.isActive).toBe(true);
		record(diag, midMove("massive", 300));
		expect(summarise(diag).massives).toBe(1);
	});

	/** A timed diagnostic must be able to take over from an open one. */
	it("lets a timed run supersede an open one", () => {
		const diag = new PhysicsDiagnostics(() => "online");
		diag.startOpen();
		expect(diag.start(50)).toContain("DIAGNOSTIC_STARTED");
		expect(diag.start(50)).toBe("DIAGNOSTIC_ALREADY_RUNNING");
	});
});

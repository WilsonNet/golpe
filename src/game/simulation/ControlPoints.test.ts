import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { CP_CAPTURE_MS, CP_POINT_COUNT } from "../../tweakables/control.js";
import {
	type CaptureEvent,
	controlClockOutcome,
	controlInProgress,
	controlRespawnDelayMs,
	controlRoundWinner,
	controlSpawnScreen,
	controlStatus,
	controlTiebreak,
	harmonicMultiplier,
	initialControlPoints,
	onPad,
	pointsOwned,
	stepControlPoints,
	unlockedFor,
} from "./ControlPoints.js";

/** Nothing on any pad, for either side. */
function emptyPresence(): number[][] {
	return [new Array(CP_POINT_COUNT).fill(0), new Array(CP_POINT_COUNT).fill(0)];
}

/** Presence with the given counts per team on one point. */
function presenceAt(point: number, a: number, b: number): number[][] {
	const p = emptyPresence();
	if (p[0]) p[0][point] = a;
	if (p[1]) p[1][point] = b;
	return p;
}

/** Run the tick in small steps, like a room does, and collect captures. */
function stepFor(
	points: ReturnType<typeof initialControlPoints>,
	present: number[][],
	ms: number,
	overtime = false,
	dtMs = 100,
): CaptureEvent[] {
	const events: CaptureEvent[] = [];
	// One step past the request, so an exact-capture-time run lands on the far
	// side of the boundary rather than on a float that is 0.9999999 of the bar.
	const steps = Math.ceil(ms / dtMs) + 1;
	for (let i = 0; i < steps; i++) {
		events.push(...stepControlPoints(points, present, dtMs, overtime));
	}
	return events;
}

describe("initialControlPoints", () => {
	it("starts each side owning its two points, with a neutral middle", () => {
		const owners = initialControlPoints().map((p) => p.owner);
		expect(owners).toEqual([0, 0, null, 1, 1]);
	});

	it("locks every point but the middle at the start", () => {
		const points = initialControlPoints();
		// The middle is reachable for both: each side's point behind it is theirs.
		expect(unlockedFor(points, 2, 0)).toBe(true);
		expect(unlockedFor(points, 2, 1)).toBe(true);
		// The enemy's nearest point is not: the middle is not theirs yet.
		expect(unlockedFor(points, 3, 0)).toBe(false);
		expect(unlockedFor(points, 1, 1)).toBe(false);
		// Nor can either side touch the enemy's last point.
		expect(unlockedFor(points, 4, 0)).toBe(false);
		expect(unlockedFor(points, 0, 1)).toBe(false);
	});
});

describe("locks", () => {
	it("unlocks exactly one more point after the middle falls", () => {
		const points = initialControlPoints();
		stepFor(points, presenceAt(2, 1, 0), CP_CAPTURE_MS[2] ?? 1);
		expect(points[2]?.owner).toBe(0);
		// Taking the middle unlocked EMBER's nearest point for AZURE...
		expect(unlockedFor(points, 3, 0)).toBe(true);
		// ...and left the middle open to EMBER to take back.
		expect(unlockedFor(points, 2, 1)).toBe(true);
		// AZURE's own point behind the middle stays locked to EMBER.
		expect(unlockedFor(points, 1, 1)).toBe(false);
	});

	it("re-locks the point behind a capture", () => {
		const points = initialControlPoints();
		stepFor(points, presenceAt(2, 2, 0), CP_CAPTURE_MS[2] ?? 1);
		stepFor(points, presenceAt(3, 2, 0), CP_CAPTURE_MS[3] ?? 1);
		expect(points[3]?.owner).toBe(0);
		// With point 3 taken, point 2 is behind the line and closed to EMBER.
		expect(unlockedFor(points, 2, 1)).toBe(false);
		// The way back in is through point 3.
		expect(unlockedFor(points, 3, 1)).toBe(true);
		// And AZURE's next step is the enemy last point.
		expect(unlockedFor(points, 4, 0)).toBe(true);
	});

	it("never lets a team back-cap past the front line", () => {
		const points = initialControlPoints();
		stepFor(points, presenceAt(2, 1, 0), CP_CAPTURE_MS[2] ?? 1);
		// EMBER runs to AZURE's yard while the middle is AZURE's: refused.
		const events = stepFor(points, presenceAt(1, 0, 1), 5000);
		expect(points[1]?.owner).toBe(0);
		expect(events).toEqual([]);
		expect(unlockedFor(points, 1, 1)).toBe(false);
	});
});

describe("capture", () => {
	it("falls in its capture time at one fighter and reports the capture", () => {
		const points = initialControlPoints();
		// Just short: still owned by nobody.
		stepFor(points, presenceAt(2, 1, 0), (CP_CAPTURE_MS[2] ?? 1) - 200);
		expect(points[2]?.owner).toBe(null);
		expect(points[2]?.progress).toBeGreaterThan(0.9);
		// The last step flips it and the event names the team and the point.
		const events = stepControlPoints(points, presenceAt(2, 1, 0), 200, false);
		expect(events).toEqual([
			{ point: 2, team: 0, fromNeutral: true, last: false },
		]);
		expect(points[2]?.owner).toBe(0);
		expect(points[2]?.progress).toBe(0);
	});

	it("is faster with a crowd, as a harmonic number", () => {
		expect(harmonicMultiplier(1)).toBe(1);
		expect(harmonicMultiplier(2)).toBeCloseTo(1.5);
		expect(harmonicMultiplier(3)).toBeCloseTo(1.8333, 3);

		const solo = initialControlPoints();
		const pair = initialControlPoints();
		stepFor(solo, presenceAt(2, 1, 0), 4000);
		stepFor(pair, presenceAt(2, 2, 0), 4000);
		expect(pair[2]?.progress ?? 0).toBeGreaterThan(solo[2]?.progress ?? 0);
		// 41 x 100ms of the middle's 8000ms bar, at 1x and at 1.5x.
		expect(solo[2]?.progress ?? 0).toBeCloseTo(0.5125, 4);
		expect(pair[2]?.progress ?? 0).toBeCloseTo(0.76875, 4);
	});

	it("the middle is the slowest point and the last the fastest", () => {
		expect(CP_CAPTURE_MS[2] ?? 0).toBeGreaterThan(CP_CAPTURE_MS[1] ?? 0);
		expect(CP_CAPTURE_MS[1] ?? 0).toBeGreaterThan(CP_CAPTURE_MS[0] ?? 0);
		expect(CP_CAPTURE_MS[3]).toBe(CP_CAPTURE_MS[1]);
		expect(CP_CAPTURE_MS[4]).toBe(CP_CAPTURE_MS[0]);
	});
});

describe("contested and decay", () => {
	it("freezes progress while both sides stand on the pad", () => {
		const points = initialControlPoints();
		stepFor(points, presenceAt(2, 1, 0), 3000);
		const before = points[2]?.progress ?? 0;
		stepFor(points, presenceAt(2, 1, 1), 10000);
		expect(points[2]?.contested).toBe(true);
		expect(points[2]?.progress).toBe(before);
		expect(points[2]?.owner).toBe(null);
	});

	it("decays an abandoned capture and drops the claim at zero", () => {
		const points = initialControlPoints();
		stepFor(points, presenceAt(2, 2, 0), 3000);
		const before = points[2]?.progress ?? 0;
		expect(before).toBeGreaterThan(0);
		stepFor(points, emptyPresence(), 5000);
		const after = points[2]?.progress ?? 0;
		expect(after).toBeLessThan(before);
		// Long enough at the decay rate and the claim is gone entirely.
		stepFor(points, emptyPresence(), 40000);
		expect(points[2]?.progress).toBe(0);
		expect(points[2]?.attacker).toBe(null);
	});

	it("decays six times faster in overtime", () => {
		const normal = initialControlPoints();
		const overtime = initialControlPoints();
		stepFor(normal, presenceAt(2, 1, 0), 4000);
		stepFor(overtime, presenceAt(2, 1, 0), 4000);
		stepFor(normal, emptyPresence(), 2000);
		stepFor(overtime, emptyPresence(), 2000, true);
		expect(overtime[2]?.progress ?? 0).toBeLessThan(normal[2]?.progress ?? 0);
	});
});

describe("a neutral point is reverted at capture speed", () => {
	it("makes the other team unwind the progress before building its own", () => {
		const points = initialControlPoints();
		stepFor(points, presenceAt(2, 1, 0), 4000); // AZURE 50% on the middle
		expect(points[2]?.attacker).toBe(0);
		// EMBER arrives alone: the bar changes hands at EMBER's capture speed.
		stepFor(points, presenceAt(2, 0, 1), 4000);
		expect(points[2]?.attacker).toBe(1);
		expect(points[2]?.progress ?? 0).toBe(0);
		// And then starts building its own capture.
		stepFor(points, presenceAt(2, 0, 1), 200);
		expect(points[2]?.progress ?? 0).toBeGreaterThan(0);
		stepFor(points, presenceAt(2, 0, 1), CP_CAPTURE_MS[2] ?? 1);
		expect(points[2]?.owner).toBe(1);
	});

	it("an owned point does not revert just because a defender stands on it", () => {
		const points = initialControlPoints();
		stepFor(points, presenceAt(2, 1, 0), CP_CAPTURE_MS[2] ?? 1);
		// AZURE now holds the middle and starts on EMBER's point.
		stepFor(points, presenceAt(3, 1, 0), 2000);
		const progress = points[3]?.progress ?? 0;
		// EMBER alone on its own point: the defender blocks while the attacker is
		// there, but does not fast-forward the decay.
		stepFor(points, presenceAt(3, 0, 1), 1000);
		expect(points[3]?.progress).toBe(progress);
		expect(points[3]?.owner).toBe(1);
	});
});

describe("the round", () => {
	it("is won by taking the enemy's last point", () => {
		const points = initialControlPoints();
		stepFor(points, presenceAt(2, 3, 0), CP_CAPTURE_MS[2] ?? 1);
		stepFor(points, presenceAt(3, 3, 0), CP_CAPTURE_MS[3] ?? 1);
		expect(controlRoundWinner(points)).toBe(null);
		const events = stepFor(points, presenceAt(4, 3, 0), CP_CAPTURE_MS[4] ?? 1);
		expect(events.some((e) => e.last && e.team === 0)).toBe(true);
		expect(controlRoundWinner(points)).toBe(0);
		expect(pointsOwned(points, 0)).toBe(5);
	});

	it("breaks a time-out on points held, a tie being nobody's", () => {
		const tied = initialControlPoints();
		expect(controlTiebreak(tied)).toBe(null);
		const ahead = initialControlPoints();
		stepFor(ahead, presenceAt(2, 1, 0), CP_CAPTURE_MS[2] ?? 1);
		expect(controlTiebreak(ahead)).toBe(0);
	});

	it("knows when something is still being taken", () => {
		const points = initialControlPoints();
		expect(controlInProgress(points)).toBe(false);
		stepControlPoints(points, presenceAt(2, 1, 0), 1000, false);
		expect(controlInProgress(points)).toBe(true);
	});
});

describe("the clock and overtime", () => {
	const LIMIT = 10_000;

	it("does nothing before the limit", () => {
		const points = initialControlPoints();
		stepControlPoints(points, presenceAt(2, 1, 0), 1000, false);
		expect(controlClockOutcome(points, 5000, LIMIT, false)).toBe("none");
	});

	it("declares overtime when the clock runs out mid-capture", () => {
		const points = initialControlPoints();
		stepControlPoints(points, presenceAt(2, 1, 0), 2000, false);
		expect(controlClockOutcome(points, LIMIT, LIMIT, false)).toBe("overtime");
	});

	it("holds overtime while anything is still in progress", () => {
		const points = initialControlPoints();
		stepControlPoints(points, presenceAt(2, 1, 0), 2000, false);
		expect(controlClockOutcome(points, LIMIT + 5000, LIMIT, true)).toBe("none");
	});

	it("ends on time once every bar has reverted", () => {
		const points = initialControlPoints();
		expect(controlClockOutcome(points, LIMIT, LIMIT, true)).toBe("time");
		// And with nothing in progress at the whistle, it never went to overtime.
		expect(controlClockOutcome(points, LIMIT, LIMIT, false)).toBe("time");
	});
});

describe("forward spawns", () => {
	it("spawns each side on the screen of its furthest-forward point", () => {
		const points = initialControlPoints();
		// The line is the map: owning the yard means coming back on the yard.
		expect(controlSpawnScreen(points, 5, 0)).toBe(1);
		expect(controlSpawnScreen(points, 5, 1)).toBe(3);
		// AZURE takes the middle: their spawn walks one screen forward.
		stepFor(points, presenceAt(2, 1, 0), CP_CAPTURE_MS[2] ?? 1);
		expect(controlSpawnScreen(points, 5, 0)).toBe(2);
		expect(controlSpawnScreen(points, 5, 1)).toBe(3);
		// And the yard: another screen forward, one from the last point.
		stepFor(points, presenceAt(3, 1, 0), CP_CAPTURE_MS[3] ?? 1);
		expect(controlSpawnScreen(points, 5, 0)).toBe(3);
		// EMBER retakes its yard (the way back in is through 3, never around it),
		// and the middle after it: their front line walks back with the captures.
		stepFor(points, presenceAt(3, 0, 1), CP_CAPTURE_MS[3] ?? 1);
		expect(controlSpawnScreen(points, 5, 1)).toBe(3);
		stepFor(points, presenceAt(2, 0, 1), CP_CAPTURE_MS[2] ?? 1);
		expect(controlSpawnScreen(points, 5, 1)).toBe(2);
		expect(controlSpawnScreen(points, 5, 0)).toBe(1);
		// Pushed back to their last point, AZURE spawns on it; EMBER's frontier is
		// their yard. The base is where a team with nothing left comes back.
		stepFor(points, presenceAt(1, 0, 1), CP_CAPTURE_MS[1] ?? 1);
		expect(controlSpawnScreen(points, 5, 0)).toBe(0);
		expect(controlSpawnScreen(points, 5, 1)).toBe(1);
	});
});

describe("the respawn advantage", () => {
	it("gives the side with fewer points a shorter wait", () => {
		const points = initialControlPoints();
		expect(controlRespawnDelayMs(points, 0)).toBe(4000);
		expect(controlRespawnDelayMs(points, 1)).toBe(4000);
		stepFor(points, presenceAt(2, 1, 0), CP_CAPTURE_MS[2] ?? 1);
		stepFor(points, presenceAt(3, 1, 0), CP_CAPTURE_MS[3] ?? 1);
		// AZURE holds four points, EMBER one.
		expect(controlRespawnDelayMs(points, 1)).toBe(4000 - 3 * 700);
		// The floor clamps the arithmetic: a synthetic four-point deficit lands
		// under it and is held there — the state a death in the winning cooldown
		// reads, after the last point has fallen and before the reset.
		const swept = initialControlPoints();
		for (const point of swept) point.owner = 0;
		expect(controlRespawnDelayMs(swept, 1)).toBe(1500);
	});
});

describe("the snapshot view", () => {
	it("carries owners, progress and the unlock flags the HUD draws", () => {
		const points = initialControlPoints();
		stepControlPoints(points, presenceAt(2, 1, 0), 2000, false);
		const status = controlStatus(points, false, 0);
		expect(status.points).toHaveLength(5);
		expect(status.points[2]?.progress).toBeGreaterThan(0);
		expect(status.points[2]?.attacker).toBe(0);
		expect(status.points[2]?.unlocked).toEqual([true, true]);
		expect(status.points[3]?.unlocked).toEqual([false, true]);
	});
});

describe("pad containment", () => {
	it("counts a body centre inside the pad and not a jump above it", () => {
		const pad = { x: 360, y: 504, w: 180, h: 64 };
		// Standing on the ground at the pad's centre: in.
		expect(onPad(pad, 400, 520, 32, 48)).toBe(true);
		// A full jump clears the pad's headroom: out.
		expect(onPad(pad, 400, 420, 32, 48)).toBe(false);
		// Beside it: out.
		expect(onPad(pad, 200, 520, 32, 48)).toBe(false);
	});
});

describe("invariants under random play", () => {
	test.prop([
		fc.array(
			fc.array(
				fc.tuple(
					fc.integer({ min: 0, max: 3 }),
					fc.integer({ min: 0, max: 3 }),
				),
				{
					minLength: 5,
					maxLength: 5,
				},
			),
			{ minLength: 1, maxLength: 120 },
		),
	])(
		"ownership stays a prefix and a suffix, progress stays in bounds",
		(ticks) => {
			const points = initialControlPoints();
			for (const tick of ticks) {
				const a = new Array<number>(CP_POINT_COUNT).fill(0);
				const b = new Array<number>(CP_POINT_COUNT).fill(0);
				tick.forEach(([countA, countB], i) => {
					a[i] = countA;
					b[i] = countB;
				});
				stepControlPoints(points, [a, b], 16, false);
				for (const point of points) {
					expect(point.progress).toBeGreaterThanOrEqual(0);
					expect(point.progress).toBeLessThanOrEqual(1);
				}
				// No team ever owns a point past the other team's: each side's
				// ownership is contiguous from its own base.
				let seenB = false;
				for (const point of points) {
					if (point.owner === 1) seenB = true;
					else if (seenB && point.owner === 0) {
						throw new Error("AZURE owns a point behind EMBER's line");
					}
				}
			}
		},
	);
});

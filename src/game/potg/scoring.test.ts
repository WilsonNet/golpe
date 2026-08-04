import { describe, expect, it } from "vitest";
import {
	beats,
	describePlay,
	HIGHLIGHT_WEIGHTS,
	killsIn,
	PlayTracker,
	POTG_ABSORB_BURST,
	POTG_DAMAGE_BURST,
	POTG_LINK_MS,
	POTG_MAX_PLAY_MS,
	scorePlay,
} from "./scoring.js";
import type { HighlightEvent, HighlightKind, PotgPlay } from "./types.js";

function event(
	t: number,
	kind: HighlightKind,
	actorId = "a",
	victimName = "Foe",
	amount?: number,
): HighlightEvent {
	return {
		t,
		kind,
		actorId,
		actorName: actorId.toUpperCase(),
		victimId: "v",
		victimName,
		...(amount !== undefined ? { amount } : {}),
	};
}

/** Collect what a tracker closes, so a test can assert on finished plays. */
function collect(): { plays: PotgPlay[]; tracker: PlayTracker } {
	const plays: PotgPlay[] = [];
	return { plays, tracker: new PlayTracker((p) => plays.push(p)) };
}

describe("scorePlay", () => {
	it("prices a lone frag at the base weight", () => {
		expect(scorePlay([event(0, "kill")])).toBe(HIGHLIGHT_WEIGHTS.kill);
	});

	it("escalates each successive frag in a run", () => {
		const one = scorePlay([event(0, "kill")]);
		const two = scorePlay([event(0, "kill"), event(500, "kill")]);
		const three = scorePlay([
			event(0, "kill"),
			event(500, "kill"),
			event(900, "kill"),
		]);
		// Not merely additive: the second frag is worth more than the first, and
		// the third more than the second. That escalation is the entire reason a
		// multikill beats an accumulated scoreboard.
		expect(two - one).toBeGreaterThan(one);
		expect(three - two).toBeGreaterThan(two - one);
	});

	it("beats any pair of unrelated frags with one double kill", () => {
		const double = scorePlay([event(0, "kill"), event(800, "kill")]);
		const single = scorePlay([event(0, "kill")]);
		expect(double).toBeGreaterThan(single * 2);
	});

	it("adds a modifier to the frag it rides on", () => {
		const plain = scorePlay([event(0, "kill")]);
		const airborne = scorePlay([event(0, "airKill"), event(0, "kill")]);
		expect(airborne).toBe(plain + HIGHLIGHT_WEIGHTS.airKill);
	});

	it("counts frags, not modifiers", () => {
		expect(
			killsIn([
				event(0, "airKill"),
				event(0, "clutchKill"),
				event(0, "kill"),
				event(700, "kill"),
			]),
		).toBe(2);
	});

	it("prices a deny above an ordinary frag", () => {
		expect(HIGHLIGHT_WEIGHTS.deny).toBeGreaterThan(HIGHLIGHT_WEIGHTS.kill);
	});

	it("prices damage below frags, and absorbed below damage", () => {
		// A whole health bar of pressure is a fifth of a kill; a health bar of
		// blocked damage is half of that. The reel is a highlight, and neither
		// row looks like one — so neither may ever out-score a frag, let alone
		// a deny.
		expect(HIGHLIGHT_WEIGHTS.damageDealt).toBeLessThan(
			HIGHLIGHT_WEIGHTS.kill / 4,
		);
		expect(HIGHLIGHT_WEIGHTS.damageAbsorbed).toBeLessThan(
			HIGHLIGHT_WEIGHTS.damageDealt,
		);
	});

	it("never lets accumulated pressure beat a multikill", () => {
		// Eight bursts of damage — the cap of what a play's span can hold — is
		// a scoring pressure no ordinary play can sustain, and it still loses
		// to one double kill.
		const pressure = scorePlay(
			Array.from({ length: 8 }, (_, i) => event(i * 500, "damageDealt")),
		);
		const double = scorePlay([event(0, "kill"), event(800, "kill")]);
		expect(pressure).toBeLessThan(double);
	});
});

describe("PlayTracker", () => {
	it("chains events inside the link window into one play", () => {
		const { plays, tracker } = collect();
		tracker.note(event(0, "kill"));
		tracker.note(event(POTG_LINK_MS - 1, "kill"));
		tracker.flush();
		expect(plays).toHaveLength(1);
		expect(plays[0]?.kills).toBe(2);
	});

	it("cuts a play when the gap is longer than the link window", () => {
		const { plays, tracker } = collect();
		tracker.note(event(0, "kill"));
		tracker.note(event(POTG_LINK_MS + 1, "kill"));
		tracker.flush();
		expect(plays).toHaveLength(2);
		expect(plays.every((p) => p.kills === 1)).toBe(true);
	});

	it("keeps two fighters' runs apart even when they overlap in time", () => {
		const { plays, tracker } = collect();
		tracker.note(event(0, "kill", "a"));
		tracker.note(event(200, "kill", "b"));
		tracker.note(event(400, "kill", "a"));
		tracker.flush();
		// Two plays, not one four-kill monster credited to whoever went last: a
		// protagonist who is in half of their own highlight is the wrong answer.
		expect(plays).toHaveLength(2);
		const byActor = new Map(plays.map((p) => [p.actorId, p.kills]));
		expect(byActor.get("a")).toBe(2);
		expect(byActor.get("b")).toBe(1);
	});

	it("caps a run at the maximum play span", () => {
		const { plays, tracker } = collect();
		// Every event inside the link window, so only the span cap can end this.
		for (let t = 0; t <= POTG_MAX_PLAY_MS * 2; t += POTG_LINK_MS - 500) {
			tracker.note(event(t, "kill"));
		}
		tracker.flush();
		expect(plays.length).toBeGreaterThan(1);
		for (const play of plays) {
			expect(play.endMs - play.startMs).toBeLessThanOrEqual(POTG_MAX_PLAY_MS);
		}
	});

	it("closes a run on the caller's clock, not on the next event", () => {
		const { plays, tracker } = collect();
		tracker.note(event(0, "kill"));
		tracker.tick(POTG_LINK_MS - 10);
		expect(plays).toHaveLength(0);
		tracker.tick(POTG_LINK_MS + 10);
		expect(plays).toHaveLength(1);
	});

	it("carries the running score and kill count on the open play", () => {
		const { plays, tracker } = collect();
		tracker.note(event(0, "kill"));
		tracker.note(event(100, "deny"));
		tracker.flush();
		expect(plays[0]?.score).toBeGreaterThan(HIGHLIGHT_WEIGHTS.kill);
	});

	it("folds events into the play's stat line", () => {
		const { plays, tracker } = collect();
		tracker.note(event(0, "kill"));
		tracker.note(event(300, "damageDealt", "a", "Foe", 110));
		tracker.note(event(600, "damageAbsorbed", "a", "Rival", 90));
		tracker.note(event(900, "deny"));
		tracker.note(event(1200, "kill"));
		tracker.flush();
		const play = plays[0];
		expect(play?.stats).toEqual({
			kills: 2,
			damage: 110,
			denies: 1,
			absorbed: 90,
		});
		// The score is judgement, the stats are the receipt: the two may not
		// disagree about the frags that produced the headline.
		expect(play?.stats.kills).toBe(play?.kills);
	});

	it("defaults a burst event's amount to a full burst", () => {
		const { plays, tracker } = collect();
		tracker.note(event(0, "damageDealt"));
		tracker.note(event(200, "damageAbsorbed"));
		tracker.flush();
		expect(plays[0]?.stats.damage).toBe(POTG_DAMAGE_BURST);
		expect(plays[0]?.stats.absorbed).toBe(POTG_ABSORB_BURST);
	});
});

describe("beats", () => {
	const play = (score: number): PotgPlay => ({
		actorId: "a",
		actorName: "A",
		team: null,
		score,
		kills: 1,
		stats: { kills: 1, damage: 0, denies: 0, absorbed: 0 },
		events: [],
		startMs: 0,
		endMs: 0,
	});

	it("takes the first play when there is nothing to compare against", () => {
		expect(beats(play(1), null)).toBe(true);
	});

	it("keeps the earlier play on a tie", () => {
		// Deterministic by construction: any other rule makes the winner depend on
		// the order plays happen to close in.
		expect(beats(play(500), play(500))).toBe(false);
	});

	it("replaces on a strictly better score", () => {
		expect(beats(play(501), play(500))).toBe(true);
	});
});

describe("describePlay", () => {
	const play = (
		kills: number,
		kinds: HighlightKind[],
		victims: string[] = [],
		extra: Partial<PotgPlay["stats"]> = {},
	): PotgPlay => {
		const events = kinds.map((k, i) => event(i, k, "a", victims[i] ?? "Foe"));
		return {
			actorId: "a",
			actorName: "A",
			team: null,
			score: 0,
			kills,
			stats: {
				kills,
				damage: 0,
				denies: kinds.filter((k) => k === "deny").length,
				absorbed: 0,
				...extra,
			},
			events,
			startMs: 0,
			endMs: 0,
		};
	};

	it("names a multikill by its size", () => {
		expect(describePlay(play(2, ["kill", "kill"])).headline).toBe(
			"DOUBLE KILL",
		);
		expect(
			describePlay(play(4, ["kill", "kill", "kill", "kill"])).headline,
		).toBe("QUADRUPLE KILL");
	});

	it("has a name for a run past the table", () => {
		expect(describePlay(play(6, ["kill"])).headline).toBe("RAMPAGE");
	});

	it("lets a multikill outrank whatever was unusual about it", () => {
		expect(
			describePlay(play(2, ["ultimateKill", "kill", "kill"])).headline,
		).toBe("DOUBLE KILL");
	});

	it("falls through to what was unusual about a single frag", () => {
		expect(describePlay(play(1, ["ultimateKill", "kill"])).headline).toBe(
			"BLACK HOLE",
		);
		expect(describePlay(play(1, ["airKill", "kill"])).headline).toBe(
			"OUT OF THE AIR",
		);
		expect(describePlay(play(0, ["deny"])).headline).toBe("DENIED");
	});

	it("names a win that had no frag worth shouting about", () => {
		// Four bursts of damage with nothing else in the play: a BARRAGE is the
		// honest name for the fight the camera is about to show.
		expect(describePlay(play(0, [], [], { damage: 400 })).headline).toBe(
			"BARRAGE",
		);
		// And a wall of blocked damage beats even that — the rarest way to win a
		// play, and the one that reads worst, so it gets the rarest name.
		expect(describePlay(play(0, [], [], { absorbed: 420 })).headline).toBe(
			"THE WALL",
		);
		// The bigger of the two gets the name: a fighter who dished out more than
		// they blocked is a barrage, and one who blocked more than they dished is
		// the wall.
		expect(
			describePlay(play(0, [], [], { damage: 700, absorbed: 500 })).headline,
		).toBe("BARRAGE");
		expect(
			describePlay(play(0, [], [], { damage: 500, absorbed: 700 })).headline,
		).toBe("THE WALL");
	});

	it("always says something", () => {
		const described = describePlay(play(1, ["kill"], ["Rival"]));
		expect(described.headline).not.toBe("");
		expect(described.subtitle).toContain("Rival");
	});
});

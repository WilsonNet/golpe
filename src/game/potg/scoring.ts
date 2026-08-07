/**
 * Which moment of a match was the best one.
 *
 * Overwatch's Play of the Game is a scoring problem dressed as a cinematic: the
 * camera work is what people remember, but it is worth nothing if it points at
 * the wrong player. So this file is pure — no clock, no state beyond the events
 * it is fed, no rendering — and it is the only place that decides who the
 * protagonist is. The server runs it live; a test runs it over invented events;
 * neither can disagree with the other.
 *
 * **The unit is a play, not a kill.** A play is a run of one fighter's scoring
 * moments with no gap longer than `POTG_LINK_MS` in it. That is the whole idea:
 * three frags in four seconds is a story and three frags across a minute is a
 * scoreboard, and a system that only ranked individual kills could not tell the
 * difference. The chain multiplier below is what makes the story win.
 */

import type { TeamId } from "../simulation/Teams.js";
import type {
	HighlightEvent,
	HighlightKind,
	PlayStats,
	PotgPlay,
} from "./types.js";

// ---------------------------------------------------------------------------
// The shape of a play
// ---------------------------------------------------------------------------

/**
 * The longest gap between two scoring moments that still counts as one play.
 *
 * Five seconds, and it is the number the whole feature turns on. Shorter and a
 * genuine chain — kill, reposition, kill — is cut into two unremarkable plays
 * that each lose to somebody's lucky double. Longer and a fighter who is simply
 * having a good minute out-scores anybody who actually did something.
 */
export const POTG_LINK_MS = 5000;

/**
 * How much footage runs *before* the first scoring moment.
 *
 * The pre-roll holds on this: it is the only material the camera has to
 * establish where the protagonist is and who they are about to fight. It is
 * also why a play never opens on its own kill — a kill you did not see coming
 * reads as a cut, not as a highlight.
 *
 * Longer than it used to be, for the same reason the intro grew: the pre-roll
 * now spends ten seconds doing camera work before the roll, and at the
 * pre-roll's crawl rate that eats nearly two seconds of footage before the
 * play has even started.
 */
export const POTG_LEAD_MS = 4000;

/** How much footage runs *after* the last one, so the play lands rather than stops. */
export const POTG_TAIL_MS = 2200;

/**
 * The longest span of scoring moments one play may hold.
 *
 * A cap, not a target. Without it a fighter who keeps scoring every four
 * seconds accumulates an unbounded play and an unwatchably long clip; with it,
 * the run is cut at eight seconds and whatever came after starts a new play
 * that has to win on its own merit.
 */
export const POTG_MAX_PLAY_MS = 8000;

/** Longest clip the server will cut, whatever the play's span. */
export const POTG_MAX_CLIP_MS = POTG_LEAD_MS + POTG_MAX_PLAY_MS + POTG_TAIL_MS;

/**
 * How much footage the recorder keeps behind it.
 *
 * Exactly enough to reach back to the start of the longest possible play at the
 * moment that play is finally known to have ended — its lead-in, its full span,
 * and the silence that closed it. Keeping less would mean discovering a great
 * play and having no footage of its opening; keeping more is a ring buffer that
 * grows for nothing.
 */
export const POTG_BUFFER_MS = POTG_LEAD_MS + POTG_MAX_PLAY_MS + POTG_LINK_MS;

// ---------------------------------------------------------------------------
// What a moment is worth
// ---------------------------------------------------------------------------

/**
 * The weights, in one table.
 *
 * A frag is the unit and everything else is priced against it. The ordering is
 * the argument: a **deny** outscores a frag outright because taking somebody's
 * ultimate away is the rarest thing in the game and the only one both players
 * are guaranteed to remember; a **wipe** is worth more than a frag because it
 * ended a round; **clutch** and **airborne** are cheap because they are
 * circumstantial — they colour a kill rather than being one.
 *
 * These are additive, not exclusive: an airborne finisher that wiped a side and
 * left the killer on 12 HP is worth all four, which is exactly the moment a
 * highlight reel should be fighting to show.
 *
 * **The two damage rows are burst-priced, not point-priced.** An event fires
 * once per `POTG_DAMAGE_BURST` points, so the table reads "a burst is worth
 * 20" — a fifth of a kill for a whole health bar of pressure. That is
 * deliberately stingy: the reel is a highlight, and damage dealt reads far
 * worse on screen than it felt in the chair. **Absorbed is the cheapest of
 * all** — blocking a hit is *true* but looks like nothing, so it may colour a
 * play that was already won and must almost never win one that was not.
 */
export const HIGHLIGHT_WEIGHTS: Record<HighlightKind, number> = {
	kill: 100,
	ultimateKill: 80,
	finisherKill: 45,
	airKill: 30,
	clutchKill: 60,
	wipeKill: 90,
	deny: 140,
	damageDealt: 20,
	damageAbsorbed: 10,
};

/**
 * Damage points between two `damageDealt` events — roughly one full health
 * bar. Emitted by the server wherever damage is paid, so the tracker sees a
 * steady fighter as a trickle of cheap events rather than a flood of them.
 */
export const POTG_DAMAGE_BURST = 100;

/** The same for a guard: a burst of blocked damage is one health bar's worth. */
export const POTG_ABSORB_BURST = 100;

/** A play worth a headline of its own: four hundred points of one-sided work. */
const HEADLINE_STATS = 400;

/** Kinds that are a frag in their own right, rather than a modifier on one. */
const KILL_KINDS: ReadonlySet<HighlightKind> = new Set<HighlightKind>(["kill"]);

/**
 * How much each successive frag in a play is worth over the last.
 *
 * The escalation is the entire reason a play beats a scoreboard: two kills in
 * one breath must be worth more than two kills a minute apart, and by enough
 * that no accumulation of ordinary frags can catch a genuine multikill.
 */
const CHAIN_STEP = 0.45;
/** Ceiling on that escalation, so a five-kill run does not lap the whole match. */
const CHAIN_CAP = 3;

function chainMultiplier(killsBefore: number): number {
	return Math.min(CHAIN_CAP, 1 + CHAIN_STEP * killsBefore);
}

/**
 * Score a run of events.
 *
 * Modifiers ride on the frag they belong to: an `airKill` is emitted alongside
 * the `kill` it describes and is multiplied by the same chain position, so the
 * fourth kill of a run is worth more *and* its trimmings are.
 */
export function scorePlay(events: readonly HighlightEvent[]): number {
	let total = 0;
	let kills = 0;
	for (const event of events) {
		total += HIGHLIGHT_WEIGHTS[event.kind] * chainMultiplier(kills);
		if (KILL_KINDS.has(event.kind)) kills++;
	}
	return Math.round(total);
}

/** Frags in a run — the number the headline is mostly made of. */
export function killsIn(events: readonly HighlightEvent[]): number {
	let kills = 0;
	for (const event of events) if (KILL_KINDS.has(event.kind)) kills++;
	return kills;
}

// ---------------------------------------------------------------------------
// The stat line
// ---------------------------------------------------------------------------

/** A play with nothing yet in any of its stat buckets. */
function emptyStats(): PlayStats {
	return { kills: 0, damage: 0, denies: 0, absorbed: 0 };
}

/**
 * Fold one event into a play's stat line.
 *
 * The score is the *judgement*; these are the *receipt*. Damage rows carry
 * their burst size in `amount`; the kinds that are counts just count. `kills`
 * mirrors `PotgPlay.kills` rather than re-deriving it, so the card's numbers
 * can never disagree with the headline they sit under.
 */
function addStats(play: PotgPlay, event: HighlightEvent): void {
	switch (event.kind) {
		case "kill":
			play.stats.kills++;
			return;
		case "deny":
			play.stats.denies++;
			return;
		case "damageDealt":
			play.stats.damage += event.amount ?? POTG_DAMAGE_BURST;
			return;
		case "damageAbsorbed":
			play.stats.absorbed += event.amount ?? POTG_ABSORB_BURST;
			return;
		default:
			return;
	}
}

// ---------------------------------------------------------------------------
// Naming it
// ---------------------------------------------------------------------------

const MULTIKILL_NAMES = [
	"",
	"",
	"DOUBLE KILL",
	"TRIPLE KILL",
	"QUADRUPLE KILL",
];
const MULTIKILL_MAX = "RAMPAGE";

/**
 * What the splash shouts, and what it says underneath.
 *
 * A multikill names itself and outranks everything, because that is what the
 * player will be describing afterwards. A single frag falls through to whatever
 * was *unusual* about it — the hole, the deny, the finisher, the fact that it
 * happened in mid-air — and a play that won on pressure alone is named for the
 * pressure. Only a completely ordinary kill gets the ordinary name. A play
 * with a headline nobody would say out loud is a play that should have lost to
 * a different one.
 */
export function describePlay(play: PotgPlay): {
	headline: string;
	subtitle: string;
} {
	const kinds = new Set(play.events.map((e) => e.kind));
	const victims = play.events
		.filter((e) => e.kind === "kill" && e.victimName)
		.map((e) => e.victimName);

	if (play.kills >= MULTIKILL_NAMES.length) {
		return {
			headline: MULTIKILL_MAX,
			subtitle: `${play.kills} fighters, one breath.`,
		};
	}
	if (play.kills >= 2) {
		return {
			headline: MULTIKILL_NAMES[play.kills] ?? MULTIKILL_MAX,
			subtitle: victims.join(", "),
		};
	}

	if (kinds.has("deny")) {
		return {
			headline: "DENIED",
			subtitle: "Took the ultimate before it landed.",
		};
	}
	if (kinds.has("ultimateKill")) {
		return { headline: "BLACK HOLE", subtitle: "Gravity has a winner." };
	}
	if (kinds.has("wipeKill")) {
		return { headline: "LAST ONE STANDING", subtitle: "Closed out the round." };
	}
	if (kinds.has("finisherKill")) {
		return { headline: "FINISHER", subtitle: "Three links, no answer." };
	}
	if (kinds.has("clutchKill")) {
		return { headline: "ON THE ROPES", subtitle: "Won it on the last sliver." };
	}
	if (kinds.has("airKill")) {
		return { headline: "OUT OF THE AIR", subtitle: "Never touched the floor." };
	}
	// A play that won without a frag worth shouting about is named for what it
	// did win with. Absorbed reads worst of anything on screen, so it is checked
	// last of the two, and only when it actually beat the damage dealt — a
	// fighter who blocked four hundred points *and* dished them out gets the
	// more flattering name, because the damage is what the camera can show.
	if (
		play.stats.absorbed >= HEADLINE_STATS &&
		play.stats.absorbed > play.stats.damage
	) {
		return { headline: "THE WALL", subtitle: "Took it all, gave nothing." };
	}
	if (play.stats.damage >= HEADLINE_STATS) {
		return { headline: "BARRAGE", subtitle: "Poured it on." };
	}
	return {
		headline: "PLAY OF THE GAME",
		subtitle: victims.length > 0 ? `Put ${victims[0]} down.` : "",
	};
}

// ---------------------------------------------------------------------------
// Grouping events into plays, live
// ---------------------------------------------------------------------------

/**
 * Feeds events in, hands finished plays out.
 *
 * Per-actor, because two fighters trading kills across the same five seconds
 * are two plays and not one — and a tracker that grouped by time alone would
 * hand the camera a protagonist who was in half of their own highlight.
 *
 * Nothing here knows about footage. The recorder that owns the ring buffer
 * subscribes to `close`, which is what keeps this file testable with nothing
 * but a list of events and a clock the test controls.
 */
export class PlayTracker {
	private readonly open = new Map<string, PotgPlay>();

	constructor(
		/** Called when a run is finished and can no longer grow. */
		private readonly onClose: (play: PotgPlay) => void,
		/** Which side a fighter is on, for tinting the card. */
		private readonly teamOf: (id: string) => TeamId | null = () => null,
	) {}

	/**
	 * Add a scoring moment.
	 *
	 * A moment that arrives more than `POTG_LINK_MS` after the actor's last one,
	 * or that would push their run past `POTG_MAX_PLAY_MS`, closes the run it
	 * could not join and starts a fresh one — so a play is always either still
	 * growing or already judged, and never both.
	 */
	note(event: HighlightEvent) {
		const current = this.open.get(event.actorId);
		if (current) {
			const linked = event.t - current.endMs <= POTG_LINK_MS;
			const short = event.t - current.startMs <= POTG_MAX_PLAY_MS;
			if (linked && short) {
				current.events.push(event);
				current.endMs = event.t;
				current.actorName = event.actorName || current.actorName;
				current.score = scorePlay(current.events);
				current.kills = killsIn(current.events);
				addStats(current, event);
				return;
			}
			this.closeOne(event.actorId);
		}

		const play: PotgPlay = {
			actorId: event.actorId,
			actorName: event.actorName,
			team: this.teamOf(event.actorId),
			score: scorePlay([event]),
			kills: killsIn([event]),
			stats: emptyStats(),
			events: [event],
			startMs: event.t,
			endMs: event.t,
		};
		addStats(play, event);
		this.open.set(event.actorId, play);
	}

	/**
	 * Close every run whose window has expired at match-clock time `now`.
	 *
	 * Driven by the caller's clock rather than by an internal one, because the
	 * server's clock is the match clock — it pauses in a team match's freezetime,
	 * and a play must not be closed by seconds nobody was fighting through.
	 */
	tick(now: number) {
		for (const [id, play] of [...this.open]) {
			if (now - play.endMs <= POTG_LINK_MS) continue;
			this.closeOne(id);
		}
	}

	/** Close everything still open. The match is over; nothing can grow. */
	flush() {
		for (const id of [...this.open.keys()]) this.closeOne(id);
	}

	private closeOne(id: string) {
		const play = this.open.get(id);
		if (!play) return;
		this.open.delete(id);
		this.onClose(play);
	}
}

/**
 * Is `next` a better play than `best`?
 *
 * Strictly greater, deliberately: on a tie the play that happened **first**
 * keeps the title. Any other rule makes the winner depend on the order plays
 * happen to close in, and two identical matches would produce two different
 * cinematics.
 */
export function beats(next: PotgPlay, best: PotgPlay | null): boolean {
	return best === null || next.score > best.score;
}

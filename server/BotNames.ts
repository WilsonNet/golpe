/**
 * Names for server-hosted bots.
 *
 * A sixteen-fighter scoreboard full of `bot-room-3-7` is unreadable, and the
 * scoreboard is the only thing telling a player whether they are winning. Bots
 * get names for the same reason humans do.
 *
 * `unique-names-generator` is imported by name. A default import of a CJS-interop
 * module resolves to the namespace object here, which is the trap that once
 * crashed this server with "EnemyBrain is not a constructor".
 */

import {
	adjectives,
	animals,
	colors,
	uniqueNamesGenerator,
} from "unique-names-generator";

/** Capitalise each dash-separated word, then run them together: `SilentWolf`. */
function gamertag(raw: string): string {
	return raw
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join("");
}

/**
 * Longest name a bot may be given.
 *
 * The same cap humans get. The dictionaries happily produce
 * `ConstitutionalMockingbird`, which is 25 characters — and 25 characters in a
 * 34px podium heading wraps mid-word and reads as `ConstitutionalMoc kingbird`.
 * A bot with a name longer than any player could type is also just wrong.
 */
const MAX_NAME = 16;

/**
 * Every bot name begins with this marker, so a fighter driven by the server is
 * readable at a glance — on the in-world nameplate, not just on the scoreboard,
 * where the roster already tags it. A player who joins a room with a bot in it
 * must be able to tell who to remove.
 */
export const BOT_NAME_PREFIX = "BOT · ";

/**
 * Longest gamertag a bot may carry *behind the prefix*.
 *
 * `MAX_NAME` caps the whole name; the prefix eats six characters of it, so the
 * drawn tag gets the rest. Same wrap-protection argument, applied to the part
 * that varies.
 */
const MAX_TAG_LEN = MAX_NAME - BOT_NAME_PREFIX.length;

/** How many attempts to draw a name before falling back to a numeric suffix. */
const MAX_ATTEMPTS = 40;
/** Characters a fallback suffix (`2`..`99`) may eat before the cap. */
const FALLBACK_SUFFIX_SLACK = 3;
/** Characters a uniqueName suffix (`2`..) may eat before the cap. */
const UNIQUE_SUFFIX_SLACK = 2;
/** Largest numeric suffix tried before the fallback chain gives up. */
const MAX_UNIQUE_SUFFIX = 99;

/**
 * A gamertag-shaped name not already in `taken`, with the bot marker up front.
 *
 * Uniqueness is enforced rather than hoped for: two `SilentWolf`s on a
 * scoreboard is indistinguishable from a scoring bug — and a human and a bot
 * sharing a name would make the marker a lie. After a bounded number of tries
 * it falls back to a numeric suffix, because a slightly ugly name beats an
 * unbounded loop on the server's boot path.
 */
export function botName(taken: ReadonlySet<string>): string {
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const tag = gamertag(
			uniqueNamesGenerator({
				dictionaries:
					attempt % 2 === 0 ? [adjectives, animals] : [colors, animals],
				separator: "-",
				length: 2,
				style: "lowerCase",
			}),
		);
		if (tag.length > MAX_TAG_LEN) continue;
		const full = BOT_NAME_PREFIX + tag;
		if (taken.has(full)) continue;
		return full;
	}

	// Give up drawing and build one. Truncated so the numeric suffix still fits
	// inside the cap rather than pushing the name past it.
	const base = gamertag(
		uniqueNamesGenerator({
			dictionaries: [animals],
			separator: "-",
			length: 1,
			style: "lowerCase",
		}),
	).slice(0, MAX_TAG_LEN - FALLBACK_SUFFIX_SLACK);
	let n = 2;
	while (taken.has(`${BOT_NAME_PREFIX}${base}${n}`)) n++;
	return `${BOT_NAME_PREFIX}${base}${n}`;
}

/**
 * `name`, or `name2` / `name3` if it is already taken in this room.
 *
 * Applies to humans, not only bots. Two players called `Wilson` on a scoreboard is
 * indistinguishable from a scoring bug — the same reason bot names are unique —
 * and it happens constantly: people pick the same handle, and two tabs on one
 * machine share the remembered name in `localStorage`.
 *
 * The suffix goes on the *second* one through the door, so a player who was
 * already in the match keeps the name they have been playing under.
 */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
	if (!taken.has(base)) return base;
	// Trimmed so the suffix fits inside the cap rather than pushing past it.
	const stem = base.slice(0, MAX_NAME - UNIQUE_SUFFIX_SLACK);
	let n = 2;
	while (taken.has(`${stem}${n}`) && n < MAX_UNIQUE_SUFFIX) n++;
	return `${stem}${n}`;
}

/** Printable, in the sense a scoreboard cares about. */
const PRINTABLE_MIN_CODE = 0x20;
const DELETE_CODE_POINT = 0x7f;
function isPrintable(ch: string): boolean {
	const code = ch.codePointAt(0) ?? 0;
	return code >= PRINTABLE_MIN_CODE && code !== DELETE_CODE_POINT;
}

/**
 * Clean a name a human typed.
 *
 * Trimmed, length-capped and stripped of control characters — the scoreboard is
 * a DOM overlay, so a name is untrusted text that ends up next to a player's
 * score. React escapes it, so this is not about injection: it is that a
 * 400-character name would destroy the layout and an empty one would leave a row
 * with no label.
 *
 * Checked by code point rather than by a regex of literal control characters,
 * which are invisible in a source file and survive exactly one careless edit.
 */
export function sanitiseName(raw: unknown, fallback: string): string {
	if (typeof raw !== "string") return fallback;
	const clean = [...raw].filter(isPrintable).join("").trim().slice(0, MAX_NAME);
	return clean.length > 0 ? clean : fallback;
}

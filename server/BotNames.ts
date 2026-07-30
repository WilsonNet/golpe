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
 * A gamertag-shaped name not already in `taken`.
 *
 * Uniqueness is enforced rather than hoped for: two `SilentWolf`s on a
 * scoreboard is indistinguishable from a scoring bug. After a bounded number of
 * tries it falls back to a numeric suffix, because a slightly ugly name beats an
 * unbounded loop on the server's boot path.
 */
export function botName(taken: ReadonlySet<string>): string {
	for (let attempt = 0; attempt < 40; attempt++) {
		const name = gamertag(
			uniqueNamesGenerator({
				dictionaries:
					attempt % 2 === 0 ? [adjectives, animals] : [colors, animals],
				separator: "-",
				length: 2,
				style: "lowerCase",
			}),
		);
		if (name.length > MAX_NAME || taken.has(name)) continue;
		return name;
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
	).slice(0, MAX_NAME - 3);
	let n = 2;
	while (taken.has(`${base}${n}`)) n++;
	return `${base}${n}`;
}

/** Printable, in the sense a scoreboard cares about. */
function isPrintable(ch: string): boolean {
	const code = ch.codePointAt(0) ?? 0;
	return code >= 0x20 && code !== 0x7f;
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
	const clean = [...raw].filter(isPrintable).join("").trim().slice(0, 16);
	return clean.length > 0 ? clean : fallback;
}

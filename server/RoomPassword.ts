/**
 * Room passwords.
 *
 * A password is a property of a room, set by whoever creates it and checked
 * against everybody who joins it afterwards. It never travels in a snapshot
 * and never leaves the server: the client sends the text it was given, the
 * server compares it against a salted hash and answers "seated" or
 * `room-locked`.
 *
 * The hash is scrypt with a per-room salt, because the alternative — keeping
 * the text in memory — would put every player's password one heap dump away
 * from the open. The comparison is timing-safe, because one that is not is a
 * stopwatch an intruder can read a character at a time.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { MAX_PASSWORD_LENGTH } from "../src/game/online/types.js";

export { MAX_PASSWORD_LENGTH };

/** Salt and derived-key sizes, in bytes. */
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/**
 * The password a message actually carries, or `null` when it carries none.
 *
 * Arrival is untrusted — the value comes off the wire — so anything that is
 * not a string is no password at all, surrounding whitespace is a typing
 * artefact rather than part of the secret, and the empty result is the same
 * as no password. The cap matches the host form's field.
 */
export function cleanPassword(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return null;
	return trimmed.slice(0, MAX_PASSWORD_LENGTH);
}

/**
 * A room's password, stored. `salt:hash`, both hex — the salt first because
 * verification needs it and the format is only ever read by `verifyPassword`.
 */
export function hashPassword(password: string): string {
	const salt = randomBytes(SALT_BYTES);
	const key = scryptSync(password, salt, KEY_BYTES);
	return `${salt.toString("hex")}:${key.toString("hex")}`;
}

/**
 * Whether an attempt to enter matches what the room stored.
 *
 * `null` stored means the room has no password, and a keyless door opens for
 * everybody. A missing or malformed attempt never matches; the comparison is
 * timing-safe so a wrong answer does not say how much of it was right.
 */
export function verifyPassword(raw: unknown, stored: string | null): boolean {
	if (stored === null) return true;
	const attempt = cleanPassword(raw);
	if (attempt === null) return false;
	const [saltHex, keyHex] = stored.split(":");
	if (!saltHex || !keyHex) return false;
	const salt = Buffer.from(saltHex, "hex");
	const expected = Buffer.from(keyHex, "hex");
	if (salt.length === 0 || expected.length === 0) return false;
	const actual = scryptSync(attempt, salt, expected.length);
	return timingSafeEqual(actual, expected);
}

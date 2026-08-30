/**
 * What the player has finished, remembered between sessions.
 *
 * `localStorage`, like the bindings and the name — never the wire. Progress is
 * a property of this browser, not of a room, and a server that owned it would
 * mean a tutorial that could not be played offline or before a match exists.
 *
 * The stored shape is a flat set of **lesson ids**, which is why lesson ids are
 * required to be stable: reordering a chapter must not un-finish anything, and
 * renaming a lesson is a deliberate decision to make people play it again.
 */

const KEY = "golpe.campaign";

interface Stored {
	completed: string[];
}

function read(): Stored {
	try {
		const raw = window.localStorage.getItem(KEY);
		if (raw === null) return { completed: [] };
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return { completed: [] };
		const list = (parsed as { completed?: unknown }).completed;
		if (!Array.isArray(list)) return { completed: [] };
		return {
			completed: list.filter((v): v is string => typeof v === "string"),
		};
	} catch {
		// A private-mode browser, a quota, or somebody's hand-edited JSON. A
		// tutorial that refuses to open because it cannot remember is worse than
		// one that forgets.
		return { completed: [] };
	}
}

function write(data: Stored) {
	try {
		window.localStorage.setItem(KEY, JSON.stringify(data));
	} catch {
		// Same reasoning: losing the record is survivable, throwing is not.
	}
}

/** Mark one finished. Idempotent. */
export function markLessonComplete(id: string) {
	const data = read();
	if (data.completed.includes(id)) return;
	data.completed.push(id);
	write(data);
}

/** How much of a set of lesson ids is done, for a menu badge. */
export function progressOf(ids: string[]): { done: number; total: number } {
	const done = new Set(read().completed);
	return { done: ids.filter((id) => done.has(id)).length, total: ids.length };
}

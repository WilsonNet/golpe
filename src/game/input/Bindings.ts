/**
 * What each physical button means.
 *
 * The keyboard used to be a `KEYS` constant read straight out of `Input`, which
 * made every binding a compile-time fact — fine until a player wants block on a
 * key their hand can reach while holding a direction. This module is the single
 * source of truth for the mapping, and `Input` asks it rather than comparing
 * `e.code` against literals.
 *
 * **Mouse buttons live in the same namespace as keys.** A binding is a code
 * string: `KeyboardEvent.code` for keys, `Mouse0`/`Mouse1`/`Mouse2` for the
 * pointer. That is what lets block move from right-click to Shift without the
 * input layer growing a second code path — and lets a player move it back.
 *
 * **This is a client-side concern only.** The simulation is handed buttons, not
 * keys: `PlayerIntent` says `block`, never `ShiftLeft`. Rebinding therefore
 * cannot desync anything, because nothing about a binding ever reaches the wire.
 */

/**
 * Every rebindable action, in the order the controls dialog lists them.
 *
 * Dash is absent on purpose: it is a *gesture* on the movement bindings (double
 * tap left or right), not a button of its own, so it follows whatever those two
 * are bound to.
 */
export const ACTIONS = [
	"left",
	"right",
	"jump",
	"attack",
	"block",
	"uppercut",
	"sword",
	"gun",
	"toggleAi",
] as const;

export type Action = (typeof ACTIONS)[number];

/** How the controls dialog names each action. */
export const ACTION_LABELS: Record<Action, string> = {
	left: "Move left",
	right: "Move right",
	jump: "Jump / double jump",
	attack: "Slash / fire",
	block: "Block",
	uppercut: "Uppercut",
	sword: "Sword stance",
	gun: "Gun stance",
	toggleAi: "Toggle AI vs AI",
};

/**
 * Two bindings per action: a primary and an alternate.
 *
 * Named rather than numbered because the dialog keys its cells by them — keying
 * a row's buttons by slot index is the React mistake where a re-render hands the
 * focused button's state to a different slot.
 */
export const SLOT_NAMES = ["primary", "alternate"] as const;

/** How many bindings an action can hold. */
export const SLOTS = SLOT_NAMES.length;

/**
 * The defaults.
 *
 * **Block is Shift, not right-click.** Blocking is held through a whole exchange
 * while the same hand aims and slashes, and holding a mouse button down removes
 * the button the other half of the fight is fought with. Shift is under the hand
 * that is already holding a direction.
 *
 * **Jump is W and Space.** W keeps the WASD hand shape; Space is what every
 * player's thumb reaches for without being told. They are the same action, so a
 * double jump can even be W then Space.
 */
export const DEFAULT_BINDINGS: Readonly<Record<Action, readonly string[]>> = {
	left: ["KeyA"],
	right: ["KeyD"],
	jump: ["KeyW", "Space"],
	attack: ["Mouse0"],
	// Both shifts, because which one is under the hand depends on which half of
	// the keyboard the player's movement fingers live on.
	block: ["ShiftLeft", "ShiftRight"],
	uppercut: ["KeyF"],
	sword: ["KeyQ"],
	gun: ["KeyE"],
	toggleAi: ["KeyP"],
};

/** Where a player's bindings are kept, so they are set once and not again. */
const STORAGE_KEY = "vento.bindings";

/** The pointer, in the same code namespace as the keyboard. */
export function mouseCode(button: number): string {
	return `Mouse${button}`;
}

const MOUSE_LABELS: Record<string, string> = {
	Mouse0: "Left Click",
	Mouse1: "Middle Click",
	Mouse2: "Right Click",
};

/**
 * A code as a player would recognise it.
 *
 * `KeyboardEvent.code` is a *physical* position — `KeyA` is the key where A sits
 * on a US layout, whatever it prints on another. Showing the raw code would be
 * honest and unreadable; showing the letter is what everybody means.
 */
export function codeLabel(code: string): string {
	if (code in MOUSE_LABELS) return MOUSE_LABELS[code] as string;
	if (code.startsWith("Mouse")) return `Mouse ${code.slice(5)}`;
	if (code.startsWith("Key")) return code.slice(3);
	if (code.startsWith("Digit")) return code.slice(5);
	if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
	if (code.startsWith("Arrow")) return `${code.slice(5)} Arrow`;
	const named: Record<string, string> = {
		Space: "Space",
		ShiftLeft: "Left Shift",
		ShiftRight: "Right Shift",
		ControlLeft: "Left Ctrl",
		ControlRight: "Right Ctrl",
		AltLeft: "Left Alt",
		AltRight: "Right Alt",
		Enter: "Enter",
		Backquote: "`",
		Minus: "-",
		Equal: "=",
		BracketLeft: "[",
		BracketRight: "]",
		Backslash: "\\",
		Semicolon: ";",
		Quote: "'",
		Comma: ",",
		Period: ".",
		Slash: "/",
		CapsLock: "Caps Lock",
		Tab: "Tab",
	};
	return named[code] ?? code;
}

/**
 * Codes a player must not be able to take away from the browser or the UI.
 *
 * Escape closes the menu the rebind is happening in, and Tab is the scoreboard
 * *and* the browser's focus key — binding either would leave a player with a
 * dialog they cannot leave except by reloading.
 */
export const RESERVED_CODES = new Set(["Escape", "Tab"]);

export type BindingMap = Record<Action, string[]>;

function defaults(): BindingMap {
	const out = {} as BindingMap;
	for (const action of ACTIONS) out[action] = [...DEFAULT_BINDINGS[action]];
	return out;
}

/**
 * Take whatever was in storage and make it a usable map.
 *
 * Defensive because the value survives across versions of the game: an action
 * added after a player last saved is simply missing, and a binding they saved
 * for an action since removed is nonsense. Neither should cost them the rest of
 * their bindings, so unknown keys are dropped and missing ones fall back to the
 * default rather than to nothing.
 */
export function sanitise(raw: unknown): BindingMap {
	const out = defaults();
	if (!raw || typeof raw !== "object") return out;
	const source = raw as Record<string, unknown>;
	const claimed = new Set<string>();
	for (const action of ACTIONS) {
		const value = source[action];
		if (!Array.isArray(value)) continue;
		const codes: string[] = [];
		for (const code of value) {
			if (typeof code !== "string" || code === "") continue;
			if (RESERVED_CODES.has(code)) continue;
			// One code, one action. A saved file that binds Space to two things would
			// otherwise make one of them permanently unreachable.
			if (claimed.has(code)) continue;
			claimed.add(code);
			codes.push(code);
			if (codes.length === SLOTS) break;
		}
		out[action] = codes;
	}
	// A default that a *custom* binding already claimed has to go, or the two
	// disagree about who owns the code the moment the reverse index is built.
	for (const action of ACTIONS) {
		if (Array.isArray(source[action])) continue;
		out[action] = out[action].filter((code) => !claimed.has(code));
	}
	return out;
}

/**
 * The live bindings.
 *
 * A single mutable store rather than React state passed down into the game:
 * `Input` reads it on every frame and the controls dialog writes it, and those
 * two live on opposite sides of the canvas/DOM boundary. Subscribers exist so
 * the dialog re-renders; `Input` needs none, because it reads fresh each tick.
 */
export class KeyBindings {
	private map: BindingMap;
	/** Reverse index, rebuilt on every change. One code belongs to one action. */
	private owner = new Map<string, Action>();
	private readonly listeners = new Set<() => void>();

	constructor(initial: BindingMap = defaults()) {
		this.map = initial;
		this.reindex();
	}

	/** The codes bound to an action, in slot order. */
	codesFor(action: Action): readonly string[] {
		return this.map[action];
	}

	/** What a code does, or undefined if it does nothing. */
	actionFor(code: string): Action | undefined {
		return this.owner.get(code);
	}

	/** A snapshot, for persistence or for a dialog to render. */
	snapshot(): BindingMap {
		const out = {} as BindingMap;
		for (const action of ACTIONS) out[action] = [...this.map[action]];
		return out;
	}

	/**
	 * Put `code` in one of an action's slots.
	 *
	 * Returns the action the code was taken *from*, if any — the dialog says so,
	 * because a rebind that silently unbinds something else is how a player ends
	 * up unable to jump and with no idea why.
	 */
	bind(action: Action, slot: number, code: string): Action | undefined {
		if (RESERVED_CODES.has(code)) return undefined;
		const previous = this.owner.get(code);
		if (previous !== undefined) {
			this.map[previous] = this.map[previous].filter((c) => c !== code);
		}
		const codes = this.map[action];
		// Slots are positional in the dialog but sparse arrays are not worth the
		// trouble: filling slot 1 of an unbound action puts the code in slot 0.
		const index = Math.min(Math.max(slot, 0), codes.length, SLOTS - 1);
		codes[index] = code;
		this.map[action] = codes.slice(0, SLOTS);
		this.changed();
		return previous === action ? undefined : previous;
	}

	/** Unbind one slot. An action with no bindings simply cannot be performed. */
	clear(action: Action, slot: number) {
		const codes = this.map[action];
		if (slot < 0 || slot >= codes.length) return;
		codes.splice(slot, 1);
		this.changed();
	}

	/** Back to the defaults, wholesale. */
	reset() {
		this.map = defaults();
		this.changed();
	}

	/** True while every action is bound exactly as it ships. */
	get isDefault(): boolean {
		return ACTIONS.every(
			(action) =>
				this.map[action].length === DEFAULT_BINDINGS[action].length &&
				this.map[action].every((c, i) => c === DEFAULT_BINDINGS[action][i]),
		);
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private changed() {
		this.reindex();
		for (const listener of [...this.listeners]) listener();
	}

	private reindex() {
		this.owner.clear();
		for (const action of ACTIONS) {
			for (const code of this.map[action]) this.owner.set(code, action);
		}
	}
}

function load(): BindingMap {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		return raw ? sanitise(JSON.parse(raw)) : defaults();
	} catch {
		// Private browsing, disabled storage, or a corrupted value. Default
		// bindings are a far better failure than a game that will not start.
		return defaults();
	}
}

/** The instance the game and the controls dialog share. */
export const bindings = new KeyBindings(
	typeof window === "undefined" ? defaults() : load(),
);

// Persist on every change, in one place: the dialog mutates the store and does
// not have to remember to save, which is exactly the sort of thing that is
// remembered for the "bind" path and forgotten for "reset".
if (typeof window !== "undefined") {
	bindings.subscribe(() => {
		try {
			window.localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify(bindings.snapshot()),
			);
		} catch {
			/* not fatal — see load() */
		}
	});
}

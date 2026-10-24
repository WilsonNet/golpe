/**
 * How this player aims, and whether the game draws them a gamepad.
 *
 * Two settings, deliberately separate, because the device somebody holds and the
 * device the page is running on are different questions:
 *
 * - **`scheme`** decides where the aim angle comes from. `"mouse"` points at the
 *   cursor. `"controller"` uses the two-layer aim in `Aim.ts` — the analog
 *   Contra layer (d-pad or left stick, the same input that moves you), plus the
 *   right stick (or a relative mouse) for the full 360 on top.
 * - **`deck`** decides whether the on-screen deck is drawn. A phone wants one;
 *   a phone with a Bluetooth keyboard and mouse plugged into it does not, and
 *   that player must be able to say so. That is the whole reason this is not
 *   simply derived from `scheme`.
 *
 * **Neither ever reaches the wire.** Like key bindings, this is a client-side
 * fact: the simulation is handed an angle and a set of buttons, and has no idea
 * whether a thumb, a trackpad or a mouse produced them. Switching mid-match
 * therefore cannot desync anything.
 *
 * A single mutable store rather than React state, for the same reason
 * `Bindings.ts` is one: `Input` reads it every frame from outside React
 * entirely, and the Esc menu writes it from inside.
 */

/** Where the aim angle comes from. */
export type AimScheme = "mouse" | "controller";

/** Whether the on-screen deck is drawn. */
export type DeckSetting = "auto" | "on" | "off";

/**
 * Whether the deck may turn the fighter toward a nearby foe on its own.
 *
 * A cursor points; a thumb on a one-axis rocker is lucky to be pointing the
 * right way when somebody crosses behind it. On **sword** stance only, and only
 * while the fighter is stationary or holding guard, the deck nudges the angle
 * toward the nearest hostile within melee range. It is an input angle like any
 * other — the simulation never learns it was assisted — and it is a setting so
 * a player can turn it off.
 */
export type DeckAssist = "on" | "off";

export interface InputSettings {
	scheme: AimScheme;
	deck: DeckSetting;
	assist: DeckAssist;
}

const STORAGE_KEY = "golpe.input";

/**
 * True when the primary pointer cannot hover and is imprecise — a finger.
 *
 * `pointer: coarse` rather than a touch-events check or a user-agent sniff: a
 * laptop with a touchscreen still has a mouse, and should not be handed a
 * thumb-sized d-pad over its game.
 */
export function isTouchPrimary(): boolean {
	if (typeof window === "undefined" || !window.matchMedia) return false;
	return window.matchMedia("(pointer: coarse)").matches;
}

/**
 * What a first-time visitor gets.
 *
 * A finger has no cursor to aim with, so a touch device starts in controller
 * mode — it is the only scheme that is playable there at all. Everything else
 * starts on the mouse, because that is the scheme this game was designed around
 * and a player with a pad can say so in two clicks.
 */
function defaultSettings(): InputSettings {
	return {
		scheme: isTouchPrimary() ? "controller" : "mouse",
		deck: "auto",
		assist: "on",
	};
}

/** Take whatever was in storage and make it usable. Unknown values default. */
function sanitiseSettings(raw: unknown): InputSettings {
	const out = defaultSettings();
	if (!raw || typeof raw !== "object") return out;
	const source = raw as Partial<Record<"scheme" | "deck" | "assist", unknown>>;
	const scheme = source.scheme;
	const deck = source.deck;
	const assist = source.assist;
	if (scheme === "mouse" || scheme === "controller") out.scheme = scheme;
	if (deck === "auto" || deck === "on" || deck === "off") out.deck = deck;
	if (assist === "on" || assist === "off") out.assist = assist;
	return out;
}

class InputSettingsStore {
	private settings: InputSettings;
	private readonly listeners = new Set<() => void>();
	/**
	 * The coarse-pointer answer, cached.
	 *
	 * `deckVisible()` and the deck's aim assist are asked every frame; calling
	 * `matchMedia` per frame allocates a MediaQueryList on a phone for an answer
	 * that changes only when a mouse is paired. The listener below is the same
	 * change event the deck's own component subscribes to.
	 */
	private coarse = isTouchPrimary();

	constructor(initial: InputSettings = defaultSettings()) {
		this.settings = initial;
		if (typeof window !== "undefined" && window.matchMedia) {
			const query = window.matchMedia("(pointer: coarse)");
			query.addEventListener("change", () => {
				this.coarse = query.matches;
				this.changed();
			});
		}
	}

	get touchPrimary(): boolean {
		return this.coarse;
	}

	get scheme(): AimScheme {
		return this.settings.scheme;
	}

	get deck(): DeckSetting {
		return this.settings.deck;
	}

	get assist(): DeckAssist {
		return this.settings.assist;
	}

	snapshot(): InputSettings {
		return { ...this.settings };
	}

	setScheme(scheme: AimScheme) {
		if (this.settings.scheme === scheme) return;
		this.settings = { ...this.settings, scheme };
		this.changed();
	}

	setDeck(deck: DeckSetting) {
		if (this.settings.deck === deck) return;
		this.settings = { ...this.settings, deck };
		this.changed();
	}

	setAssist(assist: DeckAssist) {
		if (this.settings.assist === assist) return;
		this.settings = { ...this.settings, assist };
		this.changed();
	}

	/**
	 * Whether the on-screen deck should be drawn right now.
	 *
	 * `auto` is not "is this phone" but "is this player using a finger *and*
	 * aiming like a controller" — a touch device switched to mouse aim has
	 * something else pointing at the screen, and the deck would only be in the way.
	 */
	deckVisible(touchPrimary = this.coarse): boolean {
		return deckVisibleFor(this.settings, touchPrimary);
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private changed() {
		for (const listener of [...this.listeners]) listener();
	}
}

/**
 * The `deck` setting applied to a *snapshot*, for a component that renders one.
 *
 * Pure, so the deck can ask the same question about a snapshot it holds as
 * React state as the live store answers for `Input` — a component that renders
 * a snapshot must not ask the live store, or the React Compiler's memoisation
 * (which only sees values a render reads) would freeze the deck's visibility
 * at mount.
 */
export function deckVisibleFor(
	settings: InputSettings,
	touchPrimary = isTouchPrimary(),
): boolean {
	if (settings.deck === "on") return true;
	if (settings.deck === "off") return false;
	return touchPrimary && settings.scheme === "controller";
}

function load(): InputSettings {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		return raw ? sanitiseSettings(JSON.parse(raw)) : defaultSettings();
	} catch {
		// Private browsing, or storage disabled. Defaults are a far better failure
		// than a game that will not start.
		return defaultSettings();
	}
}

/** The instance the game and the Esc menu share. */
export const inputSettings = new InputSettingsStore(
	typeof window === "undefined" ? defaultSettings() : load(),
);

// Persist in one place, so a caller cannot add a setter and forget to save.
if (typeof window !== "undefined") {
	inputSettings.subscribe(() => {
		try {
			window.localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify(inputSettings.snapshot()),
			);
		} catch {
			/* not fatal — see load() */
		}
	});
}

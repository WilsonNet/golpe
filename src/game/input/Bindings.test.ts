/**
 * The binding store, without a browser.
 *
 * These pin the two rules that make rebinding safe rather than a way to lose the
 * game: **one code belongs to one action**, and **whatever was in storage cannot
 * produce an unplayable map**. Both are invisible until a player has already
 * bound themselves into a corner, which is far too late to find out.
 */

import { describe, expect, it } from "vitest";
import {
	ACTIONS,
	codeLabel,
	DEFAULT_BINDINGS,
	KeyBindings,
	mouseCode,
	SLOTS,
	sanitise,
} from "./Bindings";

describe("defaults", () => {
	it("blocks with Shift rather than the mouse", () => {
		// The change this feature was built around: block is held through a whole
		// exchange while the same hand aims and slashes.
		expect(DEFAULT_BINDINGS.block).toContain("ShiftLeft");
		expect(DEFAULT_BINDINGS.block).not.toContain("Mouse2");
	});

	it("jumps on Space and on the pad's bottom face button; W is the uppercut", () => {
		// Uppercut lives on the top of the WASD hand — see specs/controls.md —
		// and Space is the jump a thumb reaches for without being told.
		expect([...DEFAULT_BINDINGS.jump]).toEqual(["Space", "Pad0"]);
		expect(DEFAULT_BINDINGS.uppercut).toContain("KeyW");
		expect(DEFAULT_BINDINGS.item).toContain("KeyF");
	});

	it("gives every action a pad binding except the debug toggle", () => {
		// A controller that could not do something a keyboard can is not a control
		// scheme, it is a demo. AI vs AI is the one exception: it is a debug switch,
		// and a stray pad button flipping the whole match to bots would be a bug.
		for (const action of ACTIONS) {
			const hasPad = DEFAULT_BINDINGS[action].some((c) => c.startsWith("Pad"));
			expect(hasPad).toBe(action !== "toggleAi");
		}
	});

	it("aims vertically on the arrow keys and the d-pad", () => {
		// Horizontal aim is the movement input — that is the Contra scheme — so
		// there is deliberately no aimLeft/aimRight to bind.
		expect([...DEFAULT_BINDINGS.aimUp]).toEqual(["ArrowUp", "PadUp"]);
		expect([...DEFAULT_BINDINGS.aimDown]).toEqual(["ArrowDown", "PadDown"]);
	});

	it("binds no code to two actions", () => {
		const seen = new Set<string>();
		for (const action of ACTIONS) {
			for (const code of DEFAULT_BINDINGS[action]) {
				expect(seen.has(code)).toBe(false);
				seen.add(code);
			}
		}
	});
});

describe("KeyBindings", () => {
	it("resolves a code to the action it performs", () => {
		const b = new KeyBindings();
		expect(b.actionFor("Space")).toBe("jump");
		expect(b.actionFor("KeyW")).toBe("uppercut");
		expect(b.actionFor(mouseCode(0))).toBe("attack");
		expect(b.actionFor("KeyZ")).toBeUndefined();
	});

	it("takes a code away from whatever held it, and says so", () => {
		const b = new KeyBindings();
		// A rebind that silently unbinds something else is how a player ends up
		// unable to jump with no idea why.
		expect(b.bind("block", 0, "Space")).toBe("jump");
		expect(b.actionFor("Space")).toBe("block");
		expect([...b.codesFor("jump")]).toEqual(["Pad0"]);
	});

	it("does not report a displacement when the action already had the code", () => {
		const b = new KeyBindings();
		expect(b.bind("jump", 1, "Space")).toBeUndefined();
	});

	it("puts a code in the first free slot rather than leaving a hole", () => {
		const b = new KeyBindings();
		b.clear("left", 0);
		b.clear("left", 0);
		b.clear("left", 0);
		b.bind("left", 2, "KeyZ");
		expect([...b.codesFor("left")]).toEqual(["KeyZ"]);
	});

	it("never keeps more than three bindings for an action", () => {
		const b = new KeyBindings();
		b.bind("jump", 0, "KeyU");
		b.bind("jump", 1, "KeyI");
		b.bind("jump", 2, "KeyO");
		expect(b.codesFor("jump").length).toBe(SLOTS);
	});

	it("refuses the codes the menu itself needs", () => {
		const b = new KeyBindings();
		b.bind("jump", 0, "Escape");
		// Escape closes the dialog the rebind happens in — binding it would leave a
		// player with a menu they cannot leave.
		expect(b.actionFor("Escape")).toBeUndefined();
		expect(b.codesFor("jump")).toContain("Space");
	});

	it("allows an action to be left unbound", () => {
		const b = new KeyBindings();
		b.clear("toggleAi", 0);
		expect(b.codesFor("toggleAi").length).toBe(0);
		expect(b.actionFor("KeyP")).toBeUndefined();
	});

	it("restores every default at once", () => {
		const b = new KeyBindings();
		b.bind("block", 0, "KeyW");
		b.clear("uppercut", 0);
		expect(b.isDefault).toBe(false);
		b.reset();
		expect(b.isDefault).toBe(true);
		expect(b.actionFor("Space")).toBe("jump");
		expect(b.actionFor("KeyW")).toBe("uppercut");
		expect(b.actionFor("KeyF")).toBe("item");
	});

	it("notifies subscribers so the dialog redraws", () => {
		const b = new KeyBindings();
		let changes = 0;
		const off = b.subscribe(() => changes++);
		b.bind("jump", 0, "KeyU");
		b.reset();
		off();
		b.bind("jump", 0, "KeyI");
		expect(changes).toBe(2);
	});
});

describe("sanitise", () => {
	it("falls back to the defaults for anything it cannot read", () => {
		expect(sanitise(null).jump).toEqual([...DEFAULT_BINDINGS.jump]);
		expect(sanitise("nonsense").block).toEqual([...DEFAULT_BINDINGS.block]);
		expect(sanitise({ jump: "KeyW" }).jump).toEqual([...DEFAULT_BINDINGS.jump]);
	});

	it("keeps a saved action and defaults the ones it does not mention", () => {
		// An action added after a player last saved is simply missing, and losing
		// the rest of their bindings over it would be a poor trade.
		const map = sanitise({ block: ["KeyC"] });
		expect(map.block).toEqual(["KeyC"]);
		expect(map.jump).toEqual([...DEFAULT_BINDINGS.jump]);
	});

	it("drops a default that a saved binding already claimed", () => {
		const map = sanitise({ block: ["KeyW"] });
		expect(map.block).toEqual(["KeyW"]);
		expect(map.uppercut).toEqual(["Pad3"]);
	});

	it("refuses duplicates, reserved codes and junk entries", () => {
		const map = sanitise({
			jump: ["KeyW", "KeyW", "Escape", 7, "Space"],
			left: ["Tab"],
		});
		expect(map.jump).toEqual(["KeyW", "Space"]);
		expect(map.left).toEqual([]);
	});

	it("round-trips a live store", () => {
		const b = new KeyBindings();
		b.bind("block", 0, "KeyC");
		const copy = new KeyBindings(
			sanitise(JSON.parse(JSON.stringify(b.snapshot()))),
		);
		expect(copy.snapshot()).toEqual(b.snapshot());
	});
});

describe("codeLabel", () => {
	it("shows a player what they pressed, not what the DOM calls it", () => {
		expect(codeLabel("KeyW")).toBe("W");
		expect(codeLabel("ShiftLeft")).toBe("Left Shift");
		expect(codeLabel("Mouse2")).toBe("Right Click");
		expect(codeLabel("ArrowUp")).toBe("Up Arrow");
		expect(codeLabel("Digit1")).toBe("1");
		expect(codeLabel("Pad0")).toBe("Pad A");
		expect(codeLabel("PadLeft")).toBe("Pad Left");
		// Anything unmapped is shown raw rather than hidden.
		expect(codeLabel("F13")).toBe("F13");
	});
});

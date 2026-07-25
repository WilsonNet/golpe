import Phaser from "phaser";

export const playableControls = {
	up: Phaser.Input.Keyboard.KeyCodes.W,
	left: Phaser.Input.Keyboard.KeyCodes.A,
	down: Phaser.Input.Keyboard.KeyCodes.S,
	right: Phaser.Input.Keyboard.KeyCodes.D,
	switchMelee: Phaser.Input.Keyboard.KeyCodes.Q,
	switchRanged: Phaser.Input.Keyboard.KeyCodes.E,
	/**
	 * Uppercut. On its own key rather than sharing a mouse button with block:
	 * a hold/tap split on right-click would make the two moves ambiguous at
	 * exactly the moment precision matters. See specs/melee.md.
	 */
	uppercut: Phaser.Input.Keyboard.KeyCodes.F,
	space: Phaser.Input.Keyboard.KeyCodes.SPACE,
};

export const debuggableControls = {
	up: Phaser.Input.Keyboard.KeyCodes.NUMPAD_FIVE,
	left: Phaser.Input.Keyboard.KeyCodes.NUMPAD_ONE,
	down: Phaser.Input.Keyboard.KeyCodes.NUMPAD_TWO,
	right: Phaser.Input.Keyboard.KeyCodes.NUMPAD_THREE,
	switchMelee: Phaser.Input.Keyboard.KeyCodes.NUMPAD_SEVEN,
	switchRanged: Phaser.Input.Keyboard.KeyCodes.NUMPAD_EIGHT,
	uppercut: Phaser.Input.Keyboard.KeyCodes.NUMPAD_NINE,
	space: Phaser.Input.Keyboard.KeyCodes.NUMPAD_EIGHT,
};

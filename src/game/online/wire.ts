/**
 * The wire format: how a `PlayerPosition` and a `PlayerIntent` are packed into
 * a snapshot.
 *
 * At two players a snapshot could afford to be the state objects verbatim. At
 * sixteen it cannot: the full JSON of a `PlayerPosition` is ~400 bytes, so
 * sixteen of them at 20Hz is ~128 KB/s downstream *per client* and a single
 * datagram well past any sane MTU. Packed, a fighter is nineteen numbers.
 *
 * Two rules make this safe to have at all:
 *
 * 1. **The field list is checked by the compiler.** `STATE_FIELDS` is asserted
 *    to cover every key of `PlayerPosition`, so adding a field to the simulation
 *    fails to build until it is also on the wire. This is the same guarantee
 *    `PlayerInput extends PlayerIntent` gives the input path, and it exists for
 *    the same reason: a field the server simulates and does not send is a
 *    divergence nothing else can see.
 * 2. **Pack and unpack are inverses, and a test proves it** over randomised
 *    states. A silent asymmetry here would land as unexplained reconciliation
 *    error, which is the hardest kind of bug this project has.
 *
 * Nothing here is lossy for the simulation. The analogue intent axes (`face`,
 * `dash`) are packed as signs because the simulation only ever reads their sign.
 */

import type {
	MeleeAction,
	PlayerIntent,
	PlayerPosition,
	Stance,
	WallSide,
} from "../simulation/Physics.js";

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

const BTN_LEFT = 1 << 0;
const BTN_RIGHT = 1 << 1;
const BTN_UP = 1 << 2;
const BTN_ATTACK = 1 << 3;
const BTN_BLOCK = 1 << 4;
const BTN_UPPERCUT = 1 << 5;
const BTN_SWORD = 1 << 6;
const BTN_FACE_POS = 1 << 7;
const BTN_FACE_NEG = 1 << 8;
const BTN_DASH_POS = 1 << 9;
const BTN_DASH_NEG = 1 << 10;

/** One tick of intent as a single integer. */
export type PackedIntent = number;

export function packIntent(i: PlayerIntent): PackedIntent {
	let b = 0;
	if (i.left) b |= BTN_LEFT;
	if (i.right) b |= BTN_RIGHT;
	if (i.up) b |= BTN_UP;
	if (i.attack) b |= BTN_ATTACK;
	if (i.block) b |= BTN_BLOCK;
	if (i.uppercut) b |= BTN_UPPERCUT;
	if (i.swordStance) b |= BTN_SWORD;
	if (i.face > 0) b |= BTN_FACE_POS;
	else if (i.face < 0) b |= BTN_FACE_NEG;
	if (i.dash > 0) b |= BTN_DASH_POS;
	else if (i.dash < 0) b |= BTN_DASH_NEG;
	return b;
}

export function unpackIntent(b: PackedIntent): PlayerIntent {
	return {
		left: (b & BTN_LEFT) !== 0,
		right: (b & BTN_RIGHT) !== 0,
		up: (b & BTN_UP) !== 0,
		attack: (b & BTN_ATTACK) !== 0,
		block: (b & BTN_BLOCK) !== 0,
		uppercut: (b & BTN_UPPERCUT) !== 0,
		swordStance: (b & BTN_SWORD) !== 0,
		face: (b & BTN_FACE_POS) !== 0 ? 1 : (b & BTN_FACE_NEG) !== 0 ? -1 : 0,
		dash: (b & BTN_DASH_POS) !== 0 ? 1 : (b & BTN_DASH_NEG) !== 0 ? -1 : 0,
	};
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const WALL_SIDES: readonly WallSide[] = ["none", "left", "right"];
const STANCES: readonly Stance[] = ["sword", "gun"];
const MELEE_ACTIONS: readonly MeleeAction[] = [
	"none",
	"slash",
	"uppercut",
	"massive",
];

/**
 * The three encodings, each listing the fields it carries **in wire order**.
 *
 * These are the packer, not a description of it: `packState` and `unpackState`
 * both walk these lists, so a field's slot in the array and its bit in the flag
 * word are derived rather than written down twice. The indices used to be
 * hand-numbered on the unpacking side, which meant inserting one field in the
 * middle silently shifted every field after it — a desync with no symptom except
 * unexplained correction, and the exact mistake adding `dashActiveTimer` invited.
 */
const NUMBER_FIELDS = [
	"x",
	"y",
	"vx",
	"vy",
	"wallJumpTimer",
	"coyoteTimer",
	"jumpBufferTimer",
	"wallCoyoteTimer",
	"dashTimer",
	"dashActiveTimer",
	"airJumps",
	"facing",
	"meleeTimer",
	"blockTimer",
	"chargeTimer",
	"stunTimer",
	"iframeTimer",
] as const;

const ENUM_FIELDS = ["wallTouch", "stance", "meleeAction"] as const;

/** One bit each, in this order. */
const FLAG_FIELDS = [
	"grounded",
	"jumping",
	"jumpHeld",
	"hitLatch",
	"blocking",
	"massiveReady",
	"attackHeld",
	"blockHeld",
	"uppercutHeld",
] as const;

type NumberField = (typeof NUMBER_FIELDS)[number];
type FlagField = (typeof FLAG_FIELDS)[number];

/**
 * Compile-time proof that the three lists cover `PlayerPosition`.
 *
 * Add a field to the simulation and this line stops compiling with the name of
 * the field you forgot, which is the whole point of it existing — and now it can
 * only be satisfied by putting the field in a list that is actually *encoded*,
 * rather than in a parallel roll-call the encoders never read.
 */
type UnpackedField = Exclude<
	keyof PlayerPosition,
	NumberField | (typeof ENUM_FIELDS)[number] | FlagField
>;
const _exhaustive: UnpackedField extends never ? true : UnpackedField = true;
void _exhaustive;

/** Where the enums and the flag word sit, after the numbers. */
const ENUM_BASE = NUMBER_FIELDS.length;
const FLAGS_AT = ENUM_BASE + ENUM_FIELDS.length;

/** A fighter's full simulation state as a flat number array. */
export type PackedState = readonly number[];

export function packState(s: PlayerPosition): number[] {
	const out: number[] = [];
	for (const key of NUMBER_FIELDS) out.push(s[key]);

	out[ENUM_BASE] = WALL_SIDES.indexOf(s.wallTouch);
	out[ENUM_BASE + 1] = STANCES.indexOf(s.stance);
	out[ENUM_BASE + 2] = MELEE_ACTIONS.indexOf(s.meleeAction);

	let flags = 0;
	FLAG_FIELDS.forEach((key, bit) => {
		if (s[key]) flags |= 1 << bit;
	});
	out[FLAGS_AT] = flags;

	return out;
}

export function unpackState(p: PackedState): PlayerPosition {
	const numbers = {} as Record<NumberField, number>;
	NUMBER_FIELDS.forEach((key, i) => {
		numbers[key] = p[i] ?? 0;
	});

	const flagWord = p[FLAGS_AT] ?? 0;
	const flags = {} as Record<FlagField, boolean>;
	FLAG_FIELDS.forEach((key, bit) => {
		flags[key] = (flagWord & (1 << bit)) !== 0;
	});

	return {
		...numbers,
		...flags,
		wallTouch: WALL_SIDES[p[ENUM_BASE] ?? 0] ?? "none",
		stance: STANCES[p[ENUM_BASE + 1] ?? 0] ?? "sword",
		meleeAction: MELEE_ACTIONS[p[ENUM_BASE + 2] ?? 0] ?? "none",
	};
}

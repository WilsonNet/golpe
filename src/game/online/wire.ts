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

const FLAG_GROUNDED = 1 << 0;
const FLAG_JUMPING = 1 << 1;
const FLAG_JUMP_HELD = 1 << 2;
const FLAG_HIT_LATCH = 1 << 3;
const FLAG_BLOCKING = 1 << 4;
const FLAG_MASSIVE_READY = 1 << 5;
const FLAG_ATTACK_HELD = 1 << 6;
const FLAG_BLOCK_HELD = 1 << 7;
const FLAG_UPPERCUT_HELD = 1 << 8;

/**
 * Every field of `PlayerPosition`, exactly once.
 *
 * Order is irrelevant — this list exists so the compiler can prove the packer
 * knows about every field. `_exhaustive` below is the proof.
 */
const STATE_FIELDS = [
	"x",
	"y",
	"vx",
	"vy",
	"grounded",
	"wallTouch",
	"wallJumpTimer",
	"coyoteTimer",
	"jumpBufferTimer",
	"wallCoyoteTimer",
	"jumping",
	"jumpHeld",
	"dashTimer",
	"stance",
	"facing",
	"meleeAction",
	"meleeTimer",
	"hitLatch",
	"blocking",
	"blockTimer",
	"chargeTimer",
	"massiveReady",
	"stunTimer",
	"iframeTimer",
	"attackHeld",
	"blockHeld",
	"uppercutHeld",
] as const;

/**
 * Compile-time proof that `STATE_FIELDS` covers `PlayerPosition`.
 *
 * Add a field to the simulation and this line stops compiling with the name of
 * the field you forgot, which is the whole point of it existing.
 */
type UnpackedField = Exclude<
	keyof PlayerPosition,
	(typeof STATE_FIELDS)[number]
>;
const _exhaustive: UnpackedField extends never ? true : UnpackedField = true;
void _exhaustive;

/** A fighter's full simulation state as a flat number array. */
export type PackedState = readonly number[];

export function packState(s: PlayerPosition): number[] {
	let flags = 0;
	if (s.grounded) flags |= FLAG_GROUNDED;
	if (s.jumping) flags |= FLAG_JUMPING;
	if (s.jumpHeld) flags |= FLAG_JUMP_HELD;
	if (s.hitLatch) flags |= FLAG_HIT_LATCH;
	if (s.blocking) flags |= FLAG_BLOCKING;
	if (s.massiveReady) flags |= FLAG_MASSIVE_READY;
	if (s.attackHeld) flags |= FLAG_ATTACK_HELD;
	if (s.blockHeld) flags |= FLAG_BLOCK_HELD;
	if (s.uppercutHeld) flags |= FLAG_UPPERCUT_HELD;

	return [
		s.x,
		s.y,
		s.vx,
		s.vy,
		s.wallJumpTimer,
		s.coyoteTimer,
		s.jumpBufferTimer,
		s.wallCoyoteTimer,
		s.dashTimer,
		s.facing,
		s.meleeTimer,
		s.blockTimer,
		s.chargeTimer,
		s.stunTimer,
		s.iframeTimer,
		WALL_SIDES.indexOf(s.wallTouch),
		STANCES.indexOf(s.stance),
		MELEE_ACTIONS.indexOf(s.meleeAction),
		flags,
	];
}

export function unpackState(p: PackedState): PlayerPosition {
	const at = (i: number) => p[i] ?? 0;
	const flags = at(18);
	return {
		x: at(0),
		y: at(1),
		vx: at(2),
		vy: at(3),
		wallJumpTimer: at(4),
		coyoteTimer: at(5),
		jumpBufferTimer: at(6),
		wallCoyoteTimer: at(7),
		dashTimer: at(8),
		facing: at(9),
		meleeTimer: at(10),
		blockTimer: at(11),
		chargeTimer: at(12),
		stunTimer: at(13),
		iframeTimer: at(14),
		wallTouch: WALL_SIDES[at(15)] ?? "none",
		stance: STANCES[at(16)] ?? "sword",
		meleeAction: MELEE_ACTIONS[at(17)] ?? "none",
		grounded: (flags & FLAG_GROUNDED) !== 0,
		jumping: (flags & FLAG_JUMPING) !== 0,
		jumpHeld: (flags & FLAG_JUMP_HELD) !== 0,
		hitLatch: (flags & FLAG_HIT_LATCH) !== 0,
		blocking: (flags & FLAG_BLOCKING) !== 0,
		massiveReady: (flags & FLAG_MASSIVE_READY) !== 0,
		attackHeld: (flags & FLAG_ATTACK_HELD) !== 0,
		blockHeld: (flags & FLAG_BLOCK_HELD) !== 0,
		uppercutHeld: (flags & FLAG_UPPERCUT_HELD) !== 0,
	};
}

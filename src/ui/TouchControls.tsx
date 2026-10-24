/**
 * The on-screen deck: a **two-thumb** control surface, not a gamepad painted on
 * glass.
 *
 * The old deck gave one thumb six controls — aim, slash, jump, block, uppercut,
 * item — and the other thumb movement plus the stance pills. Every signature
 * technique in the game is a pair of simultaneous actions, so the layout made
 * most of them physically impossible: the butterfly (guard + attack), a charged
 * Massive + jump (the plunge bomb), charge + guard, and retreat-fire all needed
 * one thumb in two places. The diagnosis is not "the buttons are small"; it is
 * "the hands were assigned console conventions instead of jobs."
 *
 * **The split is by hand, and it is the desktop split.**
 *
 * - **Left hand — feet and defence.** A one-axis move rocker with a **jump cap**
 *   (push up to jump, horizontal position still steers), **Guard** (held, on
 *   the thumb's other reach so the right thumb never leaves the weapon), and
 *   **Dash** (an explicit one-shot; the double-tap remains an alias).
 * - **Right hand — weapon and aim.** The **weapon button** is the thumb's home:
 *   tap to slash or fire, hold to charge or shoot, and in gun stance drag it to
 *   aim. Around it: **Uppercut**, **Item** (press-drag-release), **Ultimate**
 *   (hold to arm, drag to aim, release to cast), and the **stance** switch.
 *
 * The hard consequences, decided deliberately:
 *
 * - **Guard is on the left thumb**, opposite the attack thumb, because that is
 *   the only way the butterfly can exist. It is a *hold*, not a toggle: the
 *   simulation re-raises a held guard after your own swing, and a toggle would
 *   turn the block-cancel press into an off-switch.
 * - **The move pad is a rocker, not a 360 stick.** Movement is left/right; the
 *   vertical axis is the jump cap, not an aim axis. The sword only consumes the
 *   *sign* of the aim, so melee facing comes from the feet; the gun and the
 *   throwables aim from the button that fires or throws them.
 * - **A tap jump is a full jump.** The deck holds the jump action for
 *   `JUMP_MIN_HOLD_MS` after the thumb leaves, because the simulation cuts a
 *   jump on release and a 70ms phone tap made every phone jump a half-hop.
 * - **The ultimate does not appear out of nowhere.** It is always drawn with
 *   its charge ring; a 260ms hold arms it, so a brush neither spends a minute of
 *   charge nor starts a drag the player did not mean.
 *
 * The deck emits **actions**, not pad codes — a painted control is already a
 * binding, and a rebind must not silently change what a labelled button does.
 * See `Deck.ts`. Nothing here knows about the simulation; every button is
 * either held state or a press edge the simulation already understands, so none
 * of this can desync.
 */

import {
	type CSSProperties,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { EventBus } from "../game/EventBus";
import { HUD_EVENTS, type HudState } from "../game/hud";
import type { Action } from "../game/input/Bindings";
import {
	AIM_DRAG_RADIUS_PX,
	DECK_EVENTS,
	DRAG_DEADZONE,
	dragVector,
	ITEM_PULSE_MS,
	inJumpBand,
	JUMP_MIN_HOLD_MS,
	moveDirection,
	ULT_ARM_MS,
} from "../game/input/Deck";
import {
	deckVisibleFor,
	inputSettings,
	isTouchPrimary,
} from "../game/input/Scheme";
import { kitFor } from "../game/simulation/Heroes";
import { fadedHandFor } from "./deckFade";
import { DECK_CSS } from "./deckStyles";
import { ULTIMATE_CARDS } from "./ultimateCards";

/** Every action the deck can hold, in one place for a clean release. */
const DECK_ACTIONS: readonly Action[] = [
	"left",
	"right",
	"jump",
	"attack",
	"block",
	"uppercut",
	"item",
	"ultimate",
	"sword",
	"gun",
];

const action = (name: Action, down: boolean) =>
	EventBus.emit(DECK_EVENTS.action, { action: name, down });

/**
 * The fine aim has **one owner at a time**.
 *
 * A gun drag, an item throw and an ultimate cast all write the same absolute
 * aim channel, and two of them clear it on a timer. Without an owner, casting an
 * ultimate and then starting a gun drag 100ms later let the *ultimate's* release
 * timer wipe the gun's live aim. Each control carries an opaque token; a null
 * only clears the channel if its own token still owns it.
 */
let deckAimOwner: object | null = null;

interface AimVec {
	x: number;
	y: number;
}

function emitAim(owner: object, vector: AimVec | null) {
	if (vector) {
		deckAimOwner = owner;
		EventBus.emit("virtual-aim", vector);
		return;
	}
	if (deckAimOwner !== owner) return;
	deckAimOwner = null;
	EventBus.emit("virtual-aim", null);
}

function releaseAllAims() {
	deckAimOwner = null;
	EventBus.emit("virtual-aim", null);
}

/** Anything held has to be released, or the fighter swings at nothing forever. */
function releaseDeck() {
	for (const name of DECK_ACTIONS) action(name, false);
	releaseAllAims();
}

function haptic(pattern: number | number[]) {
	if (typeof navigator === "undefined" || !navigator.vibrate) return;
	try {
		navigator.vibrate(pattern);
	} catch {
		/* A browser that refuses is not a reason to break a press. */
	}
}

const COACH_KEY = "golpe.deck.coach";

function coachSeen(): boolean {
	try {
		return window.localStorage.getItem(COACH_KEY) === "seen";
	} catch {
		// Private browsing: showing the coach once more is a far better failure
		// than silently hiding it.
		return false;
	}
}

function markCoachSeen() {
	try {
		window.localStorage.setItem(COACH_KEY, "seen");
	} catch {
		/* not fatal — see coachSeen */
	}
}

/** The training room and the tutorial already have a panel and a lesson card. */
function coachSuppressed(): boolean {
	if (typeof window === "undefined") return false;
	const params = new URLSearchParams(window.location.search);
	return (
		params.get("training") === "true" ||
		params.get("training-room") === "true" ||
		params.get("tutorial") === "true"
	);
}

/**
 * A test hook for safe areas.
 *
 * Playwright cannot set `env(safe-area-inset-*)`, so a probe that wants to
 * prove the controls clear a notch needs a way to say where the notch is.
 * `?safe=top,right,bottom,left` in CSS pixels. Absent in normal play, where the
 * stylesheet's `env()` values are the only source of truth.
 */
function safeAreaStyle(): CSSProperties | undefined {
	if (typeof window === "undefined") return undefined;
	const raw = new URLSearchParams(window.location.search).get("safe");
	if (!raw) return undefined;
	const parts = raw.split(",").map(Number);
	if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
		return undefined;
	}
	const [top, right, bottom, left] = parts as [number, number, number, number];
	return {
		"--safe-t": `${Math.max(0, top)}px`,
		"--safe-r": `${Math.max(0, right)}px`,
		"--safe-b": `${Math.max(0, bottom)}px`,
		"--safe-l": `${Math.max(0, left)}px`,
	} as CSSProperties;
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

interface ButtonFaceProps {
	/** Stable name for probes and for the CSS. */
	name: string;
	label: ReactNode;
	title: string;
	className?: string;
	/** A number from 0 to 1 draws a conic progress ring; omitted draws none. */
	ring?: number;
	/** A state owned by the simulation, not by the finger (guard, stance, ready). */
	on?: boolean;
	/** True for a two-state control (a stance segment), so ARIA says "toggle". */
	toggle?: boolean;
	disabled?: boolean;
	children?: ReactNode;
}

/**
 * The look and the pointer plumbing shared by every deck button.
 *
 * `setPointerCapture` is what makes several controls work at once: without it a
 * second finger landing elsewhere re-targets the first one's events and the
 * button it left never sees its release. Capture also means a thumb that slides
 * off a control keeps holding it, which is what a held guard should do.
 */
function ButtonFace({
	name,
	label,
	title,
	className = "",
	ring,
	on = false,
	toggle = false,
	disabled = false,
	children,
	onDown,
	onUp,
}: ButtonFaceProps & {
	onDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
	onUp: (e: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
	const [held, setHeld] = useState(false);
	const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
		if (disabled) return;
		e.preventDefault();
		e.stopPropagation();
		e.currentTarget.setPointerCapture(e.pointerId);
		setHeld(true);
		onDown(e);
	};
	const up = (e: ReactPointerEvent<HTMLButtonElement>) => {
		if (disabled) return;
		e.preventDefault();
		if (held) setHeld(false);
		onUp(e);
	};
	return (
		<button
			type="button"
			data-deck={name}
			aria-label={title}
			aria-pressed={toggle ? on : undefined}
			title={title}
			disabled={disabled}
			className={`gg-control ${className}${held ? " held" : ""}${on ? " on" : ""}${disabled ? " disabled" : ""}`}
			onPointerDown={down}
			onPointerUp={up}
			onPointerCancel={up}
			onLostPointerCapture={() => {
				setHeld(false);
				// A lost capture is not a completed press, but the release still
				// has to be delivered or the code stays down forever.
				const fake = {
					preventDefault() {},
				} as ReactPointerEvent<HTMLButtonElement>;
				onUp(fake);
			}}
			onContextMenu={(e) => e.preventDefault()}
		>
			{ring !== undefined && (
				<span
					className="gg-ring"
					style={
						{
							"--v": Math.max(0, Math.min(1, ring)),
						} as CSSProperties
					}
				/>
			)}
			<span className="gg-label">{label}</span>
			{children}
		</button>
	);
}

// ---------------------------------------------------------------------------
// The left hand: a move rocker with a jump cap
// ---------------------------------------------------------------------------

/**
 * The move pad: one horizontal rocker and a jump cap.
 *
 * A thumb on the pad reads its offset from the pad's **centre**, not from where
 * it landed, so the direction is a place on the control rather than a distance
 * from an arbitrary touch. The top band is jump: a thumb pushed 44px up jumps
 * while its horizontal position keeps steering, so a running jump is one thumb
 * movement. There is no vertical aim here on purpose — see the module comment.
 */
function MovePad({
	onMove,
	onJump,
}: {
	onMove: (direction: -1 | 0 | 1) => void;
	onJump: (down: boolean) => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const onJumpRef = useRef(onJump);
	onJumpRef.current = onJump;
	const [nub, setNub] = useState<{ x: number; y: number } | null>(null);
	const [dir, setDir] = useState<-1 | 0 | 1>(0);
	const [jumping, setJumping] = useState(false);
	const dirRef = useRef<-1 | 0 | 1>(0);
	const jumpRef = useRef(false);
	const jumpDownAt = useRef(0);
	const jumpRelease = useRef<number | null>(null);
	/** A re-press inside the latch, held a couple of frames so the edge lands. */
	const jumpRepress = useRef<number | null>(null);
	/** Is the thumb in the band right now? The repress timer needs to know. */
	const inBandRef = useRef(false);

	const jumpUp = () => {
		if (!jumpRef.current) return;
		jumpRef.current = false;
		setJumping(false);
		onJump(false);
	};

	/** Release the jump, but let a tap live long enough to be a full jump. */
	const requestJumpUp = () => {
		if (!jumpRef.current) return;
		if (jumpRelease.current !== null) return;
		const heldFor = performance.now() - jumpDownAt.current;
		const wait = JUMP_MIN_HOLD_MS - heldFor;
		if (wait <= 0) {
			jumpUp();
			return;
		}
		jumpRelease.current = window.setTimeout(() => {
			jumpRelease.current = null;
			jumpUp();
		}, wait);
	};

	const setJump = (next: boolean) => {
		inBandRef.current = next;
		if (next && jumpRef.current) {
			if (jumpRelease.current === null) return;
			// **A second tap inside the latch is a double jump, not a no-op.**
			// The latch keeps the action down to make a tap a full jump; a re-press
			// while it is pending therefore has to flush the release and start a new
			// press, or the natural 100-250ms double-tap rhythm is swallowed whole.
			// The re-press is deferred past a couple of fixed steps so the
			// simulation actually sees the release edge — a false/true in the same
			// JS task is one held button, and a held jump is not a double jump.
			window.clearTimeout(jumpRelease.current);
			jumpRelease.current = null;
			jumpRef.current = false;
			setJumping(false);
			onJump(false);
			if (jumpRepress.current !== null)
				window.clearTimeout(jumpRepress.current);
			jumpRepress.current = window.setTimeout(() => {
				jumpRepress.current = null;
				jumpRef.current = true;
				jumpDownAt.current = performance.now();
				setJumping(true);
				onJump(true);
				// The thumb may already be up (a tap shorter than the repress
				// window). Press and release, or the action stays held forever
				// and the *next* jump is a no-op.
				if (!inBandRef.current) requestJumpUp();
			}, 45);
			return;
		}
		if (next === jumpRef.current) return;
		if (next) {
			if (jumpRepress.current !== null) {
				window.clearTimeout(jumpRepress.current);
				jumpRepress.current = null;
			}
			if (jumpRelease.current !== null) {
				window.clearTimeout(jumpRelease.current);
				jumpRelease.current = null;
			}
			jumpRef.current = true;
			jumpDownAt.current = performance.now();
			setJumping(true);
			onJump(true);
		} else {
			requestJumpUp();
		}
	};

	const track = (e: ReactPointerEvent) => {
		const el = ref.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const dx = e.clientX - (rect.left + rect.width / 2);
		const dy = e.clientY - (rect.top + rect.height / 2);
		const next = moveDirection(dx, dirRef.current);
		if (next !== dirRef.current) {
			dirRef.current = next;
			setDir(next);
			onMove(next);
		}
		setJump(inJumpBand(dy, rect.height));
		setNub({
			x: Math.max(-1, Math.min(1, dx / (rect.width / 2))),
			y: Math.max(-1, Math.min(1, dy / (rect.height / 2))),
		});
	};

	const down = (e: ReactPointerEvent) => {
		e.preventDefault();
		e.stopPropagation();
		e.currentTarget.setPointerCapture(e.pointerId);
		track(e);
	};
	const move = (e: ReactPointerEvent) => {
		if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
		track(e);
	};
	const release = (e: ReactPointerEvent) => {
		e.preventDefault();
		inBandRef.current = false;
		if (dirRef.current !== 0) {
			dirRef.current = 0;
			setDir(0);
			onMove(0);
		}
		setNub(null);
		requestJumpUp();
	};

	useEffect(() => {
		return () => {
			if (jumpRelease.current !== null) {
				window.clearTimeout(jumpRelease.current);
				jumpRelease.current = null;
			}
			if (jumpRepress.current !== null) {
				window.clearTimeout(jumpRepress.current);
				jumpRepress.current = null;
			}
			if (jumpRef.current) {
				jumpRef.current = false;
				onJumpRef.current(false);
			}
		};
	}, []);

	return (
		// biome-ignore lint/a11y/useSemanticElements: a move pad is one analog surface, not a form group.
		<div
			ref={ref}
			className={`gg-move${nub ? " live" : ""}${jumping ? " jumping" : ""}${dir < 0 ? " left" : dir > 0 ? " right" : ""}`}
			data-deck="move"
			role="group"
			aria-label="Move. Push up to jump."
			onPointerDown={down}
			onPointerMove={move}
			onPointerUp={release}
			onPointerCancel={release}
			onLostPointerCapture={release}
		>
			<div className="gg-move-jump" data-deck="jump">
				<span>Jump</span>
			</div>
			<div className="gg-move-stem">
				<span className="gg-move-arrow gg-move-left">‹</span>
				<span className="gg-move-arrow gg-move-right">›</span>
			</div>
			<div
				className="gg-move-nub"
				style={
					nub
						? { transform: `translate(${nub.x * 34}%, ${nub.y * 34}%)` }
						: undefined
				}
			/>
			<div className="gg-move-caption">Move</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// The right hand: weapon, aim, and the kit around it
// ---------------------------------------------------------------------------

/**
 * The weapon button.
 *
 * In sword stance it is a slash: tap repeatedly for the chain, hold for the
 * Massive. In gun stance it is a **twin-stick trigger**: press to fire, drag to
 * aim, release to stop. That is the only way a two-thumb player can run one way
 * and shoot the other, and it keeps the gun's aim on the thumb that is already
 * pulling the trigger rather than on the thumb that is walking.
 */
function WeaponButton({
	kit,
	stance,
	charge,
	throwCharge,
	ammo,
	reserve,
	reload,
	massiveReady,
}: {
	kit: ReturnType<typeof kitFor>;
	stance: "sword" | "gun";
	charge: number;
	throwCharge: number;
	ammo: number;
	reserve: number;
	reload: number;
	massiveReady: boolean;
}) {
	const ref = useRef<HTMLButtonElement>(null);
	const [held, setHeld] = useState(false);
	const heldRef = useRef(false);
	const [nub, setNub] = useState<{ x: number; y: number } | null>(null);
	/** The aim is a drag from where the thumb landed, not from the button's centre. */
	const origin = useRef<{ x: number; y: number } | null>(null);
	const aimOwner = useRef<object>({});
	const gun = stance === "gun";
	const thrown = kit.ranged.thrown === true;

	const meleeLabel =
		kit.melee.id === "dagger"
			? "Stab"
			: kit.melee.id === "viking"
				? "Hew"
				: "Slash";
	const chargeName = kit.melee.chargeMove === "sunder" ? "Sunder" : "Massive";
	const weaponLabel = gun ? (thrown ? "Throw" : "Fire") : meleeLabel;
	const ring = gun
		? thrown
			? throwCharge
			: Math.max(0, Math.min(1, reload))
		: charge;

	const aim = (e: ReactPointerEvent<HTMLButtonElement>) => {
		const from = origin.current;
		if (!from || !gun) return;
		const v = dragVector(
			e.clientX - from.x,
			e.clientY - from.y,
			AIM_DRAG_RADIUS_PX,
		);
		if (v.magnitude < DRAG_DEADZONE) {
			setNub(null);
			emitAim(aimOwner.current, null);
			return;
		}
		setNub({ x: v.x, y: v.y });
		emitAim(aimOwner.current, { x: v.x, y: v.y });
	};

	const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();
		e.currentTarget.setPointerCapture(e.pointerId);
		origin.current = { x: e.clientX, y: e.clientY };
		aimOwner.current = {};
		heldRef.current = true;
		setHeld(true);
		action("attack", true);
		aim(e);
	};
	const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
		if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
		aim(e);
	};
	const release = () => {
		if (!heldRef.current) return;
		heldRef.current = false;
		setHeld(false);
		action("attack", false);
		origin.current = null;
		setNub(null);
		emitAim(aimOwner.current, null);
	};
	const up = (e: ReactPointerEvent<HTMLButtonElement>) => {
		e.preventDefault();
		release();
	};

	// A stance change during a hold must not leave the gun's fine aim driving
	// the sword's facing. The attack stays held — the simulation decides what
	// the new stance's button does — but the aim reverts to the feet.
	useEffect(() => {
		if (!gun) {
			origin.current = null;
			setNub(null);
			emitAim(aimOwner.current, null);
		}
	}, [gun]);

	const title = gun
		? thrown
			? `Throw axe — hold to charge, release to throw. ${ammo} left.`
			: `Fire — press and drag to aim. ${ammo}/${reserve} rounds.`
		: kit.melee.hasCharge
			? massiveReady
				? `${chargeName} armed — release`
				: `${meleeLabel} — hold for the ${chargeName}`
			: kit.melee.chain
				? `${meleeLabel} — three-tap chain`
				: `${meleeLabel}`;
	const hint = gun
		? thrown
			? throwCharge > 0.02
				? "Release"
				: "Hold"
			: null
		: massiveReady
			? "Release"
			: charge > 0.02
				? "Hold"
				: kit.melee.chain
					? "Tap ×3"
					: "Tap";

	return (
		<button
			ref={ref}
			type="button"
			data-deck="attack"
			aria-label={title}
			title={title}
			className={`gg-control gg-attack${held ? " held" : ""}${gun ? " gun" : ""}${massiveReady ? " ready" : ""}`}
			onPointerDown={down}
			onPointerMove={move}
			onPointerUp={up}
			onPointerCancel={up}
			onLostPointerCapture={release}
			onContextMenu={(e) => e.preventDefault()}
		>
			<span className="gg-ring" style={{ "--v": ring } as CSSProperties} />
			<span className="gg-label">{weaponLabel}</span>
			{gun && (
				<span className="gg-ammo">
					{ammo}
					{!thrown && <span className="gg-ammo-reserve">/{reserve}</span>}
				</span>
			)}
			{nub && (
				<span
					className="gg-aim-dot"
					style={{
						transform: `translate(${nub.x * 38}px, ${nub.y * 38}px)`,
					}}
				/>
			)}
			{hint && (
				<span className={`gg-charge-hint${gun ? " gun" : ""}`}>{hint}</span>
			)}
		</button>
	);
}

/** A kit's item in the few characters that fit a thumb button. */
function shortItemLabel(label: string): string {
	const upper = label.toUpperCase();
	if (upper.includes("HE")) return "Nade";
	if (upper.includes("SMOKE")) return "Smoke";
	if (upper.includes("TRAP")) return "Trap";
	return "Item";
}

/**
 * The item: press, drag to aim, release to throw.
 *
 * The server uses the item on the **press** edge with the press's angle, so the
 * deck withholds the press until the thumb comes up and holds it for a few
 * frames. A tap therefore throws at the facing, and a drag throws at the drag —
 * with the left thumb still free to move. The fine aim's handover is 260ms, so
 * the 90ms pulse has to be inside it.
 */
function ItemButton({
	charges,
	enabled,
	label,
}: {
	charges: number;
	enabled: boolean;
	label: string;
}) {
	const ref = useRef<HTMLButtonElement>(null);
	const [held, setHeld] = useState(false);
	const heldRef = useRef(false);
	const [nub, setNub] = useState<{ x: number; y: number } | null>(null);
	const timer = useRef<number | null>(null);
	const origin = useRef<{ x: number; y: number } | null>(null);
	const aimOwner = useRef<object>({});

	const aim = (e: ReactPointerEvent<HTMLButtonElement>) => {
		const from = origin.current;
		if (!from) return;
		const v = dragVector(
			e.clientX - from.x,
			e.clientY - from.y,
			AIM_DRAG_RADIUS_PX,
		);
		if (v.magnitude < DRAG_DEADZONE) {
			setNub(null);
			emitAim(aimOwner.current, null);
			return;
		}
		setNub({ x: v.x, y: v.y });
		emitAim(aimOwner.current, { x: v.x, y: v.y });
	};

	const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
		if (!enabled) return;
		e.preventDefault();
		e.stopPropagation();
		e.currentTarget.setPointerCapture(e.pointerId);
		origin.current = { x: e.clientX, y: e.clientY };
		aimOwner.current = {};
		heldRef.current = true;
		setHeld(true);
		aim(e);
	};
	const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
		if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
		aim(e);
	};
	const up = (e: ReactPointerEvent<HTMLButtonElement>) => {
		e.preventDefault();
		if (!heldRef.current || !enabled) return;
		heldRef.current = false;
		setHeld(false);
		setNub(null);
		// The aim at this instant is the throw; the press is delivered now and
		// held for a few frames so the server cannot miss it. The fine aim
		// survives the release for 900ms, so the angle is still there when the
		// server samples it.
		action("item", true);
		if (timer.current !== null) window.clearTimeout(timer.current);
		const owner = aimOwner.current;
		timer.current = window.setTimeout(() => {
			timer.current = null;
			action("item", false);
			emitAim(owner, null);
		}, ITEM_PULSE_MS);
	};

	/** A cancelled touch is not a throw. The item is a finite resource. */
	const cancel = () => {
		if (!heldRef.current) return;
		heldRef.current = false;
		setHeld(false);
		setNub(null);
		origin.current = null;
		emitAim(aimOwner.current, null);
	};

	useEffect(
		() => () => {
			if (timer.current !== null) {
				window.clearTimeout(timer.current);
				timer.current = null;
				action("item", false);
			}
			emitAim(aimOwner.current, null);
		},
		[],
	);

	return (
		<button
			ref={ref}
			type="button"
			data-deck="item"
			aria-label={`${label} — ${charges} left. Drag to aim.`}
			title={`${label} — ${charges} left. Drag to aim.`}
			disabled={!enabled}
			className={`gg-control gg-item${held ? " held" : ""}${enabled ? "" : " disabled"}`}
			onPointerDown={down}
			onPointerMove={move}
			onPointerUp={up}
			onPointerCancel={cancel}
			onLostPointerCapture={cancel}
			onContextMenu={(e) => e.preventDefault()}
		>
			<span className="gg-item-count">{charges}</span>
			<span className="gg-label">{shortItemLabel(label)}</span>
			{nub && (
				<span
					className="gg-aim-dot"
					style={{
						transform: `translate(${nub.x * 28}px, ${nub.y * 28}px)`,
					}}
				/>
			)}
		</button>
	);
}

/**
 * The ultimate: hold to arm, drag to aim, release to cast.
 *
 * The server tracks the aim angle for the whole hold and casts on the release
 * edge, so a press-drag-release is exactly the mechanic rather than a phone
 * compromise. The 260ms arm delay is what stops a brush of the thumb spending
 * a minute of charge — and the button is always drawn, with its ring, so its
 * place is learned before the one moment it matters.
 */
function UltButton({
	charge,
	ready,
	name,
}: {
	charge: number;
	ready: boolean;
	name: string;
}) {
	const ref = useRef<HTMLButtonElement>(null);
	const [held, setHeld] = useState(false);
	const heldRef = useRef(false);
	const [armed, setArmed] = useState(false);
	const [nub, setNub] = useState<{ x: number; y: number } | null>(null);
	const armTimer = useRef<number | null>(null);
	const aimReleaseTimer = useRef<number | null>(null);
	const armedRef = useRef(false);
	const lastAim = useRef<{ x: number; y: number } | null>(null);
	const origin = useRef<{ x: number; y: number } | null>(null);
	const aimOwner = useRef<object>({});

	/**
	 * Let the release angle live through the cast tick.
	 *
	 * The server casts on the *release* edge and reads the aim angle of that
	 * tick. Clearing the fine aim in the same event that releases the button
	 * would start the 260ms ease-out before the cast is judged; 140ms is several
	 * frames of exact angle and then the ordinary handover.
	 */
	const releaseAimSoon = () => {
		if (aimReleaseTimer.current !== null) {
			window.clearTimeout(aimReleaseTimer.current);
		}
		const owner = aimOwner.current;
		aimReleaseTimer.current = window.setTimeout(() => {
			aimReleaseTimer.current = null;
			emitAim(owner, null);
		}, 140);
	};

	const aim = (e: ReactPointerEvent<HTMLButtonElement>) => {
		const from = origin.current;
		if (!from) return;
		const v = dragVector(
			e.clientX - from.x,
			e.clientY - from.y,
			AIM_DRAG_RADIUS_PX,
		);
		if (v.magnitude < DRAG_DEADZONE) {
			lastAim.current = null;
			setNub(null);
			emitAim(aimOwner.current, null);
			return;
		}
		lastAim.current = { x: v.x, y: v.y };
		setNub({ x: v.x, y: v.y });
		if (armedRef.current) {
			emitAim(aimOwner.current, { x: v.x, y: v.y });
		}
	};

	const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
		if (!ready) return;
		e.preventDefault();
		e.stopPropagation();
		e.currentTarget.setPointerCapture(e.pointerId);
		if (aimReleaseTimer.current !== null) {
			window.clearTimeout(aimReleaseTimer.current);
			aimReleaseTimer.current = null;
		}
		origin.current = { x: e.clientX, y: e.clientY };
		aimOwner.current = {};
		heldRef.current = true;
		setHeld(true);
		aim(e);
		armTimer.current = window.setTimeout(() => {
			armTimer.current = null;
			armedRef.current = true;
			setArmed(true);
			action("ultimate", true);
			if (lastAim.current) {
				emitAim(aimOwner.current, lastAim.current);
			}
			haptic(12);
		}, ULT_ARM_MS);
	};
	const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
		if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
		aim(e);
	};
	const up = (e: ReactPointerEvent<HTMLButtonElement>) => {
		e.preventDefault();
		if (!heldRef.current) return;
		heldRef.current = false;
		setHeld(false);
		if (armTimer.current !== null) {
			window.clearTimeout(armTimer.current);
			armTimer.current = null;
		}
		if (!armedRef.current) {
			origin.current = null;
			setNub(null);
			emitAim(aimOwner.current, null);
			return;
		}
		armedRef.current = false;
		setArmed(false);
		action("ultimate", false);
		releaseAimSoon();
		origin.current = null;
		setNub(null);
		haptic(20);
	};

	/**
	 * A cancelled touch is not a deliberate release.
	 *
	 * The ultimate casts on the server's release edge, so emitting `ultimate`
	 * false here would spend a minute of charge on an OS gesture. Keep the
	 * server's hold and the button armed: the next press can re-aim and release
	 * to cast. (There is no cancel gesture on the wire; this is the least
	 * destructive one.)
	 */
	const cancel = () => {
		if (!heldRef.current) return;
		heldRef.current = false;
		setHeld(false);
		if (armTimer.current !== null) {
			window.clearTimeout(armTimer.current);
			armTimer.current = null;
		}
		origin.current = null;
		setNub(null);
		emitAim(aimOwner.current, null);
		// Keep `armedRef` / `armed` true: the server still holds the button.
	};

	useEffect(
		() => () => {
			if (armTimer.current !== null) {
				window.clearTimeout(armTimer.current);
				armTimer.current = null;
			}
			if (armedRef.current) {
				armedRef.current = false;
				action("ultimate", false);
			}
			if (aimReleaseTimer.current !== null) {
				window.clearTimeout(aimReleaseTimer.current);
				aimReleaseTimer.current = null;
			}
			emitAim(aimOwner.current, null);
		},
		[],
	);

	return (
		<button
			ref={ref}
			type="button"
			data-deck="ult"
			aria-disabled={!ready}
			aria-label={`Ultimate — ${name}. ${ready ? "Ready: hold, drag to aim, release." : `Charging, ${Math.round(charge * 100)} percent.`}`}
			title={`Ultimate — ${name}${ready ? " — hold, drag, release" : ` — ${Math.round(charge * 100)}%`}`}
			className={`gg-control gg-ult${held ? " held" : ""}${armed ? " armed" : ""}${ready ? " ready" : ""}`}
			onPointerDown={down}
			onPointerMove={move}
			onPointerUp={up}
			onPointerCancel={cancel}
			onLostPointerCapture={() => {
				if (heldRef.current) cancel();
			}}
			onContextMenu={(e) => e.preventDefault()}
		>
			<span
				className="gg-ring"
				style={{ "--v": Math.max(0, Math.min(1, charge)) } as CSSProperties}
			/>
			<span className="gg-label">Ult</span>
			<span className="gg-ult-pct">{Math.round(charge * 100)}</span>
			{nub && (
				<span
					className="gg-aim-dot"
					style={{
						transform: `translate(${nub.x * 26}px, ${nub.y * 26}px)`,
					}}
				/>
			)}
		</button>
	);
}

/** The stance switch: two segments, the active one lit. */
function StanceSwitch({
	stance,
	gunLabel,
	gunDisabled,
}: {
	stance: "sword" | "gun";
	gunLabel: string;
	gunDisabled: boolean;
}) {
	const segment = (which: "sword" | "gun", label: string, disabled = false) => (
		<ButtonFace
			name={`stance-${which}`}
			label={label}
			title={`Switch to ${label}`}
			className="gg-stance-seg"
			on={stance === which}
			toggle
			disabled={disabled}
			onDown={() => action(which, true)}
			onUp={() => action(which, false)}
		/>
	);
	return (
		// biome-ignore lint/a11y/useSemanticElements: two buttons and a label; a fieldset's chrome is not wanted over the arena.
		<div className="gg-stance" role="group" aria-label="Weapon stance">
			{segment("sword", "Sword")}
			{segment("gun", gunLabel, gunDisabled)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// The deck
// ---------------------------------------------------------------------------

/**
 * The only way off the deck on a phone.
 *
 * Open on the pointerup, then open the menu a tick later: `click` is not
 * synthesised while another touch is down, so a thumb holding Guard could not
 * pause, and opening on `pointerdown` let the compatibility click land on the
 * card that had just mounted under the finger — in portrait, that was Heroes.
 * It is rendered by the bare deck too, because turning the deck off must not
 * take the only menu away from a phone.
 */
function DeckMenu() {
	/**
	 * Open on a short delay after the finger lifts.
	 *
	 * `click` is not synthesised while another touch is still down, so a thumb
	 * holding Guard could not pause. `pointerdown` opened the menu before the
	 * compatibility click, and that click landed on the card that had just
	 * mounted under the finger. `pointerup` plus a tick lets the click land on
	 * the Menu pill, then opens the menu after it.
	 */
	const open = (e: ReactPointerEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();
		window.setTimeout(() => EventBus.emit("menu-toggle"), 50);
	};
	return (
		<button
			type="button"
			className="gg-menu"
			data-deck="menu"
			aria-label="Menu"
			onPointerUp={open}
			onClick={(e) => {
				// Keyboard activation only: a real mouse/touch click is detail 1
				// and would open a second menu on top of the first.
				if (e.detail !== 0) return;
				e.preventDefault();
				e.stopPropagation();
				EventBus.emit("menu-toggle");
			}}
		>
			Menu
		</button>
	);
}

export function TouchControls() {
	// The stores are deliberately not React state — `Input` reads them every
	// frame from outside React entirely — so the deck snapshots them and
	// resubscribes. The indirection is what the React Compiler needs: it
	// memoises on the values a render reads, and a gate that read
	// `deckVisible` straight off the store would freeze at mount.
	const [settings, setSettings] = useState(() => inputSettings.snapshot());
	const [touch, setTouch] = useState(isTouchPrimary);
	const [hud, setHud] = useState<HudState | null>(null);
	const [coach, setCoach] = useState(() => !coachSuppressed() && !coachSeen());
	/**
	 * Bumped whenever input is suspended. The deck's key remounts its buttons,
	 * which is the only reliable way to reset a pressed state whose pointerup was
	 * eaten by the menu that just opened — and to drop captures the veil now owns.
	 */
	const [epoch, setEpoch] = useState(0);
	const [suspended, setSuspended] = useState(false);
	// Asked once per render from the snapshot, never from the live store: the
	// React Compiler memoises on the values a render reads.
	const deckVisible = deckVisibleFor(settings, touch);

	useEffect(
		() => inputSettings.subscribe(() => setSettings(inputSettings.snapshot())),
		[],
	);
	useEffect(() => {
		const off = EventBus.on(HUD_EVENTS.state, ((next: HudState) =>
			setHud(next)) as never);
		return off;
	}, []);

	// A tablet that gets a mouse plugged in, or a phone rotated into a mode the
	// media query answers differently. Re-asked rather than latched at mount.
	useEffect(() => {
		if (!window.matchMedia) return;
		const query = window.matchMedia("(pointer: coarse)");
		const onChange = () => setTouch(query.matches);
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);

	// The coach is a first-run card, not a permanent panel. It gets out of the
	// way on the first deliberate touch (armed after 700ms so the tap that
	// boots the match does not dismiss it unread) or on its own button.
	useEffect(() => {
		if (!coach) return;
		const dismiss = (e: PointerEvent) => {
			// A thumb on "Got it" is answering the card, not starting the fight:
			// let the button's own click close it instead of pulling the button out
			// from under the same gesture.
			const target = e.target as Element | null;
			if (target?.closest?.(".gg-coach")) return;
			setCoach(false);
			markCoachSeen();
			window.removeEventListener("pointerdown", dismiss, true);
		};
		window.addEventListener("pointerdown", dismiss, true);
		return () => {
			window.removeEventListener("pointerdown", dismiss, true);
		};
	}, [coach]);

	const stance = hud?.stance ?? "sword";
	const kit = kitFor(hud?.hero ?? "lia");
	const ultCap = hud?.ultCap ?? 100;
	const ultCharge = ultCap > 0 ? (hud?.ult ?? 0) / ultCap : 0;
	const ultReady = ultCharge >= 1;
	const itemCharges = hud?.itemCharges ?? 0;
	const facing = hud?.facing ?? 1;

	// ---- the left hand's direction, shared by the pad, Guard and Dash ----
	//
	// One source of truth for left/right: the pad and the guard's walk latch
	// both ask `applyDir`, so a thumb that leaves the pad to hold Guard keeps
	// walking in the last direction (a guard-walk), and the two can never emit
	// conflicting ups and downs for the same action.
	const padDir = useRef<-1 | 0 | 1>(0);
	const guardHeld = useRef(false);
	const guardDir = useRef<-1 | 0 | 1>(0);
	const lastDir = useRef<-1 | 0 | 1>(0);
	const lastDirAt = useRef(0);
	const appliedDir = useRef<-1 | 0 | 1>(0);
	const facingRef = useRef(1);
	useEffect(() => {
		facingRef.current = facing;
	}, [facing]);

	const applyDir = (next: -1 | 0 | 1) => {
		if (next === appliedDir.current) return;
		const previous = appliedDir.current;
		appliedDir.current = next;
		if (previous === -1) action("left", false);
		if (previous === 1) action("right", false);
		if (next === -1) action("left", true);
		if (next === 1) action("right", true);
		if (next !== 0) {
			lastDir.current = next;
			lastDirAt.current = performance.now();
		}
	};

	const onPadDir = (next: -1 | 0 | 1) => {
		const was = padDir.current;
		padDir.current = next;
		if (next !== 0) {
			if (guardHeld.current) guardDir.current = next;
			applyDir(next);
			return;
		}
		// **The direction was held until the thumb left, not until it changed.**
		// Stamping only on a direction *change* meant a normal 800ms walk was
		// already "old" the moment the thumb lifted, so Guard pressed right after
		// it did not guard-walk. The release is the last moment the player was
		// still going that way.
		if (was !== 0) {
			lastDir.current = was;
			lastDirAt.current = performance.now();
		}
		applyDir(guardHeld.current ? guardDir.current : 0);
	};

	const guardDown = () => {
		guardHeld.current = true;
		// Only a *recent* direction becomes a guard-walk. Pressing Guard while
		// standing still must not start the fighter walking in whichever
		// direction it last happened to move.
		const recent = performance.now() - lastDirAt.current < 450;
		guardDir.current =
			padDir.current !== 0 ? padDir.current : recent ? lastDir.current : 0;
		if (padDir.current === 0) applyDir(guardDir.current);
		action("block", true);
	};

	const guardUp = () => {
		guardHeld.current = false;
		guardDir.current = 0;
		action("block", false);
		if (padDir.current === 0) applyDir(0);
	};
	const guardUpRef = useRef(guardUp);
	guardUpRef.current = guardUp;

	// The deck's Dash is a one-shot with a direction of its own: the sim takes
	// `dash: ±1`, so a dash button that needed a direction held would be a dash
	// button that does nothing when the thumb is on the button.
	const dash = () => {
		const recent = performance.now() - lastDirAt.current < 700;
		const direction =
			padDir.current ||
			(recent ? lastDir.current : 0) ||
			(facingRef.current < 0 ? -1 : 1);
		EventBus.emit(DECK_EVENTS.dash, direction);
		haptic(8);
	};

	// A stance switch to the gun holsters the melee weapon: a held guard must
	// not keep walking behind a gun, and must not spring back up the moment the
	// sword returns without a fresh press.
	useEffect(() => {
		if (stance !== "gun") return;
		// Holstering the melee weapon takes its actions away, including one a
		// thumb is still holding when the other hand taps Gun. The buttons
		// become disabled, so without this their pointerups would be eaten and
		// the codes would stay down.
		action("uppercut", false);
		action("block", false);
		if (guardHeld.current) guardUpRef.current();
	}, [stance]);

	// The ultimate becoming ready is the one event worth a haptic: it is a
	// resource the player has been waiting on, and the deck is under their thumb.
	const wasReady = useRef(false);
	useEffect(() => {
		if (ultReady && !wasReady.current) haptic(30);
		wasReady.current = ultReady;
	}, [ultReady]);

	/** Release everything and forget the left hand's latched state. */
	const resetDeckInput = () => {
		releaseDeck();
		appliedDir.current = 0;
		padDir.current = 0;
		guardHeld.current = false;
		guardDir.current = 0;
		lastDir.current = 0;
		lastDirAt.current = 0;
	};
	const resetDeckInputRef = useRef(resetDeckInput);
	resetDeckInputRef.current = resetDeckInput;

	// The Esc menu takes the deck too. Anything held when it opened would never
	// deliver its release and would stay down forever.
	useEffect(() => {
		const off = EventBus.on("input-suspended", ((on: boolean) => {
			setSuspended(on);
			if (!on) return;
			resetDeckInputRef.current();
			setEpoch((n) => n + 1);
		}) as never);
		return off;
	}, []);

	// The deck can disappear without the menu: a tablet gets a mouse, or the
	// player turns it off in Controls. The component stays mounted and returns
	// null, so the unmount cleanup would never run — release the held actions
	// here or the fighter keeps blocking behind a deck nobody can see.
	useEffect(() => {
		if (!deckVisible) resetDeckInputRef.current();
	}, [deckVisible]);

	// And on unmount: a player who turns the deck off mid-press must not be left
	// holding a button that no longer has anything to release it.
	useEffect(() => releaseDeck, []);

	if (!deckVisible) {
		if (!touch) return null;
		// A phone must always have a way into the menu, even with the deck off.
		return (
			<div
				className="gg-deck gg-deck-bare"
				style={safeAreaStyle()}
				inert={suspended}
			>
				<style>{DECK_CSS}</style>
				<DeckMenu />
			</div>
		);
	}

	const guardBlockable = kit.melee.blockable;
	const guardLabel = guardBlockable
		? "Guard"
		: kit.melee.shiftMove === "thrust"
			? "Thrust"
			: "Shift";
	const upperLabel = kit.melee.specialMove === "shoryuken" ? "Shoryu" : "Upper";
	const gunLabel = kit.ranged.thrown === true ? "Axes" : "Gun";
	const ultName = ULTIMATE_CARDS[hud?.hero ?? "lia"].name;
	const fadedHand = fadedHandFor(
		hud?.playerScreenX ?? 0.5,
		hud?.playerScreenY ?? 0.5,
	);

	return (
		<div
			className={`gg-deck${fadedHand === "left" ? " fighter-left" : fadedHand === "right" ? " fighter-right" : ""}`}
			key={epoch}
			style={safeAreaStyle()}
			inert={suspended}
		>
			<style>{DECK_CSS}</style>

			<DeckMenu />

			{/* ---- left hand: feet and defence ---- */}
			<div className="gg-hand gg-left">
				<div className="gg-left-utility">
					<ButtonFace
						name="guard"
						label={guardLabel}
						title={
							guardBlockable
								? `${guardLabel} — hold. The butterfly is guard + weapon.`
								: `${guardLabel} — tap. This weapon has no guard.`
						}
						className={`gg-guard${guardBlockable ? "" : " tap"}`}
						on={
							guardBlockable && stance === "sword"
								? (hud?.blocking ?? false)
								: false
						}
						disabled={stance !== "sword"}
						onDown={() => {
							if (guardBlockable) guardDown();
							else action("block", true);
						}}
						onUp={() => {
							if (guardBlockable) guardUp();
							else action("block", false);
						}}
					/>
					<ButtonFace
						name="dash"
						label="Dash"
						title="Dash — tap. Double-tapping the move pad also dashes."
						className="gg-dash"
						onDown={dash}
						onUp={() => {}}
					/>
				</div>
				<MovePad onMove={onPadDir} onJump={(down) => action("jump", down)} />
			</div>

			{/* ---- right hand: weapon, aim, kit ---- */}
			<div className="gg-hand gg-right">
				<div className="gg-combat">
					<StanceSwitch
						stance={stance}
						gunLabel={gunLabel}
						gunDisabled={hud?.berserk ?? false}
					/>
					<UltButton charge={ultCharge} ready={ultReady} name={ultName} />
					<ItemButton
						charges={itemCharges}
						enabled={itemCharges > 0}
						label={hud?.itemLabel ?? "Item"}
					/>
					<ButtonFace
						name="upper"
						label={upperLabel}
						title={
							upperLabel === "Shoryu"
								? "Shoryuken — the anti-air, while a jump is in hand."
								: "Uppercut — launches and knocks down."
						}
						className="gg-upper"
						disabled={stance !== "sword"}
						onDown={() => action("uppercut", true)}
						onUp={() => action("uppercut", false)}
					/>
					<WeaponButton
						kit={kit}
						stance={stance}
						charge={hud?.charge ?? 0}
						throwCharge={hud?.throwCharge ?? 0}
						ammo={hud?.ammo ?? 0}
						reserve={hud?.reserveRounds ?? 0}
						reload={hud?.reloadProgress ?? 0}
						massiveReady={hud?.massiveReady ?? false}
					/>
				</div>
			</div>

			{coach && (
				<div
					className="gg-coach"
					data-deck="coach"
					role="status"
					aria-live="polite"
				>
					<div className="gg-coach-copy">
						<div className="gg-coach-line">
							<b>Left</b> move · push <b>up</b> to jump ·{" "}
							{guardBlockable ? "hold" : "tap"} <b>{guardLabel}</b>
						</div>
						<div className="gg-coach-line">
							<b>Right</b> attack · drag to aim
						</div>
						<div className="gg-coach-line dim">
							Dash cyan · Item green · Ult: hold, drag, release
						</div>
					</div>
					<button
						type="button"
						className="gg-coach-ok"
						data-deck="coach-ok"
						onClick={() => {
							setCoach(false);
							markCoachSeen();
						}}
					>
						Got it
					</button>
				</div>
			)}
		</div>
	);
}

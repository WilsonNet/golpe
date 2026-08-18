/**
 * The on-screen gamepad.
 *
 * A 4:3 game on a portrait phone leaves the bottom half of the screen empty, and
 * the shape that fills it — screen up top, cross on the left, face buttons on the
 * right, a wordmark between them — is a handheld. Borrowing that silhouette means
 * a player knows where their thumbs go before reading a label.
 *
 * **It emits codes, not actions.** A thumb on the slash button sends `Pad2` over
 * the EventBus, exactly what a real controller's X button sends, and `Bindings`
 * decides what that means. So the deck is rebindable for free, it shares one code
 * path with the pad and the keyboard, and this component has no idea what any of
 * its buttons do. See `Bindings.ts` on why every device speaks one alphabet.
 *
 * **The cross is one element, not four buttons, and it is an analog stick, not
 * a d-pad.** A thumb rolling from left to up-left has to stay on the control the
 * whole way, and four adjacent buttons each with their own hit test drop the
 * input in the gap between them. It is the deck's *left stick*: the movement
 * sector for the codes comes from `quantise8`, the same function a physical left
 * stick goes through, and the raw thumb position is emitted as the analog Contra
 * aim — so a thumb at 30° aims at 30°, not at the nearest of eight. It is drawn
 * as a round pad with a nub, because that is what it is; it used to be drawn as
 * a d-pad and read as one.
 *
 * **Each stance draws its own buttons.** Sword and gun do not share a button:
 * block and uppercut are sword moves, so in gun mode they are not drawn at all
 * rather than left sitting there doing nothing. `Input` owns the stance and says
 * which it is over `stance-changed`; this component just listens.
 *
 * **It is not tied to being a phone.** `inputSettings.deck` is a separate setting
 * from `inputSettings.scheme` precisely because somebody can pair a Bluetooth
 * keyboard and mouse to a tablet, and that player has to be able to send the deck
 * away. `auto` means "a finger is the pointer *and* the aim is a controller's".
 */

import { useEffect, useRef, useState } from "react";
import { EventBus } from "../game/EventBus";
import { quantise8 } from "../game/input/Aim";
import { codeLabel } from "../game/input/Bindings";
import { PAD_DOWN, PAD_LEFT, PAD_RIGHT, PAD_UP } from "../game/input/Gamepad";
import {
	deckVisibleFor,
	inputSettings,
	isTouchPrimary,
} from "../game/input/Scheme";
import { DECK_CSS } from "./deckStyles";

/**
 * Which pad code each control sends.
 *
 * These are the *default* pad bindings from `Bindings.ts` read backwards: the
 * deck presses the button, the binding decides the action. A player who moves
 * block off the left trigger moves it off this deck's block button too, which is
 * the correct and slightly surprising consequence of there being one alphabet.
 */
const CODES = {
	up: PAD_UP,
	down: PAD_DOWN,
	left: PAD_LEFT,
	right: PAD_RIGHT,
	jump: "Pad0",
	slash: "Pad2",
	upper: "Pad3",
	block: "Pad6",
	sword: "Pad4",
	gun: "Pad5",
	ult: "Pad1",
	item: "Pad7",
} as const;

const press = (code: string, down: boolean) =>
	EventBus.emit("virtual-button", { code, down });

/** Anything held has to be released, or the fighter swings at nothing forever. */
function releaseAll() {
	for (const code of Object.values(CODES)) press(code, false);
	EventBus.emit("virtual-aim", null);
	EventBus.emit("virtual-contra", null);
}

/**
 * A face button or a stance pill.
 *
 * `setPointerCapture` is what makes several buttons work at once: without it a
 * second finger landing elsewhere re-targets the first one's events, and the
 * button it left never sees its release.
 */
function PadButton({
	code,
	label,
	className,
	title,
}: {
	code: string;
	label: string;
	className: string;
	title: string;
}) {
	const [held, setHeld] = useState(false);
	const down = (e: React.PointerEvent) => {
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		setHeld(true);
		press(code, true);
	};
	const up = (e: React.PointerEvent) => {
		e.preventDefault();
		setHeld(false);
		press(code, false);
	};
	return (
		<button
			type="button"
			aria-label={title}
			title={`${title} — ${codeLabel(code)}`}
			className={`${className}${held ? " held" : ""}`}
			onPointerDown={down}
			onPointerUp={up}
			onPointerCancel={up}
			// A finger that slides off a captured button still delivers its up here,
			// but a mouse dragged out of the window does not — this is the mouse's
			// safety net, and it costs a touch nothing because of the capture.
			onLostPointerCapture={() => {
				setHeld(false);
				press(code, false);
			}}
		>
			{label}
		</button>
	);
}

/** The on-screen left stick. One control, two outputs, one thumb. */
function Cross() {
	const ref = useRef<HTMLDivElement>(null);
	const [nub, setNub] = useState<{ x: number; y: number } | null>(null);
	// Kept in refs as well, because the pointer handlers close over the state
	// from the render they were created in and would diff against a stale value.
	const live = useRef({ x: 0, y: 0 });
	const liveContra = useRef<{ x: number; y: number } | null>(null);

	const apply = (raw: { x: number; y: number } | null) => {
		// The movement half stays quantised — walking is still left or right —
		// while the aim half is the raw deflection, exactly like a physical left
		// stick. Same deadzone for both, so a thumb resting on the hub neither
		// moves the fighter nor waves the aim at whatever the hub happens to sit
		// over.
		const next = raw ? quantise8(raw.x, raw.y, 0.22) : { x: 0, y: 0 };
		const was = live.current;
		if (next.x !== was.x || next.y !== was.y) {
			live.current = next;
			if (next.x !== was.x) {
				press(CODES.left, next.x < 0);
				press(CODES.right, next.x > 0);
			}
			if (next.y !== was.y) {
				press(CODES.up, next.y < 0);
				press(CODES.down, next.y > 0);
			}
		}
		// The nub follows the thumb, clamped to the rim so it cannot leave the
		// pad, and returns to the hub on release — a stick at rest, not one left
		// where it was abandoned.
		let nubPos: { x: number; y: number } | null = null;
		if (raw) {
			const m = Math.hypot(raw.x, raw.y);
			nubPos = m > 1 ? { x: raw.x / m, y: raw.y / m } : raw;
		}
		setNub(nubPos);
		const contra = raw && Math.hypot(raw.x, raw.y) >= 0.22 ? raw : null;
		const prev = liveContra.current;
		if (contra?.x !== prev?.x || contra?.y !== prev?.y) {
			liveContra.current = contra;
			EventBus.emit("virtual-contra", contra);
		}
	};

	const track = (e: React.PointerEvent) => {
		const el = ref.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 2;
		// Normalised against the half-size, so the deadzone is a fraction of the
		// pad rather than a pixel count that means something different on every
		// screen. A thumb resting on the hub is not a direction.
		apply({
			x: (e.clientX - cx) / (rect.width / 2),
			y: (e.clientY - cy) / (rect.height / 2),
		});
	};

	const down = (e: React.PointerEvent) => {
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		track(e);
	};
	const move = (e: React.PointerEvent) => {
		if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
		track(e);
	};
	const release = (e: React.PointerEvent) => {
		e.preventDefault();
		apply(null);
	};

	return (
		<div
			ref={ref}
			className={`gg-cross${nub ? " live" : ""}`}
			onPointerDown={down}
			onPointerMove={move}
			onPointerUp={release}
			onPointerCancel={release}
			onLostPointerCapture={() => apply(null)}
		>
			<div
				className="gg-cross-nub"
				style={
					nub
						? // 29% of the pad, so a fully deflected nub sits inside the
							// rim rather than half outside it.
							{ transform: `translate(${nub.x * 29}%, ${nub.y * 29}%)` }
						: undefined
				}
			/>
			<div className="gg-cross-label">Move</div>
		</div>
	);
}

/**
 * The fine-aim thumb pad — the layer that is *not* eight directions.
 *
 * Absolute rather than relative: the vector is where the thumb sits relative to
 * the pad's centre, clamped to the rim, so this behaves like a real right stick
 * and recentres the instant it is let go. `AimController` treats it exactly the
 * way it treats a physical stick, and the mouse — which has no spring and needs
 * a hold window — goes down the other path.
 *
 * It is also the deck's fire button in gun mode. On a phone the right thumb is
 * on this pad, and there is no spare finger for the Slash button on the face
 * cluster — so `Input` reads "aim stick held" as "attack held" while the stance
 * is gun. This component does none of that itself; it only emits `virtual-aim`,
 * exactly like a physical right stick.
 */
function AimStick() {
	const ref = useRef<HTMLDivElement>(null);
	const [nub, setNub] = useState<{ x: number; y: number } | null>(null);

	const track = (e: React.PointerEvent) => {
		const el = ref.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const radius = rect.width / 2;
		let x = (e.clientX - (rect.left + radius)) / radius;
		let y = (e.clientY - (rect.top + radius)) / radius;
		const magnitude = Math.hypot(x, y);
		if (magnitude > 1) {
			x /= magnitude;
			y /= magnitude;
		}
		setNub({ x, y });
		EventBus.emit("virtual-aim", { x, y });
	};

	const down = (e: React.PointerEvent) => {
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		track(e);
	};
	const move = (e: React.PointerEvent) => {
		if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
		track(e);
	};
	const release = () => {
		setNub(null);
		// Null, not the origin: "nobody is holding this", which is what starts the
		// handover back to the Contra aim.
		EventBus.emit("virtual-aim", null);
	};

	return (
		<div
			ref={ref}
			className={`gg-stick${nub ? " live" : ""}`}
			onPointerDown={down}
			onPointerMove={move}
			onPointerUp={release}
			onPointerCancel={release}
			onLostPointerCapture={release}
		>
			<div
				className="gg-stick-nub"
				style={
					nub
						? // 29% of the pad, so a fully deflected nub sits inside the rim
							// rather than half outside it.
							{ transform: `translate(${nub.x * 29}%, ${nub.y * 29}%)` }
						: undefined
				}
			/>
			<div className="gg-stick-label">Aim</div>
		</div>
	);
}

export function TouchControls() {
	// The settings store is deliberately not React state — `Input` reads it
	// every frame from outside React entirely — so the deck snapshots it into
	// state and resubscribes. The indirection is what the React Compiler
	// needs: it memoises on the values a render reads, and a gate that read
	// `deckVisible` straight off the store would freeze — a deck that stayed
	// on screen after its owner turned it off, with the store's change events
	// arriving at a bump state nothing in the JSX read.
	const [settings, setSettings] = useState(() => inputSettings.snapshot());
	const [touch, setTouch] = useState(isTouchPrimary);
	useEffect(
		() => inputSettings.subscribe(() => setSettings(inputSettings.snapshot())),
		[],
	);

	// A tablet that gets a mouse plugged in, or a phone rotated into a mode the
	// media query answers differently. Re-asked rather than latched at mount.
	useEffect(() => {
		if (!window.matchMedia) return;
		const query = window.matchMedia("(pointer: coarse)");
		const onChange = () => setTouch(query.matches);
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);

	// The stance is owned by `Input` — the simulation reads `swordStance`, not
	// the deck — so the deck learns it over the same EventBus the rest of the
	// overlay uses. It starts on sword, which is where a new match starts.
	const [stance, setStance] = useState<"sword" | "gun">("sword");
	useEffect(() => {
		const off = EventBus.on("stance-changed", ((sword: boolean) => {
			setStance(sword ? "sword" : "gun");
		}) as never);
		return off;
	}, []);

	// The ultimate button is drawn only when the meter is full — see
	// `deckStyles.ts`. The charge is server-owned and reaches React the same way
	// the stance does; `Match` emits it, rounded, only when the integer changes.
	const [ultReadyNow, setUltReady] = useState(false);
	useEffect(() => {
		const off = EventBus.on("ult-charge", ((charge: number) => {
			setUltReady(charge >= 100);
		}) as never);
		return off;
	}, []);
	// Spending it takes the button away mid-press, and a button that vanishes
	// never delivers its release — the same trap the stance buttons have.
	useEffect(() => {
		if (!ultReadyNow) press(CODES.ult, false);
	}, [ultReadyNow]);

	// The item button is always drawn, but its label carries the charge count —
	// server-owned, reaching React the same way the ult's readiness does.
	const [itemCharges, setItemCharges] = useState(0);
	useEffect(() => {
		const off = EventBus.on("item-charge", ((n: number) => {
			setItemCharges(n);
		}) as never);
		return off;
	}, []);

	// A button that stops being drawn must not leave its code held, or the
	// fighter would keep blocking (sword-only) while the player watches a deck
	// with no Block button on it. Released defensively when the stance drops the
	// buttons — releasing a code that was never held is a no-op.
	useEffect(() => {
		if (stance === "gun") {
			press(CODES.upper, false);
			press(CODES.block, false);
		}
	}, [stance]);

	// The Esc menu takes the keyboard; it takes the deck too. Anything held when
	// it opened would never deliver its release and would stay down forever —
	// the same rule the keyboard follows, for the same reason.
	useEffect(() => {
		const off = EventBus.on("input-suspended", ((on: boolean) => {
			if (on) releaseAll();
		}) as never);
		return off;
	}, []);

	// And on unmount: a player who switches to mouse aim mid-press must not be
	// left holding a button that no longer has anything to release it.
	useEffect(() => releaseAll, []);

	// Same gate `deckVisible` answers, computed from the snapshot — a render
	// must ask the pure predicate about the state it holds, never the live
	// store.
	const deckVisible = deckVisibleFor(settings, touch);
	if (!deckVisible) return null;

	return (
		<div className="gg-deck">
			<style>{DECK_CSS}</style>
			<div className="gg-brand">
				<span className="gg-brand-mark">Golpe</span>
				<span className="gg-brand-sub">The strike</span>
				{/* A phone has no Escape key, and the menu is where a player turns
				    this deck off again — so without this, choosing the on-screen
				    gamepad on a phone is a decision that cannot be undone. */}
				<button
					type="button"
					className="gg-menu"
					aria-label="Menu"
					onPointerDown={(e) => {
						e.preventDefault();
						EventBus.emit("menu-toggle");
					}}
				>
					Menu
				</button>
			</div>
			{/* Four cells, placed by grid area rather than by source order — the
			    portrait layout stacks them two and two, and the landscape one pins
			    them into the two letterbox margins a 4:3 game leaves beside itself.
			    Same DOM, and therefore the same held buttons, through a rotation. */}
			<div className="gg-body">
				<div className="gg-cell cross">
					<Cross />
				</div>
				<div className="gg-cell stance">
					<PadButton
						code={CODES.sword}
						label="Sword"
						className="gg-pill"
						title="Sword stance"
					/>
					<PadButton
						code={CODES.gun}
						label="Gun"
						className="gg-pill"
						title="Gun stance"
					/>
					{ultReadyNow && (
						<PadButton
							code={CODES.ult}
							label="Ult"
							className="gg-pill ult"
							title="Ultimate — Black Hole"
						/>
					)}
				</div>
				<div className="gg-cell stick">
					<AimStick />
				</div>
				<div className="gg-cell face">
					<div className="gg-face">
						{/* Sword and gun do not share buttons. Block and Uppercut are
						    sword moves and do nothing in gun stance, so in gun mode they
						    are not drawn — a dead button on a phone is a thumb spent on
						    nothing. Slash survives both, as the fire button. */}
						{stance === "sword" && (
							<PadButton
								code={CODES.upper}
								label="Upper"
								className="gg-btn upper"
								title="Uppercut"
							/>
						)}
						<PadButton
							code={CODES.slash}
							label="Slash"
							className="gg-btn slash"
							title="Slash / fire"
						/>
						{stance === "sword" && (
							<PadButton
								code={CODES.block}
								label="Block"
								className="gg-btn block"
								title="Block"
							/>
						)}
						<PadButton
							code={CODES.jump}
							label="Jump"
							className="gg-btn jump"
							title="Jump / double jump"
						/>
						{/* The item works in both stances — it is the third member of the
						    kit — so it is drawn regardless. The pip count tells the thumb
						    how many uses this life has left. */}
						<PadButton
							code={CODES.item}
							label={itemCharges > 0 ? `Item ${itemCharges}` : "Item"}
							className="gg-btn item"
							title="Item"
						/>
					</div>
				</div>
			</div>
			{/* The raked grille. Pure decoration, and the single detail that stops
			    the shell reading as a flat slab under the buttons. */}
			<div className="gg-speaker" />
		</div>
	);
}

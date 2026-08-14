/**
 * Client-side prediction with server reconciliation.
 *
 * The local player is simulated immediately on input so the game feels
 * lag-free. When an authoritative snapshot arrives it is not blended in
 * blindly — the state is rewound to what the server said and every input the
 * server has not acknowledged yet is replayed on top. Because Physics.ts is
 * deterministic, a correct prediction replays to exactly where the client
 * already was and nothing moves at all.
 */

import { type HeroKit, LIA_KIT } from "../simulation/Heroes";
import type { Trap } from "../simulation/Items";
import {
	copyPlayerState,
	createPlayerState,
	DEFAULT_WORLD,
	type PlayerIntent,
	type PlayerPosition,
	type Singularity,
	tickPlayer,
	type World,
} from "../simulation/Physics";

interface PendingInput {
	seq: number;
	intent: PlayerIntent;
}

/**
 * Errors below this are treated as float noise and ignored, so we never
 * re-render a "correction" that is smaller than a pixel.
 */
const NEGLIGIBLE_ERROR_PX = 0.01;

/** Safety valve: never let unacknowledged input grow without bound. */
const MAX_PENDING_INPUTS = 180;

/** Per-second decay of the smoothing offset — how fast a pop becomes a glide. */
const SMOOTH_DECAY_BASE = 0.5;
/** An offset this small is indistinguishable from zero; snap it exactly. */
const SNAP_EPSILON = 0.05;

export interface ReconcileResult {
	/** Distance between where the client predicted and where it ended up. */
	errorPx: number;
	/** Inputs replayed on top of the authoritative state. */
	replayed: number;
	/** True when the error was large enough to be a visible pop. */
	corrected: boolean;
	/**
	 * The sword state diverged for a reason the client should have predicted.
	 *
	 * The melee equivalent of `errorPx`, and it must be false — but only
	 * *unexplained* divergence counts. Being hit is by design unpredictable: the
	 * client cannot know it was stunned, parried or knocked back until the server
	 * says so, and it will always mispredict those. Counting them would make the
	 * metric report correct netcode as a defect, which is exactly how a metric
	 * gets ignored. What must never happen is the state machine itself running
	 * differently on the two sides.
	 */
	meleeDiverged: boolean;
	/**
	 * The replay landed on a different sword state than was predicted, whatever
	 * the reason — including the legitimate ones.
	 *
	 * Separate from `meleeDiverged`, which is only the *unexplained* subset. The
	 * frame data metric needs to know about the explained ones too: an
	 * uncancellable move that vanishes because the server replaced the state is
	 * not the state machine breaking its own table, and counting it as one
	 * reports correct netcode as a defect.
	 */
	meleeReplaced: boolean;
	/**
	 * Why the state was allowed to change without the client predicting it.
	 * `server-ended`/`server-started` are the frozen-tick spellings: the server
	 * acknowledged an input it froze, so the replayed state lost a move (or
	 * gained one a refusal did not produce) with no hit involved.
	 */
	replaceReason:
		| "stun"
		| "iframe"
		| "massive-armed"
		| "server-ended"
		| "server-started"
		| "unexplained"
		| null;
	/**
	 * A predicted dragon ride the server's state does not have.
	 *
	 * The dragon is cast by prediction — the release *is* the launch — and a
	 * cast the server refuses (it judged the caster stunned on a hit this
	 * client had not seen) drops the ride: the fighter snaps back from wherever
	 * the prediction had ridden to. A legitimate discontinuity, exactly like a
	 * respawn, and the jitter metric must be told not to count it.
	 */
	dragonDropped: boolean;
	/**
	 * The server folded in a plunge-bomb catch this client did not know about.
	 *
	 * The carry is a hit — server-judged, unpredictable — so the rewind lands
	 * on a body already falling at the dive's speed, up to a full fall ahead of
	 * where the prediction was. The catch has no melee event to announce itself
	 * (there is no swing to draw), so the jitter metric must be told here,
	 * exactly like `dragonDropped`.
	 */
	carryStarted: boolean;
	/** What diverged, when it did. Empty otherwise. */
	meleeDivergence?: {
		predictedAction: string;
		actualAction: string;
		predictedBlocking: boolean;
		actualBlocking: boolean;
		stunTimer: number;
		iframeTimer: number;
	};
}

export class PredictedPlayer {
	/** The state the game renders and reads from. */
	state: PlayerPosition;

	private pending: PendingInput[] = [];
	private nextSeq = 1;

	/**
	 * `world` is the geometry prediction replays against — it must be the
	 * room's, not the default's, or a wide room's replays would fight the
	 * single-screen walls and reconciliation would yank every correction back.
	 *
	 * `kit` is the hero this fighter plays, threaded into every `tickPlayer`
	 * replay for the same reason `world` is: the weapons a move belongs to must
	 * be the same on the live step and every replayed one, or a replay would
	 * not be a replay.
	 */
	constructor(
		x: number,
		y: number,
		private readonly world: World = DEFAULT_WORLD,
		private kit: HeroKit = LIA_KIT,
	) {
		this.state = createPlayerState(x, y);
	}

	/** Change the hero mid-match (the Esc menu's hero select). */
	setKit(kit: HeroKit) {
		this.kit = kit;
	}

	get currentKit(): HeroKit {
		return this.kit;
	}

	get pendingCount(): number {
		return this.pending.length;
	}

	/** Reset prediction entirely — used on fight resets and (re)spawns. */
	reset(x: number, y: number) {
		this.state = createPlayerState(x, y);
		this.pending.length = 0;
	}

	/**
	 * The buttons pressed in the recent input stream, acknowledged or not.
	 *
	 * The frozen-tick excuse asks whether the server's move could have come
	 * from this client's own input — a thrust the client's replay latched
	 * differently needs a block press in the stream, and one that was never
	 * pressed is a genuine divergence, not a race.
	 */
	private recentButtons = { attack: false, block: false, uppercut: false };

	/**
	 * Advance one fixed step locally and remember the input so it can be
	 * replayed. Returns the sequence number to send to the server.
	 */
	/**
	 * `field` is the black hole as *this* fighter feels it — already filtered for
	 * friendly fire by the caller. It is passed on both the live step and the
	 * replay, and it is deliberately the *current* field in both cases: the
	 * singularity's position and strength never change while it is open, so the
	 * only thing a replayed tick can be wrong about is whether the hole had
	 * already closed, and only for the handful of ticks at the very end of its
	 * life. That is a few pixels, absorbed by the smoother. A field whose force
	 * varied over time would make every replay a different replay and
	 * reconciliation would never settle — which is why it does not.
	 */
	step(
		intent: PlayerIntent,
		dt: number,
		field: Singularity | null = null,
		traps: readonly Trap[] = [],
	): number {
		const seq = this.nextSeq++;
		this.state = tickPlayer(
			this.state,
			intent,
			dt,
			this.world,
			field,
			this.kit,
			traps,
		);
		this.pending.push({ seq, intent: { ...intent } });
		// Remember which buttons the stream has carried, so the frozen-tick
		// excuse can tell a latch race (the button was pressed) from a genuine
		// divergence (it never was).
		this.recentButtons.attack ||= intent.attack;
		this.recentButtons.block ||= intent.block;
		this.recentButtons.uppercut ||= intent.uppercut;
		if (this.pending.length > MAX_PENDING_INPUTS) {
			this.pending.splice(0, this.pending.length - MAX_PENDING_INPUTS);
		}
		return seq;
	}

	/**
	 * Fold in an authoritative snapshot: drop acknowledged inputs, rewind to the
	 * server state, then replay whatever the server has not seen yet.
	 */
	reconcile(
		authoritative: PlayerPosition,
		lastSeq: number,
		dt: number,
		field: Singularity | null = null,
		traps: readonly Trap[] = [],
	): ReconcileResult {
		const predictedX = this.state.x;
		const predictedY = this.state.y;
		const predictedAction = this.state.meleeAction;
		const predictedBlocking = this.state.blocking;
		const predictedMassiveReady = this.state.massiveReady;
		const predictedDragon = this.state.dragonTimer;
		const predictedCarry = this.state.plungeCarryTimer;

		// Drop every input the server has already folded in.
		while (this.pending[0] !== undefined && this.pending[0].seq <= lastSeq) {
			this.pending.shift();
		}

		const rewound = copyPlayerState(authoritative, { ...this.state });
		let replayed = rewound;
		for (const p of this.pending) {
			replayed = tickPlayer(
				replayed,
				p.intent,
				dt,
				this.world,
				field,
				this.kit,
				traps,
			);
		}
		this.state = replayed;

		const dx = this.state.x - predictedX;
		const dy = this.state.y - predictedY;
		const errorPx = Math.sqrt(dx * dx + dy * dy);

		// The server telling us we were hit is the one legitimate way a sword state
		// can change without the client having seen it coming. Stun, fresh
		// invulnerability and a newly armed Massive are the three tells.
		//
		// The Massive tell has to be read two ways, because arming is *consumed* by
		// striking. A parry the client had not been told about arms a Massive
		// server-side; the client predicts a plain slash on release; the replay lands
		// on a Massive and `massiveReady` is already spent — so looking only for the
		// flag being newly set finds nothing and reports correct netcode as an
		// unexplained desync. Landing on a Massive the client did not know it had is
		// the same event, seen one tick later.
		const grantedMassive =
			this.state.meleeAction === "massive" &&
			predictedAction !== "massive" &&
			!predictedMassiveReady;
		// The frozen-tick trade, spelled the same way. The server freezes a
		// fighter for up to `MAX_STARVED_TICKS` rather than invent a tick its
		// client did not send — and a frozen tick *acknowledges* an input without
		// applying it, so the next reconcile drops that input from the replay.
		// The dagger's state-gated moves make the result visible: the client
		// predicted a thrust the server never had (the input was eaten by the
		// freeze), the server started a shoryuken the client's replay refused
		// (the double-jump input the freeze swallowed left the server's air jumps
		// a tick ahead), or the two simply disagree about which move a press
		// edge started (the latches differ by the frozen tick). Every spelling is
		// the same event — the server's state diverged from the client's by a
		// tick the client was told about — and every one is excused, exactly
		// like the massive's two spellings.
		const serverEnded =
			predictedAction !== "none" &&
			this.state.meleeAction === "none" &&
			this.state.stunTimer <= 0 &&
			this.state.iframeTimer <= 0;
		// A different move on the server is only the frozen-tick race if this
		// client's own stream could have started it: the button its move needs
		// must have been pressed. A move whose button never appears is a
		// genuine divergence — the state machines ran different inputs.
		const serverMove = this.state.meleeAction;
		const serverMoveButton =
			serverMove === "uppercut" || serverMove === "shoryuken"
				? "uppercut"
				: serverMove === "thrust"
					? "block"
					: "attack";
		const serverMoved =
			this.state.meleeAction !== "none" &&
			this.state.meleeAction !== predictedAction &&
			this.state.stunTimer <= 0 &&
			this.state.iframeTimer <= 0 &&
			this.recentButtons[serverMoveButton];
		const reason: ReconcileResult["replaceReason"] =
			this.state.stunTimer > 0
				? "stun"
				: this.state.iframeTimer > 0
					? "iframe"
					: (this.state.massiveReady && !predictedMassiveReady) ||
							grantedMassive
						? "massive-armed"
						: serverEnded
							? "server-ended"
							: serverMoved
								? "server-started"
								: null;
		const interrupted = reason !== null;

		const changed =
			this.state.meleeAction !== predictedAction ||
			this.state.blocking !== predictedBlocking;
		const diverged = !interrupted && changed;

		// A predicted dragon ride the server's state does not have: the cast was
		// refused (the server judged the caster stunned on a hit this client had
		// not seen), so the fighter snaps back from wherever the prediction had
		// ridden to. A legitimate discontinuity, like a respawn — announced so
		// the jitter metric does not count it.
		const dragonDropped = predictedDragon > 0 && rewound.dragonTimer <= 0;
		// The mirror image, one ride over: the server folded in a plunge-bomb
		// catch this client could not have predicted (it is a hit), and the
		// rewind lands on a body already falling at the dive's speed. The catch
		// has no melee event to announce itself, so the reconcile must.
		const carryStarted = predictedCarry <= 0 && rewound.plungeCarryTimer > 0;

		return {
			errorPx,
			replayed: this.pending.length,
			corrected: errorPx > NEGLIGIBLE_ERROR_PX,
			meleeDiverged: diverged,
			meleeReplaced: changed,
			replaceReason: changed ? (reason ?? "unexplained") : null,
			dragonDropped,
			carryStarted,
			// Captured so a rare divergence is diagnosable rather than a bare count.
			// Captured whenever the state was replaced, not only when it was
			// unexplained: the explained cases are exactly the ones another metric
			// needs to be told about.
			...(changed
				? {
						meleeDivergence: {
							predictedAction,
							actualAction: this.state.meleeAction,
							predictedBlocking,
							actualBlocking: this.state.blocking,
							stunTimer: this.state.stunTimer,
							iframeTimer: this.state.iframeTimer,
						},
					}
				: {}),
		};
	}
}

/**
 * Visual smoothing for the residual error a reconciliation leaves behind.
 *
 * The simulation snaps to the authoritative answer immediately (so gameplay
 * stays correct) while the sprite is drawn at an offset that decays to zero
 * over a few frames, turning a pop into a glide. Errors past `snapThreshold`
 * are real teleports (respawns) and are shown instantly.
 */
export class RenderSmoother {
	private offsetX = 0;
	private offsetY = 0;

	constructor(
		private readonly halfLifeSec = 0.06,
		private readonly snapThresholdPx = 100,
	) {}

	/** Absorb a correction of (dx, dy) that the simulation just applied. */
	absorb(dx: number, dy: number) {
		if (Math.hypot(dx, dy) > this.snapThresholdPx) {
			this.offsetX = 0;
			this.offsetY = 0;
			return;
		}
		this.offsetX -= dx;
		this.offsetY -= dy;
	}

	/** Decay the offset and return where the sprite should actually be drawn. */
	apply(x: number, y: number, dtSec: number): { x: number; y: number } {
		const keep = SMOOTH_DECAY_BASE ** (dtSec / this.halfLifeSec);
		this.offsetX *= keep;
		this.offsetY *= keep;
		if (Math.abs(this.offsetX) < SNAP_EPSILON) this.offsetX = 0;
		if (Math.abs(this.offsetY) < SNAP_EPSILON) this.offsetY = 0;
		return { x: x + this.offsetX, y: y + this.offsetY };
	}

	reset() {
		this.offsetX = 0;
		this.offsetY = 0;
	}
}

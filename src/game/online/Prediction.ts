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

import {
	copyPlayerState,
	createPlayerState,
	type PlayerIntent,
	type PlayerPosition,
	tickPlayer,
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
	/** Why the state was allowed to change without the client predicting it. */
	replaceReason: "stun" | "iframe" | "massive-armed" | "unexplained" | null;
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

	constructor(x: number, y: number) {
		this.state = createPlayerState(x, y);
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
	 * Advance one fixed step locally and remember the input so it can be
	 * replayed. Returns the sequence number to send to the server.
	 */
	step(intent: PlayerIntent, dt: number): number {
		const seq = this.nextSeq++;
		this.state = tickPlayer(this.state, intent, dt);
		this.pending.push({ seq, intent: { ...intent } });
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
	): ReconcileResult {
		const predictedX = this.state.x;
		const predictedY = this.state.y;
		const predictedAction = this.state.meleeAction;
		const predictedBlocking = this.state.blocking;
		const predictedMassiveReady = this.state.massiveReady;

		// Drop every input the server has already folded in.
		while (this.pending[0] !== undefined && this.pending[0].seq <= lastSeq) {
			this.pending.shift();
		}

		const rewound = copyPlayerState(authoritative, { ...this.state });
		let replayed = rewound;
		for (const p of this.pending) {
			replayed = tickPlayer(replayed, p.intent, dt);
		}
		this.state = replayed;

		const dx = this.state.x - predictedX;
		const dy = this.state.y - predictedY;
		const errorPx = Math.sqrt(dx * dx + dy * dy);

		// The server telling us we were hit is the one legitimate way a sword state
		// can change without the client having seen it coming. Stun, fresh
		// invulnerability and a newly armed Massive are the three tells.
		const reason: ReconcileResult["replaceReason"] =
			this.state.stunTimer > 0
				? "stun"
				: this.state.iframeTimer > 0
					? "iframe"
					: this.state.massiveReady && !predictedMassiveReady
						? "massive-armed"
						: null;
		const interrupted = reason !== null;

		const changed =
			this.state.meleeAction !== predictedAction ||
			this.state.blocking !== predictedBlocking;
		const diverged = !interrupted && changed;

		return {
			errorPx,
			replayed: this.pending.length,
			corrected: errorPx > NEGLIGIBLE_ERROR_PX,
			meleeDiverged: diverged,
			meleeReplaced: changed,
			replaceReason: changed ? (reason ?? "unexplained") : null,
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
		const keep = 0.5 ** (dtSec / this.halfLifeSec);
		this.offsetX *= keep;
		this.offsetY *= keep;
		if (Math.abs(this.offsetX) < 0.05) this.offsetX = 0;
		if (Math.abs(this.offsetY) < 0.05) this.offsetY = 0;
		return { x: x + this.offsetX, y: y + this.offsetY };
	}

	reset() {
		this.offsetX = 0;
		this.offsetY = 0;
	}
}

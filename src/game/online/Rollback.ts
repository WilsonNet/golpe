/**
 * Rollback prediction for fighters this client does not control.
 *
 * The local player has always been predicted and replayed — that is ordinary
 * client-side prediction, and it is what got reconciliation to a measured
 * 0.00px. Everybody *else* used to be interpolated 150ms in the past, which is
 * the standard answer and the wrong one for a game about reading a swing: a
 * swing you see 150ms late is a swing you cannot react to, and reacting is the
 * whole game.
 *
 * So remotes are rolled back instead, the way GGPO does it:
 *
 * 1. **Carry the last known input forward.** The server tells us the exact
 *    intent it advanced each fighter with, so we keep pressing it. Players change
 *    input far less often than 60 times a second, so this is right most ticks.
 * 2. **Simulate them at the present instant**, through the same deterministic
 *    `tickPlayer` the server runs.
 * 3. **On every snapshot, rewind and re-simulate.** Adopt the authoritative
 *    state at the server's tick, adopt the input it actually used, then replay
 *    forward to now. A correct prediction replays to exactly where the fighter
 *    already was, so nothing moves — the same property the local player relies on.
 *
 * The differences from peer-to-peer GGPO are deliberate and both come from the
 * server being authoritative. There is no waiting on a slow peer, because
 * nothing here is lockstep — a client that falls behind hurts only itself. And
 * outcomes are never predicted: whether a swing connected is still the server's
 * call alone. We predict where fighters are, never what happened to them.
 *
 * ## How far forward is "now"
 *
 * `leadTicks` is not estimated from a clock. It is the local player's count of
 * unacknowledged inputs: the server told us its state at the tick it consumed
 * seq N, and we hold inputs N+1..N+k, so the local fighter is exactly k ticks
 * ahead of that snapshot. Advancing remotes by the same k puts every fighter on
 * one tick, by construction, with no latency estimate to be wrong about.
 *
 * That also makes the depth self-limiting: a laggy connection has more pending
 * input and therefore predicts further, which is exactly the trade rollback is
 * supposed to make — up to `MAX_ROLLBACK_TICKS`, past which prediction error
 * grows faster than the latency it hides.
 */

import { resolveOverlap } from "../simulation/Collision";
import { type HeroId, type HeroKit, LIA_KIT } from "../simulation/Heroes";
import type { Trap } from "../simulation/Items";
import {
	copyPlayerState,
	DEFAULT_WORLD,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type PlayerIntent,
	type PlayerPosition,
	type Singularity,
	tickPlayer,
	type World,
} from "../simulation/Physics";
import { RenderSmoother } from "./Prediction";

/**
 * Push a *drawn* position out of solid geometry.
 *
 * Everything the simulation produces is already legal. A drawn position is not
 * always the simulation's: the render smoother deliberately offsets a sprite
 * from its body so a correction glides instead of popping, and that offset can
 * put the sprite a few pixels inside a ledge the body never touched. The old
 * interpolator needed exactly this for exactly this reason — a straight line
 * between two legal snapshots can still clip a corner.
 *
 * Never fed back into the simulation. A depenetrated draw position that became
 * authoritative would make the renderer part of the physics.
 */
export function legaliseDrawn(
	x: number,
	y: number,
	world: World = DEFAULT_WORLD,
): { x: number; y: number } {
	const box = { x, y, w: PLAYER_WIDTH, h: PLAYER_HEIGHT };
	return resolveOverlap(box, world) ? { x: box.x, y: box.y } : { x, y };
}

/**
 * Cap on how far a remote fighter is predicted, in 60Hz ticks.
 *
 * Nine ticks is 150ms. Prediction past that range stops being an improvement:
 * the misprediction it introduces is larger and more frequent than the latency
 * it hides, which is why rollback implementations converge on roughly this
 * number regardless of topology.
 */
/** How quickly a remote's drawn offset decays toward its true position. */
const REMOTE_SMOOTH_FACTOR = 0.06;

const MAX_ROLLBACK_TICKS = 9;
/** Two decimal places: the report's own precision, not a physics number. */
const ROUNDING_SCALE = 100;

/** Above this, a remote correction is a respawn or a teleport, not a mistake. */
const REMOTE_TELEPORT_PX = 100;

export interface RollbackResult {
	/** How far the fighter moved when the authoritative state was folded in. */
	errorPx: number;
	/** Ticks re-simulated on top of the authoritative state. */
	resimTicks: number;
	/** The server had frozen this fighter, so nothing was predicted for it. */
	frozen: boolean;
	/** A discontinuity, not a misprediction: respawn, spawn or teleport. */
	teleported: boolean;
	/**
	 * A predicted dragon ride the server's state does not have — refused, or
	 * ended at a wall a lead-tick earlier than this client's clock. A
	 * legitimate discontinuity, like a respawn; the jitter metric must be told.
	 */
	dragonDropped: boolean;
	/**
	 * The server folded in a plunge-bomb catch this client did not predict:
	 * the rewind lands on a body already falling at the dive's speed. Same
	 * family as `dragonDropped` — a ride entered, not left — and announced the
	 * same way, so the enemy jitter metric skips the snap.
	 */
	carryStarted: boolean;
}

/**
 * One fighter the client predicts but does not own.
 *
 * Holds simulation state and the render offset that hides a correction, and
 * nothing else — the entity that draws it lives in the ECS world, so this class
 * never touches a sprite.
 */
export class RemoteFighter {
	state: PlayerPosition;

	/**
	 * The intent to keep pressing until the next snapshot says otherwise.
	 *
	 * `null` means the server froze this fighter — its input queue had run dry.
	 * That is reproduced rather than papered over: the server did not advance it,
	 * so neither do we. Inventing a tick of motion here is the same mistake as the
	 * server inventing one, and it costs the same permanent error.
	 */
	private intent: PlayerIntent | null = null;

	/**
	 * Is this fighter pressing the ultimate button, per the input the server
	 * last echoed for it?
	 *
	 * The button travels in the intent, so the whole room sees a held charge-up
	 * one snapshot after it starts — which is exactly what the charge aura is
	 * for. `null` intent (the server froze the fighter) reads as not held.
	 */
	get heldUltimate(): boolean {
		return this.intent?.ultimate === true;
	}

	private readonly smoother = new RenderSmoother(
		REMOTE_SMOOTH_FACTOR,
		REMOTE_TELEPORT_PX,
	);

	/**
	 * The geometry this fighter is predicted against — the room's, not the
	 * default's: predicting a wide-room fighter against single-screen walls
	 * would plant every correction at x=800 as a phantom wall contact.
	 *
	 * `kit` is the hero this fighter plays, from the snapshot — the same kit the
	 * server ticks them with, so the client's carry-forward and re-simulations
	 * run the same weapon tables the authoritative state came from.
	 */
	constructor(
		state: PlayerPosition,
		private readonly world: World = DEFAULT_WORLD,
		private kit: HeroKit = LIA_KIT,
	) {
		this.state = { ...state };
	}

	/** The hero this fighter plays, learned from the snapshot. */
	get hero(): HeroId {
		return this.kit.hero;
	}

	/** A hero change (the Esc menu) swaps the kit this fighter replays with. */
	setKit(kit: HeroKit) {
		this.kit = kit;
	}

	/**
	 * Advance one client fixed step on the carried-forward input.
	 *
	 * Called once per local physics step, so this fighter stays on the same tick
	 * as the locally predicted player.
	 */
	predict(
		dt: number,
		field: Singularity | null = null,
		traps: readonly Trap[] = [],
	) {
		if (!this.intent) return;
		this.state = tickPlayer(
			this.state,
			this.intent,
			dt,
			this.world,
			field,
			this.kit,
			traps,
		);
	}

	/**
	 * Fold in an authoritative state and re-simulate to the present.
	 *
	 * `leadTicks` is the local player's unacknowledged input count — see the file
	 * comment. `intent` is what the server actually simulated on that tick, or
	 * null if it froze the fighter.
	 */
	rollback(
		authoritative: PlayerPosition,
		intent: PlayerIntent | null,
		leadTicks: number,
		dt: number,
		field: Singularity | null = null,
		traps: readonly Trap[] = [],
	): RollbackResult {
		const beforeX = this.state.x;
		const beforeY = this.state.y;

		this.state = copyPlayerState(authoritative, { ...this.state });
		this.intent = intent;

		let resimTicks = 0;
		if (intent) {
			const depth = Math.max(0, Math.min(leadTicks, MAX_ROLLBACK_TICKS));
			for (let i = 0; i < depth; i++) {
				this.state = tickPlayer(
					this.state,
					intent,
					dt,
					this.world,
					field,
					this.kit,
					traps,
				);
				resimTicks++;
			}
		}

		const errorPx = Math.hypot(this.state.x - beforeX, this.state.y - beforeY);
		const teleported = errorPx > REMOTE_TELEPORT_PX;
		// A misprediction glides; a respawn snaps. The smoother's own threshold
		// makes that call, which is why the threshold is shared with it rather than
		// re-decided here.
		this.smoother.absorb(this.state.x - beforeX, this.state.y - beforeY);

		// A predicted ride the server's state does not have: the dragon was
		// refused (or ended at a wall a lead-tick earlier than this client's
		// clock), so the fighter snaps back from wherever the prediction had
		// ridden to. A legitimate discontinuity, like a respawn — announced so
		// the jitter metric does not count it.
		const dragonDropped =
			this.state.dragonTimer > 0 && authoritative.dragonTimer <= 0;
		// And its mirror: the server folded in a plunge-bomb catch this client
		// could not predict (it is a hit), and the rewind lands on a body
		// already falling at the dive's speed. Announced like the dragon's drop.
		const carryStarted =
			this.state.plungeCarryTimer <= 0 && authoritative.plungeCarryTimer > 0;

		return {
			errorPx,
			resimTicks,
			frozen: intent === null,
			teleported,
			dragonDropped,
			carryStarted,
		};
	}

	/**
	 * Adopt an authoritative state with no prediction and no smoothing.
	 *
	 * For an announced discontinuity — a respawn, a round reset, the first
	 * snapshot a fighter appears in. Easing across 600px turns one honest jump
	 * into a long smear of fake motion.
	 */
	teleport(authoritative: PlayerPosition, intent: PlayerIntent | null) {
		this.state = copyPlayerState(authoritative, { ...this.state });
		this.intent = intent;
		this.smoother.reset();
	}

	/** Where to draw this fighter: its state plus the decaying correction offset. */
	render(dtSec: number): { x: number; y: number } {
		const at = this.smoother.apply(this.state.x, this.state.y, dtSec);
		return legaliseDrawn(at.x, at.y, this.world);
	}
}

/**
 * Rollback measurements, accumulated across a run.
 *
 * Instrumentation before conclusion. Rollback trades a fixed visual delay for
 * occasional misprediction, and the only way to know whether that trade came out
 * ahead is to measure how often it mispredicts and by how much. `avgErrorPx`
 * near zero with a non-zero `rollbacks` count is the shape of a working
 * prediction; `rollbacks` at zero means no snapshots ever landed and every other
 * number here is meaningless.
 */
export class RollbackStats {
	private rollbacks = 0;
	private errors: number[] = [];
	private resimTicks = 0;
	private maxResimTicks = 0;
	private frozenTicks = 0;
	private teleports = 0;
	private maxLeadTicks = 0;
	private leadSum = 0;
	private leadSamples = 0;
	private primarySwitches = 0;

	record(result: RollbackResult) {
		this.rollbacks++;
		this.resimTicks += result.resimTicks;
		this.maxResimTicks = Math.max(this.maxResimTicks, result.resimTicks);
		if (result.frozen) this.frozenTicks++;
		if (result.teleported) {
			this.teleports++;
			return;
		}
		// A teleport is not a misprediction, and averaging it in would drown the
		// number that actually says whether prediction is working.
		this.errors.push(result.errorPx);
	}

	/**
	 * The fighter the `enemy_*` metrics are about changed.
	 *
	 * Not an error — a bot giving up its seat to a human is exactly what should
	 * happen. But it is the first thing to check when those metrics look wrong,
	 * because a change of subject reads identically to a fighter teleporting.
	 */
	recordPrimarySwitch() {
		this.primarySwitches++;
	}

	recordLead(leadTicks: number) {
		this.maxLeadTicks = Math.max(this.maxLeadTicks, leadTicks);
		this.leadSum += leadTicks;
		this.leadSamples++;
	}

	reset() {
		this.rollbacks = 0;
		this.errors = [];
		this.resimTicks = 0;
		this.maxResimTicks = 0;
		this.frozenTicks = 0;
		this.teleports = 0;
		this.maxLeadTicks = 0;
		this.leadSum = 0;
		this.leadSamples = 0;
		this.primarySwitches = 0;
	}

	summary() {
		// Two decimal places is the report's own precision, not a physics number.
		const round = (n: number) =>
			Math.round(n * ROUNDING_SCALE) / ROUNDING_SCALE;
		return {
			/** Authoritative states folded into a predicted fighter. Zero means no netcode ran. */
			rollbacks: this.rollbacks,
			avgErrorPx:
				this.errors.length > 0
					? round(this.errors.reduce((a, b) => a + b, 0) / this.errors.length)
					: 0,
			maxErrorPx: round(this.errors.reduce((m, e) => Math.max(m, e), 0)),
			/** Corrections a player could actually see. */
			visibleCorrections: this.errors.filter((e) => e > 1).length,
			avgResimTicks:
				this.rollbacks > 0 ? round(this.resimTicks / this.rollbacks) : 0,
			maxResimTicks: this.maxResimTicks,
			/** Ticks the server had frozen a fighter, and so did we. */
			frozenRemoteTicks: this.frozenTicks,
			/** Announced discontinuities — respawns and spawns. Not errors. */
			teleports: this.teleports,
			avgLeadTicks:
				this.leadSamples > 0 ? round(this.leadSum / this.leadSamples) : 0,
			maxLeadTicks: this.maxLeadTicks,
			/** Times the fighter the `enemy_*` metrics describe was replaced. */
			primarySwitches: this.primarySwitches,
		};
	}
}

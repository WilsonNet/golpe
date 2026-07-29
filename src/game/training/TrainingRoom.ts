/**
 * The client half of the training room.
 *
 * It owns three things and no more:
 *
 *   1. the conversation with the server's dummy (`training-config` out,
 *      `training-state` in),
 *   2. `window.__training`, the agent-facing controller,
 *   3. a *view* over `PhysicsDiagnostics` — never a second measurement stack. A
 *      second stack that disagreed with the first would be worse than none,
 *      because the training room is the instrument other results are taken
 *      with.
 *
 * It owns no gameplay. The dummy is server-side, hits are judged server-side,
 * and the local fighter is driven through the same `Input` a keyboard drives.
 */

import type { PhysicsDiagnostics } from "../diagnostics/PhysicsDiagnostics";
import { EventBus } from "../EventBus";
import type { Input } from "../input/Input";
import type { OnlineSession } from "../online/OnlineSession";
import type { MeleeEventMsg } from "../online/types";
import {
	type MeleeMove,
	type MeleeOutcome,
	MOVES,
	meleePhase,
	type PlayerIntent,
	type PlayerPosition,
} from "../simulation/Physics";
import type {
	DiagnosticView,
	MoveCount,
	PhaseTimings,
	TrainingApi,
	TrainingExchange,
	TrainingReport,
	TrainingScenario,
	TrainingState,
} from "./report";
import {
	type DummyScript,
	defaultTrainingConfig,
	type TrainingConfigPatch,
	type TrainingStateMsg,
} from "./types";

/** How long to wait for the server to echo a config change before giving up. */
const ECHO_TIMEOUT_MS = 2500;
/**
 * A clear released frame after every programmatic hold.
 *
 * The simulation edge-detects its own buttons, so two holds run back to back
 * would read as one continuous press and the second move would never start —
 * the same trap the beat format exists to avoid, on the agent's side of it.
 */
const RELEASE_GAP_MS = 60;
/**
 * How long a reset is given to land before the measurement window opens.
 *
 * Two snapshot intervals plus the smoothing that follows a respawn snap.
 */
const RESET_SETTLE_MS = 350;
/** Long enough for the fighter to turn before the buttons land. Three frames. */
const AIM_LEAD_MS = 50;

const NO_MOVES: MoveCount = { slash: 0, uppercut: 0, massive: 0 };

function moveCount(counts?: MoveCount): MoveCount {
	return { ...NO_MOVES, ...counts };
}

function declaredTimings(move: MeleeMove): PhaseTimings {
	const def = MOVES[move];
	return {
		startupMs: def.startupMs,
		activeMs: def.activeMs,
		recoveryMs: def.recoveryMs,
		totalMs: def.startupMs + def.activeMs + def.recoveryMs,
	};
}

const wait = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * Measures the local fighter's move phases from observed state.
 *
 * Deliberately *not* read off `meleeTimer`. The timer is the thing under test:
 * a state machine that skipped a phase would report perfect frame data about
 * itself. Sampling which phase is live each frame is an outside observation,
 * and the one-frame granularity is exactly the tolerance the diagnostic already
 * uses.
 */
class ExchangeWatcher {
	private move: MeleeMove | null = null;
	private measured: PhaseTimings = {
		startupMs: 0,
		activeMs: 0,
		recoveryMs: 0,
		totalMs: 0,
	};
	private startedAtMs = 0;
	private outcome: MeleeOutcome | null = null;
	private damage = 0;

	readonly exchanges: TrainingExchange[] = [];

	reset() {
		this.move = null;
		this.outcome = null;
		this.damage = 0;
		this.exchanges.length = 0;
	}

	/** A server-judged impact by the local fighter, while a move is in flight. */
	noteOutcome(outcome: MeleeOutcome, damage: number) {
		if (!this.move) return;
		this.outcome = outcome;
		this.damage = damage;
	}

	observe(body: PlayerPosition, dtMs: number, elapsedMs: number) {
		const action = body.meleeAction;

		if (action !== "none" && action !== this.move) {
			this.move = action;
			this.measured = {
				startupMs: 0,
				activeMs: 0,
				recoveryMs: 0,
				totalMs: 0,
			};
			this.startedAtMs = elapsedMs;
			this.outcome = null;
			this.damage = 0;
		}

		if (action !== "none") {
			const phase = meleePhase(body);
			if (phase === "startup") this.measured.startupMs += dtMs;
			else if (phase === "active") this.measured.activeMs += dtMs;
			else if (phase === "recovery") this.measured.recoveryMs += dtMs;
			this.measured.totalMs += dtMs;
			return;
		}

		if (!this.move) return;
		this.exchanges.push({
			move: this.move,
			outcome: this.outcome,
			damage: this.damage,
			measured: {
				startupMs: Math.round(this.measured.startupMs),
				activeMs: Math.round(this.measured.activeMs),
				recoveryMs: Math.round(this.measured.recoveryMs),
				totalMs: Math.round(this.measured.totalMs),
			},
			declared: declaredTimings(this.move),
			atMs: Math.round(this.startedAtMs),
		});
		if (this.exchanges.length > 64) this.exchanges.shift();
		this.move = null;
		this.outcome = null;
		this.damage = 0;
	}

	get last(): TrainingExchange | null {
		return this.exchanges.at(-1) ?? null;
	}
}

export interface TrainingRoomDeps {
	session: OnlineSession;
	input: Input;
	diagnostics: PhysicsDiagnostics;
	/** The local fighter's live simulation state — re-read, never captured. */
	localBody: () => PlayerPosition;
	localHp: () => number;
}

export class TrainingRoom {
	private latest: TrainingStateMsg | null = null;
	private readonly events: MeleeEventMsg[] = [];
	private readonly watcher = new ExchangeWatcher();
	private readonly echoWaiters: ((state: TrainingStateMsg) => void)[] = [];
	private elapsedMs = 0;
	private started = false;

	constructor(private readonly deps: TrainingRoomDeps) {
		deps.session.onTrainingState((state) => this.onTrainingState(state));
		// The diagnostic runs open-ended for the whole session: a scenario's window
		// is bounded by a reset at one end and a report at the other, and its
		// length is decided by the scenario rather than known up front.
		deps.diagnostics.startOpen();
		this.installApi();
	}

	// =========================================================
	//  Per-frame
	// =========================================================

	update(dtMs: number) {
		this.elapsedMs += dtMs;
		this.watcher.observe(this.deps.localBody(), dtMs, this.elapsedMs);
	}

	/**
	 * A server-judged impact. Only the ones the *local* fighter caused count as
	 * an exchange — the outcome of an incoming swing belongs to the dummy.
	 */
	recordMeleeEvent(event: MeleeEventMsg, byLocal: boolean) {
		this.events.push(event);
		if (this.events.length > 256) this.events.shift();
		if (!byLocal) return;
		const damage =
			event.outcome === "hit" || event.outcome === "backstab"
				? MOVES[event.move].damage
				: 0;
		this.watcher.noteOutcome(event.outcome, damage);
	}

	private onTrainingState(state: TrainingStateMsg) {
		this.latest = state;
		this.started = true;
		for (const resolve of this.echoWaiters.splice(0)) resolve(state);
		// The React panel is a client of this API like any other.
		EventBus.emit("training-state", state);
	}

	// =========================================================
	//  The agent API
	// =========================================================

	private installApi() {
		const api: TrainingApi = {
			set: (config) => this.set(config),
			script: (script) => this.setScript(script),
			clearRecording: () => this.clearRecording(),
			state: () => this.state(),
			reset: () => this.reset(),
			input: (intent, holdMs, aimAngle) =>
				this.driveInput(intent, holdMs, aimAngle),
			report: () => this.report(),
			run: (scenario) => this.run(scenario),
			ready: (timeoutMs) => this.ready(timeoutMs),
		};
		window.__training = api;
	}

	/** Resolve once the room is seated and the server has described itself. */
	async ready(timeoutMs = 15000): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		// Ask once rather than waiting to be told: the first `training-state` is
		// sent on change, and a room that has not changed yet has nothing to send.
		this.deps.session.sendTrainingConfig({});
		while (Date.now() < deadline) {
			if (this.started && this.deps.session.remoteState) return true;
			this.deps.session.sendTrainingConfig({});
			await wait(150);
		}
		return false;
	}

	private async send(msg: {
		config?: TrainingConfigPatch;
		reset?: boolean;
		clearRecording?: boolean;
	}): Promise<TrainingStateMsg | null> {
		const echo = new Promise<TrainingStateMsg | null>((resolve) => {
			this.echoWaiters.push(resolve);
			// Never hang a scenario on a dropped datagram. A late echo is a stale
			// readout; a missing one that blocks forever is a dead harness.
			setTimeout(() => resolve(this.latest), ECHO_TIMEOUT_MS);
		});
		this.deps.session.sendTrainingConfig(msg);
		return echo;
	}

	async set(config: TrainingConfigPatch): Promise<TrainingState> {
		await this.send({ config });
		return this.state();
	}

	async setScript(script: DummyScript): Promise<TrainingState> {
		return this.set({ behaviour: "script", script });
	}

	/**
	 * Drop the recording without touching the config.
	 *
	 * Its own message field rather than a config value: the buffer is history,
	 * not configuration, and folding it into the config would mean every
	 * unrelated patch had to carry a decision about whether to keep it.
	 */
	async clearRecording(): Promise<TrainingState> {
		await this.send({ clearRecording: true });
		return this.state();
	}

	/**
	 * Zero everything: both fighters back to spawn, no bullets, no counters, and
	 * a fresh diagnostic window.
	 *
	 * Both halves matter. Resetting the server without restarting the collector
	 * would leave the previous scenario's moves in the next scenario's report.
	 */
	async reset(): Promise<void> {
		await this.send({ reset: true });
		// Settle *first*, then start measuring.
		//
		// A respawn is a legitimate discontinuity that reconciliation corrects with
		// a single ~40px snap. Starting the window before it lands folded that snap
		// into every scenario's reconciliation error, so a perfectly healthy run
		// reported an average error several times what a normal match shows — the
		// measurement would have been reporting its own setup.
		await wait(RESET_SETTLE_MS);
		this.events.length = 0;
		this.watcher.reset();
		this.elapsedMs = 0;
		this.deps.diagnostics.startOpen();
	}

	/**
	 * Hold a set of buttons for exactly `holdMs`, then release.
	 *
	 * Routed through `Input`'s override layer, which sits *above* the keyboard
	 * rather than beside it — so what an agent tests is what a player gets. This
	 * is the piece Playwright cannot supply: it can press a key, but it cannot
	 * express "hold attack for 420ms and let go on this frame", which is the
	 * whole of the Massive Strike.
	 */
	private async driveInput(
		intent: Partial<PlayerIntent>,
		holdMs: number,
		aimAngle?: number,
	): Promise<void> {
		// Point, then swing — in that order, because that is the order the
		// simulation allows.
		//
		// Facing is locked through a swing's startup and active frames, and
		// `tickMelee` starts the move *before* facing is applied. Aiming and
		// attacking on the same tick therefore commits the fighter to whatever
		// direction it was already facing, and the aim is silently ignored for the
		// whole move: a scenario that aimed right and pressed attack swung left,
		// missed, and reported a clean whiff with nothing to explain it.
		// The lead is deliberately *not* released before the real hold. Releasing
		// hands the fighter back to the cursor for the gap — and a headless cursor
		// sits at the centre of the screen, so the fighter turned straight back
		// round and the swing still went the wrong way. The second `hold` replaces
		// the first with no keyboard frame in between.
		if (aimAngle !== undefined) {
			this.deps.input.hold({}, AIM_LEAD_MS + holdMs, aimAngle);
			await wait(AIM_LEAD_MS);
		}

		this.deps.input.hold(intent, holdMs, aimAngle);
		const deadline = Date.now() + holdMs + 1000;
		while (this.deps.input.overrideActive && Date.now() < deadline) {
			await wait(16);
		}
		this.deps.input.releaseOverride();
		await wait(RELEASE_GAP_MS);
	}

	// =========================================================
	//  Reading it back
	// =========================================================

	state(): TrainingState {
		const body = this.deps.localBody();
		const live = this.deps.session.remoteState;
		const latest = this.latest;

		return {
			connected: this.deps.session.connected && this.started,
			config: latest?.config ?? defaultTrainingConfig(),
			status: latest?.status ?? {
				behaviour: "idle",
				beatIndex: 0,
				beatCount: 0,
				beatElapsedMs: 0,
				recording: false,
				recordedFrames: 0,
				recordedMs: 0,
				playing: false,
				playbackIndex: 0,
			},
			// Config and counters come from the training channel; the body comes from
			// the 20Hz snapshot, which is fresher than a message sent on change.
			dummy: {
				id: latest?.dummy.id ?? "",
				hp: latest?.stats.dummy.hp ?? 0,
				x: live?.x ?? latest?.dummy.x ?? 0,
				y: live?.y ?? latest?.dummy.y ?? 0,
				vx: live?.vx ?? latest?.dummy.vx ?? 0,
				vy: live?.vy ?? latest?.dummy.vy ?? 0,
				facing: live?.facing ?? latest?.dummy.facing ?? 1,
				meleeAction: live?.meleeAction ?? latest?.dummy.meleeAction ?? "none",
				phase: live ? meleePhase(live) : (latest?.dummy.phase ?? "none"),
				blocking: live?.blocking ?? latest?.dummy.blocking ?? false,
				stunned: live ? live.stunTimer > 0 : (latest?.dummy.stunned ?? false),
			},
			stats: latest?.stats ?? {
				player: {
					bulletsFired: 0,
					bulletHits: 0,
					damageDealt: 0,
					damageTaken: 0,
					hp: this.deps.localHp(),
				},
				dummy: {
					bulletsFired: 0,
					bulletHits: 0,
					damageDealt: 0,
					damageTaken: 0,
					hp: 0,
				},
			},
			elapsedMs: Math.round(this.elapsedMs),
			local: {
				hp: this.deps.localHp(),
				x: body.x,
				y: body.y,
				facing: body.facing,
				meleeAction: body.meleeAction,
				phase: meleePhase(body),
				blocking: body.blocking,
				stunned: body.stunTimer > 0,
				massiveReady: body.massiveReady,
				stance: body.stance,
			},
			lastExchange: this.watcher.last,
		};
	}

	report(): TrainingReport {
		const view = this.deps.diagnostics.peek() as DiagnosticView;
		const melee = view.meleeSummary;
		const stats = this.state().stats;

		const outcomes: Record<MeleeOutcome, number> = {
			hit: 0,
			backstab: 0,
			blocked: 0,
			parried: 0,
		};
		let parriedByDummy = 0;
		for (const e of this.events) {
			outcomes[e.outcome]++;
			// The dummy parried when *our* attack came back parried.
			if (e.outcome === "parried" && e.attackerId !== this.latest?.dummy.id) {
				parriedByDummy++;
			}
		}

		return {
			durationMs: Math.round(this.elapsedMs),
			player: {
				moves: moveCount(melee?.movesByFighter["local"]),
				blocks: melee?.blocksByFighter["local"] ?? 0,
				damageDealt: stats.player.damageDealt,
				damageTaken: stats.player.damageTaken,
			},
			dummy: {
				moves: moveCount(melee?.movesByFighter["remote"]),
				blocks: melee?.blocksByFighter["remote"] ?? 0,
				parries: parriedByDummy,
				damageDealt: stats.dummy.damageDealt,
				damageTaken: stats.dummy.damageTaken,
			},
			events: this.events.slice(),
			outcomes,
			bullets: {
				fired: stats.player.bulletsFired,
				hits: stats.player.bulletHits,
			},
			violations: melee?.violations ?? [],
			melee,
			reconciliation: view.reconciliationSummary,
			exchanges: this.watcher.exchanges.slice(),
			lastExchange: this.watcher.last,
			connected: this.deps.session.connected && this.started,
		};
	}

	/**
	 * A whole test in one call.
	 *
	 * Config, then reset, then act, then settle. The reset is *after* the config
	 * on purpose: a scenario's spawn positions are part of its configuration, and
	 * resetting first would place the fighters using the previous scenario's.
	 */
	async run(scenario: TrainingScenario): Promise<TrainingReport> {
		const config: TrainingConfigPatch = { ...scenario.config };
		if (scenario.script) {
			config.behaviour = "script";
			config.script = scenario.script;
		}
		if (Object.keys(config).length > 0) await this.set(config);
		await this.reset();

		for (const step of scenario.steps ?? []) {
			await this.driveInput(step.intent, step.holdMs, step.aimAngle);
			if (step.restMs) await wait(step.restMs);
		}
		await wait(scenario.settleMs ?? 400);

		const report = this.report();
		report.scenario = scenario.name;
		return report;
	}

	destroy() {
		// `delete` rather than assigning undefined: under
		// `exactOptionalPropertyTypes` an optional property and one holding
		// `undefined` are different types, and only removal actually clears it.
		delete window.__training;
	}
}

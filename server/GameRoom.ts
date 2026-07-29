import type { ServerChannel } from "@geckos.io/server";
import type { AIConfig } from "../src/game/characters/AIConfig.js";
import {
	type AIInput,
	type AIOutput,
	EnemyBrain,
} from "../src/game/characters/EnemyBrain.js";
import type {
	TrainingConfig,
	TrainingConfigMsg,
	TrainingConfigPatch,
	TrainingFighterStats,
	TrainingStateMsg,
} from "../src/game/training/types.js";
import {
	applyMeleeResult,
	BULLET_DAMAGE,
	BULLET_SPEED,
	type BulletState,
	bulletHitsPlatform,
	bulletHitsPlayer,
	canFire,
	createPlayerState,
	hasLineOfSight,
	isBulletOutOfBounds,
	type MeleeMove,
	type MeleeOutcome,
	meleePhase,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type PlayerIntent,
	type PlayerPosition,
	resolveMelee,
	tickBullet,
	tickPlayer,
} from "./physics.js";
import { TrainingDummy } from "./TrainingDummy.js";

export interface PlayerInput extends PlayerIntent {
	seq: number;
	aimAngle: number;
}

export interface MeleeEventMsg {
	attackerId: string;
	move: MeleeMove;
	outcome: MeleeOutcome;
	x: number;
	y: number;
	dir: number;
}

/** Per-fighter counters. Only the server sees a bullet connect, or a hit land through invincibility. */
function newStats(): Omit<TrainingFighterStats, "hp"> {
	return { bulletsFired: 0, bulletHits: 0, damageDealt: 0, damageTaken: 0 };
}

interface ConnectedPlayer {
	/** null for a server-hosted bot or a training dummy, which have no channel. */
	channel: ServerChannel | null;
	/** Set only for bots: the fighter logic driving this player. */
	brain: EnemyBrain | null;
	/**
	 * Set only in a training room: the scripted input source driving this player.
	 *
	 * Exactly one of `channel`, `brain` and `dummy` decides where a tick's input
	 * comes from. They are alternatives, not layers — the training room is not a
	 * second pipeline, it is a third input source into the one that exists.
	 */
	dummy: TrainingDummy | null;
	/** Full simulation state — never rebuilt per tick, or wall state is lost. */
	state: PlayerPosition;
	hp: number;
	lastAttackTime: number;
	/** Inputs received but not yet simulated, in arrival order. */
	queue: PlayerInput[];
	/** Most recent input consumed; repeated when the queue runs dry. */
	lastInput: PlayerInput;
	lastSeq: number;
	/** Consecutive ticks with no input available. */
	starvedTicks: number;
	/**
	 * The input actually simulated this tick, or null when the player was frozen.
	 *
	 * The dummy's `mirror` and `record` behaviours read this rather than
	 * `lastInput`: recording a frozen tick would record a frame the player never
	 * sent, and a playback of invented frames is not a playback of what they did.
	 */
	tickInput: PlayerInput | null;
	/** What to simulate this tick — including a repeat of `lastInput` when starved. */
	pendingInput: PlayerInput | null;
	stats: ReturnType<typeof newStats>;
}

export interface SnapshotPlayer {
	id: string;
	hp: number;
	facingDir: number;
	lastSeq: number;
	state: PlayerPosition;
}

export interface SnapshotBullet {
	id: number;
	ownerId: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
}

const START_X_A = 100;
const START_X_B = 668;
const START_Y = 480;

const MAX_PLAYERS = 2;
const TICK_RATE = 1000 / 60;
const BROADCAST_RATE = 1000 / 20;
const RESET_DELAY_MS = 1500;

/**
 * Cap on buffered input. A client that floods or lags must not be able to make
 * the server simulate an unbounded backlog in one tick.
 */
const MAX_QUEUED_INPUTS = 10;

/** Randomised bot personality, so a solo match is not the same fight every time. */
function botConfig(): AIConfig {
	return {
		skillLevel: 4 + Math.floor(Math.random() * 4),
		reactionTime: 150 + Math.floor(Math.random() * 250),
		accuracy: 0.45 + Math.random() * 0.4,
		aggressiveness: 0.35 + Math.random() * 0.45,
		dodgeChance: 0.2 + Math.random() * 0.4,
	};
}

/**
 * How long a player may be frozen waiting for input before the server gives up
 * and repeats their last intent.
 *
 * Simulating a tick the client did not simulate is the single biggest source of
 * client/server divergence: the client can only replay inputs it knows about,
 * so every invented tick becomes a permanent position error that reconciliation
 * has to yank back — roughly 8px per tick while falling. Freezing for a few
 * ticks instead keeps both sides on the same tick count and is invisible at
 * these timescales, while the cap stops a silent client hanging in mid-air.
 */
const MAX_STARVED_TICKS = 6;

function idleInput(seq = 0): PlayerInput {
	return {
		seq,
		left: false,
		right: false,
		up: false,
		attack: false,
		block: false,
		uppercut: false,
		swordStance: true,
		face: 0,
		dash: 0,
		aimAngle: 0,
	};
}

export class GameRoom {
	readonly id: string;
	private players = new Map<string, ConnectedPlayer>();
	private bullets: BulletState[] = [];
	private nextBulletId = 0;
	/** Melee impacts accumulated since the last broadcast, for client effects. */
	private meleeEvents: MeleeEventMsg[] = [];
	private channelIds: string[] = [];
	private tickAccumulator = 0;
	private broadcastAccumulator = 0;
	private lastTime = 0;
	private resetTimer = -1;
	/** ms of training simulated since the last `reset`, for the report's window. */
	private trainingElapsedMs = 0;
	/** What was last sent as `training-state`, so it can be sent on change only. */
	private trainingSignature = "";

	constructor(id: string) {
		this.id = id;
	}

	get playerCount(): number {
		return this.channelIds.length;
	}

	/** Humans only — a room of nothing but bots should be reaped. */
	get humanCount(): number {
		return [...this.players.values()].filter((p) => p.channel !== null).length;
	}

	get isFull(): boolean {
		return this.channelIds.length >= MAX_PLAYERS;
	}

	addPlayer(channel: ServerChannel): boolean {
		if (this.isFull) return false;

		const isFirst = this.channelIds.length === 0;
		const id = channel.id as string;
		this.channelIds.push(id);
		this.players.set(id, {
			channel,
			brain: null,
			dummy: null,
			state: createPlayerState(
				isFirst ? START_X_A : START_X_B,
				START_Y,
				isFirst ? 1 : -1,
			),
			hp: 100,
			lastAttackTime: 0,
			queue: [],
			lastInput: idleInput(),
			lastSeq: 0,
			starvedTicks: 0,
			tickInput: null,
			pendingInput: null,
			stats: newStats(),
		});

		channel.join(this.id);
		channel.userData = { roomId: this.id };

		channel.on("input", (data: unknown) => {
			const player = this.players.get(id);
			if (!player) return;
			const input = data as PlayerInput;
			if (typeof input?.seq !== "number") return;
			// Ignore replays of inputs already simulated.
			if (input.seq <= player.lastSeq) return;
			player.queue.push(input);
			if (player.queue.length > MAX_QUEUED_INPUTS) {
				player.queue.splice(0, player.queue.length - MAX_QUEUED_INPUTS);
			}
		});

		// The training room's only client→server message. Registered on every
		// channel rather than only in training rooms, because a room learns it is
		// a training room from `join`, which has already been handled by the time
		// the client is in a position to configure anything.
		channel.on("training-config", (data: unknown) => {
			this.applyTrainingConfig(data as TrainingConfigMsg | null);
		});

		channel.onDisconnect(() => {
			this.removePlayer(id);
		});

		return true;
	}

	/**
	 * Fill a slot with a server-hosted bot.
	 *
	 * The bot is an ordinary player from the simulation's point of view — same
	 * state, same tickPlayer, same bullets. Only its input source differs, so a
	 * solo match exercises the entire netcode path instead of bypassing it.
	 */
	addBot(): boolean {
		if (this.isFull) return false;

		const isFirst = this.channelIds.length === 0;
		const id = `bot-${this.id}-${this.channelIds.length}`;
		this.channelIds.push(id);
		this.players.set(id, {
			channel: null,
			brain: new EnemyBrain(botConfig()),
			dummy: null,
			state: createPlayerState(
				isFirst ? START_X_A : START_X_B,
				START_Y,
				isFirst ? 1 : -1,
			),
			hp: 100,
			lastAttackTime: 0,
			queue: [],
			lastInput: idleInput(),
			lastSeq: 0,
			starvedTicks: 0,
			tickInput: null,
			pendingInput: null,
			stats: newStats(),
		});
		return true;
	}

	/**
	 * Fill a slot with a scriptable training dummy instead of a bot.
	 *
	 * Deliberately the same shape as `addBot`: the dummy is an ordinary player to
	 * the simulation, and a training room is an ordinary online match. Everything
	 * a training session exercises — prediction, reconciliation, server-owned
	 * bullets, server-judged hits — is exercised exactly as it is in a real one,
	 * which is the entire reason the dummy is not on the client.
	 */
	addDummy(patch: TrainingConfigPatch = {}): boolean {
		if (this.isFull) return false;

		const isFirst = this.channelIds.length === 0;
		const id = `dummy-${this.id}-${this.channelIds.length}`;
		const dummy = new TrainingDummy(patch);
		this.channelIds.push(id);
		this.players.set(id, {
			channel: null,
			brain: null,
			dummy,
			state: createPlayerState(
				isFirst ? START_X_A : START_X_B,
				START_Y,
				isFirst ? 1 : -1,
			),
			hp: dummy.config.dummyHp,
			lastAttackTime: 0,
			queue: [],
			lastInput: idleInput(),
			lastSeq: 0,
			starvedTicks: 0,
			tickInput: null,
			pendingInput: null,
			stats: newStats(),
		});
		// Place both fighters where the config asks before anyone sees a snapshot.
		this.resetPlayers(false);
		return true;
	}

	get hasBot(): boolean {
		return [...this.players.values()].some((p) => p.brain !== null);
	}

	get isTrainingRoom(): boolean {
		return this.dummySlot !== undefined;
	}

	private get dummySlot(): ConnectedPlayer | undefined {
		return [...this.players.values()].find((p) => p.dummy !== null);
	}

	private get trainingConfig(): TrainingConfig | null {
		return this.dummySlot?.dummy?.config ?? null;
	}

	/**
	 * Apply a live config change. **No reconnect**, by design: a menu that
	 * required one would be useless, and an agent that had to reconnect between
	 * scenarios could not run a battery.
	 */
	applyTrainingConfig(msg: TrainingConfigMsg | null) {
		const slot = this.dummySlot;
		const dummy = slot?.dummy;
		if (!dummy || !msg) return;

		if (msg.config) dummy.configure(msg.config);
		if (msg.clearRecording) dummy.clearRecording();
		if (msg.reset) this.resetTraining();
		// Echo unconditionally: the client's promise is waiting on this, and a
		// no-op patch is still an answer.
		this.emitTrainingState(true);
	}

	/** Respawn both fighters, clear the arena, and zero every counter. */
	private resetTraining() {
		this.dummySlot?.dummy?.reset();
		for (const p of this.players.values()) p.stats = newStats();
		this.trainingElapsedMs = 0;
		this.resetPlayers();
	}

	private trainingState(): TrainingStateMsg | null {
		const slot = this.dummySlot;
		const dummy = slot?.dummy;
		if (!slot || !dummy) return null;

		const player = [...this.players.values()].find((p) => p.channel !== null);
		const stats = (p: ConnectedPlayer | undefined): TrainingFighterStats => ({
			...(p?.stats ?? newStats()),
			hp: p?.hp ?? 0,
		});

		return {
			config: dummy.config,
			status: dummy.status,
			dummy: {
				id:
					[...this.players.keys()].find((k) => this.players.get(k) === slot) ??
					"",
				hp: slot.hp,
				x: slot.state.x,
				y: slot.state.y,
				vx: slot.state.vx,
				vy: slot.state.vy,
				facing: slot.state.facing,
				meleeAction: slot.state.meleeAction,
				phase: meleePhase(slot.state),
				blocking: slot.state.blocking,
				stunned: slot.state.stunTimer > 0,
			},
			stats: { player: stats(player), dummy: stats(slot) },
			elapsedMs: Math.round(this.trainingElapsedMs),
		};
	}

	/**
	 * Send `training-state` when it has actually changed.
	 *
	 * Snapshot-adjacent, not per-tick. Position is deliberately outside the
	 * change signature — it is already in the snapshot, and including it would
	 * turn "on change" into "every broadcast" the moment the dummy walks.
	 */
	private emitTrainingState(force = false) {
		const state = this.trainingState();
		if (!state) return;

		const signature = JSON.stringify([state.config, state.status, state.stats]);
		if (!force && signature === this.trainingSignature) return;
		this.trainingSignature = signature;
		this.broadcast("training-state", state);
	}

	/**
	 * Ask this player's input source what it wants to do this tick.
	 *
	 * One function for both sources on purpose. A bot and a dummy differ only in
	 * *what* decides; they read the same perception, produce the same `AIOutput`
	 * and travel down the same wire format, so there is no second pipeline to
	 * keep in step with the first.
	 */
	private scriptedInput(
		bot: ConnectedPlayer,
		dtMs: number,
		now: number,
	): PlayerInput {
		const foe = [...this.players.values()].find((p) => p !== bot);
		if (!foe) return idleInput();

		const perception = this.perceive(bot, foe);
		let out: AIOutput;
		if (bot.dummy) {
			// The player's input for *this* tick, which is why the human slot is
			// always consumed first: `mirror` and `record` are defined in terms of
			// what the player actually did, not what they did a tick ago.
			bot.dummy.observe(foe.tickInput, dtMs);
			out = bot.dummy.decide(perception, now, dtMs);
		} else if (bot.brain) {
			out = bot.brain.decide(perception, now, dtMs);
		} else {
			return idleInput();
		}

		return {
			seq: 0,
			left: out.moveLeft,
			right: out.moveRight,
			up: out.jump,
			attack: out.attack,
			block: out.block,
			uppercut: out.uppercut,
			swordStance: out.swordStance,
			face: out.face,
			dash: out.dash,
			aimAngle: out.aimAngle,
		};
	}

	/** Everything an input source is allowed to see, built from simulation state only. */
	private perceive(bot: ConnectedPlayer, foe: ConnectedPlayer): AIInput {
		const dx = foe.state.x - bot.state.x;
		const dy = foe.state.y - bot.state.y;
		return {
			playerX: foe.state.x,
			playerY: foe.state.y,
			selfX: bot.state.x,
			selfY: bot.state.y,
			distanceToPlayer: Math.hypot(dx, dy),
			// Facing lives in the simulation, not beside it. This read `foe.facingDir`
			// — a field removed when facing moved into `PlayerPosition` — so it was
			// silently `undefined`, and `undefined * n` is NaN. Every `playerFacesMe`
			// test was therefore false and the server's bots could never evade.
			// `server/` was outside `tsc` at the time, so nothing caught it.
			playerFacingDirection: foe.state.facing,
			touchingDown: bot.state.grounded,
			touchingLeft: bot.state.wallTouch === "left",
			touchingRight: bot.state.wallTouch === "right",
			hasLineOfSight: hasLineOfSight(
				bot.state.x,
				bot.state.y,
				foe.state.x,
				foe.state.y,
			),
			selfHP: bot.hp,
			enemyHP: foe.hp,
			enemyAction: foe.state.meleeAction,
			enemyPhase: meleePhase(foe.state),
			enemyBlocking: foe.state.blocking,
			enemyStunned: foe.state.stunTimer > 0,
			selfAction: bot.state.meleeAction,
			selfStunned: bot.state.stunTimer > 0,
			selfMassiveReady: bot.state.massiveReady,
		};
	}

	private removePlayer(id: string) {
		const player = this.players.get(id);
		player?.channel?.leave();
		this.players.delete(id);
		this.channelIds = this.channelIds.filter((c) => c !== id);
	}

	get snapshot(): {
		t: number;
		players: SnapshotPlayer[];
		bullets: SnapshotBullet[];
		melee: MeleeEventMsg[];
	} {
		const playerArr: SnapshotPlayer[] = [];
		for (const [id, p] of this.players) {
			playerArr.push({
				id,
				hp: p.hp,
				// Facing lives in the simulation now, because the melee hitbox is
				// built from it and both sides must agree on which way a swing points.
				facingDir: p.state.facing,
				lastSeq: p.lastSeq,
				state: p.state,
			});
		}
		return {
			t: Date.now(),
			players: playerArr,
			bullets: this.bullets.map((b) => ({
				id: b.id,
				ownerId: b.ownerId,
				x: b.x,
				y: b.y,
				vx: b.vx,
				vy: b.vy,
			})),
			melee: this.meleeEvents.slice(),
		};
	}

	tick(time: number) {
		if (this.lastTime === 0) this.lastTime = time;
		const elapsed = time - this.lastTime;
		this.lastTime = time;
		this.tickAccumulator += elapsed;
		this.broadcastAccumulator += elapsed;

		// Bound catch-up so a stalled process cannot spiral.
		if (this.tickAccumulator > TICK_RATE * 5) {
			this.tickAccumulator = TICK_RATE * 5;
		}

		while (this.tickAccumulator >= TICK_RATE) {
			this.fixedTick(TICK_RATE / 1000, time);
			this.tickAccumulator -= TICK_RATE;
		}

		if (this.broadcastAccumulator >= BROADCAST_RATE) {
			this.broadcastAccumulator = 0;
			this.broadcastState();
		}
	}

	/**
	 * Take the next input for a player. Returns null when the player should be
	 * frozen this tick because no input has arrived yet.
	 */
	private consumeInput(player: ConnectedPlayer): PlayerInput | null {
		const next = player.queue.shift();
		if (next) {
			player.lastInput = next;
			player.lastSeq = next.seq;
			player.starvedTicks = 0;
			player.tickInput = next;
			return next;
		}

		player.starvedTicks++;
		if (player.starvedTicks <= MAX_STARVED_TICKS) {
			player.tickInput = null;
			return null;
		}
		// Given up waiting: hold the previous intent, but do not re-acknowledge a
		// sequence we have already applied. Nor is a repeated intent a frame the
		// player sent, so it is not offered to the dummy's recorder.
		player.tickInput = null;
		return player.lastInput;
	}

	private fixedTick(dt: number, now: number) {
		// Human slots first, so a dummy's `mirror` and `record` see the player's
		// input for *this* tick. The map is in insertion order and the human is
		// always seated before the dummy, but relying on that would make a
		// recording silently one tick stale the day the seating order changes.
		for (const player of this.players.values()) {
			if (!player.brain && !player.dummy) {
				player.pendingInput = this.consumeInput(player);
			}
		}

		for (const [id, player] of this.players) {
			const input =
				player.brain || player.dummy
					? this.scriptedInput(player, dt * 1000, now)
					: player.pendingInput;
			if (!input) continue;

			player.state = tickPlayer(player.state, input, dt);

			// A fighter holds a sword or a gun, never both: firing is gated on the
			// stance the simulation says they are actually in.
			if (
				player.hp > 0 &&
				player.state.stance === "gun" &&
				input.attack &&
				canFire(player.lastAttackTime, now)
			) {
				player.lastAttackTime = now;
				player.stats.bulletsFired++;
				this.bullets.push({
					id: this.nextBulletId++,
					ownerId: id,
					x: player.state.x + PLAYER_WIDTH / 2,
					y: player.state.y + PLAYER_HEIGHT / 2,
					vx: Math.cos(input.aimAngle) * BULLET_SPEED,
					vy: Math.sin(input.aimAngle) * BULLET_SPEED,
				});
			}
		}

		this.resolveMeleeHits();
		this.tickBullets(dt);
		this.applyTrainingRules(dt);

		if (this.resetTimer > 0) {
			this.resetTimer -= dt * 1000;
			if (this.resetTimer <= 0) this.resetPlayers();
			return;
		}

		// A training session is not a round. Ending one every time the practising
		// player loses their HP bar would restart the scenario mid-measurement,
		// which is worse than useless when the scenario *is* the measurement.
		if (this.trainingConfig?.disableRoundReset) return;

		for (const player of this.players.values()) {
			if (player.hp <= 0) {
				this.resetTimer = RESET_DELAY_MS;
				break;
			}
		}
	}

	/**
	 * Invincibility, applied after damage has been counted.
	 *
	 * Order is the whole point: `stats.damageDealt` is incremented where the hit
	 * is resolved, and the HP bar is refilled here. A report taken from an
	 * invincible practice session therefore still says exactly what landed —
	 * which is what makes "did that uppercut beat the guard?" answerable without
	 * having to turn the training wheels off first.
	 */
	private applyTrainingRules(dt: number) {
		const cfg = this.trainingConfig;
		if (!cfg) return;

		this.trainingElapsedMs += dt * 1000;
		for (const player of this.players.values()) {
			if (player.dummy) {
				if (cfg.dummyInvincible) player.hp = cfg.dummyHp;
			} else if (cfg.playerInvincible) {
				player.hp = 100;
			}
		}
	}

	/**
	 * Judge every live melee hitbox against every other fighter.
	 *
	 * This is the half of sword combat a client never gets to decide. Whether a
	 * swing connected, was blocked, was parried or landed from behind depends on
	 * *both* fighters, and only the server sees both authoritatively — so the
	 * client predicts the swing's timing and nothing about its outcome.
	 *
	 * The consequences are written straight into `state`, which is the whole
	 * reason stun and launch live in the simulation: they replay through
	 * reconciliation with no special case.
	 */
	private resolveMeleeHits() {
		for (const [attackerId, attacker] of this.players) {
			if (attacker.hp <= 0) continue;

			for (const [defenderId, defender] of this.players) {
				if (defenderId === attackerId || defender.hp <= 0) continue;

				const result = resolveMelee(attacker.state, defender.state);
				if (!result) continue;

				const damage = applyMeleeResult(attacker.state, defender.state, result);
				defender.hp = Math.max(0, defender.hp - damage);
				// Counted before invincibility refills the bar, so a practice session
				// still reports what actually connected.
				attacker.stats.damageDealt += damage;
				defender.stats.damageTaken += damage;

				this.meleeEvents.push({
					attackerId,
					move: result.move,
					outcome: result.outcome,
					x: result.x,
					y: result.y,
					dir: result.dir,
				});
			}
		}
	}

	private tickBullets(dt: number) {
		// Compact in place: advance every bullet, keep the survivors at the front,
		// then truncate. Splicing mid-iteration meant the loop index and the array
		// length were changing together, which is exactly the sort of thing that
		// works until someone adds a second removal path.
		let kept = 0;
		for (const b of this.bullets) {
			tickBullet(b, dt);

			if (isBulletOutOfBounds(b) || bulletHitsPlatform(b)) continue;

			let consumed = false;
			for (const [id, player] of this.players) {
				if (b.ownerId === id || player.hp <= 0) continue;
				if (!bulletHitsPlayer(b, player.state.x, player.state.y)) continue;
				player.hp = Math.max(0, player.hp - BULLET_DAMAGE);
				player.stats.damageTaken += BULLET_DAMAGE;
				// A client never learns why a projectile vanished, so this counter is
				// the only honest source for the training report's bullet numbers.
				const owner = this.players.get(b.ownerId);
				if (owner) {
					owner.stats.bulletHits++;
					owner.stats.damageDealt += BULLET_DAMAGE;
				}
				consumed = true;
				break;
			}

			if (!consumed) this.bullets[kept++] = b;
		}
		this.bullets.length = kept;
	}

	private resetPlayers(announce = true) {
		const cfg = this.trainingConfig;
		this.channelIds.forEach((id, i) => {
			const p = this.players.get(id);
			if (!p) return;
			// In a training room the spawns are part of the scenario: a backstab test
			// needs a known separation, and a determinism check needs two runs to
			// start from the same two points.
			const spawn = cfg
				? p.dummy
					? cfg.spawn.dummy
					: cfg.spawn.player
				: { x: i === 0 ? START_X_A : START_X_B, y: START_Y };
			const facing = cfg
				? p.dummy
					? cfg.spawn.dummy.x >= cfg.spawn.player.x
						? -1
						: 1
					: cfg.spawn.player.x <= cfg.spawn.dummy.x
						? 1
						: -1
				: i === 0
					? 1
					: -1;
			p.state = createPlayerState(spawn.x, spawn.y, facing);
			p.hp = p.dummy ? (cfg?.dummyHp ?? 100) : 100;
			p.lastAttackTime = 0;
			p.queue.length = 0;
			p.pendingInput = null;
			p.tickInput = null;
			if (p.brain) p.brain = new EnemyBrain(botConfig());
		});
		this.bullets = [];
		this.meleeEvents.length = 0;
		this.resetTimer = -1;

		// Tell clients explicitly. A respawn is a legitimate discontinuity, and
		// announcing it beats every client guessing from a distance threshold.
		if (announce) this.broadcast("round-reset", { t: Date.now() });
	}

	broadcast(event: string, data: object) {
		for (const player of this.players.values()) {
			player.channel?.emit(event, data);
		}
	}

	private broadcastState() {
		// Alongside the snapshot rather than on its own clock, and only when
		// something in it changed — a training room is an ordinary match, and its
		// extra channel should not run hotter than the state it annotates.
		this.emitTrainingState();

		const snap = this.snapshot;
		for (const player of this.players.values()) {
			player.channel?.emit("state", snap);
		}
		// Melee events are one-shot. Cleared unconditionally, so a room with no
		// listening humans does not accumulate them forever.
		this.meleeEvents.length = 0;
	}
}

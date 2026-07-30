import type { ServerChannel } from "@geckos.io/server";
import type { AIConfig } from "../src/game/characters/AIConfig.js";
import {
	type AIInput,
	type AIOutput,
	EnemyBrain,
} from "../src/game/characters/EnemyBrain.js";
import {
	type GameSnapshot,
	type MatchStatus,
	type MeleeEventMsg,
	type PlayerInput,
	RELIABLE,
	type RosterMsg,
	type SnapshotPlayer,
} from "../src/game/online/types.js";
import { packIntent, packState } from "../src/game/online/wire.js";
import { pickSpawn, type SpawnPoint } from "../src/game/simulation/Arena.js";
import {
	MATCH_OVER_LINGER_MS,
	type MatchEndReason,
	type MatchPhase,
	matchEndReason,
	matchWinner,
	RESPAWN_DELAY_MS,
	SCORE_LIMIT,
	type ScoreEntry,
	TIME_LIMIT_MS,
} from "../src/game/simulation/Deathmatch.js";
import type {
	TrainingConfig,
	TrainingConfigMsg,
	TrainingConfigPatch,
	TrainingFighterStats,
	TrainingStateMsg,
} from "../src/game/training/types.js";
import { botName, sanitiseName, uniqueName } from "./BotNames.js";
import {
	applyMeleeResult,
	BULLET_DAMAGE,
	BULLET_SPEED,
	type BulletState,
	blocksBullet,
	bulletHitsPlatform,
	bulletHitsPlayer,
	canFire,
	createPlayerState,
	hasLineOfSight,
	isBulletOutOfBounds,
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

/** Per-fighter counters. Only the server sees a bullet connect, or a hit land through invincibility. */
function newStats(): Omit<TrainingFighterStats, "hp"> {
	return { bulletsFired: 0, bulletHits: 0, damageDealt: 0, damageTaken: 0 };
}

interface ConnectedPlayer {
	id: string;
	/** What the scoreboard calls this fighter. Never empty. */
	name: string;
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
	/** Deathmatch score. */
	kills: number;
	deaths: number;
	/**
	 * Down and waiting to respawn.
	 *
	 * A dead fighter is still simulated — it is held still by an ordinary stun, so
	 * both sides discard its intent through the same code path — but it cannot be
	 * hit and cannot score.
	 */
	alive: boolean;
	/** ms until this fighter returns to the arena. Only meaningful while dead. */
	respawnTimer: number;
	/** Who last damaged this fighter, for kill credit. */
	lastHurtBy: string | null;
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
	/**
	 * The intent this fighter was actually advanced with this tick, for the
	 * snapshot.
	 *
	 * This is what lets every other client roll this fighter forward to the
	 * present instead of drawing it in the past. `null` means it was frozen, which
	 * clients must reproduce rather than paper over.
	 */
	simulatedIntent: PlayerIntent | null;
	stats: ReturnType<typeof newStats>;
}

const START_Y = 480;

/**
 * Sixteen fighters per room.
 *
 * The arena has seventeen spawn points, one more than the cap, so a respawn
 * always has somewhere to go that nobody is standing on.
 */
const MAX_PLAYERS = 16;
const TICK_RATE = 1000 / 60;
const BROADCAST_RATE = 1000 / 20;
const RESET_DELAY_MS = 1500;

/** How often the roster is re-sent even when nothing changed. See `tick`. */
const ROSTER_HEARTBEAT_MS = 2000;

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
	/**
	 * Monotonic simulation tick. The anchor every client rolls back to.
	 *
	 * Never reset, not even between matches: it is a clock, and a clock that goes
	 * backwards would make every client re-simulate the whole match.
	 */
	private tickCount = 0;
	private resetTimer = -1;
	/** ms of training simulated since the last `reset`, for the report's window. */
	private trainingElapsedMs = 0;
	/** What was last sent as `training-state`, so it can be sent on change only. */
	private trainingSignature = "";
	/** ms since the roster was last sent. */
	private rosterAccumulator = 0;

	/** Deathmatch clock and lifecycle. */
	private phase: MatchPhase = "live";
	private matchElapsedMs = 0;
	private endReason: MatchEndReason = null;
	private winnerId: string | null = null;
	private overTimer = 0;
	private readonly scoreLimit: number;
	private readonly timeLimitMs: number;

	/**
	 * How many fighters this room keeps topped up with bots.
	 *
	 * **Zero by default: bots are opt-in.** A room is for the people in it, and
	 * seating seven strangers nobody asked for is a decision, not a default — the
	 * room still holds up to `MAX_PLAYERS` humans either way. Ask for bots with
	 * `?bots=N` (N to play against) or `?fill=N` (this many fighters, whoever they
	 * turn out to be).
	 *
	 * Fixed when the room is created and never changed. Reading it from each
	 * arriving client's request instead would let the last person through the door
	 * resize a match everybody else was already playing.
	 */
	readonly fillTarget: number;

	constructor(
		id: string,
		rules: {
			scoreLimit?: number;
			timeLimitMs?: number;
			fillTarget?: number;
		} = {},
	) {
		this.id = id;
		this.scoreLimit = rules.scoreLimit ?? SCORE_LIMIT;
		this.timeLimitMs = rules.timeLimitMs ?? TIME_LIMIT_MS;
		this.fillTarget = Math.max(0, Math.min(rules.fillTarget ?? 0, MAX_PLAYERS));
	}

	get playerCount(): number {
		return this.channelIds.length;
	}

	/** Humans only — a room of nothing but bots should be reaped. */
	get humanCount(): number {
		return [...this.players.values()].filter((p) => p.channel !== null).length;
	}

	get botCount(): number {
		return [...this.players.values()].filter((p) => p.brain !== null).length;
	}

	get isFull(): boolean {
		return this.channelIds.length >= MAX_PLAYERS;
	}

	get names(): ReadonlySet<string> {
		return new Set([...this.players.values()].map((p) => p.name));
	}

	/** Every field a new slot needs, so the three seating paths cannot drift. */
	private newSlot(
		id: string,
		name: string,
		spawn: SpawnPoint,
		hp: number,
		sources: {
			channel?: ServerChannel | null;
			brain?: EnemyBrain | null;
			dummy?: TrainingDummy | null;
		},
	): ConnectedPlayer {
		return {
			id,
			name,
			channel: sources.channel ?? null,
			brain: sources.brain ?? null,
			dummy: sources.dummy ?? null,
			state: createPlayerState(spawn.x, spawn.y, spawn.facing),
			hp,
			kills: 0,
			deaths: 0,
			alive: true,
			respawnTimer: 0,
			lastHurtBy: null,
			lastAttackTime: 0,
			queue: [],
			lastInput: idleInput(),
			lastSeq: 0,
			starvedTicks: 0,
			tickInput: null,
			pendingInput: null,
			simulatedIntent: null,
			stats: newStats(),
		};
	}

	/** Where the living currently stand, for spawn selection. */
	private occupiedPoints(): { x: number; y: number }[] {
		return [...this.players.values()]
			.filter((p) => p.alive)
			.map((p) => ({ x: p.state.x, y: p.state.y }));
	}

	addPlayer(channel: ServerChannel, rawName?: unknown): boolean {
		// A room full of bots still has room for a human: bots exist to keep the
		// arena busy, not to hold a seat against the people the arena is for.
		if (this.isFull && !this.freeBotSlot()) return false;

		const id = channel.id as string;
		// Deduplicated against the room, exactly as a bot's name is. Two players
		// called `Wilson` on one scoreboard is indistinguishable from a scoring bug,
		// and it happens constantly — people pick the same handle, and two tabs on one
		// machine share the name remembered in `localStorage`.
		const name = uniqueName(
			sanitiseName(rawName, `Player${this.channelIds.length + 1}`),
			this.names,
		);
		this.channelIds.push(id);
		this.players.set(
			id,
			this.newSlot(id, name, pickSpawn(this.occupiedPoints()), 100, {
				channel,
			}),
		);

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

		this.broadcastRoster();
		return true;
	}

	/** Evict one bot so a human can sit down. Returns false if there was none. */
	private freeBotSlot(): boolean {
		const bot = [...this.players.values()].find((p) => p.brain !== null);
		if (!bot) return false;
		this.removePlayer(bot.id);
		console.log(`[MATCH] ${this.id}: bot ${bot.name} left to seat a human`);
		return true;
	}

	/**
	 * Fill a slot with a server-hosted bot.
	 *
	 * The bot is an ordinary player from the simulation's point of view — same
	 * state, same tickPlayer, same bullets, same scoreboard row. Only its input
	 * source differs, so a match against bots exercises the entire netcode path
	 * instead of bypassing it. That is what makes a room full of AI a real test.
	 */
	addBot(): boolean {
		if (this.isFull) return false;

		const id = `bot-${this.id}-${this.channelIds.length}`;
		this.channelIds.push(id);
		this.players.set(
			id,
			this.newSlot(
				id,
				botName(this.names),
				pickSpawn(this.occupiedPoints()),
				100,
				{
					brain: new EnemyBrain(botConfig()),
				},
			),
		);
		this.broadcastRoster();
		return true;
	}

	/**
	 * Make the room hold exactly `target` fighters, using bots as the ballast.
	 *
	 * Both directions, which is the part that matters. Filling up only was not
	 * enough: two humans joining a room asked for two fighters got three, because
	 * the bot seated for the first human was never asked to leave — so a test that
	 * wanted a clean duel silently measured a three-way fight.
	 *
	 * Humans are never evicted. A room with more humans than the target keeps all
	 * of them and simply has no bots.
	 */
	rebalanceBots(target: number): number {
		// Zero is a real target, not a missing one: it means "this room has no bots",
		// which is the default. Clamping it up to one would quietly seat a bot in
		// every humans-only room, which is the whole thing being fixed.
		const want = Math.max(0, Math.min(target, MAX_PLAYERS));
		let changed = 0;
		while (this.playerCount > want && this.freeBotSlot()) changed++;
		while (this.playerCount < want && this.addBot()) changed++;
		return changed;
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

		const id = `dummy-${this.id}-${this.channelIds.length}`;
		const dummy = new TrainingDummy(patch);
		this.channelIds.push(id);
		this.players.set(
			id,
			this.newSlot(
				id,
				"Dummy",
				{ x: 668, y: START_Y, facing: -1 },
				dummy.config.dummyHp,
				{ dummy },
			),
		);
		// Place both fighters where the config asks before anyone sees a snapshot.
		this.resetPlayers(false);
		this.broadcastRoster();
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
				id: slot.id,
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
		this.broadcastReliable("training-state", state);
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
		const foe = this.nearestFoe(bot);
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

	/**
	 * The living opponent closest to `self`.
	 *
	 * `EnemyBrain` reasons about exactly one enemy, which was the whole world at
	 * two players. At sixteen, somebody has to choose which one — and "the nearest
	 * one still standing" is the choice that makes a bot fight whoever is actually
	 * threatening it rather than sprinting across the arena at a fixed rival.
	 */
	private nearestFoe(self: ConnectedPlayer): ConnectedPlayer | undefined {
		let best: ConnectedPlayer | undefined;
		let bestDist = Number.POSITIVE_INFINITY;
		for (const p of this.players.values()) {
			if (p === self || !p.alive) continue;
			const dist = Math.hypot(
				p.state.x - self.state.x,
				p.state.y - self.state.y,
			);
			if (dist < bestDist) {
				bestDist = dist;
				best = p;
			}
		}
		return best;
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
		// Bullets outlive their owner's slot otherwise, and one of them would
		// eventually be credited to an id nobody holds.
		this.bullets = this.bullets.filter((b) => b.ownerId !== id);
		this.broadcastRoster();
	}

	// =========================================================
	//  DEATHMATCH
	// =========================================================

	private scoreEntries(): ScoreEntry[] {
		return [...this.players.values()].map((p) => ({
			id: p.id,
			name: p.name,
			kills: p.kills,
			deaths: p.deaths,
			bot: p.brain !== null,
		}));
	}

	private matchStatus(): MatchStatus {
		return {
			phase: this.phase,
			elapsedMs: Math.round(this.matchElapsedMs),
			scoreLimit: this.scoreLimit,
			timeLimitMs: this.timeLimitMs,
			endReason: this.endReason,
			winnerId: this.winnerId,
			nextMatchInMs:
				this.phase === "over" ? Math.max(0, Math.round(this.overTimer)) : 0,
		};
	}

	/**
	 * Credit a kill and put the victim down.
	 *
	 * Death is expressed as an ordinary stun rather than a flag the simulation
	 * would have to learn about. That is not a shortcut: stun is already the one
	 * legitimate way a fighter's state changes without the client predicting it,
	 * it is already replayed correctly through reconciliation, and it already
	 * discards intent identically on both sides. A `dead` field in
	 * `PlayerPosition` would have needed all of that built again.
	 */
	private killPlayer(victim: ConnectedPlayer) {
		victim.alive = false;
		victim.deaths++;
		victim.respawnTimer = RESPAWN_DELAY_MS;
		victim.hp = 0;
		victim.state.stunTimer = RESPAWN_DELAY_MS;
		victim.state.blocking = false;
		victim.state.meleeAction = "none";
		victim.state.meleeTimer = 0;

		const killer =
			victim.lastHurtBy && victim.lastHurtBy !== victim.id
				? this.players.get(victim.lastHurtBy)
				: undefined;
		if (killer) killer.kills++;
		victim.lastHurtBy = null;

		console.log(
			`[FRAG] ${killer?.name ?? "the arena"} killed ${victim.name} (${killer?.kills ?? 0})`,
		);
	}

	/** Damage one fighter, crediting `sourceId`, and score the kill if it lands. */
	private damage(victim: ConnectedPlayer, amount: number, sourceId: string) {
		if (!victim.alive || amount <= 0) return;
		// Scores are frozen once the podium is decided; the fight is allowed to
		// keep going, because freezing the simulation is what desyncs it.
		if (this.phase === "over") return;

		victim.lastHurtBy = sourceId;
		victim.hp = Math.max(0, victim.hp - amount);
		victim.stats.damageTaken += amount;

		const source = this.players.get(sourceId);
		if (source && source !== victim) source.stats.damageDealt += amount;

		if (victim.hp <= 0) this.killPlayer(victim);
	}

	private tickRespawns(dt: number) {
		for (const player of this.players.values()) {
			if (player.alive) continue;
			player.respawnTimer -= dt * 1000;
			if (player.respawnTimer > 0) continue;
			this.respawn(player);
		}
	}

	/**
	 * Put one fighter back in the arena.
	 *
	 * Announced, never inferred — the same rule the round reset follows. The
	 * message races the snapshot that carries the respawned state, so a client
	 * must also treat a correction past the teleport threshold as a discontinuity;
	 * the announcement is what lets it drop this fighter's rollback history
	 * immediately rather than a frame late.
	 */
	private respawn(player: ConnectedPlayer) {
		const spawn = pickSpawn(
			this.occupiedPoints().filter(
				(p) => p.x !== player.state.x || p.y !== player.state.y,
			),
		);
		player.state = createPlayerState(spawn.x, spawn.y, spawn.facing);
		player.hp = 100;
		player.alive = true;
		player.respawnTimer = 0;
		player.lastHurtBy = null;
		player.queue.length = 0;
		player.pendingInput = null;
		player.tickInput = null;
		player.simulatedIntent = null;
		this.broadcast("respawn", { id: player.id, t: Date.now() });
	}

	private tickMatchClock(dt: number) {
		if (this.phase === "over") {
			this.overTimer -= dt * 1000;
			if (this.overTimer <= 0) this.restartMatch();
			return;
		}

		this.matchElapsedMs += dt * 1000;
		const reason = matchEndReason(
			this.scoreEntries(),
			this.matchElapsedMs,
			this.scoreLimit,
			this.timeLimitMs,
		);
		if (reason) this.endMatch(reason);
	}

	private endMatch(reason: MatchEndReason) {
		const standings = this.scoreEntries();
		const winner = matchWinner(standings);
		this.phase = "over";
		this.endReason = reason;
		this.winnerId = winner?.id ?? null;
		this.overTimer = MATCH_OVER_LINGER_MS;

		console.log(
			`[MATCH] ${this.id} over by ${reason}: ${winner?.name ?? "nobody"} wins with ${winner?.kills ?? 0}`,
		);
		// The full standings, once, with names attached. The scoreboard rebuilds
		// this from the snapshot every frame; the podium is a one-shot announcement
		// and should not depend on a client having kept up.
		this.broadcastReliable("match-over", {
			reason,
			winnerId: this.winnerId,
			standings,
		});
	}

	private restartMatch() {
		for (const player of this.players.values()) {
			player.kills = 0;
			player.deaths = 0;
			player.stats = newStats();
			// A fresh personality per match, so sixteen bots do not replay the same
			// fight every five minutes.
			if (player.brain) player.brain = new EnemyBrain(botConfig());
		}
		this.phase = "live";
		this.matchElapsedMs = 0;
		this.endReason = null;
		this.winnerId = null;
		this.overTimer = 0;
		console.log(`[MATCH] ${this.id}: new match`);
		this.resetPlayers();
	}

	// =========================================================
	//  SNAPSHOT
	// =========================================================

	get snapshot(): GameSnapshot {
		const playerArr: SnapshotPlayer[] = [];
		for (const p of this.players.values()) {
			playerArr.push({
				id: p.id,
				hp: p.hp,
				lastSeq: p.lastSeq,
				// Packed rather than sent as an object: sixteen verbatim
				// `PlayerPosition` objects is ~6KB a snapshot, which is both a lot of
				// bandwidth and a datagram nobody's MTU wants. See `online/wire.ts`.
				state: packState(p.state),
				input: p.simulatedIntent ? packIntent(p.simulatedIntent) : null,
				kills: p.kills,
				deaths: p.deaths,
				alive: p.alive,
			});
		}
		return {
			t: Date.now(),
			tick: this.tickCount,
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
			match: this.matchStatus(),
		};
	}

	private roster(): RosterMsg {
		return {
			players: [...this.players.values()].map((p) => ({
				id: p.id,
				name: p.name,
				bot: p.brain !== null,
			})),
		};
	}

	private broadcastRoster() {
		this.rosterAccumulator = 0;
		this.broadcast("roster", this.roster());
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

		// Names are sent on change *and* on a slow heartbeat.
		//
		// On change alone is not enough: these are unreliable datagrams, so a lost
		// roster leaves a client showing raw ids on its scoreboard for the rest of
		// the match with nothing to trigger a retry. Sixteen names every two seconds
		// is ~300 B/s — cheap enough that self-healing is the obvious trade.
		this.rosterAccumulator += elapsed;
		if (this.rosterAccumulator >= ROSTER_HEARTBEAT_MS) this.broadcastRoster();
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
		this.tickCount++;

		// Human slots first, so a dummy's `mirror` and `record` see the player's
		// input for *this* tick. The map is in insertion order and the human is
		// always seated before the dummy, but relying on that would make a
		// recording silently one tick stale the day the seating order changes.
		for (const player of this.players.values()) {
			if (!player.brain && !player.dummy) {
				player.pendingInput = this.consumeInput(player);
			}
		}

		for (const player of this.players.values()) {
			const input =
				player.brain || player.dummy
					? this.scriptedInput(player, dt * 1000, now)
					: player.pendingInput;
			if (!input) {
				// Frozen. Recorded as frozen, so every other client freezes it too
				// rather than inventing a tick of motion for it.
				player.simulatedIntent = null;
				continue;
			}

			player.simulatedIntent = input;
			player.state = tickPlayer(player.state, input, dt);

			// A fighter holds a sword or a gun, never both: firing is gated on the
			// stance the simulation says they are actually in.
			if (
				player.alive &&
				player.state.stance === "gun" &&
				input.attack &&
				canFire(player.lastAttackTime, now)
			) {
				player.lastAttackTime = now;
				player.stats.bulletsFired++;
				this.bullets.push({
					id: this.nextBulletId++,
					ownerId: player.id,
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

		// A training session is not a deathmatch. It keeps the old round lifecycle:
		// the scenario is the unit of measurement, and a scenario that respawned one
		// fighter mid-run while the other kept its score would measure nothing.
		if (this.isTrainingRoom) {
			this.tickTrainingRound(dt);
			return;
		}

		this.tickRespawns(dt);
		this.tickMatchClock(dt);
	}

	private tickTrainingRound(dt: number) {
		if (this.resetTimer > 0) {
			this.resetTimer -= dt * 1000;
			if (this.resetTimer <= 0) this.resetPlayers();
			return;
		}

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
	 * Quadratic in fighters, which at sixteen is 240 hitbox tests a tick — but
	 * `resolveMelee` early-outs on "this fighter has no live hitbox", so all but a
	 * handful cost one null check. A swing still hits at most one fighter, because
	 * `hitLatch` closes it on the first connection; that is a combat rule, not an
	 * optimisation, and it is why the iteration order below does not change who
	 * gets hit by more than which of two simultaneous overlaps wins.
	 */
	private resolveMeleeHits() {
		for (const attacker of this.players.values()) {
			if (!attacker.alive) continue;

			for (const defender of this.players.values()) {
				if (defender === attacker || !defender.alive) continue;

				const result = resolveMelee(attacker.state, defender.state);
				if (!result) continue;

				const damage = applyMeleeResult(attacker.state, defender.state, result);
				this.damage(defender, damage, attacker.id);

				this.meleeEvents.push({
					attackerId: attacker.id,
					victimId: defender.id,
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
			for (const player of this.players.values()) {
				if (b.ownerId === player.id || !player.alive) continue;
				if (!bulletHitsPlayer(b, player.state.x, player.state.y)) continue;

				// A guard covers the side you face, bullets included. The shot is
				// consumed either way — it hit something — but an absorbed one deals
				// nothing and is not counted as a hit against the shooter.
				if (blocksBullet(player.state, b.vx)) {
					consumed = true;
					break;
				}

				// A client never learns why a projectile vanished, so this counter is
				// the only honest source for the training report's bullet numbers.
				const owner = this.players.get(b.ownerId);
				if (owner) owner.stats.bulletHits++;
				this.damage(player, BULLET_DAMAGE, b.ownerId);
				consumed = true;
				break;
			}

			if (!consumed) this.bullets[kept++] = b;
		}
		this.bullets.length = kept;
	}

	/**
	 * Put everyone back at a spawn point at once.
	 *
	 * The whole-arena reset: a new match, or a training scenario restarting. An
	 * individual death goes through `respawn` instead — resetting sixteen fighters
	 * because one of them lost a duel is exactly what a deathmatch is not.
	 */
	private resetPlayers(announce = true) {
		const cfg = this.trainingConfig;
		// Spawns are chosen one at a time against the points already handed out, so
		// a match never starts with two fighters inside each other — which the
		// depenetrator would resolve by shoving one of them sideways on tick one, on
		// every client, at once.
		const taken: { x: number; y: number }[] = [];
		this.channelIds.forEach((id) => {
			const p = this.players.get(id);
			if (!p) return;
			// In a training room the spawns are part of the scenario: a backstab test
			// needs a known separation, and a determinism check needs two runs to
			// start from the same two points.
			const spawn: SpawnPoint = cfg
				? p.dummy
					? {
							...cfg.spawn.dummy,
							facing: cfg.spawn.dummy.x >= cfg.spawn.player.x ? -1 : 1,
						}
					: {
							...cfg.spawn.player,
							facing: cfg.spawn.player.x <= cfg.spawn.dummy.x ? 1 : -1,
						}
				: pickSpawn(taken);
			taken.push({ x: spawn.x, y: spawn.y });

			p.state = createPlayerState(spawn.x, spawn.y, spawn.facing);
			p.hp = p.dummy ? (cfg?.dummyHp ?? 100) : 100;
			p.alive = true;
			p.respawnTimer = 0;
			p.lastHurtBy = null;
			p.lastAttackTime = 0;
			p.queue.length = 0;
			p.pendingInput = null;
			p.tickInput = null;
			p.simulatedIntent = null;
			if (p.brain) p.brain = new EnemyBrain(botConfig());
		});
		this.bullets = [];
		this.meleeEvents.length = 0;
		this.resetTimer = -1;

		// Tell clients explicitly. A respawn is a legitimate discontinuity, and
		// announcing it beats every client guessing from a distance threshold.
		if (announce) this.broadcastReliable("round-reset", { t: Date.now() });
	}

	broadcast(event: string, data: object) {
		for (const player of this.players.values()) {
			player.channel?.emit(event, data);
		}
	}

	/**
	 * Broadcast a one-shot announcement until it lands.
	 *
	 * For messages with no second chance and no fallback — the podium, a match
	 * restart, the training room's echo. See `RELIABLE` in `online/types.ts` for
	 * which messages qualify and, more importantly, which deliberately do not.
	 */
	private broadcastReliable(event: string, data: object) {
		for (const player of this.players.values()) {
			player.channel?.emit(event, data, RELIABLE);
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

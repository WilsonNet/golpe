import type { ServerChannel } from "@geckos.io/server";
import type { AIConfig } from "../src/game/characters/AIConfig.js";
import { EnemyBrain } from "../src/game/characters/EnemyBrain.js";
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

interface ConnectedPlayer {
	/** null for a server-hosted bot, which has no network channel. */
	channel: ServerChannel | null;
	/** Set only for bots: the fighter logic driving this player. */
	brain: EnemyBrain | null;
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
		});
		return true;
	}

	get hasBot(): boolean {
		return [...this.players.values()].some((p) => p.brain !== null);
	}

	/** Ask the bot's brain what it wants to do this tick. */
	private botInput(bot: ConnectedPlayer, dtMs: number, now: number): PlayerInput {
		const foe = [...this.players.values()].find((p) => p !== bot);
		if (!foe || !bot.brain) return idleInput();

		const dx = foe.state.x - bot.state.x;
		const dy = foe.state.y - bot.state.y;
		const out = bot.brain.decide(
			{
				playerX: foe.state.x,
				playerY: foe.state.y,
				selfX: bot.state.x,
				selfY: bot.state.y,
				distanceToPlayer: Math.hypot(dx, dy),
				playerFacingDirection: foe.facingDir,
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
			},
			now,
			dtMs,
		);

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
			aimAngle: out.aimAngle,
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
			return next;
		}

		player.starvedTicks++;
		if (player.starvedTicks <= MAX_STARVED_TICKS) return null;
		// Given up waiting: hold the previous intent, but do not re-acknowledge a
		// sequence we have already applied.
		return player.lastInput;
	}

	private fixedTick(dt: number, now: number) {
		for (const [id, player] of this.players) {
			const input = player.brain
				? this.botInput(player, dt * 1000, now)
				: this.consumeInput(player);
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

		if (this.resetTimer > 0) {
			this.resetTimer -= dt * 1000;
			if (this.resetTimer <= 0) this.resetPlayers();
			return;
		}

		for (const player of this.players.values()) {
			if (player.hp <= 0) {
				this.resetTimer = RESET_DELAY_MS;
				break;
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

				const damage = applyMeleeResult(
					attacker.state,
					defender.state,
					result,
				);
				defender.hp = Math.max(0, defender.hp - damage);

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
		for (let i = this.bullets.length - 1; i >= 0; i--) {
			const b = this.bullets[i];
			tickBullet(b, dt);

			if (isBulletOutOfBounds(b) || bulletHitsPlatform(b)) {
				this.bullets.splice(i, 1);
				continue;
			}

			for (const [id, player] of this.players) {
				if (b.ownerId === id || player.hp <= 0) continue;
				if (!bulletHitsPlayer(b, player.state.x, player.state.y)) continue;
				player.hp = Math.max(0, player.hp - BULLET_DAMAGE);
				this.bullets.splice(i, 1);
				break;
			}
		}
	}

	private resetPlayers() {
		this.channelIds.forEach((id, i) => {
			const p = this.players.get(id);
			if (!p) return;
			p.state = createPlayerState(
				i === 0 ? START_X_A : START_X_B,
				START_Y,
				i === 0 ? 1 : -1,
			);
			p.hp = 100;
			p.lastAttackTime = 0;
			p.queue.length = 0;
			if (p.brain) p.brain = new EnemyBrain(botConfig());
		});
		this.bullets = [];
		this.meleeEvents.length = 0;
		this.resetTimer = -1;

		// Tell clients explicitly. A respawn is a legitimate discontinuity, and
		// announcing it beats every client guessing from a distance threshold.
		this.broadcast("round-reset", { t: Date.now() });
	}

	broadcast(event: string, data: object) {
		for (const player of this.players.values()) {
			player.channel?.emit(event, data);
		}
	}

	private broadcastState() {
		const snap = this.snapshot;
		for (const player of this.players.values()) {
			player.channel?.emit("state", snap);
		}
		// Melee events are one-shot. Cleared unconditionally, so a room with no
		// listening humans does not accumulate them forever.
		this.meleeEvents.length = 0;
	}
}

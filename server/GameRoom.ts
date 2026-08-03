import type { ServerChannel } from "@geckos.io/server";
import type { AIConfig } from "../src/game/characters/AIConfig.js";
import { EnemyBrain } from "../src/game/characters/EnemyBrain.js";
import type {
	AIInput,
	AIOutput,
	AllyInfo,
	FoeInfo,
} from "../src/game/characters/types.js";
import {
	type DenyEventMsg,
	type GameSnapshot,
	type MatchStatus,
	type MeleeEventMsg,
	type PlayerInput,
	RELIABLE,
	type RosterMsg,
	type SnapshotCinematic,
	type SnapshotPlayer,
	type TeamStatus,
} from "../src/game/online/types.js";
import { packIntent, packState } from "../src/game/online/wire.js";
import {
	buildWorld,
	pickSpawn,
	pickTeamSpawn,
	type SpawnPoint,
	type World,
} from "../src/game/simulation/Arena.js";
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
import {
	aliveCounts,
	balanceTeam,
	hostile,
	type MatchMode,
	ROUND_FREEZE_MS,
	ROUND_RESET_DELAY_MS,
	roundResult,
	TDM_SCORE_LIMIT,
	type TeamId,
	teamAhead,
	teamCounts,
	teamMatchWinner,
	teamName,
} from "../src/game/simulation/Teams.js";
import type {
	TrainingConfig,
	TrainingConfigMsg,
	TrainingConfigPatch,
	TrainingFighterStats,
	TrainingStateMsg,
} from "../src/game/training/types.js";
import { botName, sanitiseName, uniqueName } from "./BotNames.js";
import {
	addCharge,
	applyMeleeResult,
	BULLET_DAMAGE,
	BULLET_SPEED,
	type BulletState,
	blocksBullet,
	blocksUltimate,
	bulletHitsPlatform,
	bulletHitsPlayer,
	canFire,
	createPlayerState,
	fieldAffects,
	fieldFor,
	type GrenadeState,
	grenadeEnd,
	grenadeTouches,
	hasLineOfSight,
	isBulletOutOfBounds,
	isFrozen,
	isKnockedDown,
	isStunned,
	launchGrenade,
	meleePhase,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type PlayerIntent,
	type PlayerPosition,
	resolveMelee,
	SINGULARITY_DAMAGE_INTERVAL_MS,
	SINGULARITY_DURATION_MS,
	SINGULARITY_TICK_DAMAGE,
	type Singularity,
	singularityGrip,
	tickBullet,
	tickGrenade,
	tickPlayer,
	ULT_CHARGE_PER_DAMAGE,
	ULT_CHARGE_PER_KILL,
	ULT_CINEMATIC_MS,
	ULT_MAX_CHARGE,
	ULT_PASSIVE_PER_SEC,
	ultReady,
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
	/**
	 * Which side this fighter is on, or `null` in a free-for-all.
	 *
	 * Assigned once when the slot is seated and never reassigned mid-match:
	 * balancing a live match by moving somebody across would hand the round they
	 * are in to the other side. A leaver is replaced by the next joiner going to
	 * whichever team is now smaller, which is where the balance actually comes
	 * from.
	 */
	team: TeamId | null;
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
	/**
	 * Whether the last damage came from an ultimate.
	 *
	 * The hole pays no charge, and a kill it scores pays no kill bonus either —
	 * the ultimate is the one weapon that cannot feed the ultimate meter. This
	 * flag is how the kill credit knows.
	 */
	lastHurtByUlt: boolean;
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
	/**
	 * Ultimate charge, 0..100. Server-owned; see specs/ultimate.md.
	 *
	 * **Survives death** — carrying an ult through a respawn is what makes it a
	 * plan rather than a lottery ticket. Only a match restart zeroes it, along
	 * with everything else about the match.
	 */
	ult: number;
	/**
	 * Release-edge detection for the ultimate button.
	 *
	 * Holding R is the *aim phase* — the cast is decided when the button is let
	 * go, not when it goes down. The held button travels on the wire like any
	 * other, and this is the edge that turns a hold into exactly one cast.
	 */
	ultHeld: boolean;
	/** The aim angle of the most recent input that held the ultimate button. */
	ultAimAngle: number;
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
 *
 * **Ten, and raising it is a regression.** A deep queue is not free storage: it
 * is *latency*, because the server executes inputs in order, so a ten-deep queue
 * means acting on what the player pressed 166ms ago. This was briefly raised to
 * 24 to make room for the cinematic freeze, and `diagnose.mjs` started failing
 * with "combo links thrown airborne" — an AI vs AI client's brain decides "slash,
 * I am on the ground", and 400ms later the server applies it to a fighter that
 * has since jumped. The cap belongs where it was; the freeze gets its own.
 */
const MAX_QUEUED_INPUTS = 10;

/**
 * The cap *while the room is frozen for an ultimate*, and briefly afterwards.
 *
 * The freeze is the one thing that legitimately parks input: the server stops
 * consuming the instant a cast lands and a client keeps sending until the news
 * reaches it, so one-way latency's worth piles up — and dropping any of it would
 * be a permanent divergence, because the client already simulated those ticks.
 *
 * It drains itself, which is why this needs no cleanup. A client freezes when the
 * message reaches it and unfreezes when the next one does, so it is silent for
 * exactly as long *after* the server resumes as it was late in stopping; the
 * server eats the backlog in that window and the queue is back to its ordinary
 * depth. `CINEMATIC_QUEUE_GRACE_MS` is that window, plus margin.
 */
const MAX_QUEUED_INPUTS_FROZEN = 32;
const CINEMATIC_QUEUE_GRACE_MS = 400;

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
		ultimate: false,
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
	/** Ultimate denies since the last broadcast, for the client's "DENY" splash. */
	private denies: DenyEventMsg[] = [];
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

	// ---- the ultimate ----
	//
	// One cinematic and one singularity per room, both nullable, both owned here
	// for the same reason bullets are: only the server may decide that an
	// ultimate happened, and only the server may decide when it is over.
	private cinematic: { casterId: string; msLeft: number } | null = null;
	/**
	 * ms during which input may queue deeper than usual: the freeze itself, plus
	 * the window in which the backlog it parked is still draining. See
	 * `MAX_QUEUED_INPUTS`.
	 */
	private cinematicGraceMs = 0;
	/**
	 * The throw waiting on the far side of the cinematic.
	 *
	 * The grenade is launched when the freeze *ends*, not when the button is
	 * released. That ordering is the whole risk in the ability: the room is told a
	 * black hole is coming and only then does it have to be thrown well — and the
	 * announcement gives the room time to see the arc and dodge. The aim angle is
	 * captured at the release so a caster cannot re-aim during their own cutscene.
	 */
	private pendingThrow: {
		ownerId: string;
		ownerTeam: TeamId | null;
		x: number;
		y: number;
		angle: number;
	} | null = null;
	private grenades: GrenadeState[] = [];
	private singularity: Singularity | null = null;
	/** ms since the open singularity last dealt damage. */
	private singularityDamageAcc = 0;
	private nextUltId = 0;

	/** Deathmatch clock and lifecycle. */
	private phase: MatchPhase = "live";
	private matchElapsedMs = 0;
	private endReason: MatchEndReason = null;
	private winnerId: string | null = null;
	private overTimer = 0;
	private readonly scoreLimit: number;
	private readonly timeLimitMs: number;

	// =========================================================
	//  TEAM DEATHMATCH
	// =========================================================
	//
	// A room plays one mode for its whole life. `"ffa"` leaves every field below
	// inert — teams are `null`, `tickTeamRound` returns immediately, and the
	// friendly-fire predicate answers "hostile" for every pair, so the deathmatch
	// path is byte for byte the one that was there before.

	/** Which ruleset this room plays. Fixed by its creator. */
	readonly mode: MatchMode;
	/** Rounds won, indexed by team id. */
	private teamScores: number[] = [0, 0];
	/** 1-based, for the HUD's "ROUND N". */
	private roundNumber = 1;
	/** Counting down to the next round's spawn, after a wipe. -1 while live. */
	private roundResetTimer = -1;
	private lastRoundWinner: TeamId | null = null;
	private winnerTeam: TeamId | null = null;
	/**
	 * ms of freezetime left before the round goes live. Room-level, for the HUD
	 * and for the two things that are decided outside `tickPlayer` — a gunshot and
	 * an ultimate cast.
	 *
	 * The *authority* on whether a given fighter is frozen is that fighter's own
	 * `state.freezeTimer`, because that is what both sides simulate and replay.
	 * This is the same number, kept where a fighter-less caller can read it.
	 */
	private roundFreezeMs = 0;
	/**
	 * How long freezetime lasts in this room. `?freezeTime=S`, creator-only.
	 *
	 * Ten seconds is the number the mode is designed around; a probe that had to
	 * sit through ten of them per run is a probe nobody waits for, so it can be
	 * shortened exactly like the score and time limits — and, like them, only by
	 * whoever creates the room.
	 */
	private readonly freezeTimeMs: number;

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

	/**
	 * The arena this room plays in: bounds, platforms and spawn points for its
	 * screen count.
	 *
	 * Built once when the room is created and shared by every fighter in it —
	 * every `tickPlayer`, bullet check, spawn pick and bot brain reads this
	 * object. The client builds the same geometry from the `match` message, so
	 * both sides collide with the same world.
	 */
	readonly world: World;

	constructor(
		id: string,
		rules: {
			scoreLimit?: number;
			timeLimitMs?: number;
			fillTarget?: number;
			screens?: number;
			startUltCharge?: number;
			mode?: MatchMode;
			freezeTimeMs?: number;
		} = {},
	) {
		this.id = id;
		this.mode = rules.mode ?? "ffa";
		this.freezeTimeMs =
			this.mode === "tdm"
				? Math.max(0, rules.freezeTimeMs ?? ROUND_FREEZE_MS)
				: 0;
		// The first round gets its countdown like every other one. Fighters seated
		// while it runs inherit whatever is left of it, so a bot arriving three
		// seconds in is planted for the remaining seven rather than walking around
		// a room that has not started.
		this.roundFreezeMs = this.freezeTimeMs;
		// A frag limit and a round limit are different numbers for different
		// things: 21 frags is a deathmatch, 15 wipe-outs is a team match. Asking
		// for one and getting the other's default is how a TDM room silently
		// became a twenty-one-round marathon.
		this.scoreLimit =
			rules.scoreLimit ?? (this.mode === "tdm" ? TDM_SCORE_LIMIT : SCORE_LIMIT);
		this.timeLimitMs = rules.timeLimitMs ?? TIME_LIMIT_MS;
		this.fillTarget = Math.max(0, Math.min(rules.fillTarget ?? 0, MAX_PLAYERS));
		this.world = buildWorld(rules.screens ?? 1);
		this.startUltCharge = Math.max(
			0,
			Math.min(rules.startUltCharge ?? 0, ULT_MAX_CHARGE),
		);
	}

	/**
	 * A **floor** on everybody's ultimate charge. Zero in a real match.
	 *
	 * `?ultCharge=N`, creator-only. It exists because the meter takes ~285s of
	 * passive charge to fill, which is unmeasurable in a probe and tedious to
	 * practise a throw against — see `server/index.ts`.
	 *
	 * A floor rather than a starting value, and that is the useful shape: at 100
	 * it is a practice room where the ultimate re-arms the moment it is spent, so
	 * a player can learn the arc in a minute instead of an hour and a probe can
	 * measure two casts in one run. It cannot be used to spam, because a cast is
	 * refused while a hole is already open.
	 */
	private readonly startUltCharge: number;

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
		team: TeamId | null = null,
	): ConnectedPlayer {
		return {
			id,
			name,
			team,
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
			lastHurtByUlt: false,
			lastAttackTime: 0,
			queue: [],
			lastInput: idleInput(),
			lastSeq: 0,
			starvedTicks: 0,
			tickInput: null,
			pendingInput: null,
			simulatedIntent: null,
			ult: this.startUltCharge,
			ultHeld: false,
			ultAimAngle: 0,
			stats: newStats(),
		};
	}

	/** Where the living currently stand, for spawn selection. */
	private occupiedPoints(): { x: number; y: number }[] {
		return [...this.players.values()]
			.filter((p) => p.alive)
			.map((p) => ({ x: p.state.x, y: p.state.y }));
	}

	/** Every fighter as the team rules see them: a side and whether they stand. */
	private members() {
		return [...this.players.values()].map((p) => ({
			team: p.team,
			alive: p.alive,
		}));
	}

	/**
	 * The side a fighter about to be seated joins: the smaller one.
	 *
	 * `null` in a free-for-all, which is what makes every team rule inert there —
	 * see `hostile`.
	 */
	private nextTeam(): TeamId | null {
		if (this.mode !== "tdm") return null;
		return balanceTeam(teamCounts(this.members()));
	}

	/**
	 * Where a fighter enters, in whichever mode this room is.
	 *
	 * A free-for-all spawns furthest from everybody; a team match spawns in its
	 * own third of the arena, furthest from everybody *there*. Both are the same
	 * pure choice — see `pickTeamSpawn`.
	 */
	private spawnFor(team: TeamId | null): SpawnPoint {
		const occupied = this.occupiedPoints();
		return team === null
			? pickSpawn(occupied, this.world)
			: pickTeamSpawn(occupied, this.world, team);
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
		const team = this.nextTeam();
		const slot = this.newSlot(
			id,
			name,
			this.spawnFor(team),
			100,
			{ channel },
			team,
		);
		slot.state.freezeTimer = this.roundFreezeMs;
		this.players.set(id, slot);

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
			const cap =
				this.cinematicGraceMs > 0
					? MAX_QUEUED_INPUTS_FROZEN
					: MAX_QUEUED_INPUTS;
			if (player.queue.length > cap) {
				player.queue.splice(0, player.queue.length - cap);
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

	/**
	 * Evict one bot so a human can sit down. Returns false if there was none.
	 *
	 * In a team match the bot comes off the **larger** side, because the human
	 * about to take the seat is assigned to the smaller one — evicting from
	 * either side at random would seat every arriving human on the same team as
	 * the bot that just left, and the room would drift 9v7.
	 */
	private freeBotSlot(): boolean {
		const bots = [...this.players.values()].filter((p) => p.brain !== null);
		const counts = teamCounts(this.members());
		const bot =
			this.mode === "tdm"
				? [...bots].sort(
						(a, b) => (counts[b.team ?? 0] ?? 0) - (counts[a.team ?? 0] ?? 0),
					)[0]
				: bots[0];
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
		const team = this.nextTeam();
		const slot = this.newSlot(
			id,
			botName(this.names),
			this.spawnFor(team),
			100,
			{ brain: new EnemyBrain(botConfig(), this.world) },
			team,
		);
		slot.state.freezeTimer = this.roundFreezeMs;
		this.players.set(id, slot);
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
			ultimate: out.ultimate,
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
	 *
	 * **This is the whole of how a bot knows about friendly fire.** The brain has
	 * no team concept and does not need one: it is only ever shown an enemy, so
	 * every decision it makes — approach, block, punish, shoot down a corridor —
	 * is already aimed at somebody it is allowed to hit. A teammate is not a
	 * target it declines; it is a fighter the brain is never told about.
	 */
	private nearestFoe(self: ConnectedPlayer): ConnectedPlayer | undefined {
		let best: ConnectedPlayer | undefined;
		let bestDist = Number.POSITIVE_INFINITY;
		for (const p of this.players.values()) {
			if (p === self || !p.alive) continue;
			if (!hostile(self.team, p.team)) continue;
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

		// The whole room, split into sides. The brain reasons about one enemy at a
		// time for combat, but it needs *everyone* for the team game — how many
		// enemies there are, where a cluster is, whether an ally is being rushed —
		// and those facts are not derivable from the nearest enemy.
		const allies: AllyInfo[] = [];
		const foes: FoeInfo[] = [];
		for (const p of this.players.values()) {
			if (p.id === bot.id) continue;
			const d = Math.hypot(p.state.x - bot.state.x, p.state.y - bot.state.y);
			if (hostile(bot.team, p.team)) {
				if (p.alive) {
					foes.push({
						id: p.id,
						x: p.state.x,
						y: p.state.y,
						hp: p.hp,
						distance: d,
					});
				}
			} else {
				allies.push({
					id: p.id,
					x: p.state.x,
					y: p.state.y,
					hp: p.hp,
					alive: p.alive,
					distance: d,
				});
			}
		}

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
				24,
				this.world,
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
			selfId: bot.id,
			selfAirJumps: bot.state.airJumps,
			selfUltCharge: bot.ult,
			enemyVX: foe.state.vx,
			enemyVY: foe.state.vy,
			selfTeam: bot.team,
			allies,
			foes,
			fields: this.singularity
				? [
						{
							x: this.singularity.x,
							y: this.singularity.y,
							hostile: fieldAffects(this.singularity, bot.id, bot.team),
						},
					]
				: [],
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
			team: p.team,
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
			mode: this.mode,
			teams: this.teamStatus(),
		};
	}

	/** The round scoreboard, or null in a free-for-all. */
	private teamStatus(): TeamStatus | null {
		if (this.mode !== "tdm") return null;
		const members = this.members();
		return {
			scores: [...this.teamScores],
			alive: aliveCounts(members),
			seated: teamCounts(members),
			round: this.roundNumber,
			resetInMs:
				this.roundResetTimer > 0 ? Math.round(this.roundResetTimer) : 0,
			freezeMs: this.roundFreezeMs > 0 ? Math.round(this.roundFreezeMs) : 0,
			lastRoundWinner: this.lastRoundWinner,
			winnerTeam: this.winnerTeam,
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
		// Meaningless in a team match — nothing counts it down, because a fighter
		// stays down until their whole side does. Still set, so a mode that ever
		// mixed the two would not read an uninitialised timer.
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
		if (killer) {
			killer.kills++;
			// The kill bonus is a weapon's payment, and the ultimate is the one
			// weapon that does not pay: a hole that kills somebody fed nobody.
			if (!victim.lastHurtByUlt) {
				killer.ult = addCharge(killer.ult, ULT_CHARGE_PER_KILL);
			}
		}
		// The ultimate survives death — except the one death that is a deny.
		// Holding the button is the aim phase, the moment of maximum
		// commitment, and dying in it throws the whole meter away. The killer
		// gets the "DENY" splash; a fighter who dies holding with no killer to
		// credit (a fall, the arena) still loses the meter, they just deny
		// themselves in silence.
		if (victim.ultHeld) {
			victim.ult = 0;
			if (killer) {
				console.log(
					`[DENY] ${killer.name} denied ${victim.name}'s ultimate by killing them mid-hold`,
				);
				this.denies.push({
					denierId: killer.id,
					x: killer.state.x + PLAYER_WIDTH / 2,
					y: killer.state.y + PLAYER_HEIGHT / 2,
				});
			}
		}
		victim.lastHurtBy = null;
		victim.lastHurtByUlt = false;

		console.log(
			`[FRAG] ${killer?.name ?? "the arena"} killed ${victim.name} (${killer?.kills ?? 0})`,
		);
	}

	/** Damage one fighter, crediting `sourceId`, and score the kill if it lands. */
	private damage(
		victim: ConnectedPlayer,
		amount: number,
		sourceId: string,
		paysCharge = true,
	) {
		if (!victim.alive || amount <= 0) return;
		// Scores are frozen once the podium is decided; the fight is allowed to
		// keep going, because freezing the simulation is what desyncs it.
		if (this.phase === "over") return;
		// **No friendly fire, at the one point every weapon passes through.** Each
		// of them already declines to hit a teammate at its own hitbox — a sword
		// swing passes through, a bullet flies on, the hole ignores them — and this
		// is the backstop that makes those three an optimisation rather than the
		// rule. A weapon added later cannot forget it.
		const from = this.players.get(sourceId);
		if (from && from !== victim && !hostile(from.team, victim.team)) return;

		victim.lastHurtBy = sourceId;
		// The ultimate is the one weapon that does not feed the ultimate meter.
		// The hole is already a reward — a held enemy is a free window for
		// everyone else's weapons — and a caster whose own hole paid them charge
		// would never have to land a sword hit again. `lastHurtByUlt` carries the
		// distinction into the kill credit, so a hole that scores nobody either.
		victim.lastHurtByUlt = !paysCharge;
		victim.hp = Math.max(0, victim.hp - amount);
		victim.stats.damageTaken += amount;

		if (from && from !== victim) {
			from.stats.damageDealt += amount;
			// The Overwatch economy, in one line: charge is what you are paid for
			// participating. Paid here rather than in each weapon's code path so a
			// sword hit and a bullet are worth the same per point — and so a
			// weapon added later cannot forget to pay. The one weapon that does
			// not pay passes `paysCharge: false` and this line skips it.
			if (paysCharge) {
				from.ult = addCharge(from.ult, amount * ULT_CHARGE_PER_DAMAGE);
			}
		}

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
		const occupied = this.occupiedPoints().filter(
			(p) => p.x !== player.state.x || p.y !== player.state.y,
		);
		const spawn =
			player.team === null
				? pickSpawn(occupied, this.world)
				: pickTeamSpawn(occupied, this.world, player.team);
		player.state = createPlayerState(spawn.x, spawn.y, spawn.facing);
		player.hp = 100;
		player.alive = true;
		player.respawnTimer = 0;
		player.lastHurtBy = null;
		player.queue.length = 0;
		player.pendingInput = null;
		player.tickInput = null;
		player.simulatedIntent = null;
		// Charge is *not* reset here — an ultimate survives death, deliberately.
		// The floor only applies in a room that asked for one (`?ultCharge=N`),
		// where it is there so a probe or a practising player gets more than one
		// throw per run.
		player.ult = Math.max(player.ult, this.startUltCharge);
		this.broadcast("respawn", { id: player.id, t: Date.now() });
	}

	private tickMatchClock(dt: number) {
		if (this.phase === "over") {
			this.overTimer -= dt * 1000;
			if (this.overTimer <= 0) this.restartMatch();
			return;
		}

		// The match clock measures *fighting*, not the room being open. Fifteen
		// rounds of freezetime and cooldown is two and a half minutes of a
		// five-minute match, so counting them would mean the timer decided almost
		// every team match — and a countdown that ate your clock would punish the
		// mode's own pacing.
		//
		// **The clock is paused, the win condition is not.** Returning early here
		// instead cost a whole extra round: the deciding wipe set the cooldown, the
		// score went unchecked for five seconds, and by the time it was read the
		// arena had already reset and started a round nobody was playing.
		const paused =
			this.mode === "tdm" &&
			(this.roundFreezeMs > 0 || this.roundResetTimer > 0);
		if (!paused) this.matchElapsedMs += dt * 1000;

		const reason =
			this.mode === "tdm"
				? this.teamMatchEnd()
				: matchEndReason(
						this.scoreEntries(),
						this.matchElapsedMs,
						this.scoreLimit,
						this.timeLimitMs,
					);
		if (reason) this.endMatch(reason);
	}

	/**
	 * Has a team deathmatch ended?
	 *
	 * Rounds, not frags — a fighter with thirty kills has won nothing if their
	 * side never took a round. Score before time, exactly as `matchEndReason`
	 * does it, so a round won on the final second reads as a won match.
	 */
	private teamMatchEnd(): MatchEndReason {
		if (teamMatchWinner(this.teamScores, this.scoreLimit) !== null) {
			return "score";
		}
		return this.matchElapsedMs >= this.timeLimitMs ? "time" : null;
	}

	private endMatch(reason: MatchEndReason) {
		const standings = this.scoreEntries();
		const winner = matchWinner(standings);
		this.phase = "over";
		this.endReason = reason;
		this.winnerId = winner?.id ?? null;
		this.overTimer = MATCH_OVER_LINGER_MS;
		// The side that took it: the one at the limit, or whoever is ahead when the
		// clock runs out. `null` is a genuine draw, which only a timed match can
		// produce and which the podium says out loud rather than inventing a winner.
		this.winnerTeam =
			this.mode === "tdm"
				? (teamMatchWinner(this.teamScores, this.scoreLimit) ??
					teamAhead(this.teamScores))
				: null;

		if (this.mode === "tdm") {
			console.log(
				`[MATCH] ${this.id} over by ${reason}: ${teamName(this.winnerTeam) || "nobody"} wins ${this.teamScores.join("-")} (MVP ${winner?.name ?? "nobody"})`,
			);
		} else {
			console.log(
				`[MATCH] ${this.id} over by ${reason}: ${winner?.name ?? "nobody"} wins with ${winner?.kills ?? 0}`,
			);
		}
		// The full standings, once, with names attached. The scoreboard rebuilds
		// this from the snapshot every frame; the podium is a one-shot announcement
		// and should not depend on a client having kept up.
		this.broadcastReliable("match-over", {
			reason,
			winnerId: this.winnerId,
			standings,
			winnerTeam: this.winnerTeam,
			...(this.mode === "tdm" ? { teamScores: [...this.teamScores] } : {}),
		});
	}

	/**
	 * The wipe-out round: a side is out when its last fighter falls.
	 *
	 * **This replaces individual respawns entirely** in a team match. A dead
	 * fighter stays dead, which is what makes the last member of a side worth
	 * watching — everyone else on their team is watching them too. The reward is a
	 * round, the whole arena resets, and the score is the number of times a side
	 * has been wiped out.
	 *
	 * Scored from `roundResult`, a pure function of who is alive, so the server
	 * and a test agree on what "wiped" means. Both sides gone on the same tick is
	 * a draw and scores nobody — a black hole makes that perfectly possible.
	 */
	private tickTeamRound(dt: number) {
		// Freezetime. Nobody can act — every fighter's own `freezeTimer` is doing
		// that inside `tickPlayer` — so there is nothing to score and no round to
		// end until it runs out.
		if (this.roundFreezeMs > 0) {
			this.roundFreezeMs = Math.max(0, this.roundFreezeMs - dt * 1000);
			if (this.roundFreezeMs === 0) {
				console.log(`[ROUND] ${this.id}: round ${this.roundNumber} live`);
				// Announced, so the banner lands at the same moment on every client
				// rather than each one racing its own copy of the countdown to zero.
				this.broadcastReliable("round-live", { round: this.roundNumber });
			}
			return;
		}

		if (this.roundResetTimer > 0) {
			this.roundResetTimer -= dt * 1000;
			if (this.roundResetTimer <= 0) {
				this.roundResetTimer = -1;
				// Only if the match is still running. A wipe that decided the match
				// must leave the arena as it stands — otherwise the podium goes up
				// over a freshly respawned round nobody is playing, and the scoreboard
				// counts a round that was never fought.
				if (this.phase === "live") {
					this.roundNumber++;
					this.resetPlayers();
				}
			}
			return;
		}

		const result = roundResult(this.members());
		if (result === null) return;

		this.roundResetTimer = ROUND_RESET_DELAY_MS;
		if (result.kind === "draw") {
			this.lastRoundWinner = null;
			console.log(`[ROUND] ${this.id}: round ${this.roundNumber} drawn`);
		} else {
			this.lastRoundWinner = result.team;
			this.teamScores[result.team] = (this.teamScores[result.team] ?? 0) + 1;
			console.log(
				`[ROUND] ${this.id}: ${teamName(result.team)} takes round ${this.roundNumber} (${this.teamScores.join("-")})`,
			);
		}
		// Announced rather than inferred, like every other discontinuity. The
		// snapshot carries the same numbers, so a lost datagram costs a banner and
		// never the score.
		this.broadcastReliable("round-won", {
			team: result.kind === "win" ? result.team : null,
			round: this.roundNumber,
			scores: [...this.teamScores],
			resetInMs: ROUND_RESET_DELAY_MS,
		});
	}

	private restartMatch() {
		for (const player of this.players.values()) {
			player.kills = 0;
			player.deaths = 0;
			player.stats = newStats();
			// A new match starts everybody at zero. Charge survives a death but not a
			// scoreboard wipe — carrying one over would hand the previous match's
			// winner an ultimate before the new one has begun.
			player.ult = this.startUltCharge;
			player.ultHeld = false;
			player.ultAimAngle = 0;
			// A fresh personality per match, so sixteen bots do not replay the same
			// fight every five minutes.
			if (player.brain) player.brain = new EnemyBrain(botConfig(), this.world);
		}
		this.phase = "live";
		this.matchElapsedMs = 0;
		this.endReason = null;
		this.winnerId = null;
		this.overTimer = 0;
		// The round score is the match score in TDM, so it is wiped with everything
		// else — carrying it over would start a new match at 14-13.
		this.teamScores = [0, 0];
		this.roundNumber = 1;
		this.roundResetTimer = -1;
		this.roundFreezeMs = this.freezeTimeMs;
		this.lastRoundWinner = null;
		this.winnerTeam = null;
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
				// Beside `hp` rather than in the roster: teams are an argument to the
				// client's own `tickPlayer` — see `SnapshotPlayer`.
				team: p.team,
				// Rounded: the HUD draws a bar, and a fractional trickle would make
				// every snapshot differ in a digit nobody can see.
				ult: Math.round(p.ult),
			});
		}
		const cinematic: SnapshotCinematic | null = this.cinematic
			? {
					casterId: this.cinematic.casterId,
					remainingMs: Math.max(0, Math.round(this.cinematic.msLeft)),
					totalMs: ULT_CINEMATIC_MS,
				}
			: null;
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
			denies: this.denies.slice(),
			match: this.matchStatus(),
			grenades: this.grenades.map((g) => ({
				id: g.id,
				ownerId: g.ownerId,
				ownerTeam: g.ownerTeam,
				x: g.x,
				y: g.y,
				vx: g.vx,
				vy: g.vy,
			})),
			// Sent in full every snapshot rather than announced once. It is what every
			// client feeds into `tickPlayer`, so a lost datagram must never be able to
			// leave one pulling fighters into a hole that has closed.
			singularity: this.singularity ? { ...this.singularity } : null,
			cinematic,
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

		// The ultimate's cinematic freeze, and the only thing in the game that gets
		// to stop the simulation. Everything below is skipped: no input is consumed,
		// no fighter is advanced, no bullet moves, the match clock does not run and
		// nobody's respawn gets closer. See `tickCinematic` for why that is safe
		// here and nowhere else.
		if (this.tickCinematic(dt)) return;

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
			// The hole this fighter is in, if any — already filtered for friendly
			// fire, so the caster is handed null and walks through their own field.
			player.state = tickPlayer(
				player.state,
				input,
				dt,
				this.world,
				fieldFor(this.singularity, player.id, player.team),
			);

			// A release edge, not a press edge: `ultimate` is held button state on
			// the wire like every other button, but the hold is the *aim phase* — the
			// cast is decided when the button is let go, at the angle the player
			// released on. Edge-detecting here rather than on the client is the same
			// rule attack and jump follow.
			if (input.ultimate) player.ultAimAngle = input.aimAngle;
			if (!input.ultimate && player.ultHeld) this.tryCastUltimate(player);
			player.ultHeld = input.ultimate;

			// A fighter holds a sword or a gun, never both: firing is gated on the
			// stance the simulation says they are actually in.
			if (
				player.alive &&
				// Decided out here rather than in `tickPlayer`, so it needs the same
				// gate the intent already got: a frozen fighter's neutral intent never
				// reaches this branch, but `input` is the raw one.
				!isFrozen(player.state) &&
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

		// Counted down here rather than in `tickCinematic`, which stops running the
		// moment the freeze is over — this is the window *after* it, while the
		// parked backlog is still draining.
		this.cinematicGraceMs = Math.max(0, this.cinematicGraceMs - dt * 1000);

		this.resolveMeleeHits();
		this.tickBullets(dt);
		this.tickUltimate(dt);
		this.applyTrainingRules(dt);

		// A training session is not a deathmatch. It keeps the old round lifecycle:
		// the scenario is the unit of measurement, and a scenario that respawned one
		// fighter mid-run while the other kept its score would measure nothing.
		if (this.isTrainingRoom) {
			this.tickTrainingRound(dt);
			return;
		}

		// Two lifecycles, one per mode, and never both: a deathmatch respawns
		// individuals on a timer, a team match respawns nobody until a side is
		// wiped. Running the FFA respawn in a team room would refill the team that
		// was two seconds from losing the round.
		if (this.mode === "tdm") this.tickTeamRound(dt);
		else this.tickRespawns(dt);
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
				// A blade passes through a teammate: no damage, no stun, no knockback,
				// and no `hitLatch` spent — the swing is still live for the enemy
				// standing behind them. A guard that closed on a friendly body would
				// make a crowded push worse than swinging alone.
				if (!hostile(attacker.team, defender.team)) continue;

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

			if (
				isBulletOutOfBounds(b, this.world) ||
				bulletHitsPlatform(b, this.world)
			)
				continue;

			let consumed = false;
			const shooter = this.players.get(b.ownerId);
			for (const player of this.players.values()) {
				if (b.ownerId === player.id || !player.alive) continue;
				// Straight through a teammate, and *not* consumed: a shot that stopped
				// on the friendly in front of you would make a firing line impossible
				// and turn every corridor into a queue.
				if (shooter && !hostile(shooter.team, player.team)) continue;
				if (!bulletHitsPlayer(b, player.state)) continue;

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

	// =========================================================
	//  THE ULTIMATE
	// =========================================================

	/**
	 * Count the cinematic down. Returns true while the room must not simulate.
	 *
	 * **This is the only frame freeze the game allows, and the reason it is safe
	 * is that it is nothing like hitstop.** Hitstop is a local decision one client
	 * makes about an impact it drew; this is the server declaring a range of ticks
	 * in which *nobody* — server included — advances anything. A client that sees
	 * `cinematic` in the snapshot stops running fixed steps, so it also stops
	 * sending input and stops predicting remotes. It freezes when the message
	 * reaches it and unfreezes when the next one does, so it is exactly as far
	 * ahead of the server on the far side as it was on the near side, and the
	 * handful of inputs already in flight simply wait in the queue. Nothing is
	 * dropped, so nothing diverges.
	 *
	 * `tickCount` still advances: it is a clock and the rollback anchor, and a
	 * clock that stalls would make every client's `leadTicks` arithmetic lie.
	 */
	private tickCinematic(dt: number): boolean {
		if (!this.cinematic) return false;

		// Every fighter is frozen, and says so. Without this the previous tick's
		// intent would still be in the snapshot and every other client would predict
		// motion for a fighter the server is holding perfectly still.
		for (const player of this.players.values()) player.simulatedIntent = null;

		this.cinematic.msLeft -= dt * 1000;
		this.cinematicGraceMs = CINEMATIC_QUEUE_GRACE_MS;
		if (this.cinematic.msLeft > 0) return true;

		this.cinematic = null;
		this.releasePendingThrow();
		return true;
	}

	/**
	 * Try to cast. Silently refused when the conditions are not met.
	 *
	 * Silent on purpose: every refusal is a state the player can already see —
	 * an empty meter, being stunned, somebody else's cinematic on screen. A
	 * rejection message would be a second, unreliable channel telling them
	 * something the first one already did.
	 */
	/**
	 * Try to cast, on the release of the ultimate button. Silently refused when
	 * the conditions are not met.
	 *
	 * Silent on purpose: every refusal is a state the player can already see —
	 * an empty meter, being stunned, somebody else's cinematic on screen. A
	 * rejection message would be a second, unreliable channel telling them
	 * something the first one already did.
	 */
	private tryCastUltimate(player: ConnectedPlayer) {
		if (!ultReady(player.ult)) return;
		if (!player.alive || this.phase !== "live") return;
		if (isFrozen(player.state)) return;
		if (isStunned(player.state) || isKnockedDown(player.state)) return;
		// One at a time, both ways. Two overlapping holes would have to argue about
		// which way a fighter between them is pulled, and two overlapping cinematics
		// would mean one of them was never seen.
		if (this.cinematic || this.pendingThrow || this.singularity) return;

		// Spent at the release, before the freeze. A caster who disconnects mid
		// cinematic must not come back still armed.
		player.ult = 0;
		this.cinematic = { casterId: player.id, msLeft: ULT_CINEMATIC_MS };
		this.pendingThrow = {
			ownerId: player.id,
			ownerTeam: player.team,
			x: player.state.x + PLAYER_WIDTH / 2,
			y: player.state.y + PLAYER_HEIGHT / 2,
			// The last input that held the button, not the release input itself: the
			// release frame is the moment the button came up, and the aim that
			// matters is the one it was held at. They are the same for a human — the
			// cursor has not moved between two frames — and they differ only for
			// scripted input, whose release frame may carry no angle at all.
			angle: player.ultAimAngle,
		};
		console.log(`[ULT] ${player.name} casts Black Hole`);
	}

	/** The freeze is over: throw the grenade the caster paid for. */
	private releasePendingThrow() {
		const t = this.pendingThrow;
		this.pendingThrow = null;
		if (!t) return;
		this.grenades.push(
			launchGrenade(
				this.nextUltId++,
				t.ownerId,
				t.x,
				t.y,
				t.angle,
				t.ownerTeam,
			),
		);
	}

	/** Advance grenades in flight and the open singularity. */
	private tickUltimate(dt: number) {
		this.tickGrenades(dt);
		this.tickSingularity(dt);

		// The passive trickle, paid only to the living. Damage-based charge is paid
		// where the damage is counted, in `damage`.
		const passive = ULT_PASSIVE_PER_SEC * dt;
		for (const player of this.players.values()) {
			if (player.alive) player.ult = addCharge(player.ult, passive);
			// The practice-room floor. No-op in a real match, where it is zero.
			if (player.ult < this.startUltCharge) player.ult = this.startUltCharge;
		}
	}

	private tickGrenades(dt: number) {
		if (this.grenades.length === 0) return;

		// Compact in place, exactly like the bullets: a grenade that ends this tick
		// is removed by not being kept, so there is no splice inside the loop.
		let kept = 0;
		for (const g of this.grenades) {
			tickGrenade(g, dt);

			let touched = false;
			let denied = false;
			for (const player of this.players.values()) {
				if (!player.alive) continue;
				if (
					!grenadeTouches(
						g,
						player.id,
						player.state.x,
						player.state.y,
						player.team,
					)
				) {
					continue;
				}
				// The sword guard is the universal deny: a blocking defender facing
				// the throw catches the grenade like a bullet, and the ultimate is
				// gone — the meter was spent at the release, and the hole never
				// opens. One deny event, over the fighter who blocked it.
				if (blocksUltimate(player.state, g.vx)) {
					console.log(`[ULT] grenade ${g.id} DENIED by ${player.name}`);
					this.denies.push({
						denierId: player.id,
						x: player.state.x + PLAYER_WIDTH / 2,
						y: player.state.y + PLAYER_HEIGHT / 2,
					});
					denied = true;
					break;
				}
				touched = true;
				break;
			}
			// A denied grenade opens nothing: it is dropped here, before
			// `grenadeEnd` gets a say, because the deny is decided by who was
			// blocking at contact rather than by where the flight happened to be.
			if (denied) continue;

			const end = grenadeEnd(g, this.world, touched);
			if (end === null) {
				this.grenades[kept++] = g;
				continue;
			}
			// A fizzle is the miss the ability is balanced around: out of the top of
			// the world, no hole, nothing to show for it.
			if (end !== "fizzle") this.openSingularity(g);
			else console.log(`[ULT] grenade ${g.id} fizzled out of the world`);
		}
		this.grenades.length = kept;
	}

	private openSingularity(g: GrenadeState) {
		this.singularity = {
			id: g.id,
			ownerId: g.ownerId,
			// Carried from the grenade rather than looked up: the caster may already
			// have left the room by the time their throw lands, and a hole that
			// forgot whose side it was on would start eating their own team.
			ownerTeam: g.ownerTeam,
			// Clamped into the arena.
			//
			// A grenade that leaves through a side wall is detonated by `grenadeEnd`
			// at the point it was last seen, which is outside the world — and a hole
			// centred at x=-40 is half a hole, drawn off-screen, that still reaches
			// 128px into the room. Found by `scripts/ultimate-probe.mjs`, which threw
			// one into the left wall and reported a singularity outside its own arena.
			// The wall *is* where it hit, so the boundary is the honest place for it.
			x: Math.max(this.world.left, Math.min(g.x, this.world.right)),
			y: Math.max(this.world.top, Math.min(g.y, this.world.bottom)),
			remainingMs: SINGULARITY_DURATION_MS,
		};
		// Damage lands on the first interval, not on the frame it opens: a hole that
		// hit for 5 the instant it appeared would make the throw itself the damage,
		// and the point is the hold.
		this.singularityDamageAcc = 0;
		console.log(
			`[ULT] singularity ${g.id} at ${Math.round(g.x)},${Math.round(g.y)}`,
		);
	}

	private tickSingularity(dt: number) {
		const field = this.singularity;
		if (!field) return;

		field.remainingMs -= dt * 1000;
		if (field.remainingMs <= 0) {
			this.singularity = null;
			return;
		}

		this.singularityDamageAcc += dt * 1000;
		if (this.singularityDamageAcc < SINGULARITY_DAMAGE_INTERVAL_MS) return;
		this.singularityDamageAcc -= SINGULARITY_DAMAGE_INTERVAL_MS;

		for (const player of this.players.values()) {
			if (!player.alive) continue;
			// The friendly-fire rule and the "is it holding them" test both come from
			// the shared module, so the damage can never disagree with the pull the
			// client is predicting. `fieldFor` returns null for the caster, and a null
			// field grips nobody.
			const mine = fieldFor(field, player.id, player.team);
			if (singularityGrip(mine, player.state.x, player.state.y) !== "held") {
				continue;
			}
			// The hole does not feed the meter — `paysCharge: false` skips the
			// caster's charge and marks the kill credit non-paying too.
			this.damage(player, SINGULARITY_TICK_DAMAGE, field.ownerId, false);
		}
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
				: p.team === null
					? pickSpawn(taken, this.world)
					: // A team starts a round together, at its own end of the arena and
						// facing the other one. Sides swapping ends between rounds was
						// considered and rejected: the arena is mirrored per screen, so
						// the two ends are already the same fight from either side, and
						// swapping would only cost every player their sense of which way
						// the enemy is.
						pickTeamSpawn(taken, this.world, p.team);
			taken.push({ x: spawn.x, y: spawn.y });

			p.state = createPlayerState(spawn.x, spawn.y, spawn.facing);
			// Planted for the countdown. Zero outside team deathmatch, so every
			// other reset in the game behaves exactly as it always has.
			p.state.freezeTimer = this.freezeTimeMs;
			p.hp = p.dummy ? (cfg?.dummyHp ?? 100) : 100;
			p.alive = true;
			p.respawnTimer = 0;
			p.lastHurtBy = null;
			p.lastAttackTime = 0;
			p.queue.length = 0;
			p.pendingInput = null;
			p.tickInput = null;
			p.simulatedIntent = null;
			if (p.brain) p.brain = new EnemyBrain(botConfig(), this.world);
		});
		this.bullets = [];
		this.meleeEvents.length = 0;
		this.denies.length = 0;
		this.resetTimer = -1;
		// The room's copy of the same countdown the fighters are carrying.
		this.roundFreezeMs = this.freezeTimeMs;
		// A hole left open across a reset would grab fighters at their spawns, and a
		// cinematic left running would freeze a match that has just started. Charge
		// is *not* cleared here: `restartMatch` owns that, because a training-room
		// reset should not confiscate an ult somebody spent two minutes earning.
		this.grenades.length = 0;
		this.singularity = null;
		this.cinematic = null;
		this.pendingThrow = null;
		this.cinematicGraceMs = 0;

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
		this.denies.length = 0;
	}
}

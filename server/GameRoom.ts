import type { ServerChannel } from "@geckos.io/server";
import {
	type AIConfig,
	randomBotConfig,
} from "../src/game/characters/AIConfig.js";
import { EnemyBrain } from "../src/game/characters/EnemyBrain.js";
import type {
	AIInput,
	AIOutput,
	AllyInfo,
	FoeInfo,
} from "../src/game/characters/types.js";
import {
	type DenyEventMsg,
	type ExplosionMsg,
	type GameSnapshot,
	type MatchStatus,
	type MeleeEventMsg,
	type PlayerInput,
	RELIABLE,
	type RosterMsg,
	type SnapshotCinematic,
	type SnapshotPlayer,
	type TeamStatus,
	type TrappedMsg,
} from "../src/game/online/types.js";
import { packIntent, packState } from "../src/game/online/wire.js";
import {
	POTG_ABSORB_BURST,
	POTG_DAMAGE_BURST,
} from "../src/game/potg/scoring.js";
import type { PotgClip } from "../src/game/potg/types.js";
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
	mvpOf,
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
import {
	DEGREES_PER_PI_RADIANS,
	pelletDamageAt,
} from "../src/tweakables/ranged.js";
import { botName, sanitiseName, uniqueName } from "./BotNames.js";
import { PotgRecorder } from "./PlayOfTheGame.js";
import {
	addCharge,
	applyHitToDefender,
	applyMeleeResult,
	BLOSSOM_DURATION_MS,
	BLOSSOM_TICK_DAMAGE,
	BLOSSOM_TICK_MS,
	type Blossom,
	BULLET_DAMAGE,
	type BulletState,
	blocksBullet,
	blocksUltimate,
	blossomSweeps,
	bodyRect,
	bombBlastFor,
	bombFallHeight,
	bulletDistanceFromMuzzle,
	bulletHitsPlatform,
	bulletHitsPlayer,
	canFire,
	clampSmokePoint,
	createPlayerState,
	DEFAULT_HERO,
	DRAGON_DAMAGE,
	DRAGON_KNOCKBACK_PX_S,
	DRAGON_RIDE_MS,
	DRAGON_SPEED,
	DRAGON_STUN_MS,
	dragonSweptRect,
	dragonVelocity,
	fieldAffects,
	fieldFor,
	type GrenadeState,
	grenadeEnd,
	grenadeTouches,
	HE_GRENADE_RADIUS,
	HERO_IDS,
	type HeGrenadeState,
	type HeroId,
	hasLineOfSight,
	heBlastDamage,
	heGrenadeEnd,
	heGrenadeTouches,
	isBulletOutOfBounds,
	isFrozen,
	isHeroId,
	isKnockedDown,
	isStunned,
	kitFor,
	launchGrenade,
	launchHeGrenade,
	launchSmokeGrenade,
	launchTrapCanister,
	MASSIVE_BLAST_DAMAGE,
	MASSIVE_BLAST_KNOCKBACK_PX_S,
	MASSIVE_BLAST_RADIUS_PX,
	MASSIVE_BLAST_STUN_MS,
	MAX_HP,
	MELEE_IFRAME_MS,
	MOVES,
	MS_PER_SECOND,
	massiveSlamPoint,
	meleePhase,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	PLUNGE_CARRY_MS,
	type PlayerIntent,
	type PlayerPosition,
	plungeCatchRect,
	rectsOverlap,
	reserveRoundsFor,
	resolveMelee,
	SINGULARITY_DAMAGE_INTERVAL_MS,
	SINGULARITY_DURATION_MS,
	SINGULARITY_TICK_DAMAGE,
	type Singularity,
	SMOKE_DURATION_MS,
	type SmokeCloud,
	type SmokeGrenadeState,
	singularityGrip,
	smokeGrenadeEnd,
	sweptThrustBox,
	TRAP_COLLIDE_R,
	TRAP_DAMAGE,
	type Trap,
	type TrapCanisterState,
	tickBullet,
	tickGrenade,
	tickHeGrenade,
	tickPlayer,
	tickReload,
	tickSmokeGrenade,
	tickTrapCanister,
	trapCatches,
	trapFor,
	ULT_CHARGE_MELEE_MULTIPLIER,
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
	return {
		bulletsFired: 0,
		bulletHits: 0,
		damageDealt: 0,
		damageTaken: 0,
		damageBlocked: 0,
	};
}

/** The bomb's small horizontal shove off the crater, alongside the knockup. */
const BOMB_KNOCKBACK_VX = 120;

/**
 * One massive blast, awaiting its tick's end.
 *
 * `knockupVy` is zero for the ground slam and negative (up) for a bomb: the
 * blast's whole shape — radius, stun, knockup, damage — is decided here so the
 * resolver applies one stat card per event, not a rule per victim.
 */
interface PendingBlast {
	bomberId: string;
	x: number;
	y: number;
	radiusPx: number;
	damage: number;
	stunMs: number;
	knockupVy: number;
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
	/**
	 * Which hero this fighter plays. Chosen by the client (URL or the Esc menu's
	 * hero select) and fixed until they change it — a hero change resets the
	 * ultimate meter, because ultimates are unique per hero and a free dragon
	 * thrust would be a cheese.
	 */
	hero: HeroId;
	/** Full simulation state — never rebuilt per tick, or wall state is lost. */
	state: PlayerPosition;
	hp: number;
	/** Deathmatch score. */
	kills: number;
	deaths: number;
	/**
	 * Ultimate denies: a kill while the victim held the cast, or a guard that
	 * caught the grenade. Both spent the caster's whole meter; both credit the
	 * fighter who stopped it. The scoreboard's DENIES column.
	 */
	denies: number;
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
	 * Item charges left this life, server-owned like the ultimate's charge.
	 *
	 * Reset to the kit's maximum on respawn and on a round reset — dying is the
	 * price of the second grenade, and a new round starts everybody's items
	 * fresh. Unlike `ult` it never survives anything, because an item is a
	 * *finite* resource by design: the charges are the whole of the item.
	 */
	itemCharges: number;
	/**
	 * Press-edge latch for the item button.
	 *
	 * The item is used on the press, not the release (there is no aim phase to
	 * hold through — the aim angle of the press is the throw), so the held
	 * button travels on the wire like every other and this is the edge that
	 * turns a press into exactly one use.
	 */
	itemHeld: boolean;
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
	/**
	 * Damage-points banked since the last Play-of-the-Game burst event.
	 *
	 * The reel is fed bursts, not hits: a steady fighter trickles out one
	 * `damageDealt` per `POTG_DAMAGE_BURST` points rather than flooding the
	 * tracker with an event per bullet. Kept off the fighter's `stats` because
	 * those are the scoreboard's numbers, and the reel's are not.
	 */
	potgBurst: { damage: number; absorbed: number };
}

const START_Y = 480;

/**
 * Sixteen fighters per room.
 *
 * The arena has seventeen spawn points, one more than the cap, so a respawn
 * always has somewhere to go that nobody is standing on.
 */
const MAX_PLAYERS = 16;
const TICK_RATE = MS_PER_SECOND / 60;
const BROADCAST_HZ = 20;
const BROADCAST_RATE = MS_PER_SECOND / BROADCAST_HZ;
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
 * 24 to make room for the cinematic freeze, and `diagnose.ts` started failing
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
/** A stalled client may be caught up by at most this many ticks in one loop. */
const MAX_CATCH_UP_TICKS = 5;

/** Randomised bot personality, so a solo match is not the same fight every time. */
function botConfig(): AIConfig {
	return randomBotConfig();
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

/**
 * HP at or below which a frag counts as a clutch, for the highlight reel.
 *
 * Just under a third of a bar: low enough that the killer was one exchange from
 * losing it, high enough that it happens often enough to be worth naming.
 */
const POTG_CLUTCH_HP = 30;

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
		item: false,
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
	/**
	 * Massive blasts (ground slam and bomb) waiting for the tick's end.
	 *
	 * Collected while the fighters tick — that is when the swing is seen to
	 * reach the floor and the dive is seen to land — and resolved in one pass
	 * once every fighter is current, because each blast judges the whole room.
	 */
	private pendingBlasts: PendingBlast[] = [];
	/**
	 * Who each fighter's sweeping move has already hit, this cast.
	 *
	 * The thrust and the dragon hit **everyone** in their path, so the
	 * single-hit `hitLatch` does not apply — it would close on the first victim
	 * and let the rest of the line walk away untouched. This is the sweep's own
	 * latch: keyed by the sweeper, cleared the moment their move ends. Server
	 * only, exactly like `pendingBlasts` — the consequence travels in the
	 * victims' state, and a client never needs to know who was caught.
	 */
	private sweepLatches = new Map<string, Set<string>>();
	/**
	 * Who each diver has already caught, this dive.
	 *
	 * The plunge catch is judged once per victim per dive: the carried victim
	 * stays inside the column for the whole fall (same speed, same line), so
	 * without the latch the server would re-catch — and re-stun — every tick
	 * of the dive, and a timer that keeps resetting would make the client's
	 * replay disagree with the server's by exactly the snapshot interval.
	 * Same shape as `sweepLatches`: keyed by the bomber, cleared the moment
	 * the dive ends, server only.
	 */
	private plungeCatches = new Map<string, Set<string>>();
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
	/**
	 * The dragon waiting on the far side of the cinematic, exactly like the
	 * throw. The ride is launched when the freeze *ends*: the room is told a
	 * dragon is coming, and only then does the rider become cargo on the line.
	 */
	private pendingDragon: { ownerId: string; angle: number } | null = null;
	/**
	 * The storm waiting on the far side of the cinematic, exactly like the
	 * other two. The blossom is launched when the freeze *ends*: the room is
	 * told a Death Blossom is coming, and only then does the caster start
	 * spinning. There is no angle — the storm is radial, so only the caster
	 * rides the pending state.
	 */
	private pendingBlossom: { ownerId: string } | null = null;
	private grenades: GrenadeState[] = [];
	private singularity: Singularity | null = null;
	/** ms since the open singularity last dealt damage. */
	private singularityDamageAcc = 0;
	/**
	 * The open Death Blossom, or null. One storm at a time, like one hole.
	 *
	 * The caster's own channel lives in their `PlayerPosition.blossomTimer`
	 * (both sides tick it); this is the *area* — what the server damages
	 * against and what the clients draw. It ends when its timer runs out, or
	 * the instant the caster dies or is knocked down.
	 */
	private blossom: Blossom | null = null;
	/** ms since the open storm last dealt damage. */
	private blossomDamageAcc = 0;
	private nextUltId = 0;

	// ---- items ----
	//
	// Owned here for the same reason the ultimate is: only the server may decide
	// that an item was used, and only the server may decide when a trap has
	// caught somebody. Traps are world state (like the singularity) because the
	// client predicts their effect through `tickPlayer`; HE grenades and smoke
	// canisters are server-owned projectiles (like bullets) because a throw is a
	// one-shot the client can never see coming before the snapshot does. Smoke
	// clouds are world state like traps — not fed into `tickPlayer` (they change
	// no simulation state), but the concealment is re-derived from the list
	// every snapshot.
	private traps: Trap[] = [];
	/**
	 * Trap canisters in flight. The trap is *thrown*: a canister arcs out of
	 * the fighter's hand, inheriting their momentum, and plants into an armed
	 * trap where it touches the floor. Server-owned and dead-reckoned by the
	 * client, exactly like an HE grenade.
	 */
	private trapCanisters: TrapCanisterState[] = [];
	private heGrenades: HeGrenadeState[] = [];
	private smokeGrenades: SmokeGrenadeState[] = [];
	private smokeClouds: SmokeCloud[] = [];
	private nextItemId = 0;
	/** HE blasts since the last broadcast, for the client's explosion effects. */
	private explosions: ExplosionMsg[] = [];
	/** Traps that just caught somebody, for the client's caption. */
	private trappedEvents: TrappedMsg[] = [];

	// =========================================================
	//  PLAY OF THE GAME
	// =========================================================

	/**
	 * The highlight reel: a ring buffer of broadcast frames, and the running
	 * judgement of which slice of them was the match. See `PlayOfTheGame.ts`.
	 */
	private readonly potg: PotgRecorder;

	/**
	 * The recorder's clock, in ms since the room started.
	 *
	 * Deliberately **not** `matchElapsedMs`. The match clock stops during a team
	 * round's freezetime and cooldown, and footage stamped with a clock that
	 * stands still is footage the replay cannot sample — several hundred frames
	 * would share one timestamp. This one is monotonic and counts every tick the
	 * room ran, including the ones the ultimate's cinematic froze, so a cast
	 * replays as the held beat it actually was.
	 */
	private potgClockMs = 0;

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
	 * The hero the room's bots play, fixed by whoever created the room.
	 *
	 * `null` means random per bot — the default, because a room full of one
	 * hero is a probe's request, not a player's. `?botHero=anands` is how a
	 * probe makes the deathmatch probe exercise the dagger at sixteen fighters.
	 */
	readonly botHero: HeroId | null;

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
			botHero?: unknown;
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
		this.botHero = isHeroId(rules.botHero) ? rules.botHero : null;
		this.world = buildWorld(rules.screens ?? 1);
		this.startUltCharge = Math.max(
			0,
			Math.min(rules.startUltCharge ?? 0, ULT_MAX_CHARGE),
		);
		// The room is filmed from the moment it exists. Nothing here is optional or
		// opt-in: a highlight cannot be recorded retroactively, so the buffer has to
		// already be running when the moment worth keeping happens.
		this.potg = new PotgRecorder(
			() => ({
				roomId: this.id,
				hz: BROADCAST_HZ,
				screens: this.world.screens,
			}),
			(id) => this.players.get(id)?.team ?? null,
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

	/**
	 * The last match's Play of the Game footage, or null.
	 *
	 * Read by the HTTP endpoint in `server/index.ts` — the clip is hundreds of
	 * kilobytes and does not belong on the realtime channel. See
	 * `src/game/potg/types.ts` on why the announcement and the footage travel by
	 * different roads.
	 */
	get playOfTheGame(): PotgClip | null {
		return this.potg.clip;
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
		hero: HeroId = DEFAULT_HERO,
	): ConnectedPlayer {
		return {
			id,
			name,
			team,
			hero,
			channel: sources.channel ?? null,
			brain: sources.brain ?? null,
			dummy: sources.dummy ?? null,
			state: {
				...createPlayerState(spawn.x, spawn.y, spawn.facing),
				// The magazine starts full and the rest of the life's magazines
				// sit in the reserve, like the item kit.
				ammo: kitFor(hero).ranged.magazine,
				reserveRounds: reserveRoundsFor(kitFor(hero).ranged),
			},
			hp,
			kills: 0,
			deaths: 0,
			denies: 0,
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
			itemCharges: kitFor(hero).item.maxCharges,
			itemHeld: false,
			stats: newStats(),
			potgBurst: { damage: 0, absorbed: 0 },
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

	addPlayer(
		channel: ServerChannel,
		rawName?: unknown,
		hero?: unknown,
	): boolean {
		// A room full of bots still has room for a human: bots exist to keep the
		// arena busy, not to hold a seat against the people the arena is for.
		if (this.isFull && !this.freeBotSlot()) return false;

		const id = channel.id as string;
		// The hero is a per-client choice: the joining client asked for one in
		// its `join` message (or was handed it by the URL). A bad value falls
		// back to the default rather than failing the seat.
		const chosen = hero ?? DEFAULT_HERO;
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
			MAX_HP,
			{ channel },
			team,
			isHeroId(chosen) ? chosen : DEFAULT_HERO,
		);
		slot.state.freezeTimer = this.roundFreezeMs;
		this.players.set(id, slot);

		channel.join(this.id);
		channel.userData = { roomId: this.id, hero: slot.hero };

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

		// The Esc menu's hero select. Changing hero mid-match is allowed — the
		// kit is a snapshot field, so every client rolls the change back and
		// replays with the new weapons on the next snapshot — but it spends
		// whatever the meter held, because ultimates are unique per hero.
		channel.on("hero", (data: unknown) => {
			const player = this.players.get(id);
			const hero = (data as { hero?: unknown } | null)?.hero;
			if (!player || !isHeroId(hero)) return;
			player.hero = hero;
			// A different hero, a different ultimate: the meter is the old one's.
			player.ult = this.startUltCharge;
			player.ultHeld = false;
			// And a different melee weapon: cancel the move that belonged to the
			// old one, and any charge a sword was building.
			player.state.meleeAction = "none";
			player.state.meleeTimer = 0;
			player.state.hitLatch = false;
			player.state.blocking = false;
			player.state.chargeTimer = 0;
			player.state.massiveReady = false;
			player.state.parryMassiveTimer = 0;
			// And a different item: the old one's charges are meaningless to the
			// new kit, and the old kit's traps stay on the floor for whoever
			// placed them — a hero who leaves their traps behind is their own
			// fault, but the charges cannot travel across kits.
			player.itemCharges = kitFor(hero).item.maxCharges;
			player.itemHeld = false;
			// And a different magazine: the new kit's weapon starts full.
			this.refillMagazine(player);
			console.log(
				`[HERO] ${player.name} switches to ${kitFor(hero).melee.label} / ${kitFor(hero).ranged.label}`,
			);
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
	 * The hero a bot gets. Random by default so a busy room exercises every
	 * kit; `?botHero=` pins it for a probe.
	 */
	private botHeroFor(): HeroId {
		if (this.botHero !== null) return this.botHero;
		return (
			HERO_IDS[Math.floor(Math.random() * HERO_IDS.length)] ?? DEFAULT_HERO
		);
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
		const hero = this.botHeroFor();
		const slot = this.newSlot(
			id,
			botName(this.names),
			this.spawnFor(team),
			MAX_HP,
			{ brain: new EnemyBrain(botConfig(), this.world, hero) },
			team,
			hero,
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
				null,
				// The dummy plays whatever hero the training config asks for —
				// practising the thrust against a *sword* dummy and the sword
				// against a *dagger* dummy are different drills.
				isHeroId(dummy.config.hero) ? dummy.config.hero : DEFAULT_HERO,
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

		if (msg.config) {
			dummy.configure(msg.config);
			// The dummy's hero can change live: the kit is read from the slot
			// every tick, so a `dummyHero` patch just swaps the weapons under
			// the same fighter. The meter is the old hero's — reset it.
			if (slot && isHeroId(dummy.config.hero)) {
				slot.hero = dummy.config.hero;
				slot.ult = this.startUltCharge;
			}
		}
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
			item: out.item,
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
					hero: p.hero,
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
			enemyPlunging: foe.state.plunging,
			enemyStuck: foe.state.plungeStuckTimer > 0,
			selfAction: bot.state.meleeAction,
			selfStunned: bot.state.stunTimer > 0,
			selfPlunging: bot.state.plunging,
			selfStuck: bot.state.plungeStuckTimer > 0,
			selfMassiveReady: bot.state.massiveReady,
			selfCharging: bot.state.chargeTimer > 0 || bot.state.massiveReady,
			selfId: bot.id,
			selfHero: bot.hero,
			enemyHero: foe.hero,
			enemyGrounded: foe.state.grounded,
			selfAirJumps: bot.state.airJumps,
			selfUltCharge: bot.ult,
			enemyVX: foe.state.vx,
			enemyVY: foe.state.vy,
			selfTeam: bot.team,
			allies,
			foes,
			selfItemCharges: bot.itemCharges,
			// The magazine and the reserve, so a brain can tell a live gun from
			// a dry one. Both are per-life resources owned by the server; the
			// brain reads them exactly like a human reads the HUD.
			selfAmmo: bot.state.ammo,
			selfReserveRounds: bot.state.reserveRounds,
			// Hostile traps, pre-filtered by the same predicate the simulation
			// uses, so a bot can route around them without re-deriving a rule.
			traps: this.traps
				.filter((t) => t.ownerId !== bot.id && hostile(t.ownerTeam, bot.team))
				.map((t) => ({ x: t.x, y: t.y })),
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
			damage: p.stats.damageDealt,
			denies: p.denies,
			blocked: p.stats.damageBlocked,
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
		victim.state.plunging = false;
		victim.state.plungeStuckTimer = 0;

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
				killer.denies++;
			}
		}
		// The highlight reel, before the credit fields are cleared: every question
		// the scoring asks is about state that is true *now* and about to stop
		// being — who dealt the last blow, with what, and how close they were to
		// losing the exchange themselves.
		//
		// Modifiers are emitted **before** the frag they describe, so they carry the
		// same chain multiplier it does rather than the next one's — see
		// `scorePlay`. Everything shares one timestamp, which is what makes them one
		// moment instead of six.
		if (killer) {
			const t = this.potgClockMs;
			const actor = { id: killer.id, name: killer.name };
			const target = { id: victim.id, name: victim.name };
			if (victim.lastHurtByUlt) {
				this.potg.note(t, "ultimateKill", actor, target);
			}
			if (
				killer.state.meleeAction === "slash3" ||
				killer.state.meleeAction === "massive" ||
				killer.state.meleeAction === "thrust" ||
				// A bomb kill: the killer is planted in the ground the blast just
				// made — the finisher of the sword game's heaviest move.
				killer.state.plungeStuckTimer > 0
			) {
				this.potg.note(t, "finisherKill", actor, target);
			}
			if (!victim.state.grounded) this.potg.note(t, "airKill", actor, target);
			if (killer.hp > 0 && killer.hp <= POTG_CLUTCH_HP) {
				this.potg.note(t, "clutchKill", actor, target);
			}
			// The frag that emptied a side. Asked here rather than where the round is
			// actually scored, because that happens on the next tick and by then
			// nothing knows whose blow did it.
			if (this.mode === "tdm" && roundResult(this.members())?.kind === "win") {
				this.potg.note(t, "wipeKill", actor, target);
			}
			if (victim.ultHeld) this.potg.note(t, "deny", actor, target);
			this.potg.note(t, "kill", actor, target);
		}

		victim.lastHurtBy = null;
		victim.lastHurtByUlt = false;

		console.log(
			`[FRAG] ${killer?.name ?? "the arena"} killed ${victim.name} (${killer?.kills ?? 0})`,
		);
	}

	/** What dealt the damage, for the charge economy: the sword pays double. */
	private damage(
		victim: ConnectedPlayer,
		amount: number,
		sourceId: string,
		paysCharge = true,
		source: "melee" | "bullet" | "singularity" | "dragon" = "bullet",
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
			// sword hit and a bullet agree per point — and a weapon added later
			// cannot forget to pay. The one weapon that does not pay passes
			// `paysCharge: false` and this line skips it.
			if (paysCharge) {
				// The sword pays double per point: it is the closer, riskier weapon
				// and this game's heart, so a melee fighter arms their ultimate
				// first. The multiplier is the whole of "slashes charge more than
				// shots", and it lives in the simulation beside the base rate.
				const rate =
					source === "melee"
						? ULT_CHARGE_PER_DAMAGE * ULT_CHARGE_MELEE_MULTIPLIER
						: ULT_CHARGE_PER_DAMAGE;
				from.ult = addCharge(from.ult, amount * rate);
				// The reel's own economy rides the same gate: the ultimate is the
				// one weapon that feeds nothing — not the meter, not the highlight.
				// Banked in bursts so the tracker hears about a health bar's worth
				// of pressure at a time, never every bullet.
				from.potgBurst.damage += amount;
				if (from.potgBurst.damage >= POTG_DAMAGE_BURST) {
					this.potg.note(
						this.potgClockMs,
						"damageDealt",
						{ id: from.id, name: from.name },
						{ id: victim.id, name: victim.name },
						from.potgBurst.damage,
					);
					from.potgBurst.damage = 0;
				}
			}
		}

		if (victim.hp <= 0) this.killPlayer(victim);
	}

	private tickRespawns(dt: number) {
		for (const player of this.players.values()) {
			if (player.alive) continue;
			player.respawnTimer -= dt * MS_PER_SECOND;
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
		player.hp = MAX_HP;
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
		// Items, though, are a per-life resource: dying is the price of the
		// second grenade, so a respawn grants the full kit again — and takes
		// the dead fighter's traps off the floor with them, so a player cannot
		// stack a fresh three on top of the three that just got them killed.
		player.itemCharges = kitFor(player.hero).item.maxCharges;
		player.itemHeld = false;
		this.refillMagazine(player);
		this.traps = this.traps.filter((t) => t.ownerId !== player.id);
		// A throw in flight leaves with the thrower too: the canister is part of
		// the life that spent the charge, and a dead fighter's arc landing a
		// fresh mine after the respawn would be the same stacking the floor
		// rule exists to stop.
		this.trapCanisters = this.trapCanisters.filter(
			(c) => c.ownerId !== player.id,
		);
		// The dead fighter's clouds leave the floor with them, exactly like
		// their traps: a respawn is a new life, and a new life does not stack
		// yesterday's concealment on top of today's two charges.
		this.smokeClouds = this.smokeClouds.filter((c) => c.ownerId !== player.id);
		// A dead blossom caster is not a spinning one: the storm leaves with
		// whoever was spinning, whether they respawn or stay dead.
		if (this.blossom?.ownerId === player.id) this.blossom = null;
		// The reel's burst buckets, though, are a life's worth of pressure: a
		// play is a run of moments, and the moment ended at death.
		player.potgBurst = { damage: 0, absorbed: 0 };
		this.broadcast("respawn", { id: player.id, t: Date.now() });
	}

	/**
	 * Bank damage the sword guard turned away, and hand the reel a burst of
	 * `damageAbsorbed` once a health bar's worth has piled up.
	 *
	 * The defender is the *actor* of the event — it is their play — and the
	 * attacker whose hit was stopped rides in the victim slot, so the card can
	 * say whose blows were turned. Deliberately the cheapest thing the reel
	 * scores: blocking well is true but reads as nothing on a screen, so it may
	 * colour a play that was already won and must almost never win one that was
	 * not.
	 */
	private absorbPotg(
		defender: ConnectedPlayer,
		amount: number,
		attacker: { id: string; name: string } | null,
	) {
		if (amount <= 0) return;
		// The scoreboard's BLOCKED column, counted at the one chokepoint every
		// guard-turn passes through — a melee block and a bullet block must not
		// disagree about what blocking is worth.
		defender.stats.damageBlocked += amount;
		defender.potgBurst.absorbed += amount;
		if (defender.potgBurst.absorbed < POTG_ABSORB_BURST) return;
		this.potg.note(
			this.potgClockMs,
			"damageAbsorbed",
			{ id: defender.id, name: defender.name },
			{ id: attacker?.id ?? "", name: attacker?.name ?? "" },
			defender.potgBurst.absorbed,
		);
		defender.potgBurst.absorbed = 0;
	}

	private tickMatchClock(dt: number) {
		if (this.phase === "over") {
			this.overTimer -= dt * MS_PER_SECOND;
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
		if (!paused) this.matchElapsedMs += dt * MS_PER_SECOND;

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
			// The MVP is the side's most valuable fighter by weighted whole-match
			// stats, not necessarily the frags leader — the same `mvpOf` the client
			// uses, so the log and the ceremony cannot disagree.
			const mvp = mvpOf(standings);
			console.log(
				`[MATCH] ${this.id} over by ${reason}: ${teamName(this.winnerTeam) || "nobody"} wins ${this.teamScores.join("-")} (MVP ${mvp?.name ?? "nobody"})`,
			);
		} else {
			console.log(
				`[MATCH] ${this.id} over by ${reason}: ${winner?.name ?? "nobody"} wins with ${winner?.kills ?? 0}`,
			);
		}
		// Play of the Game, decided **before** the podium is announced and sent
		// first, because that is the order it is watched in: the reel, then the
		// standings. It is a separate message rather than a field on `match-over`
		// for the same reason the clip is fetched rather than pushed — a room where
		// nobody scored has no play, and a podium that carried an empty one would
		// have to say so.
		const potg = this.potg.finish();
		if (potg) {
			console.log(
				`[POTG] ${this.id}: ${potg.protagonistName} — ${potg.headline} (${potg.score}, clip ${potg.hasClip ? "cut" : "lost"})`,
			);
			this.broadcastReliable("potg", potg);
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
			this.roundFreezeMs = Math.max(0, this.roundFreezeMs - dt * MS_PER_SECOND);
			if (this.roundFreezeMs === 0) {
				console.log(`[ROUND] ${this.id}: round ${this.roundNumber} live`);
				// Announced, so the banner lands at the same moment on every client
				// rather than each one racing its own copy of the countdown to zero.
				this.broadcastReliable("round-live", { round: this.roundNumber });
			}
			return;
		}

		if (this.roundResetTimer > 0) {
			this.roundResetTimer -= dt * MS_PER_SECOND;
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
			player.itemHeld = false;
			// A fresh personality per match, so sixteen bots do not replay the same
			// fight every five minutes.
			if (player.brain)
				player.brain = new EnemyBrain(botConfig(), this.world, player.hero);
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
		// The reel belongs to the match that produced it. A new one starts with an
		// empty buffer, or the first thirty seconds of it would be footage of a
		// fight that is already on the scoreboard of nobody.
		this.potg.reset();
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
				damage: p.stats.damageDealt,
				denies: p.denies,
				blocked: p.stats.damageBlocked,
				alive: p.alive,
				// Beside `hp` rather than in the roster: teams are an argument to the
				// client's own `tickPlayer` — see `SnapshotPlayer`.
				team: p.team,
				// The hero rides the snapshot for the same reason the team does:
				// it is an argument to the client's `tickPlayer`.
				hero: p.hero,
				// Rounded: the HUD draws a bar, and a fractional trickle would make
				// every snapshot differ in a digit nobody can see.
				ult: Math.round(p.ult),
				// Charges are whole numbers by construction — each use spends one.
				itemCharges: p.itemCharges,
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
				pellet: b.pellet ?? false,
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
			// The storm, in full for the same reason: the renderer draws the ring
			// from this and the channel (which the client already predicts) agrees
			// with it.
			blossom: this.blossom ? { ...this.blossom } : null,
			cinematic,
			// Traps are fed into `tickPlayer` the same way the singularity is, so
			// they travel in full every snapshot too. The canisters in flight
			// dead-reckon like bullets — position and velocity, anchored by the
			// client on first sight.
			traps: this.traps.map((t) => ({ ...t })),
			trapCanisters: this.trapCanisters.map((c) => ({ ...c })),
			heGrenades: this.heGrenades.map((g) => ({
				id: g.id,
				ownerId: g.ownerId,
				ownerTeam: g.ownerTeam,
				x: g.x,
				y: g.y,
				vx: g.vx,
				vy: g.vy,
			})),
			// Smoke canisters dead-reckon like bullets; the clouds travel in full
			// every snapshot because the concealment is re-derived from the list.
			smokeGrenades: this.smokeGrenades.map((g) => ({
				id: g.id,
				ownerId: g.ownerId,
				ownerTeam: g.ownerTeam,
				x: g.x,
				y: g.y,
				vx: g.vx,
				vy: g.vy,
			})),
			smokeClouds: this.smokeClouds.map((c) => ({ ...c })),
			// One-shot effects, drained every snapshot like `melee` and `denies`.
			explosions: this.explosions.slice(),
			trapped: this.trappedEvents.slice(),
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
		if (this.tickAccumulator > TICK_RATE * MAX_CATCH_UP_TICKS) {
			this.tickAccumulator = TICK_RATE * MAX_CATCH_UP_TICKS;
		}

		while (this.tickAccumulator >= TICK_RATE) {
			this.fixedTick(TICK_RATE / MS_PER_SECOND, time);
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

		// Before the cinematic's early return, on purpose: the recorder's clock is
		// the *footage* clock, and a freeze is 1100ms of footage in which nothing
		// moves. Stopping this here would collapse the whole cast onto one
		// timestamp and make the replay skip the most cinematic second in the game.
		this.potgClockMs += dt * MS_PER_SECOND;
		this.potg.tick(this.potgClockMs);

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
					? this.scriptedInput(player, dt * MS_PER_SECOND, now)
					: player.pendingInput;
			if (!input) {
				// Frozen. Recorded as frozen, so every other client freezes it too
				// rather than inventing a tick of motion for it.
				player.simulatedIntent = null;
				continue;
			}

			player.simulatedIntent = input;
			// What the fighter was doing before this tick, for the blast judge:
			// whether a massive's swing crossed the end of its active window and
			// whether a dive was in the air. Both are transitions only this side
			// of `tickPlayer` can see.
			const prev = {
				action: player.state.meleeAction,
				timer: player.state.meleeTimer,
				plunging: player.state.plunging,
			};
			// The hole this fighter is in, if any — already filtered for friendly
			// fire, so the caster is handed null and walks through their own field.
			// The kit is the hero's weapons: an argument, never state, so the two
			// sides cannot disagree about which table a move belongs to. The traps
			// are the same shape of argument — filtered by the same `trapFor` the
			// client's prediction uses — because the lock is a timer both sides
			// simulate. Without them the *server* never sets `trapTimer` and the
			// first snapshot after a spring erases the root the client predicted.
			player.state = tickPlayer(
				player.state,
				input,
				dt,
				this.world,
				fieldFor(this.singularity, player.id, player.team),
				kitFor(player.hero),
				trapFor(this.traps, player.id, player.team),
			);
			this.noteBlasts(player, prev);

			// A release edge, not a press edge: `ultimate` is held button state on
			// the wire like every other button, but the hold is the *aim phase* — the
			// cast is decided when the button is let go, at the angle the player
			// released on. Edge-detecting here rather than on the client is the same
			// rule attack and jump follow.
			if (input.ultimate) player.ultAimAngle = input.aimAngle;
			if (!input.ultimate && player.ultHeld) this.tryCastUltimate(player);
			player.ultHeld = input.ultimate;

			// The item is used on the press, not the release — the aim angle of
			// the press *is* the throw, so there is no aim phase to hold through.
			if (input.item && !player.itemHeld) this.tryUseItem(player);
			player.itemHeld = input.item;

			// A fighter holds a melee weapon or a ranged one, never both: firing
			// is gated on the stance the simulation says they are actually in,
			// and the stat card is the hero's ranged weapon — the machine gun
			// fires four times as often as the pistol, per its own cooldown.
			const kit = kitFor(player.hero);
			if (
				player.alive &&
				// Decided out here rather than in `tickPlayer`, so it needs the same
				// gate the intent already got: a frozen fighter's neutral intent never
				// reaches this branch, but `input` is the raw one.
				!isFrozen(player.state) &&
				player.state.stance === "gun" &&
				input.attack &&
				// An empty magazine cannot fire. The round is spent here, on the
				// server, and the reload below is what brings it back.
				player.state.ammo > 0 &&
				canFire(player.lastAttackTime, now, kit.ranged.cooldownMs)
			) {
				player.lastAttackTime = now;
				player.state.ammo--;
				const muzzleX = player.state.x + PLAYER_WIDTH / 2;
				const muzzleY = player.state.y + PLAYER_HEIGHT / 2;
				// A shotgun fires a deterministic fan of pellets: fixed angles at
				// even steps across the cone, so both sides always spawn the same
				// pattern from the same aim. The fan is what makes the weapon's
				// range — the cone is fixed at the muzzle, so distance *is* the
				// miss. A weapon with no fan fires one ordinary shot.
				const pellets = kit.ranged.pellets ?? 1;
				const halfSpread =
					((kit.ranged.spreadDeg ?? 0) * Math.PI) / DEGREES_PER_PI_RADIANS;
				const step = pellets > 1 ? (halfSpread * 2) / (pellets - 1) : 0;
				for (let i = 0; i < pellets; i++) {
					const angle =
						input.aimAngle + (pellets > 1 ? -halfSpread + step * i : 0);
					this.bullets.push({
						id: this.nextBulletId++,
						ownerId: player.id,
						x: muzzleX,
						y: muzzleY,
						// The muzzle, kept for the damage falloff: a shotgun
						// pellet is judged by how far it has flown, and
						// distance needs a place it started from.
						originX: muzzleX,
						originY: muzzleY,
						vx: Math.cos(angle) * kit.ranged.speed,
						vy: Math.sin(angle) * kit.ranged.speed,
						pellet: pellets > 1,
					});
				}
				player.stats.bulletsFired += pellets;
			}

			// The auto-reload, on the same input that just fired. Server-ticked:
			// the client draws `ammo` and `reloadTimer` off the wire and never
			// simulates them, exactly like the ultimate meter.
			this.tickReload(player, input, dt);
		}

		// Counted down here rather than in `tickCinematic`, which stops running the
		// moment the freeze is over — this is the window *after* it, while the
		// parked backlog is still draining.
		this.cinematicGraceMs = Math.max(
			0,
			this.cinematicGraceMs - dt * MS_PER_SECOND,
		);

		this.resolveBlasts();
		this.resolveMeleeHits();
		this.resolvePlungeCatches();
		this.resolveThrusts();
		this.resolveDragonHits();
		this.tickBullets(dt);
		this.tickUltimate(dt);
		this.tickBlossom(dt);
		this.tickItems(dt);
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
			this.resetTimer -= dt * MS_PER_SECOND;
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

		this.trainingElapsedMs += dt * MS_PER_SECOND;
		for (const player of this.players.values()) {
			if (player.dummy) {
				if (cfg.dummyInvincible) player.hp = cfg.dummyHp;
			} else if (cfg.playerInvincible) {
				player.hp = MAX_HP;
			}
		}
	}

	/**
	 * Notice the two ways a massive reaches the floor, during the fighter's own
	 * tick.
	 *
	 * The ground slam happens the tick the swing's active window closes — the
	 * blade's travel is over, so the blade has arrived. The bomb happens the
	 * tick a dive's floor contact lands it. Both are transitions the shared
	 * `tickPlayer` produces identically on every client; only the *damage* is
	 * this side's business.
	 */
	private noteBlasts(
		player: ConnectedPlayer,
		prev: {
			action: PlayerPosition["meleeAction"];
			timer: number;
			plunging: boolean;
		},
	) {
		const s = player.state;
		if (!player.alive) return;

		// The ground slam. If a guard intercepted the swing, the guard break
		// already ended the move on the tick it was judged, so a move reaching
		// this boundary is proof the sword was not stopped.
		const activeEnd = MOVES.massive.startupMs + MOVES.massive.activeMs;
		if (
			prev.action === "massive" &&
			prev.timer < activeEnd &&
			s.meleeAction === "massive" &&
			s.meleeTimer >= activeEnd
		) {
			const point = massiveSlamPoint(s);
			this.pendingBlasts.push({
				bomberId: player.id,
				x: point.x,
				y: point.y,
				radiusPx: MASSIVE_BLAST_RADIUS_PX,
				damage: MASSIVE_BLAST_DAMAGE,
				stunMs: MASSIVE_BLAST_STUN_MS,
				knockupVy: 0,
			});
		}

		// The bomb. `tickPlayer` planted the fighter the same tick it landed, so
		// "was diving, now grounded" is exactly the landing — and the fall
		// height, and therefore the whole blast, is derived from state both
		// sides already agreed on.
		if (prev.plunging && !s.plunging && s.grounded) {
			const blast = bombBlastFor(bombFallHeight(s.plungeOriginY, s.y));
			this.pendingBlasts.push({
				bomberId: player.id,
				x: s.x + PLAYER_WIDTH / 2,
				y: s.y + PLAYER_HEIGHT / 2,
				radiusPx: blast.radiusPx,
				damage: blast.damage,
				stunMs: blast.stunMs,
				knockupVy: blast.knockupVy,
			});
		}
	}

	/**
	 * Apply every massive blast collected this tick, to everyone it reaches.
	 *
	 * A blast is the one sword hit with no swing to dodge: it ignores a guard
	 * entirely — that is the entire point of the back-massive and the bomb —
	 * and the stun goes through it the same way. It breaks a stuck bomber free
	 * like any melee hit, and it never, ever touches the fighter who made it.
	 */
	private resolveBlasts() {
		for (const blast of this.pendingBlasts) {
			const bomber = this.players.get(blast.bomberId);
			if (!bomber) continue;

			// One boom per blast, whoever it catches — or nobody. The area of
			// effect *is* the move: a whiffed massive still has to erupt, so the
			// event is pushed once per blast with the first victim's id (or
			// none) and the blast's own radius, and the damage loop only adds
			// the hurt.
			let firstVictim = "";
			for (const victim of this.players.values()) {
				if (victim === bomber || !victim.alive) continue;
				if (!hostile(bomber.team, victim.team)) continue;
				const cx = victim.state.x + PLAYER_WIDTH / 2;
				const cy = victim.state.y + PLAYER_HEIGHT / 2;
				if (Math.hypot(cx - blast.x, cy - blast.y) > blast.radiusPx) {
					continue;
				}

				if (!firstVictim) firstVictim = victim.id;

				const v = victim.state;
				v.stunTimer = Math.max(v.stunTimer, blast.stunMs);
				v.iframeTimer = MELEE_IFRAME_MS;
				if (blast.knockupVy !== 0) {
					if (v.plungeCarryTimer > 0) {
						// A fighter the dive carried to the floor is **pinned**, not
						// launched: the bomb's knockup is traded for a knockdown for
						// the blast's whole stun, so the victim ends face-down in
						// the crater instead of thrown back up. The carry's tail is
						// what says "carried" here — the timer still outlives the
						// landing, and once it is spent there is no carry left to
						// spare.
						v.plungeCarryTimer = 0;
						v.knockdownTimer = Math.max(v.knockdownTimer, blast.stunMs);
					} else {
						// The bomb's launch: upward, plus a small shove off the crater.
						v.vy = blast.knockupVy;
						v.grounded = false;
						v.vx += (Math.sign(cx - blast.x) || 1) * BOMB_KNOCKBACK_VX;
					}
				} else {
					// The ground slam shoves away from the slam point, so the fight
					// separates instead of standing in the crater.
					v.vx += (Math.sign(cx - blast.x) || 1) * MASSIVE_BLAST_KNOCKBACK_PX_S;
				}
				// A blast interrupts what the victim was doing, like any sword hit,
				// and breaks a stuck bomber free — it is an animation punishment.
				v.plungeStuckTimer = 0;
				v.meleeAction = "none";
				v.meleeTimer = 0;
				v.hitLatch = false;
				v.blocking = false;
				v.comboStep = 0;
				v.comboTimer = 0;

				this.damage(victim, blast.damage, bomber.id, true, "melee");
			}

			this.meleeEvents.push({
				attackerId: bomber.id,
				victimId: firstVictim,
				move: "massive",
				outcome: blast.knockupVy !== 0 ? "bomb" : "blast",
				x: blast.x,
				y: blast.y,
				dir: bomber.state.facing,
				radiusPx: blast.radiusPx,
			});
		}
		this.pendingBlasts.length = 0;
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

				// A guard that turned a swing away is damage the defender *didn't*
				// take. Banked for the reel before `applyMeleeResult` mutates
				// anything, because the move's table is the only record of what
				// the hit would have been worth.
				if (result.outcome === "parried") {
					this.absorbPotg(defender, MOVES[result.move].damage, attacker);
				}

				const damage = applyMeleeResult(attacker.state, defender.state, result);
				this.damage(defender, damage, attacker.id, true, "melee");

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

	/**
	 * Judge every dive's grab against every other fighter.
	 *
	 * The plunge bomb's second weapon is the dive itself: a midair foe inside
	 * the bomber's column is caught, carried down at the dive's own speed, and
	 * pinned into the ground by the landing blast instead of launched. The
	 * catch is a hit — server-only, like every hit — and its consequence
	 * (the carry) travels in the victim's `PlayerPosition` for both sides to
	 * simulate, exactly like the dragon ride.
	 *
	 * The reach is the shared `plungeCatchRect` (a body's width past the
	 * bomber on every side), the grab is midair-only, and `plungeCatches`
	 * keeps it to one victim per dive: a carried fighter stays in the column
	 * for the whole fall (same speed, same line), so without the latch the
	 * server would re-catch — and re-stun — every tick, and a timer that kept
	 * resetting would make the client's replay disagree by exactly the
	 * snapshot interval. The blast is immune to the guard like every blast;
	 * so is the grab.
	 */
	private resolvePlungeCatches() {
		for (const bomber of this.players.values()) {
			if (!bomber.alive) continue;
			const diving = bomber.state.plunging;
			if (!diving) {
				this.plungeCatches.delete(bomber.id);
				continue;
			}
			const box = plungeCatchRect(bomber.state);
			let latched = this.plungeCatches.get(bomber.id);
			if (!latched) {
				latched = new Set();
				this.plungeCatches.set(bomber.id, latched);
			}
			for (const victim of this.players.values()) {
				if (victim === bomber || !victim.alive) continue;
				if (!hostile(bomber.team, victim.team)) continue;
				if (latched.has(victim.id)) continue;
				// Midair only: a fighter on the floor gets the landing blast,
				// not the ride.
				if (victim.state.grounded) continue;
				if (!rectsOverlap(box, bodyRect(victim.state.x, victim.state.y))) {
					continue;
				}
				latched.add(victim.id);

				const v = victim.state;
				// The grab is the ride's whole shape: the carry pins the body
				// in `tickPlayer`, the stun makes the ride helpless (and reads
				// as a hit in reconciliation, like any stun), and the tail the
				// carry leaves past the landing is what tells the blast
				// "carried" from "launched".
				v.plungeCarryTimer = PLUNGE_CARRY_MS;
				v.stunTimer = Math.max(v.stunTimer, PLUNGE_CARRY_MS);
				v.iframeTimer = MELEE_IFRAME_MS;
				v.meleeAction = "none";
				v.meleeTimer = 0;
				v.hitLatch = false;
				v.blocking = false;
				v.comboStep = 0;
				v.comboTimer = 0;
			}
		}
	}

	/**
	 * Judge every live thrust sweep against every other fighter.
	 *
	 * The dagger thrust is the one melee move that hits **everyone** in its
	 * path — the move's whole identity is that a line of fighters is a line of
	 * knockdowns — so it cannot go through `resolveMelee`, whose `hitLatch`
	 * closes on the first connection. Instead the swept box (the path the dash
	 * has covered so far, derivable from state alone) is tested against every
	 * foe, and `sweepLatches` keeps each fighter at one hit per cast. The latch
	 * clears the moment the thrust ends, so a second thrust is a fresh sweep.
	 */
	private resolveThrusts() {
		for (const attacker of this.players.values()) {
			if (!attacker.alive) continue;
			const moving = attacker.state.meleeAction === "thrust";
			if (!moving || meleePhase(attacker.state) !== "active") {
				if (!moving) this.sweepLatches.delete(attacker.id);
				continue;
			}
			const box = sweptThrustBox(attacker.state);
			if (!box) continue;
			let latched = this.sweepLatches.get(attacker.id);
			if (!latched) {
				latched = new Set();
				this.sweepLatches.set(attacker.id, latched);
			}
			for (const defender of this.players.values()) {
				if (defender === attacker || !defender.alive) continue;
				if (!hostile(attacker.team, defender.team)) continue;
				// A dive cannot be anti-aired, thrust included: the plunge is
				// immune to melee, and the sweep is melee. `resolveMelee` gets
				// the same gate for the swings that go through it.
				if (defender.state.plunging) continue;
				if (latched.has(defender.id)) continue;
				if (!rectsOverlap(box, bodyRect(defender.state.x, defender.state.y))) {
					continue;
				}
				latched.add(defender.id);
				const damage = applyHitToDefender(defender.state, {
					move: "thrust",
					outcome: "hit",
					damage: MOVES.thrust.damage,
					x: box.x + box.w / 2,
					y: box.y + box.h / 2,
					dir: attacker.state.facing >= 0 ? 1 : -1,
				});
				this.damage(defender, damage, attacker.id, true, "melee");
				this.meleeEvents.push({
					attackerId: attacker.id,
					victimId: defender.id,
					move: "thrust",
					outcome: "hit",
					x: box.x + box.w / 2,
					y: box.y + box.h / 2,
					dir: attacker.state.facing >= 0 ? 1 : -1,
				});
			}
		}
	}

	/**
	 * Judge the dragon-thrust ride against every other fighter.
	 *
	 * Same shape as `resolveThrusts` — a swept box, a per-cast latch, everyone
	 * on the line hit once — with two differences that make it an *ultimate*:
	 * the sweep is the whole flight (any direction, not just along facing), and
	 * the hit is an area knockback along the dragon's line rather than a
	 * knockdown. Nothing blocks it: the dragon ignores guards by design, and
	 * the only thing that stops the *rider* is a hostile black hole, handled in
	 * `tickPlayer`.
	 */
	private resolveDragonHits() {
		for (const rider of this.players.values()) {
			if (!rider.alive) continue;
			const riding = rider.state.dragonTimer > 0;
			if (!riding) {
				this.sweepLatches.delete(rider.id);
				continue;
			}
			const box = dragonSweptRect(rider.state);
			if (!box) continue;
			let latched = this.sweepLatches.get(rider.id);
			if (!latched) {
				latched = new Set();
				this.sweepLatches.set(rider.id, latched);
			}
			const nx = rider.state.dragonVX / DRAGON_SPEED;
			const ny = rider.state.dragonVY / DRAGON_SPEED;
			for (const victim of this.players.values()) {
				if (victim === rider || !victim.alive) continue;
				if (!hostile(rider.team, victim.team)) continue;
				if (latched.has(victim.id)) continue;
				if (!rectsOverlap(box, bodyRect(victim.state.x, victim.state.y))) {
					continue;
				}
				latched.add(victim.id);
				const v = victim.state;
				// The knockback is the move: a shove along the dragon's line,
				// hard enough to bowl a fighter over, with a brief stun so the
				// shove reads. Directional, like a blast, so a line of fighters
				// is swept rather than scattered.
				v.stunTimer = Math.max(v.stunTimer, DRAGON_STUN_MS);
				v.iframeTimer = MELEE_IFRAME_MS;
				v.vx += nx * DRAGON_KNOCKBACK_PX_S;
				v.vy += ny * DRAGON_KNOCKBACK_PX_S;
				if (ny < 0) v.grounded = false;
				v.meleeAction = "none";
				v.meleeTimer = 0;
				v.hitLatch = false;
				v.blocking = false;
				v.comboStep = 0;
				v.comboTimer = 0;
				v.plungeStuckTimer = 0;
				// The ultimate pays nobody — the dragon feeds no meter, like the
				// hole.
				this.damage(victim, DRAGON_DAMAGE, rider.id, false, "dragon");
				this.meleeEvents.push({
					attackerId: rider.id,
					victimId: victim.id,
					move: "thrust",
					outcome: "hit",
					x: box.x + box.w / 2,
					y: box.y + box.h / 2,
					dir: nx >= 0 ? 1 : -1,
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
			// The bullet's damage is the shooter's weapon's — a machine gun round
			// is worth half a pistol round, however fast the stream arrives. A
			// shotgun's pellet is read at the distance it has flown: the falloff
			// is why the weapon dies by a hundred px. A weapon without a falloff
			// (the rifle, the machine gun) deals its flat card damage anywhere.
			const shotDamage = shooter
				? pelletDamageAt(
						kitFor(shooter.hero).ranged,
						bulletDistanceFromMuzzle(b),
					)
				: BULLET_DAMAGE;
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
					this.absorbPotg(player, shotDamage, shooter ?? null);
					consumed = true;
					break;
				}

				// A client never learns why a projectile vanished, so this counter is
				// the only honest source for the training report's bullet numbers.
				const owner = this.players.get(b.ownerId);
				if (owner) owner.stats.bulletHits++;
				this.damage(player, shotDamage, b.ownerId);
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

		this.cinematic.msLeft -= dt * MS_PER_SECOND;
		this.cinematicGraceMs = CINEMATIC_QUEUE_GRACE_MS;
		if (this.cinematic.msLeft > 0) return true;

		this.cinematic = null;
		this.releasePendingThrow();
		this.releasePendingDragon();
		this.releasePendingBlossom();
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
		// One cinematic at a time, and one black hole at a time: two holes
		// would have to argue about which way a fighter between them is pulled.
		// The dragon is a fast streak, not a field — a dragon can be cast into
		// an open hole (the hole is its one counter), so the singularity check
		// belongs to the black hole only.
		if (
			this.cinematic ||
			this.pendingThrow ||
			this.pendingDragon ||
			this.pendingBlossom
		)
			return;
		if (kitFor(player.hero).ultimate === "black-hole" && this.singularity) {
			return;
		}
		// One storm at a time, like one hole: two blossoms would argue about
		// whose radius a fighter inside both is being shredded by.
		if (kitFor(player.hero).ultimate === "death-blossom" && this.blossom) {
			return;
		}

		// Spent at the release, before anything happens. A caster who
		// disconnects mid-cast must not come back still armed.
		player.ult = 0;
		// Casting is one of the two things that cancel a charge — "don't switch
		// weapons or ult" — the other being a stance switch, both in `tickMelee`.
		player.state.chargeTimer = 0;
		player.state.massiveReady = false;
		player.state.parryMassiveTimer = 0;

		this.cinematic = { casterId: player.id, msLeft: ULT_CINEMATIC_MS };
		// The aim angle is the last input that held the button, not the release
		// input itself: the release frame is the moment the button came up, and
		// the aim that matters is the one it was held at. They are the same for
		// a human — the cursor has not moved between two frames — and they
		// differ only for scripted input, whose release frame may carry no
		// angle at all.
		if (kitFor(player.hero).ultimate === "dragon-thrust") {
			// Anands' ultimate: the same freeze the black hole gets, then the
			// release *is* the launch. The rider becomes cargo on the dragon's
			// line: velocity pinned to the release angle, gravity suppressed,
			// and the ride ends at the first obstacle (or a hostile black
			// hole). Whatever move the rider was making stays frozen for the
			// ride and dies with it, in `tickPlayer`, on both sides of the
			// wire.
			this.pendingDragon = {
				ownerId: player.id,
				angle: player.ultAimAngle,
			};
			console.log(`[ULT] ${player.name} casts Dragon Thrust`);
			return;
		}

		if (kitFor(player.hero).ultimate === "death-blossom") {
			// Jeffs' ultimate: the same freeze, then the release *is* the
			// storm. The caster's channel (`blossomTimer`) is set on release in
			// shared state both sides tick; the area field the server damages
			// against is opened here and closed in `tickBlossom`.
			this.pendingBlossom = { ownerId: player.id };
			console.log(`[ULT] ${player.name} casts Death Blossom`);
			return;
		}

		this.pendingThrow = {
			ownerId: player.id,
			ownerTeam: player.team,
			x: player.state.x + PLAYER_WIDTH / 2,
			y: player.state.y + PLAYER_HEIGHT / 2,
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

	/**
	 * The freeze is over: launch the dragon the caster paid for.
	 *
	 * The caster was frozen for the whole cinematic, so their state is exactly
	 * where it was at the cast — the ride's launch position is the state's own,
	 * and the velocity comes from the angle captured at the release.
	 */
	private releasePendingDragon() {
		const d = this.pendingDragon;
		this.pendingDragon = null;
		if (!d) return;
		const rider = this.players.get(d.ownerId);
		if (!rider) return;
		const velocity = dragonVelocity(d.angle);
		rider.state.dragonVX = velocity.vx;
		rider.state.dragonVY = velocity.vy;
		rider.state.dragonTimer = DRAGON_RIDE_MS;
		rider.state.vx = 0;
		rider.state.vy = 0;
		this.sweepLatches.delete(rider.id);
	}

	/**
	 * The freeze is over: start the storm the caster paid for.
	 *
	 * The channel is shared state — `blossomTimer` in the caster's
	 * `PlayerPosition`, ticked identically by every client — and this field is
	 * the area the server damages against and the clients draw. The caster's
	 * position at release is the storm's centre for its whole life.
	 */
	private releasePendingBlossom() {
		const b = this.pendingBlossom;
		this.pendingBlossom = null;
		if (!b) return;
		const caster = this.players.get(b.ownerId);
		if (!caster?.alive) return;
		caster.state.blossomTimer = BLOSSOM_DURATION_MS;
		this.blossom = {
			id: this.nextUltId++,
			ownerId: caster.id,
			ownerTeam: caster.team,
			x: caster.state.x + PLAYER_WIDTH / 2,
			y: caster.state.y + PLAYER_HEIGHT / 2,
			remainingMs: BLOSSOM_DURATION_MS,
		};
		this.blossomDamageAcc = 0;
		console.log(
			`[ULT] blossom ${this.blossom.id} at ${Math.round(this.blossom.x)},${Math.round(this.blossom.y)}`,
		);
	}

	/**
	 * Try to use the item, on the press of the item button. Silently refused
	 * when the conditions are not met, exactly like `tryCastUltimate` — every
	 * refusal is a state the player can already see.
	 */
	private tryUseItem(player: ConnectedPlayer) {
		const item = kitFor(player.hero).item;
		if (player.itemCharges <= 0) return;
		if (!player.alive || this.phase !== "live") return;
		if (isFrozen(player.state)) return;
		if (isStunned(player.state) || isKnockedDown(player.state)) return;
		if (this.cinematic) return;

		// The charge is spent up front, so a player who disconnects mid-throw
		// does not come back armed. The item is a finite resource on purpose.
		player.itemCharges--;
		console.log(
			`[ITEM] ${player.name} uses ${item.id} (${player.itemCharges} left)`,
		);

		if (item.id === "he-grenade") {
			this.heGrenades.push(
				launchHeGrenade(
					this.nextItemId++,
					player.id,
					player.state.x + PLAYER_WIDTH / 2,
					player.state.y + PLAYER_HEIGHT / 2,
					player.lastInput.aimAngle,
					player.team,
				),
			);
			return;
		}

		// The smoke canister arcs like the HE and blooms where its fuse ends.
		// Unlike the HE it never detonates on a fighter or on geometry — the
		// throw is a lob, the fuse is the bloom, and the cloud does the work.
		if (item.id === "smoke-grenade") {
			this.smokeGrenades.push(
				launchSmokeGrenade(
					this.nextItemId++,
					player.id,
					player.state.x + PLAYER_WIDTH / 2,
					player.state.y + PLAYER_HEIGHT / 2,
					player.lastInput.aimAngle,
					player.team,
				),
			);
			return;
		}

		// The trap is *thrown*, from the air as happily as from the floor: a
		// canister arcs out of the hand under its own gravity — inheriting the
		// thrower's momentum, so a throw out of a dash or a fall carries — and
		// plants into an armed trap where it touches the ground. Aiming the
		// landing patch is the skill; the arc is the counterplay, because
		// everybody gets to watch it come down.
		this.trapCanisters.push(
			launchTrapCanister(
				this.nextItemId++,
				player.id,
				player.state.x + PLAYER_WIDTH / 2,
				player.state.y + PLAYER_HEIGHT / 2,
				player.lastInput.aimAngle,
				player.state.vx,
				player.state.vy,
				player.team,
			),
		);
	}

	/**
	 * Advance one fighter's auto-reload, given the input that was just
	 * simulated.
	 *
	 * The state (`ammo`, `reloadTimer`) rides the wire so every client draws
	 * it, but only this side ticks it — the fire that spends a round is this
	 * side's decision, so the reload is too. The rule is the shared pure
	 * `tickReload`; this is the one gate that function cannot know about,
	 * because it lives here with the fighter, not in the state: a dead,
	 * frozen or disabled fighter reloads nothing.
	 */
	private tickReload(player: ConnectedPlayer, input: PlayerInput, dt: number) {
		const s = player.state;
		if (!player.alive || isFrozen(s) || isStunned(s) || isKnockedDown(s)) {
			s.reloadTimer = 0;
			return;
		}
		tickReload(s, input, kitFor(player.hero), dt);
	}

	/**
	 * The magazine and the reserve are a per-life resource: refilled on every
	 * new life, so a dry gun is dry only until death.
	 */
	private refillMagazine(player: ConnectedPlayer) {
		const ranged = kitFor(player.hero).ranged;
		player.state.ammo = ranged.magazine;
		player.state.reserveRounds = reserveRoundsFor(ranged);
		player.state.reloadTimer = 0;
	}

	/** Advance HE grenades, smoke canisters, the clouds, the traps and the canisters in flight. */
	private tickItems(dt: number) {
		this.tickHeGrenades(dt);
		this.tickSmokeGrenades(dt);
		this.tickSmokeClouds(dt);
		// The spring runs before the planting: a canister that lands this tick
		// becomes an armed trap only for the *next* tick's `tickPlayer`, so the
		// fighter standing on it gets the lock first and the spring (damage,
		// destruction) follows it — never the other way around, which would
		// destroy a trap on the same tick it planted without ever locking
		// anybody.
		this.tickTraps();
		this.tickTrapCanisters(dt);
	}

	private tickHeGrenades(dt: number) {
		if (this.heGrenades.length === 0) return;

		// Compact in place, exactly like the bullets: a grenade that ends this
		// tick is removed by not being kept.
		let kept = 0;
		for (const g of this.heGrenades) {
			tickHeGrenade(g, dt, this.world);

			let touched = false;
			for (const player of this.players.values()) {
				if (!player.alive) continue;
				if (
					!heGrenadeTouches(
						g,
						player.id,
						player.state.x,
						player.state.y,
						player.team,
					)
				) {
					continue;
				}
				touched = true;
				break;
			}

			// The HE is not deniable: a direct hit on a hostile fighter goes off
			// on them. Geometry is a bounce, never a detonation — the fuse is
			// what a bounced throw spends.
			if (!heGrenadeEnd(g, touched)) {
				this.heGrenades[kept++] = g;
				continue;
			}
			this.explodeHeGrenade(g);
		}
		this.heGrenades.length = kept;
	}

	private explodeHeGrenade(g: HeGrenadeState) {
		this.explosions.push({ x: g.x, y: g.y, radius: HE_GRENADE_RADIUS });
		console.log(
			`[ITEM] HE grenade ${g.id} detonates at ${Math.round(g.x)},${Math.round(g.y)}`,
		);
		for (const player of this.players.values()) {
			if (!player.alive) continue;
			// The friendly-fire rule, asked the same way every weapon asks it.
			// The thrower and their teammates walk out of their own blast.
			if (player.id === g.ownerId) continue;
			if (!hostile(g.ownerTeam, player.team)) continue;
			const dx = g.x - (player.state.x + PLAYER_WIDTH / 2);
			const dy = g.y - (player.state.y + PLAYER_HEIGHT / 2);
			const dist = Math.hypot(dx, dy);
			const damage = heBlastDamage(dist);
			if (damage <= 0) continue;
			// The HE feeds the meter like a bullet: it is an ordinary weapon, not
			// an ultimate, and the Overwatch economy pays for participation.
			this.damage(player, damage, g.ownerId, true, "bullet");
		}
	}

	/**
	 * Advance the smoke canisters in flight. The canister never detonates — it
	 * bounces until its fuse runs out, and then it **blooms**: a cloud is
	 * anchored at wherever it is, clamped into the arena.
	 */
	private tickSmokeGrenades(dt: number) {
		if (this.smokeGrenades.length === 0) return;

		let kept = 0;
		for (const g of this.smokeGrenades) {
			tickSmokeGrenade(g, dt, this.world);
			if (!smokeGrenadeEnd(g)) {
				this.smokeGrenades[kept++] = g;
				continue;
			}
			const point = clampSmokePoint(g.x, g.y, this.world);
			this.smokeClouds.push({
				id: g.id,
				ownerId: g.ownerId,
				ownerTeam: g.ownerTeam,
				x: point.x,
				y: point.y,
				remainingMs: SMOKE_DURATION_MS,
			});
			console.log(
				`[ITEM] smoke ${g.id} blooms at ${Math.round(point.x)},${Math.round(point.y)}`,
			);
		}
		this.smokeGrenades.length = kept;
	}

	/**
	 * Count the clouds down. A cloud affects vision only — nothing here is fed
	 * into any `tickPlayer` — so its whole server life is a timer and a place.
	 * A cloud is never consumed by a fighter standing in it; it expires when
	 * its clock runs out, or when its owner leaves the match.
	 */
	private tickSmokeClouds(dt: number) {
		if (this.smokeClouds.length === 0) return;
		let kept = 0;
		for (const c of this.smokeClouds) {
			c.remainingMs -= dt * MS_PER_SECOND;
			if (c.remainingMs > 0 && this.players.has(c.ownerId)) {
				this.smokeClouds[kept++] = c;
			}
		}
		this.smokeClouds.length = kept;
	}

	/**
	 * The storm: count it down, and every `BLOSSOM_TICK_MS` deal the interval
	 * damage to every hostile fighter inside the ring with line of sight.
	 *
	 * The caster's own channel lives in their `PlayerPosition.blossomTimer`,
	 * which both sides tick — so the *area* can trust it: when that timer hits
	 * zero (a knockdown — the one interrupt), the field is over on the same
	 * tick every client predicted. Death ends it too: a dead caster is not a
	 * spinning one, and their storm leaves with them.
	 */
	private tickBlossom(dt: number) {
		const field = this.blossom;
		if (!field) return;

		const caster = this.players.get(field.ownerId);
		if (!caster?.alive || caster.state.blossomTimer <= 0) {
			this.blossom = null;
			return;
		}

		field.remainingMs -= dt * MS_PER_SECOND;
		if (field.remainingMs <= 0) {
			this.blossom = null;
			return;
		}

		this.blossomDamageAcc += dt * MS_PER_SECOND;
		if (this.blossomDamageAcc < BLOSSOM_TICK_MS) return;
		this.blossomDamageAcc -= BLOSSOM_TICK_MS;

		for (const player of this.players.values()) {
			if (!player.alive) continue;
			// The friendly-fire rule and the "is it in the ring with a
			// corridor" test both come from the shared module, so the damage
			// can never disagree with the ring the client predicted.
			if (
				!blossomSweeps(
					field,
					player.id,
					player.team,
					player.state.x,
					player.state.y,
					this.world,
				)
			) {
				continue;
			}
			// The storm feeds nobody — `paysCharge: false` skips the caster's
			// charge and marks the kill credit non-paying too, exactly like the
			// hole.
			this.damage(player, BLOSSOM_TICK_DAMAGE, field.ownerId, false);
		}
	}

	/**
	 * Spring the traps. A trap catches the hostile fighters whose feet cross
	 * its patch; the lock itself was already set by the shared `tickPlayer` —
	 * this is the *consequence*, which only the server may own: the trap is
	 * destroyed, the little bit of damage is dealt, and the caption is sent.
	 * A trap is single-use, so springing removes it from the world.
	 */
	private tickTraps() {
		if (this.traps.length === 0) return;
		// Compact in place: a sprung trap is destroyed by not being kept.
		let kept = 0;
		for (const trap of this.traps) {
			// On the one tick it springs, a trap catches everyone standing in it
			// — anyone who "stepped in" that moment.
			let sprung = false;
			for (const player of this.players.values()) {
				if (!player.alive) continue;
				// Same filter `tickPlayer` was handed: never the owner, never a
				// teammate. The overlap test is the same shared function, so the
				// server's trigger can never disagree with the lock the client
				// predicted.
				if (trapFor([trap], player.id, player.team).length === 0) continue;
				if (!trapCatches(trap, player.state.x, player.state.y)) continue;
				sprung = true;
				this.trappedEvents.push({
					victimId: player.id,
					x: player.state.x,
					y: player.state.y,
				});
				this.damage(player, TRAP_DAMAGE, trap.ownerId, true, "bullet");
			}
			if (sprung) {
				console.log(`[ITEM] trap ${trap.id} springs and is spent`);
				continue;
			}
			this.traps[kept++] = trap;
		}
		this.traps.length = kept;
	}

	/**
	 * Advance the trap canisters in flight. A canister that touches the floor
	 * **plants**: it becomes an armed trap at its landing spot, carrying the
	 * thrower's side, and the flight is over. Compact in place, like the
	 * grenades.
	 */
	private tickTrapCanisters(dt: number) {
		if (this.trapCanisters.length === 0) return;
		let kept = 0;
		for (const c of this.trapCanisters) {
			if (tickTrapCanister(c, dt, this.world)) {
				// The canister's box bottoms out on the floor, so the trap's
				// patch sits at the landing spot's floor line — the same "feet
				// level" `placeTrap` used to hand the server.
				this.traps.push({
					id: c.id,
					ownerId: c.ownerId,
					ownerTeam: c.ownerTeam,
					x: c.x,
					y: c.y + TRAP_COLLIDE_R,
				});
				continue;
			}
			this.trapCanisters[kept++] = c;
		}
		this.trapCanisters.length = kept;
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
					// The other kind of deny, and worth exactly as much: the meter was
					// spent, the hole never opens, and one fighter's guard is why.
					this.potg.note(
						this.potgClockMs,
						"deny",
						{ id: player.id, name: player.name },
						{ id: g.ownerId, name: this.players.get(g.ownerId)?.name ?? "" },
					);
					this.denies.push({
						denierId: player.id,
						x: player.state.x + PLAYER_WIDTH / 2,
						y: player.state.y + PLAYER_HEIGHT / 2,
					});
					player.denies++;
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
			// 128px into the room. Found by `scripts/ultimate-probe.ts`, which threw
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

		field.remainingMs -= dt * MS_PER_SECOND;
		if (field.remainingMs <= 0) {
			this.singularity = null;
			return;
		}

		this.singularityDamageAcc += dt * MS_PER_SECOND;
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
			p.hp = p.dummy ? (cfg?.dummyHp ?? MAX_HP) : MAX_HP;
			p.alive = true;
			p.respawnTimer = 0;
			p.lastHurtBy = null;
			p.lastAttackTime = 0;
			p.queue.length = 0;
			p.pendingInput = null;
			p.tickInput = null;
			p.simulatedIntent = null;
			// A new round is a new life for the items too: everyone gets their
			// full kit again, and every trap on the floor is gone with the round
			// that placed it.
			p.itemCharges = kitFor(p.hero).item.maxCharges;
			p.itemHeld = false;
			this.refillMagazine(p);
			p.potgBurst = { damage: 0, absorbed: 0 };
			if (p.brain) p.brain = new EnemyBrain(botConfig(), this.world, p.hero);
		});
		this.bullets = [];
		this.meleeEvents.length = 0;
		this.denies.length = 0;
		this.traps = [];
		this.trapCanisters.length = 0;
		this.heGrenades.length = 0;
		this.smokeGrenades.length = 0;
		this.smokeClouds.length = 0;
		this.explosions.length = 0;
		this.trappedEvents.length = 0;
		this.resetTimer = -1;
		// The room's copy of the same countdown the fighters are carrying.
		this.roundFreezeMs = this.freezeTimeMs;
		// A hole left open across a reset would grab fighters at their spawns, and a
		// cinematic left running would freeze a match that has just started. Charge
		// is *not* cleared here: `restartMatch` owns that, because a training-room
		// reset should not confiscate an ult somebody spent two minutes earning.
		this.grenades.length = 0;
		this.singularity = null;
		this.blossom = null;
		this.blossomDamageAcc = 0;
		this.cinematic = null;
		this.pendingThrow = null;
		this.pendingDragon = null;
		this.pendingBlossom = null;
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
		// Filmed from the broadcast itself, so the reel and the room can never be
		// showing two different fights. See `PlayOfTheGame.ts`.
		this.potg.capture(this.potgClockMs, snap, (id) => {
			const p = this.players.get(id);
			return {
				id,
				name: p?.name ?? id,
				team: p?.team ?? null,
				bot: p?.brain !== null && p?.brain !== undefined,
			};
		});
		for (const player of this.players.values()) {
			player.channel?.emit("state", snap);
		}
		// Melee events are one-shot. Cleared unconditionally, so a room with no
		// listening humans does not accumulate them forever.
		this.meleeEvents.length = 0;
		this.denies.length = 0;
		// Item events are the same shape, and cleared for the same reason.
		this.explosions.length = 0;
		this.trappedEvents.length = 0;
	}
}

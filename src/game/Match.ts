/** Sprites are anchored at their centre; bodies are top-left — see `syncSpriteToBody`. */
const SPRITE_ANCHOR_CENTRE = 0.5;

/**
 * One match: the fixed-timestep loop, the entity world, and the wiring between
 * the simulation, the netcode and the renderer.
 *
 * This is the only place that knows about all of them. Systems read simulation
 * state and write presentation; the netcode owns truth; the simulation is pure.
 * Keeping the crossings in one file is what stops those responsibilities leaking
 * into each other — which is exactly how the old scene grew to 800 lines.
 *
 * A match holds **one local fighter and up to fifteen remote ones**. Remote
 * fighters come and go with the room's roster, and every one of them is an
 * ordinary entity whose `body` points at rolled-back simulation state — so the
 * same animation, sprite-sync and effect systems draw all sixteen with no second
 * code path.
 */

import { Sprite } from "pixi.js";
import { type AIConfig, randomBotConfig } from "./characters/AIConfig";
import { EnemyBrain } from "./characters/EnemyBrain";
import type { AIInput, AIOutput, AllyInfo, FoeInfo } from "./characters/types";
import { BulletSystem, type BulletTarget } from "./combat/BulletSystem";
import {
	PhysicsDiagnostics,
	RESPAWN_CORRECTION_PX,
} from "./diagnostics/PhysicsDiagnostics";
import { EventBus } from "./EventBus";
import {
	animationSystem,
	bindFxBodies,
	CLIPS,
	meleeFxSystem,
	nameplateSystem,
	shadowSystem,
	spriteSyncSystem,
} from "./ecs/systems";
import {
	createQueries,
	createWorld,
	type FighterEntity,
	type GameWorld,
	type Queries,
} from "./ecs/world";
import { HUD_EVENTS, type HudState } from "./hud";
import { Input } from "./input/Input";
import { inputSettings } from "./input/Scheme";
import { parseLaunchParams } from "./online/launch";
import { OnlineSession } from "./online/OnlineSession";
import { requestedRoomId, showRoomInUrl } from "./online/room";
import { readStoredName, storeName } from "./playerName";
import { AimLine } from "./render/AimLine";
import { bodyCentre, drawArena } from "./render/ArenaRenderer";
import { dudeFrames, TEX, tex } from "./render/assets";
import { BlackHoleFx } from "./render/BlackHoleFx";
import { DenyFx } from "./render/DenyFx";
import { type ImpactEvent, MeleeFx } from "./render/MeleeFx";
import { Nameplates } from "./render/Nameplates";
import { Shadows } from "./render/Shadows";
import type { Stage } from "./render/Stage";
import { UltAimLine } from "./render/UltAimLine";
import {
	applyWorld,
	buildWorld,
	MAX_SCREENS,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type World,
} from "./simulation/Arena";
import { timeLeftMs } from "./simulation/Deathmatch";
import {
	applyMeleeResult,
	BULLET_DAMAGE,
	canFire,
	createPlayerState,
	fieldAffects,
	fieldFor,
	hasLineOfSight,
	isKnockedDown,
	isStunned,
	MAX_HP,
	MS_PER_SECOND,
	meleePhase,
	NEUTRAL_INTENT,
	type PlayerIntent,
	type PlayerPosition,
	resolveMelee,
	type Singularity,
	singularityGrip,
	tickPlayer,
	ULT_MAX_CHARGE,
} from "./simulation/Physics";
import {
	hostile,
	type MatchMode,
	TDM_MIN_SCREENS,
	type TeamId,
	teamName,
} from "./simulation/Teams";
import { TrainingRoom } from "./training/TrainingRoom";

/** Client physics runs at a fixed 60Hz to match the server, whatever the display does. */
const PHYSICS_DT = 1 / 60;
const MAX_PHYSICS_STEPS = 5;
const RESET_DELAY_MS = 2000;

/** Longest a single rendered frame may simulate — a stall must not rubber-band the world. */
const MAX_FRAME_DT_S = 0.05;
/** HUD state is throttled to this cadence; the snapshot itself is the truth. */
const HUD_MIN_INTERVAL_MS = 50;
/** Frames of jitter measurement skipped after an announced teleport (the ultimate's pull). */
const TELEPORT_GRACE_FRAMES = 4;
/** The room-link hint waits out the FIGHT banner's 3.5s so the two narrations do not overlap. */
const SHARE_HINT_DELAY_MS = 4000;

/**
 * How far the follow camera may move in one rendered frame, in world px.
 *
 * Deliberately under `DIAG_JITTER_CAM` (15px): the diagnostic reads camera
 * scroll as a jitter signal, so a follow camera that outran the threshold on
 * a dash frame would report deliberate movement as a defect. 12px/frame is a
 * comfortable glide at 60fps and still keeps up with a walking fighter.
 */
const CAMERA_MAX_STEP_PX = 12;

function clamp(value: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, value));
}

const START_PLAYER_X = 100;
const START_PLAYER_Y = 480;
const START_ENEMY_X = 668;
const START_ENEMY_Y = 480;

/** The offline escape hatch's single opponent. Never used in an online match. */
const OFFLINE_FOE_ID = "offline-foe";
const LOCAL_ID = "local";

const NO_INTENT: PlayerIntent = { ...NEUTRAL_INTENT };

/** Translate a brain's decision into the intent the simulation consumes. */
function intentFromAI(output: AIOutput): PlayerIntent {
	return {
		left: output.moveLeft,
		right: output.moveRight,
		up: output.jump,
		attack: output.attack,
		block: output.block,
		uppercut: output.uppercut,
		swordStance: output.swordStance,
		face: output.face,
		dash: output.dash,
		ultimate: output.ultimate,
	};
}

function fightConfig(): AIConfig {
	return randomBotConfig();
}

/** A name for a client whose fighter is a bot, so the scoreboard is readable. */
const AI_NAME_MIN = 100;
const AI_NAME_SPAN = 900;
function aiClientName(): string {
	const n = AI_NAME_MIN + Math.floor(Math.random() * AI_NAME_SPAN);
	return `AI-${n}`;
}

export class Match {
	private readonly world: GameWorld = createWorld();
	private readonly queries: Queries;
	/**
	 * The arena geometry this client simulates, renders and aims against.
	 *
	 * One object shared by reference with the physics, the AI, the renderer and
	 * the diagnostics, so a wide room never has two geometries to drift. Built
	 * from `?screen=N`, then rebuilt in place from the `match` message — the
	 * server is the authority on a room's size, not the URL.
	 */
	private readonly arena: World = buildWorld(1);
	/** Logical view size (`app.screen`), for camera clamping. */
	private readonly view: { readonly width: number; readonly height: number };
	private readonly fx: MeleeFx;
	private readonly blackHole: BlackHoleFx;
	private readonly plates: Nameplates;
	private readonly shadows: Shadows;
	private readonly aimLine: AimLine;
	private readonly ultAim: UltAimLine;
	private readonly denyFx: DenyFx;
	private readonly input: Input;
	private readonly diagnostics: PhysicsDiagnostics;
	private readonly bullets: BulletSystem;

	private readonly local: FighterEntity;
	/** Every other fighter in the room, keyed by the id the server scores it under. */
	private readonly remotes = new Map<string, FighterEntity>();
	/** The offline escape hatch's opponent. Created only when there is no server. */
	private offlineFoe: FighterEntity | undefined;

	/**
	 * The game is online-first: every match runs through the authoritative
	 * server, including single-player. Playing it is dogfooding the netcode.
	 */
	private onlineMode = true;
	/** The local fighter is AI-driven (`?ai=true`), online or not. */
	private aiMode = false;
	/** Solo: the server fills the room with bots instead of matching humans. */
	private soloMatch = true;
	/**
	 * Training: the server fills the other slot with a *scriptable dummy*.
	 *
	 * Still online, still solo, still predicted and reconciled — the only
	 * difference is what decides the opponent's inputs. A client-side dummy would
	 * have been easier and worthless: it would bypass exactly the netcode the
	 * training room is used to test other things through.
	 */
	private trainingMode = false;
	/** Bots to seat in a solo room, and fighters to top a public room up to. */
	private botCount: number | undefined;
	private fillCount: number | undefined;
	private scoreLimit: number | undefined;
	private timeLimitMs: number | undefined;
	/** `?ultCharge=N`: what everybody in a freshly created room starts armed with. */
	private ultCharge: number | undefined;
	/**
	 * Which ruleset this room plays — a *proposal* until the server answers.
	 *
	 * `?mode=tdm` asks for team deathmatch; the room's creator decides, and
	 * `onSeated` replaces this with what the room actually is. A client that
	 * trusted its own URL would draw a team HUD over a free-for-all it had just
	 * joined by link.
	 */
	private mode: MatchMode = "ffa";
	/** `?freezeTime=S`: how long a team round's countdown lasts. Creator-only. */
	private freezeTime: number | undefined;
	private online: OnlineSession | undefined;
	private training: TrainingRoom | undefined;

	private localBrain: EnemyBrain | undefined;
	private remoteBrain: EnemyBrain | undefined;

	private accumulator = 0;
	private localIntent: PlayerIntent = { ...NO_INTENT };
	private remoteIntent: PlayerIntent = { ...NO_INTENT };
	private aimAngle = 0;
	private diagSteps = 0;
	private resetAt = -1;
	private elapsed = 0;
	private playerName = "";
	/**
	 * The room this client asked for, from `?room=` or freshly minted.
	 *
	 * A proposal. The server decides and says so in the `match` message, and the
	 * address bar is rewritten from that — see `online/room.ts`.
	 */
	private roomId = "";
	/** Torn down on destroy, so a remounted match does not connect twice. */
	private nameUnsubscribe: (() => void) | undefined;
	/** The one-time "your room link is in the address bar" narration timer. */
	private shareHintTimer: number | undefined;

	constructor(
		private readonly stage: Stage,
		canvas: HTMLCanvasElement,
		/** Logical view size — `app.screen`, never the canvas backing store. */
		screen: { readonly width: number; readonly height: number },
	) {
		// The launch request, read once and used for every choice below. This is
		// the same parser the main menu writes the URL with, so a menu commit and a
		// hand-typed link can never disagree — see `online/launch.ts`.
		const launch = parseLaunchParams(window.location.search);
		// `?screen=N` widens the arena to N 800px screens. The URL proposes; the
		// room decides (the creator's value sticks, and the `match` message says
		// what it actually is), so the authoritative correction happens on
		// `onSeated`.
		const rawScreens = launch.screens;
		// `?mode=tdm` only decides how wide to build the arena before connecting.
		// A team room has a three-screen floor, and building one screen first
		// would draw the whole level twice — once wrong.
		const wantsTeams = launch.mode === "tdm";
		const askedScreens =
			rawScreens === undefined
				? 1
				: Math.max(1, Math.min(rawScreens, MAX_SCREENS));
		this.arena = buildWorld(
			wantsTeams ? Math.max(askedScreens, TDM_MIN_SCREENS) : askedScreens,
		);
		this.view = screen;
		drawArena(stage.background, stage.arena, this.arena);

		this.queries = createQueries(this.world);
		this.fx = new MeleeFx(stage.effects, stage);
		// Two layers: the hole itself goes *behind* the fighters and its particles in
		// front of them. See `BlackHoleFx` — a 150px black disc drawn over the actors
		// hid the fighters it was holding.
		this.blackHole = new BlackHoleFx(stage.field, stage.effects, stage);
		this.plates = new Nameplates(stage.nameplates, this.arena);
		// Between the arena and the fighters: a shadow falls on the ledge below and
		// is never drawn over the feet that cast it. See `Stage.shadows`.
		this.shadows = new Shadows(stage.shadows, this.arena);
		// In the nameplate layer, which is inside the camera and drawn last: the beam
		// tracks a moving fighter, and one buried behind a ledge or a spark answers
		// nothing. It is under the plates themselves because a name is worth more.
		this.aimLine = new AimLine(stage.nameplates);
		// Same layer, same reason: it tracks a moving fighter inside the camera.
		// The ultimate's aim arc is only ever shown while its button is held, so
		// it never competes with the ordinary beam.
		this.ultAim = new UltAimLine(stage.nameplates);
		// Same layer again: the DENY caption is a world-space splash over the
		// fighter who denied the ultimate, and it must never be buried behind a
		// sprite it is announcing.
		this.denyFx = new DenyFx(stage.nameplates);
		this.bullets = new BulletSystem(
			stage.projectiles,
			tex(TEX.fireball),
			this.arena,
		);
		this.diagnostics = new PhysicsDiagnostics(
			() => (this.onlineMode ? "online" : "offline"),
			() => this.online?.netSummary() ?? null,
			this.arena,
			// The team brain's own report: role, stance usage, ally distance.
			// Measured here so the team probe can assert that a side actually
			// split into complementary jobs rather than mirroring.
			() => {
				const brain = this.localBrain;
				if (!brain || !this.online?.connected || this.online.myTeam === null) {
					return null;
				}
				return {
					team: this.online.myTeam,
					...brain.getInsight(),
				};
			},
		);

		this.local = this.spawnFighter(
			LOCAL_ID,
			true,
			START_PLAYER_X,
			START_PLAYER_Y,
			1,
		);

		this.input = new Input(
			canvas,
			// A live view: the getters are read on every aim, so a resized window or
			// a scrolled camera is accounted for without re-plumbing anything.
			{
				get width() {
					return screen.width;
				},
				get height() {
					return screen.height;
				},
				get cameraX() {
					return stage.cameraX;
				},
				get cameraY() {
					return stage.cameraY;
				},
			},
			() => this.toggleAiVsAi(),
		);
		this.installDebugHooks();

		this.aiMode = launch.ai;
		// Which room, from the URL — or a new one. There is no matchmaking queue:
		// sharing the link is how two people end up in the same match.
		this.roomId = requestedRoomId();
		// Vestigial, and kept only for the status line and the debug hooks. Rooms are
		// addressed by id, so there is no "solo" placement to choose — and bots are
		// opt-in, so this no longer decides how a room is filled either. Every room is
		// served, predicted, reconciled, and a room somebody else can be sent to.
		this.soloMatch = !launch.online;
		// `?offline=true` is an escape hatch for working without a game server. It
		// is not the supported path — it bypasses the netcode entirely.
		this.onlineMode = !launch.offline;
		this.trainingMode = launch.training;
		// `bots=0` is meaningful — an empty room — so it cannot go through the
		// positive-integer parser the other counts use.
		this.botCount = launch.bots;
		this.fillCount = launch.fill;
		// Shortened rules, for a probe. Honoured server-side only for the client that
		// *creates* the room, so a latecomer cannot end a match already in progress.
		this.scoreLimit = launch.scoreLimit;
		// `?ultCharge=N` seats everybody with N charge. Creator-only server-side,
		// like the shortened rules — see specs/ultimate.md. Zero is the real
		// default and a legitimate thing to ask for explicitly.
		this.ultCharge = launch.ultCharge;
		// Both spellings, like `training`, and both are only a request.
		this.mode = launch.mode ?? "ffa";
		// Zero is a legitimate request — "no countdown, start fighting" — so this
		// goes through the parser that accepts it.
		this.freezeTime = launch.freezeTime;
		const timeLimitSec = launch.timeLimitSec;
		this.timeLimitMs =
			timeLimitSec === undefined ? undefined : timeLimitSec * MS_PER_SECOND;

		if (this.trainingMode) {
			// A training room is an ordinary online, single-human match by
			// construction. `?offline=true&training=true` is not a mode: offline
			// bypasses the server, and the dummy lives there.
			this.onlineMode = true;
			this.soloMatch = true;
		}

		if (this.onlineMode) this.beginOnline();
		else {
			this.offlineFoe = this.spawnFighter(
				OFFLINE_FOE_ID,
				false,
				START_ENEMY_X,
				START_ENEMY_Y,
				-1,
			);
			// No server, so no roster to be named by.
			this.offlineFoe.fighter.name = "Rival";
			this.local.fighter.name = "You";
			if (this.aiMode) this.startOfflineAi();
		}

		EventBus.emit("current-scene-ready", this);
	}

	// =========================================================
	//  SETUP
	// =========================================================

	private spawnFighter(
		id: string,
		local: boolean,
		x: number,
		y: number,
		facing: number,
	): FighterEntity {
		// The strip's idle frames are the strip's own table — see `CLIPS` in
		// ecs/systems.ts, where `left-idle` and `right-idle` name these indices.
		const idleClip = facing < 0 ? CLIPS["left-idle"] : CLIPS["right-idle"];
		const [idleFrame] = idleClip.frames;
		const sprite = new Sprite(dudeFrames[idleFrame]);
		sprite.anchor.set(SPRITE_ANCHOR_CENTRE);
		this.stage.actors.addChild(sprite);

		const entity = this.world.add({
			key: id,
			// The name is filled in from the roster once it arrives; until then a
			// plate shows a bar and no label, which is honest — nobody has told this
			// client who that is yet.
			// No side until a snapshot says otherwise, which is also what every
			// fighter in a free-for-all keeps for the whole match.
			fighter: { id, local, hp: MAX_HP, maxHp: MAX_HP, name: "", team: null },
			body: createPlayerState(x, y, facing),
			sprite,
			anim: { clip: "right-idle", frame: 0, elapsedMs: 0 },
		}) as FighterEntity;

		// Bind the new fighter's sprite for impact punches. Re-binding every fighter
		// is cheap and keeps one code path, rather than a special case for the ones
		// that existed at construction time.
		bindFxBodies(this.queries, this.fx);
		return entity;
	}

	/**
	 * A fighter left the room.
	 *
	 * Sprites and effect sprites are destroyed rather than hidden. Sixteen slots
	 * on a server that runs for hours means fighters churn, and three leaked
	 * effect sprites per departure is the kind of leak that only shows up long
	 * after anyone is looking.
	 */
	private despawnFighter(id: string) {
		const entity = this.remotes.get(id);
		if (!entity) return;
		this.remotes.delete(id);
		entity.sprite.destroy();
		this.world.remove(entity);
		this.fx.forget(id);
		this.plates.forget(id);
		this.shadows.forget(id);
	}

	/**
	 * Compose and emit the HUD's view of the fight.
	 *
	 * The React HUD subscribes to `hud-state`; this is the only emitter. Sent at
	 * snapshot cadence (50ms) — the data it carries is server-owned and moves no
	 * faster — plus immediately whenever damage lands, the stance changes or a
	 * name arrives, so the player's own hit never waits out the throttle.
	 */
	private lastHudSentAt = -1;
	private lastHudStance: HudState["stance"] = "sword";
	private lastHudName = "";

	private emitHud(force = false) {
		const session = this.online;
		const state: HudState = {
			hp: this.local.fighter.hp,
			maxHp: this.local.fighter.maxHp,
			ult: session ? session.localUlt : 0,
			stance: this.local.body.stance,
			name: this.local.fighter.name,
			foeName: this.onlineMode
				? (this.online?.nameOf(this.online?.primaryRemoteId ?? "") ?? "")
				: (this.offlineFoe?.fighter.name ?? ""),
			foeHp: this.onlineMode
				? (this.online?.remoteHp ?? MAX_HP)
				: (this.offlineFoe?.fighter.hp ?? MAX_HP),
			fighterCount:
				1 +
				this.remotes.size +
				// The offline escape hatch's rival is not a remote (it is its own
				// field, never a roster entry) — count it or a duel shows no foe
				// panel.
				(this.offlineFoe ? 1 : 0),
			online: this.onlineMode,
			massiveReady: this.local.body.massiveReady,
			team: this.local.fighter.team,
		};
		const stanceChanged = state.stance !== this.lastHudStance;
		const nameChanged = state.name !== this.lastHudName;
		this.lastHudStance = state.stance;
		this.lastHudName = state.name;
		if (!force && !stanceChanged && !nameChanged) {
			if (this.elapsed - this.lastHudSentAt < HUD_MIN_INTERVAL_MS) return;
		}
		this.lastHudSentAt = this.elapsed;
		EventBus.emit(HUD_EVENTS.state, state);
	}

	/**
	 * Decide what this client is called, then connect.
	 *
	 * A human types their name once and it is remembered; an AI-driven client
	 * generates one, because `?ai=true` is how every probe and diagnostic runs and
	 * a modal waiting on a keyboard would hang all of them. That is also why the
	 * gate is here rather than in React: the *connection* is what needs a name, so
	 * the connection is what waits for it.
	 */
	private beginOnline() {
		// The address bar becomes shareable immediately, before anything has
		// connected. A host opens the game, copies the URL and sends it — waiting for
		// the server to confirm first would mean the link a player copies in the
		// first second is not the room they end up in.
		if (!this.trainingMode) {
			showRoomInUrl(this.roomId);
			EventBus.emit("room-id", this.roomId);
		}

		const stored = readStoredName();
		if (stored) {
			this.startOnline(stored);
			return;
		}
		if (this.aiMode || this.trainingMode) {
			this.startOnline(this.aiMode ? aiClientName() : "Trainee");
			return;
		}

		EventBus.emit(HUD_EVENTS.status, "");
		EventBus.emit("need-player-name");
		this.nameUnsubscribe = EventBus.on("player-name", ((name: string) => {
			this.nameUnsubscribe?.();
			this.nameUnsubscribe = undefined;
			storeName(name);
			this.startOnline(name);
		}) as never);
	}

	private startOnline(name: string) {
		this.playerName = name;
		this.local.fighter.name = name;
		EventBus.emit(HUD_EVENTS.status, "Connecting...");
		// The name just landed; the plaque must not wait out the 50ms throttle.
		this.emitHud(true);

		this.online = new OnlineSession(
			this.stage.projectiles,
			tex(TEX.fireball),
			START_PLAYER_X,
			START_PLAYER_Y,
			this.arena,
			{
				onStatus: (msg) => {
					if (msg) console.log(`[ONLINE] ${msg}`);
					EventBus.emit(HUD_EVENTS.status, msg);
				},
				onLocalHp: (hp) => {
					this.local.fighter.hp = hp;
					// Damage lands here on a snapshot — emit immediately so the
					// player's own hit flashes the bar without the 50ms throttle.
					this.emitHud(true);
				},
				onReconcile: (result) => {
					// A correction this large is a respawn, not a misprediction. The
					// server replaces the whole state, so the sword state changes too;
					// counting that as a prediction desync would blame the netcode for a
					// round ending.
					const respawn = result.errorPx > RESPAWN_CORRECTION_PX;
					this.diagnostics.recordReconciliation(
						result.errorPx,
						result.replayed,
						result.meleeDiverged && !respawn,
						// Every replacement, explained or not — *including* the respawn
						// case. A respawn is the loudest possible discontinuity and the
						// one most likely to be mistaken for a broken state machine, so
						// dropping it here is exactly backwards.
						result.meleeReplaced
							? {
									reason: respawn ? "respawn" : result.replaceReason,
									detail: result.meleeDivergence,
								}
							: undefined,
					);
					// The diagnostic breaks its own melee continuity on a correction
					// this large — see RESPAWN_CORRECTION_PX. Nothing more is needed
					// here.
					if (result.meleeDiverged && !respawn && result.meleeDivergence) {
						console.log(`[DESYNC] ${JSON.stringify(result.meleeDivergence)}`);
					}
				},
				onTeleport: () => this.diagnostics.markTeleport(),
				onRoundReset: () => {
					this.diagnostics.markRoundReset();
					// A hole and a portrait both outlive the match they belong to
					// otherwise: the effect has its own fade and the overlay its own
					// timer, and neither knows a new match has started.
					this.blackHole.reset();
					EventBus.emit("ultimate-clear");
					// Takes the podium down. Without this the previous match's winner
					// screen would sit over a live fight forever.
					EventBus.emit("match-reset");
				},
				onMeleeEvent: (event) => {
					// The victim comes from the event now. Deriving it from
					// `attackerId === myId` was correct in a duel and wrong the moment a
					// third fighter existed: every hit between two other players punched
					// the local fighter's sprite.
					this.fx.impact(event, event.victimId, event.attackerId);
					this.diagnostics.recordMeleeEvent(event.move, event.outcome);
					this.training?.recordMeleeEvent(
						event,
						event.attackerId === this.online?.manager.myId,
					);
					// A hit is an announced discontinuity, exactly like a respawn. Only
					// the server can know a swing connected, so the client necessarily
					// mispredicts the stun and knockback and then rewinds into them —
					// tens of pixels in one frame, from correct netcode.
					this.diagnostics.markTeleport(2);
				},
				onDeny: (event) => {
					// The caption, and nothing else: the denied meter already travels
					// in the snapshot, so this is pure presentation. The training room
					// counts it, because a deny is a first-class outcome there.
					this.denyFx.deny(event.x, event.y);
					this.training?.recordDeny();
				},
				onFighterAdded: (id) => this.addRemoteFighter(id),
				onFighterRemoved: (id) => this.despawnFighter(id),
				onUltimateCast: (casterId) => {
					// The cinematic is a dialog with a portrait in it, so it belongs to
					// the React overlay rather than the canvas — see the
					// `pixi-text-and-ui` skill on the split. The game hands it a name and
					// an id and nothing else; everything about how it looks is over
					// there.
					EventBus.emit("ultimate-cast", {
						casterId,
						casterName: this.online?.nameOf(casterId) ?? casterId,
						mine: casterId === this.online?.manager.myId,
						durationMs: this.online?.cinematic?.totalMs ?? 0,
					});
					// The bots' ultimate is measured through this same event: the local
					// brain's cast is the one the diagnostic can watch, and it fires
					// here on the snapshot that announced the cinematic.
					if (casterId === this.online?.manager.myId) {
						this.diagnostics.recordUltimateCast();
					}
					console.log(
						`[ULT] ${this.online?.nameOf(casterId) ?? casterId} casts`,
					);
				},
				onSingularityOpened: (field) => {
					this.blackHole.detonate(field.x, field.y, field.ownerTeam);
					// An announced discontinuity, like a melee hit: the server has just
					// started yanking fighters toward a point no client could have
					// predicted, and the first frame of that is tens of pixels. Counting
					// it as jitter would report a working ultimate as broken physics.
					this.diagnostics.markTeleport(TELEPORT_GRACE_FRAMES);
				},
				onMatch: (status, standings) => {
					// The clock, the frags and the standings all live in this event;
					// the React HUD reads them from it. Nothing else needs them.
					EventBus.emit("match-status", {
						status,
						standings,
						myId: this.online?.manager.myId ?? "",
					});
				},
				onRoundWon: (msg) => {
					// The banner, and only the banner. The arena reset that follows
					// arrives as its own `round-reset` message a couple of seconds
					// later — that is the one that breaks prediction continuity, and
					// conflating the two would drop every fighter's rollback history on
					// a frame where the survivors are still fighting.
					const who =
						msg.team === null
							? "ROUND DRAWN"
							: `${teamName(msg.team)} WIN THE ROUND`;
					EventBus.emit(
						HUD_EVENTS.status,
						`${who} — ${msg.scores.join(" : ")}`,
					);
					EventBus.emit("round-won", msg);
					console.log(`[ROUND] ${msg.round}: ${who} (${msg.scores.join("-")})`);
				},
				onRoundLive: (msg) => {
					// The one moment everybody has to see together. The countdown that
					// led to it is in the snapshot and drawn from there; this is the
					// server saying "now", so no two screens can start on different
					// frames because their clocks drifted.
					EventBus.emit(HUD_EVENTS.status, "FIGHT!");
					console.log(`[ROUND] ${msg.round} live`);
				},
				onMatchOver: (msg) => {
					console.log(
						`[MATCH] over by ${msg.reason}, winner ${msg.winnerId ?? "nobody"}`,
					);
					EventBus.emit("match-over", msg);
				},
				onSeated: (roomId, screens, mode) => {
					// The room decides the mode as it decides the id and the size. A
					// client that joined a team room by link learns it here.
					this.mode = mode;
					// The server decides the id, so the address bar follows it rather
					// than the proposal. They agree unless the proposal was malformed.
					this.roomId = roomId;
					// The server also decides the arena's size — a latecomer's
					// `?screen=` is ignored, and the client must simulate the room's
					// geometry, not the one it asked for. Rebuilding the shared world
					// in place keeps every holder (physics, AI, renderer, diagnostics)
					// on the corrected geometry, then the arena is redrawn.
					if (screens !== this.arena.screens) {
						applyWorld(this.arena, screens);
						drawArena(this.stage.background, this.stage.arena, this.arena);
						console.log(`[ONLINE] room arena resized to ${screens} screens`);
					}
					if (!this.trainingMode) {
						showRoomInUrl(roomId);
						EventBus.emit("room-id", roomId);
						// The name prompt teaches the invite link with a copyable
						// field — and only appears for a player who has no stored
						// name. One named by the menu (or a previous match) never
						// sees it, so the link is said once here instead. It waits
						// out the FIGHT banner's 3.5s so the two narrations do not
						// fight — the message window is last-write-wins.
						if (readStoredName()) {
							this.shareHintTimer = window.setTimeout(() => {
								EventBus.emit(
									HUD_EVENTS.status,
									"Your room link is in the address bar — send it to play together.",
								);
							}, SHARE_HINT_DELAY_MS);
						}
					}
					console.log(`[ONLINE] room ${roomId}`);
				},
				onRoomFull: (roomId) => {
					EventBus.emit(HUD_EVENTS.status, "That room is full.");
					console.log(`[ONLINE] room ${roomId} is full`);
				},
			},
		);
		this.online.connect({
			solo: this.soloMatch,
			training: this.trainingMode,
			name,
			room: this.roomId,
			...(this.botCount === undefined ? {} : { bots: this.botCount }),
			...(this.fillCount === undefined ? {} : { fill: this.fillCount }),
			...(this.scoreLimit === undefined ? {} : { scoreLimit: this.scoreLimit }),
			...(this.timeLimitMs === undefined
				? {}
				: { timeLimitMs: this.timeLimitMs }),
			...(this.ultCharge === undefined ? {} : { ultCharge: this.ultCharge }),
			mode: this.mode,
			...(this.freezeTime === undefined ? {} : { freezeTime: this.freezeTime }),
			screens: this.arena.screens,
		});

		if (this.trainingMode) {
			this.training = new TrainingRoom({
				session: this.online,
				input: this.input,
				diagnostics: this.diagnostics,
				localBody: () => this.local.body,
				localHp: () => this.local.fighter.hp,
			});
			console.log("[TRAINING] window.__training installed");
		}

		if (this.aiMode) {
			this.localBrain = new EnemyBrain(fightConfig(), this.arena);
			console.log("[AI-ONLINE] AI brain created for local player");
		}
	}

	/** A fighter appeared in a snapshot. Give it something to be drawn with. */
	private addRemoteFighter(id: string) {
		if (this.remotes.has(id)) return;
		const state = this.online?.remotes.get(id)?.state;
		const entity = this.spawnFighter(
			id,
			false,
			state?.x ?? START_ENEMY_X,
			state?.y ?? START_ENEMY_Y,
			state?.facing ?? -1,
		);
		this.remotes.set(id, entity);
		console.log(`[ONLINE] fighter joined: ${this.online?.nameOf(id) ?? id}`);
	}

	private startOfflineAi() {
		this.localBrain = new EnemyBrain(fightConfig(), this.arena);
		this.remoteBrain = new EnemyBrain(fightConfig(), this.arena);
		console.log("=== AI VS AI MODE ENABLED ===");
	}

	private installDebugHooks() {
		// Typed in src/types/global.d.ts rather than cast through
		// `Record<string, unknown>`: the harness drives the game through these, so
		// they are a contract and should break the build when they change.
		window.__toggleAIVsAI = () => this.toggleAiVsAi();
		window.__gameState = () => ({
			aiVsAIMode: !!this.localBrain,
			onlineMode: this.onlineMode,
			onlineAIMode: this.aiMode,
			soloMatch: this.soloMatch,
			trainingMode: this.trainingMode,
			playerHP: this.local.fighter.hp,
			enemyHP: this.onlineMode
				? (this.online?.remoteHp ?? MAX_HP)
				: (this.offlineFoe?.fighter.hp ?? MAX_HP),
			playerState: this.localBrain?.getCurrentState(),
			enemyState: this.remoteBrain?.getCurrentState(),
			playerPhys: this.local.body,
			enemyPhys: this.onlineMode
				? (this.online?.remoteState ?? null)
				: (this.offlineFoe?.body ?? null),
			remote: this.onlineMode
				? this.online?.remotePosition
				: this.offlineFoe
					? { x: this.offlineFoe.body.x, y: this.offlineFoe.body.y }
					: null,
			fighterCount: this.onlineMode ? 1 + this.remotes.size : 2,
			bulletCount: this.onlineMode
				? (this.online?.bullets.length ?? 0)
				: this.bullets.count,
			worldScreens: this.arena.screens,
			worldWidth: this.arena.right,
			cameraX: this.stage.cameraX,
			cameraY: this.stage.cameraY,
		});
		// The deathmatch's own contract. `__gameState` describes two fighters
		// because that is what a duel is; a sixteen-player match is a scoreboard and
		// a clock, and `scripts/deathmatch-probe.mjs` reads exactly this.
		window.__matchState = () => {
			const status = this.online?.matchStatus;
			const standings = this.online?.standings() ?? [];
			const winnerId = status?.winnerId ?? null;
			return {
				// The mode and the round scoreboard, for `scripts/tdm-probe.mjs`.
				// Everything else here describes a free-for-all, which a team match
				// is not: sixteen individual frag counts say nothing about whether a
				// side was ever wiped out.
				mode: status?.mode ?? this.mode,
				teams: status?.teams ?? null,
				myTeam: this.online?.myTeam ?? null,
				connected: this.online?.connected ?? false,
				roomId: this.online?.roomId || this.roomId,
				myId: this.online?.manager.myId ?? "",
				myName: this.playerName,
				fighterCount: 1 + this.remotes.size,
				phase: status?.phase ?? "live",
				elapsedMs: status?.elapsedMs ?? 0,
				timeLeftMs: status
					? timeLeftMs(status.elapsedMs, status.timeLimitMs)
					: 0,
				scoreLimit: status?.scoreLimit ?? 0,
				timeLimitMs: status?.timeLimitMs ?? 0,
				endReason: status?.endReason ?? null,
				winnerId,
				winnerName: winnerId
					? (standings.find((s) => s.id === winnerId)?.name ?? "")
					: "",
				standings,
				rollback: this.online?.rollbackStats.summary() ?? null,
				net: this.online?.netSummary() ?? null,
				worldScreens: this.arena.screens,
				worldWidth: this.arena.right,
			};
		};
		// The ultimate's own contract. Nothing else can see it: AI vs AI never
		// presses the button (a brain has no charge meter to reason about), the
		// deathmatch probe reads scores, and the physics diagnostic reads positions
		// — so the freeze, the throw and the capture are invisible to all three.
		// `scripts/ultimate-probe.mjs` reads exactly this.
		window.__ultState = () => {
			const session = this.online;
			const field = session?.singularity ?? null;
			const me = session?.manager.myId ?? "";
			const held: string[] = [];
			if (field) {
				for (const e of this.queries.fighters) {
					const at = e.renderPos ?? e.body;
					// Reported under the id the *server* scores this fighter by, never
					// the entity key — a probe comparing `held` against a caster id has
					// to be comparing the same alphabet. See `serverIdOf`.
					const id = this.serverIdOf(e.fighter.id);
					const mine = fieldFor(field, id, e.fighter.team);
					if (singularityGrip(mine, at.x, at.y) === "held") {
						held.push(id);
					}
				}
			}
			return {
				myId: me,
				charge: session?.localUlt ?? 0,
				ready: (session?.localUlt ?? 0) >= ULT_MAX_CHARGE,
				/** True while the ultimate button is held and a cast is legal. */
				aiming: this.ultAimVisible(),
				frozen: session?.frozen ?? false,
				cinematic: session?.cinematic ?? null,
				grenades: [...(session?.grenades ?? [])].map((g) => ({
					id: g.id,
					ownerId: g.ownerId,
					x: g.x,
					y: g.y,
				})),
				singularity: field ? { ...field } : null,
				/** Everyone the *client's own* grip test says is caught, casters excluded. */
				held,
				/** Charge for every fighter, so a probe can watch the economy. */
				charges: Object.fromEntries(
					[...this.remotes.keys(), me]
						.filter((id) => id !== "")
						.map((id) => [id, session?.ultOf(id) ?? 0]),
				),
				playerPhys: this.local.body,
			};
		};
		window.__physicsDiagnostic = (durationMs = 5000) =>
			this.diagnostics.start(durationMs);
		// Supplying the name from a probe, so an automated run can exercise the same
		// path a human does instead of a bypass nobody plays.
		window.__setPlayerName = (name: string) => {
			EventBus.emit("player-name", name);
		};
		// Aim is the one system AI vs AI cannot exercise — the brains hand the
		// simulation an angle and never touch a cursor. `scripts/aim-probe.mjs`
		// drives a real mouse and reads this.
		window.__aimState = () => {
			const c = bodyCentre(this.local.body.x, this.local.body.y);
			const gap = this.input.pointerX - c.x;
			return {
				pointerX: this.input.pointerX,
				pointerY: this.input.pointerY,
				centreX: c.x,
				centreY: c.y,
				aimAngle: this.aimAngle,
				aimSide: gap === 0 ? 0 : Math.sign(gap),
				facing: this.local.body.facing,
				phase: meleePhase(this.local.body),
				stance: this.local.body.stance,
				hp: this.local.fighter.hp,
				viewWidth: this.input.viewport.width,
				viewHeight: this.input.viewport.height,
				cameraX: this.stage.cameraX,
				cameraY: this.stage.cameraY,
				bullets: this.localBullets(),
			};
		};
		// Controller mode is invisible to every other probe for exactly the reason
		// aim was: the brains hand the simulation an angle and never touch a stick,
		// and Playwright cannot press a physical button. `scripts/pad-probe.mjs`
		// stubs the Gamepad API and reads this.
		window.__inputState = () => ({
			scheme: inputSettings.scheme,
			deck: inputSettings.deck,
			deckVisible: inputSettings.deckVisible(),
			padAvailable: this.input.padAvailable,
			aim: this.input.aimReport(),
			face: this.localIntent.face,
			facing: this.local.body.facing,
		});
		// Switching scheme from a probe, the same way the Esc menu switches it —
		// a bypass nobody plays would prove nothing about the path a player takes.
		window.__setInputScheme = (scheme) => {
			inputSettings.setScheme(scheme);
		};
	}

	/** Local fighter's live projectiles with their headings, for the aim probe. */
	private localBullets(): {
		id: number;
		x: number;
		y: number;
		angle: number;
	}[] {
		const mine = this.online?.manager.myId;
		const raw = this.onlineMode
			? [...(this.online?.bulletVectors ?? [])].filter(
					(b) => b.ownerId === mine,
				)
			: this.bullets.vectors().filter((b) => b.owner === "player");
		return raw.map((b) => ({
			id: b.id,
			x: b.x,
			y: b.y,
			angle: Math.atan2(b.vy, b.vx),
		}));
	}

	// =========================================================
	//  LOOP
	// =========================================================

	update(dtMs: number) {
		const dtSec = Math.min(dtMs / MS_PER_SECOND, MAX_FRAME_DT_S);
		this.elapsed += dtMs;

		// Before anything reads an aim or an intent. The gamepad has no events, so
		// this is where a pad button becomes a held code, and where the handover
		// between the Contra aim and the fine stick advances by one frame.
		this.input.poll(dtMs, this.local.body.facing);

		if (this.onlineMode) this.updateOnline(dtSec);
		else this.updateOffline(dtSec);

		// Presentation, in dependency order: animation picks the frame, sync moves
		// the sprites, effects read the same state, then the camera settles.
		animationSystem(this.queries, dtMs);
		spriteSyncSystem(this.queries);
		nameplateSystem(this.queries, this.plates);
		shadowSystem(this.queries, this.shadows);
		this.syncAimLine(dtMs);
		meleeFxSystem(this.queries, this.fx, dtMs, (id) => this.ultAuraVisible(id));
		this.fx.update(dtMs);
		this.denyFx.update(dtMs);
		this.updateUltimate(dtMs);
		this.stage.update(dtMs);
		this.updateCamera();

		this.training?.update(dtMs);
		this.record(dtMs);
		this.emitHud();
	}

	/**
	 * Point the aim beam at whatever the input layer settled on this frame.
	 *
	 * **Controller mode only, and only for a human.** A mouse player's cursor is
	 * already the reticle, so a second one would be a line pointing at a dot a few
	 * hundred pixels away; and a bot's beam is noise on every probe screenshot.
	 *
	 * Read off the *drawn* position, like the nameplates: the render smoother
	 * deliberately offsets the sprite from its simulation state to hide a
	 * correction, and a beam grown from the body would detach from its own fighter
	 * by exactly the amount that smoothing is hiding.
	 */
	private syncAimLine(dtMs: number) {
		const at = this.local.renderPos ?? this.local.body;
		const centre = bodyCentre(at.x, at.y);
		const report = this.input.aimReport();
		const visible =
			inputSettings.scheme === "controller" &&
			!this.localBrain &&
			this.local.fighter.hp > 0;
		this.aimLine.update(
			dtMs,
			visible,
			centre.x,
			centre.y,
			this.aimAngle,
			report.blend,
		);
	}

	/**
	 * Everything the ultimate draws: the meter, the grenade and the hole.
	 *
	 * Runs on every frame including the frozen ones — the cinematic stops the
	 * *simulation*, and a cutscene during which the arena stopped animating would
	 * look like the game had crashed rather than paused for effect.
	 *
	 * The victim list is derived with the same `fieldFor` + `singularityGrip` the
	 * simulation uses, never with a radius the renderer keeps for itself. A hole
	 * that visibly tears at somebody it is not holding is the most confusing thing
	 * a field ability can do, and the only way to guarantee it cannot happen is to
	 * ask the same function.
	 */
	private updateUltimate(dtMs: number) {
		const session = this.online;
		if (!session) {
			// The `?offline=true` escape hatch has no server, and the ultimate is
			// server-owned end to end. It simply does not exist there — see
			// specs/ultimate.md.
			this.blackHole.update(null, [], dtMs);
			return;
		}

		const charge = session.localUlt;
		// The deck draws its ultimate button only when the meter is full, so it is
		// told on the integer boundary rather than on every frame.
		const readyNow = charge >= ULT_MAX_CHARGE;
		if (readyNow !== this.ultReadyLast) {
			this.ultReadyLast = readyNow;
			EventBus.emit("ult-charge", charge);
		}

		// The aim phase: while the ultimate button is held and a cast is legal,
		// show the arc the grenade will fly on this angle. It is the *release*
		// that casts, so the aim itself must not be hidden behind anything.
		const at = this.local.renderPos ?? this.local.body;
		const centre = bodyCentre(at.x, at.y);
		this.ultAim.update(
			dtMs,
			this.ultAimVisible(),
			centre.x,
			centre.y,
			this.aimAngle,
			this.arena,
		);

		const field: Singularity | null = session.singularity;
		const victims: PlayerPosition[] = [];
		if (field) {
			for (const e of this.queries.fighters) {
				if (e.fighter.hp <= 0) continue;
				const mine = fieldFor(
					field,
					this.serverIdOf(e.fighter.id),
					e.fighter.team,
				);
				const at = e.renderPos ?? e.body;
				if (singularityGrip(mine, at.x, at.y) === "held") victims.push(e.body);
			}
		}

		this.blackHole.syncGrenades(session.grenades, dtMs);
		this.blackHole.update(field, victims, dtMs);
	}

	/**
	 * May the ultimate's aim arc be shown right now?
	 *
	 * The mirror image of the server's cast conditions in `tryCastUltimate`,
	 * asked of what the *client* knows: the button is held, the meter is full,
	 * and nothing that would refuse the cast on release is true. It is
	 * presentation — the server still decides the cast — but an arc shown for a
	 * cast that will be silently refused is a lie about the button.
	 *
	 * The one asymmetry is deliberate: the client cannot know about a throw
	 * waiting on the far side of somebody else's freeze, but that state only
	 * exists *during* a cinematic, and `frozen` covers it.
	 */
	private ultAimVisible(): boolean {
		const session = this.online;
		if (!session) return false;
		if (session.frozen) return false;
		if (session.singularity) return false;
		if (session.grenades.length > 0) return false;
		if (session.matchStatus?.phase !== "live") return false;
		if (!this.input.actionDown("ultimate")) return false;
		if (this.local.fighter.hp <= 0) return false;
		if (isStunned(this.local.body) || isKnockedDown(this.local.body)) {
			return false;
		}
		return session.localUlt >= ULT_MAX_CHARGE;
	}

	/** Last value pushed over `ult-charge`, so the deck is told only on a change. */
	private ultReadyLast = false;

	/**
	 * May this fighter's ultimate charge aura be drawn right now?
	 *
	 * The local fighter answers with the same mirror of the server's cast
	 * conditions the aim arc uses: the button is held, the meter is full, and
	 * nothing would refuse the cast on release. A remote answers from what the
	 * **server** echoed about it — the held button travels in the input, so the
	 * input the server consumed tells the room a charge-up is happening one
	 * snapshot after it starts — plus the same room and fighter conditions.
	 *
	 * The aura is the room's tell that a cast is imminent, and like the arc it
	 * must never appear for a cast that will be refused: an aura on a fighter
	 * with an empty meter is a lie about the button.
	 */
	private ultAuraVisible(id: string): boolean {
		if (id === LOCAL_ID) return this.ultAimVisible();
		const session = this.online;
		if (!session) return false;
		if (session.frozen) return false;
		if (session.singularity) return false;
		if (session.grenades.length > 0) return false;
		if (session.matchStatus?.phase !== "live") return false;
		const entity = this.remotes.get(id);
		if (!entity) return false;
		if (entity.fighter.hp <= 0) return false;
		if (isStunned(entity.body) || isKnockedDown(entity.body)) return false;
		if (session.ultOf(id) < ULT_MAX_CHARGE) return false;
		return session.ultHeldBy(id);
	}

	/**
	 * The id the *server* knows an entity by.
	 *
	 * The local fighter's entity is keyed `"local"` — it is created before this
	 * client has been told who it is, and the key is also its effects key, so it
	 * cannot be renamed later without orphaning every sprite bound to it.
	 *
	 * That is harmless right up until something asks a question the server also
	 * asks. The black hole's friendly-fire rule compares against `field.ownerId`,
	 * which is a server id — so `fieldFor(field, "local")` never matched the
	 * caster, and the caster's *own* client drew them being torn apart inside
	 * their own hole. Found by `scripts/ultimate-probe.mjs`, which reported the
	 * held fighter as `"local"` on a client where that was the caster.
	 *
	 * The simulation was never wrong: `OnlineSession` looks the field up by
	 * `manager.myId` and always did. This is the presentation layer needing the
	 * same name for the same fighter.
	 */
	private serverIdOf(entityId: string): string {
		return entityId === LOCAL_ID
			? (this.online?.manager.myId ?? entityId)
			: entityId;
	}

	/**
	 * The follow camera: keep the local fighter on screen, clamped to the world.
	 *
	 * A room wider than the viewport scrolls horizontally (and would scroll
	 * vertically too if the world were ever taller than a screen). The fighter
	 * is kept near the centre, and the camera's per-frame movement is capped —
	 * deliberately: the diagnostic reads `camera_x`/`camera_y` scroll as jitter,
	 * and a dash at 1000px/s would otherwise trip the 15px threshold on the
	 * frames it flies. On a single-screen arena `maxX` is zero and the camera
	 * never moves, exactly as it always has.
	 *
	 * Reads the *drawn* position, like the nameplates and the aim beam — the
	 * sprite is what a player watches, so the camera tracks it, not the body.
	 */
	private updateCamera() {
		const at = this.local.renderPos ?? this.local.body;
		const centreX = at.x + PLAYER_WIDTH / 2;
		const centreY = at.y + PLAYER_HEIGHT / 2;

		const maxX = Math.max(0, this.arena.right - this.view.width);
		const maxY = Math.max(0, this.arena.bottom - this.view.height);
		const targetX = clamp(centreX - this.view.width / 2, 0, maxX);
		const targetY = clamp(centreY - this.view.height / 2, 0, maxY);

		const dx = targetX - this.stage.cameraX;
		const dy = targetY - this.stage.cameraY;
		const dist = Math.hypot(dx, dy);
		if (dist <= CAMERA_MAX_STEP_PX) {
			this.stage.setScroll(targetX, targetY);
		} else {
			const t = CAMERA_MAX_STEP_PX / dist;
			this.stage.setScroll(
				this.stage.cameraX + dx * t,
				this.stage.cameraY + dy * t,
			);
		}
	}

	private record(dtMs: number) {
		if (!this.diagnostics.isActive) return;
		this.diagnostics.record({
			t: this.elapsed,
			dt: dtMs,
			physicsSteps: this.diagSteps,
			player: this.local.body,
			// Where the opponent is *drawn*, not where its simulation state sits.
			//
			// The two differ now, and the difference is the point. A remote fighter is
			// predicted from its last known input and corrected on every snapshot, so
			// its raw state legitimately jumps tens of pixels the moment the server
			// reports something no client could have predicted — a hit landing, a
			// respawn. The render smoother exists to turn that into a glide, and
			// measuring the state instead of the sprite reported a pop nobody could
			// see, on a metric that therefore could never reach zero.
			//
			// The correction itself is not hidden: `netSummary.rollback` reports every
			// one of them, with magnitudes. This metric answers the other question —
			// whether what a player *watched* was continuous.
			enemy: this.onlineMode
				? this.primaryRemoteDrawnAt()
				: this.offlineFoe
					? { x: this.offlineFoe.body.x, y: this.offlineFoe.body.y }
					: null,
			// The opponent's state **as the server sent it**, not as this client
			// predicted it.
			//
			// This feeds the melee frame-data tracker, which asks whether a state
			// machine kept the contracts in the MOVES table — and that is only
			// answerable about the authoritative state machine. A remote fighter is
			// predicted now, and prediction being wrong is what prediction *is*: fed
			// the predicted state, the tracker read a mispredicted uppercut as an
			// uncancellable move ending 500ms early, and reported correct netcode as a
			// frame data violation.
			enemyState: this.onlineMode
				? (this.online?.remoteAuthoritativeState ?? null)
				: (this.offlineFoe?.body ?? null),
			bullets: this.onlineMode
				? [...(this.online?.bullets ?? [])]
				: this.bullets.snapshot(),
			// The ultimate's cinematic freeze holds the projectile clock still —
			// see `PhysicsDiagnostics` on why a parked bullet is not a stall.
			frozen: this.online?.frozen ?? false,
			// Camera *scroll*, never the shake offset: shake is cosmetic and would
			// otherwise report every heavy sword impact as camera jitter.
			cameraX: this.stage.cameraX,
			cameraY: this.stage.cameraY,
		});
	}

	/**
	 * Where the primary remote fighter was drawn this frame.
	 *
	 * Read off the entity rather than by calling `renderRemote` again: the smoother
	 * decays on every call, so asking twice in one frame would advance it twice and
	 * report a position nothing was ever drawn at.
	 */
	private primaryRemoteDrawnAt(): { x: number; y: number } | null {
		const id = this.online?.primaryRemoteId;
		if (id === undefined) return null;
		const entity = this.remotes.get(id);
		if (!entity) return null;
		const at = entity.renderPos ?? entity.body;
		return { x: at.x, y: at.y };
	}

	/** Run the fixed-timestep accumulator, calling `step` once per 1/60s. */
	private runFixedSteps(dtSec: number, step: (dt: number) => void): number {
		this.accumulator += dtSec;
		let steps = 0;
		while (this.accumulator >= PHYSICS_DT && steps < MAX_PHYSICS_STEPS) {
			step(PHYSICS_DT);
			this.accumulator -= PHYSICS_DT;
			steps++;
		}
		return steps;
	}

	/**
	 * Build the perception an AI brain reads, from simulation state only.
	 *
	 * The online room is the full picture: the brain gets its own side, every
	 * living enemy and every teammate with positions, plus the charge meter and
	 * the open black holes — the facts the team and ultimate modules reason over.
	 * Offline there is exactly one opponent and none of the rest, which is honest
	 * for a mode with no server and no sides.
	 */
	private perceive(
		self: PlayerPosition,
		foe: PlayerPosition,
		selfHP: number,
		enemyHP: number,
	): AIInput {
		const dx = foe.x - self.x;
		const dy = foe.y - self.y;

		const allies: AllyInfo[] = [];
		const foes: FoeInfo[] = [];
		let selfTeam: TeamId | null = null;
		let selfUltCharge = 0;
		const fields: { x: number; y: number; hostile: boolean }[] = [];
		let selfId = "local";

		const session = this.online;
		if (session?.connected) {
			const myId = session.manager.myId;
			selfId = myId;
			selfTeam = session.myTeam;
			selfUltCharge = session.localUlt;
			for (const [id, fighter] of session.remotes) {
				const d = Math.hypot(
					fighter.state.x - self.x,
					fighter.state.y - self.y,
				);
				const team = session.teamOf(id);
				if (hostile(selfTeam, team)) {
					if (session.aliveOf(id)) {
						foes.push({
							id,
							x: fighter.state.x,
							y: fighter.state.y,
							hp: session.hpOf(id),
							distance: d,
						});
					}
				} else {
					allies.push({
						id,
						x: fighter.state.x,
						y: fighter.state.y,
						hp: session.hpOf(id),
						alive: session.aliveOf(id),
						distance: d,
					});
				}
			}
			const field = session.singularity;
			if (field) {
				fields.push({
					x: field.x,
					y: field.y,
					hostile: fieldAffects(field, myId, selfTeam),
				});
			}
		} else if (this.offlineFoe) {
			foes.push({
				id: OFFLINE_FOE_ID,
				x: foe.x,
				y: foe.y,
				hp: enemyHP,
				distance: Math.hypot(dx, dy),
			});
		}

		return {
			playerX: foe.x,
			playerY: foe.y,
			selfX: self.x,
			selfY: self.y,
			distanceToPlayer: Math.sqrt(dx * dx + dy * dy),
			playerFacingDirection: foe.facing,
			touchingDown: self.grounded,
			touchingLeft: self.wallTouch === "left",
			touchingRight: self.wallTouch === "right",
			hasLineOfSight: hasLineOfSight(
				self.x,
				self.y,
				foe.x,
				foe.y,
				24,
				this.arena,
			),
			selfHP,
			enemyHP,
			enemyAction: foe.meleeAction,
			enemyPhase: meleePhase(foe),
			enemyBlocking: foe.blocking,
			enemyStunned: foe.stunTimer > 0,
			selfAction: self.meleeAction,
			selfStunned: self.stunTimer > 0,
			selfMassiveReady: self.massiveReady,
			selfId,
			selfAirJumps: self.airJumps,
			selfUltCharge,
			enemyVX: foe.vx,
			enemyVY: foe.vy,
			selfTeam,
			allies,
			foes,
			fields,
		};
	}

	// =========================================================
	//  ONLINE
	// =========================================================

	private updateOnline(dtSec: number) {
		const session = this.online;
		if (!session?.connected) return;

		// An ultimate is being cast: the room is frozen, so run **no fixed steps**.
		//
		// Not a rendering pause — a simulation one, and the only one in the game.
		// Skipping the step is what makes it safe: no step means no prediction, no
		// input sent and no remote advanced, which is exactly what the server is
		// doing for the same range of ticks. The accumulator is drained rather than
		// left to fill, or the frame the freeze lifts would fire five steps at once
		// and hand the server a burst of input it never asked for.
		//
		// **The brain is gated on this too.** The server's bots decide inside
		// `fixedTick`, which the cinematic skips entirely, so their holds and
		// releases only ever happen in gaps between freezes. A client brain that
		// kept deciding through the freeze measured the opposite: it held and
		// released an ultimate while no input could leave the client, and every
		// cast was silently swallowed — zero of zero in a room where the bots
		// chained cinematics. Deciding only in the gaps makes the client brain
		// pause its hold mid-freeze and release it the moment inputs flow again.
		if (session.frozen) {
			this.accumulator = 0;
			this.diagSteps = 0;
			this.local.body = session.predicted.state;
			this.local.fighter.team = session.myTeam;
			// Presentation still runs. `render` knows it is frozen and holds the
			// projectile clock still, so bullets hang in the air with everything
			// else instead of flying on through the cutscene.
			this.local.renderPos = session.render(dtSec);
			this.syncRemotes(session, dtSec);
			return;
		}

		if (this.aiMode && this.localBrain) {
			// The nearest living opponent's full authoritative state, not just a
			// position: the brain has to see what that fighter's sword is doing to
			// block, punish or uppercut a guard. `EnemyBrain` reasons about exactly
			// one enemy, so somebody has to choose which — and in a sixteen-fighter
			// arena "whoever is closest" is the only choice that reads as fighting
			// rather than as commuting.
			const foe = session.nearestFoe(this.local.body);
			if (foe) {
				const output = this.localBrain.decide(
					this.perceive(
						this.local.body,
						foe,
						this.local.fighter.hp,
						session.remoteHp,
					),
					this.elapsed,
					dtSec * MS_PER_SECOND,
				);
				this.localIntent = intentFromAI(output);
				this.aimAngle = output.aimAngle;
			}
		} else {
			this.aimAngle = this.input.aimAngle(this.local.body.x, this.local.body.y);
			this.localIntent = this.input.intent(this.aimAngle);
		}

		this.diagSteps = this.runFixedSteps(dtSec, (dt) => {
			// The one-shot dash is delivered here, at the fixed-step boundary,
			// rather than by the rendered frame. A frame can run zero fixed steps
			// — on a 120Hz+ display, roughly half of them — and a gesture consumed
			// into a frame that ran none was silently dropped: the player
			// double-tapped and nothing happened, which read as a cooldown far
			// longer than the 250ms lockout. A local AI brain already carries its
			// dash inside `localIntent`, so it wins and the human gesture stays.
			const intent =
				this.localBrain !== undefined
					? this.localIntent
					: Input.withDash(this.localIntent, this.input.consumeDash());
			session.fixedStep(intent, this.aimAngle, dt);
		});

		// The predicted state object is replaced every tick, so the entity has to
		// be re-pointed at the current one rather than holding a stale copy. Same
		// for every remote: `tickPlayer` is pure, so rolling one forward hands back
		// a new object.
		this.local.body = session.predicted.state;
		this.local.renderPos = session.render(dtSec);
		this.local.fighter.team = session.myTeam;
		this.syncRemotes(session, dtSec);
	}

	/**
	 * Re-point every remote entity at its current predicted state.
	 *
	 * Its own method because the cinematic freeze needs it too: the simulation
	 * stands still, but the smoother, the sprites and the nameplates must keep
	 * being fed or fifteen fighters would blink out for the length of the
	 * cutscene.
	 */
	private syncRemotes(session: OnlineSession, dtSec: number) {
		for (const [id, entity] of this.remotes) {
			const fighter = session.remotes.get(id);
			if (!fighter) continue;
			entity.body = fighter.state;
			const at = session.renderRemote(id, dtSec);
			if (at) entity.renderPos = at;
			entity.fighter.hp = session.hpOf(id);
			// Cheap, and it means a name appears the moment the roster names it —
			// including when a bot gives up its seat and a human inherits the slot.
			entity.fighter.name = session.nameOf(id);
			// Straight off the snapshot, every frame. Sides do not change mid-match,
			// but a fighter is drawn before its first snapshot lands, and a colourless
			// frame is better than a wrong one that never corrects itself.
			entity.fighter.team = session.teamOf(id);
		}
	}

	// =========================================================
	//  OFFLINE ESCAPE HATCH
	// =========================================================

	private updateOffline(dtSec: number) {
		const foe = this.offlineFoe;
		if (!foe) return;

		this.gatherOfflineIntents(dtSec, foe);

		this.diagSteps = this.runFixedSteps(dtSec, (dt) => {
			if (this.local.fighter.hp > 0) {
				// Same dash-at-the-step-boundary rule as online, so the offline
				// escape hatch behaves like the real game: see `updateOnline`.
				const intent =
					this.localBrain !== undefined
						? this.localIntent
						: Input.withDash(this.localIntent, this.input.consumeDash());
				this.local.body = tickPlayer(this.local.body, intent, dt, this.arena);
			}
			if (foe.fighter.hp > 0) {
				foe.body = tickPlayer(foe.body, this.remoteIntent, dt, this.arena);
			}
			this.bullets.step(dt);
		});

		this.handleOfflineAttacks(foe);
		this.tickReset(dtSec);
	}

	private gatherOfflineIntents(dtSec: number, foe: FighterEntity) {
		const dtMs = dtSec * MS_PER_SECOND;

		if (this.localBrain) {
			const output = this.localBrain.decide(
				this.perceive(
					this.local.body,
					foe.body,
					this.local.fighter.hp,
					foe.fighter.hp,
				),
				this.elapsed,
				dtMs,
			);
			this.localIntent = intentFromAI(output);
			this.aimAngle = output.aimAngle;
		} else {
			this.aimAngle = this.input.aimAngle(this.local.body.x, this.local.body.y);
			this.localIntent = this.input.intent(this.aimAngle);
		}

		if (this.remoteBrain) {
			const output = this.remoteBrain.decide(
				this.perceive(
					foe.body,
					this.local.body,
					foe.fighter.hp,
					this.local.fighter.hp,
				),
				this.elapsed,
				dtMs,
			);
			this.remoteIntent = intentFromAI(output);
			this.remoteBrainAim = output.aimAngle;
		}
	}

	private handleOfflineAttacks(foe: FighterEntity) {
		const now = this.elapsed;

		// A fighter holds a sword or a gun, never both.
		if (
			this.local.body.stance === "gun" &&
			this.localIntent.attack &&
			canFire(this.localAttackAt, now)
		) {
			this.localAttackAt = now;
			const c = bodyCentre(this.local.body.x, this.local.body.y);
			this.bullets.fire(c.x, c.y, this.aimAngle, "player");
			EventBus.emit("bullet-fired");
		}

		if (
			foe.fighter.hp > 0 &&
			foe.body.stance === "gun" &&
			this.remoteIntent.attack &&
			canFire(this.remoteAttackAt, now)
		) {
			this.remoteAttackAt = now;
			const c = bodyCentre(foe.body.x, foe.body.y);
			this.bullets.fire(c.x, c.y, this.remoteBrainAim, "enemy");
			EventBus.emit("bullet-fired");
		}

		this.resolveOfflineMelee(foe);
		this.bullets.resolve(this.bulletTargets(foe));
	}

	private localAttackAt = 0;
	private remoteAttackAt = 0;
	private remoteBrainAim = 0;

	/**
	 * Judge sword hits without a server. `?offline=true` only.
	 *
	 * Mirrors `GameRoom.resolveMeleeHits` because both call the same simulation
	 * code — the escape hatch must not become a second, divergent set of combat
	 * rules, since it is the one path nobody dogfoods.
	 */
	private resolveOfflineMelee(foe: FighterEntity) {
		const sides: [FighterEntity, FighterEntity][] = [
			[this.local, foe],
			[foe, this.local],
		];

		for (const [attacker, defender] of sides) {
			if (attacker.fighter.hp <= 0 || defender.fighter.hp <= 0) continue;

			const result = resolveMelee(attacker.body, defender.body);
			if (!result) continue;

			const damage = applyMeleeResult(attacker.body, defender.body, result);
			this.fx.impact(result as ImpactEvent, defender.fighter.id);
			if (damage > 0) this.applyOfflineDamage(defender, damage, "sword");
		}
	}

	private bulletTargets(foe: FighterEntity): BulletTarget[] {
		return [
			{
				owner: "enemy",
				x: foe.body.x,
				y: foe.body.y,
				alive: foe.fighter.hp > 0,
				state: foe.body,
				onHit: () => this.applyOfflineDamage(foe, BULLET_DAMAGE, "bullet"),
			},
			{
				owner: "player",
				x: this.local.body.x,
				y: this.local.body.y,
				alive: this.local.fighter.hp > 0,
				state: this.local.body,
				onHit: () =>
					this.applyOfflineDamage(this.local, BULLET_DAMAGE, "bullet"),
			},
		];
	}

	private applyOfflineDamage(
		victim: FighterEntity,
		damage: number,
		kind: string,
	) {
		victim.fighter.hp = Math.max(0, victim.fighter.hp - damage);
		const who = victim.fighter.local ? "Player" : "Enemy";
		console.log(`[FIGHT] ${who} hit by ${kind}! HP: ${victim.fighter.hp}`);

		if (victim.fighter.local) {
			this.emitHud(true);
		}

		if (victim.fighter.hp <= 0 && this.resetAt < 0) {
			console.log(`[FIGHT] ${who} defeated!`);
			this.resetAt = RESET_DELAY_MS;
		}
	}

	private tickReset(dtSec: number) {
		if (this.resetAt < 0) return;
		this.resetAt -= dtSec * MS_PER_SECOND;
		if (this.resetAt > 0) return;
		this.resetFight();
		console.log("=== FIGHT RESET ===");
	}

	// =========================================================
	//  LIFECYCLE
	// =========================================================

	private resetFight() {
		this.diagnostics.markRoundReset();
		this.resetAt = -1;

		this.local.body = createPlayerState(START_PLAYER_X, START_PLAYER_Y, 1);
		this.local.fighter.hp = MAX_HP;
		this.localIntent = { ...NO_INTENT };
		this.remoteIntent = { ...NO_INTENT };

		if (this.offlineFoe) {
			this.offlineFoe.body = createPlayerState(
				START_ENEMY_X,
				START_ENEMY_Y,
				-1,
			);
			this.offlineFoe.fighter.hp = MAX_HP;
		}

		if (this.localBrain)
			this.localBrain = new EnemyBrain(fightConfig(), this.arena);
		if (this.remoteBrain)
			this.remoteBrain = new EnemyBrain(fightConfig(), this.arena);

		this.bullets.clear();
		this.fx.reset();
		this.blackHole.reset();
		this.denyFx.reset();
		this.aimLine.reset();
		this.ultAim.reset();
		this.stage.reset();
		this.emitHud(true);
	}

	private toggleAiVsAi() {
		if (this.localBrain) {
			this.localBrain = undefined;
			this.remoteBrain = undefined;
			console.log("=== AI VS AI MODE DISABLED ===");
			return;
		}
		this.localBrain = new EnemyBrain(fightConfig(), this.arena);
		if (!this.onlineMode)
			this.remoteBrain = new EnemyBrain(fightConfig(), this.arena);
		if (!this.onlineMode) this.resetFight();
		console.log("=== AI VS AI MODE ENABLED ===");
		console.log("Press 'P' to exit, or call window.__gameState()");
	}

	destroy() {
		this.nameUnsubscribe?.();
		window.clearTimeout(this.shareHintTimer);
		this.input.destroy();
		this.blackHole.destroy();
		this.aimLine.destroy();
		this.ultAim.destroy();
		this.denyFx.destroy();
		this.training?.destroy();
		this.online?.disconnect();
	}
}

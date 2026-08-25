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

import { Container, Sprite } from "pixi.js";
import { SMOKE_REVEAL_MS } from "../tweakables/items.js";
import { pelletDamageAt } from "../tweakables/ranged.js";
import { type AIConfig, randomBotConfig } from "./characters/AIConfig";
import { EnemyBrain } from "./characters/EnemyBrain";
import type { AIInput, AIOutput, AllyInfo, FoeInfo } from "./characters/types";
import { BulletSystem, type BulletTarget } from "./combat/BulletSystem";
import {
	CARRY_START_SUPPRESSION_FRAMES,
	DRAGON_DROP_SUPPRESSION_FRAMES,
	PhysicsDiagnostics,
	RESPAWN_CORRECTION_PX,
} from "./diagnostics/PhysicsDiagnostics";
import { EventBus } from "./EventBus";
import {
	animationSystem,
	bindFxBodies,
	idleTexture,
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
import type { KillCause, MatchOverMsg } from "./online/types";
import { readStoredName, storeName } from "./playerName";
import { fetchPotgClip } from "./potg/clipSource";
import { POTG_BAR_FRACTION, type PotgShot } from "./potg/Director";
import { PotgReplay, type ReplaySample } from "./potg/Replay";
import type {
	PotgAnnounce,
	PotgCastMember,
	PotgTrackEntry,
} from "./potg/types";
import { AimLine } from "./render/AimLine";
import { bodyCentre, drawArena } from "./render/ArenaRenderer";
import { heroFrames, sheetScale, TEX, tex } from "./render/assets";
import { BlackHoleFx } from "./render/BlackHoleFx";
import { BlossomFx } from "./render/BlossomFx";
import { DenyFx } from "./render/DenyFx";
import { DragonFx } from "./render/DragonFx";
import { ItemFx } from "./render/ItemFx";
import { type ImpactEvent, MeleeFx } from "./render/MeleeFx";
import { Nameplates } from "./render/Nameplates";
import { RootedFx } from "./render/RootedFx";
import { Shadows } from "./render/Shadows";
import { SpritePool } from "./render/SpritePool";
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
import {
	timeLeftMs,
	VICTORY_BREATHING_MS,
	VICTORY_HOLD_MS,
} from "./simulation/Deathmatch";
import {
	DEFAULT_HERO,
	HEROES,
	type HeroId,
	type HeroKit,
	isHeroId,
	kitFor,
} from "./simulation/Heroes";
import { smokeHidesFrom } from "./simulation/Items";
import {
	applyHitToDefender,
	applyMeleeResult,
	bodyRect,
	bulletDistanceFromMuzzle,
	canFire,
	createPlayerState,
	fieldAffects,
	fieldFor,
	hasLineOfSight,
	isFrozen,
	isKnockedDown,
	isStunned,
	MAX_HP,
	type MeleeAction,
	MOVES,
	MS_PER_SECOND,
	meleePhase,
	NEUTRAL_INTENT,
	type PlayerIntent,
	type PlayerPosition,
	rectsOverlap,
	reserveRoundsFor,
	resolveMelee,
	type Singularity,
	singularityGrip,
	sweptThrustBox,
	tickPlayer,
	tickReload,
	ULT_MAX_CHARGE,
} from "./simulation/Physics";
import {
	hostile,
	type MatchMode,
	TDM_MIN_SCREENS,
	type TeamId,
	teamName,
} from "./simulation/Teams";
import { sound } from "./sound/facade";
import { TrainingRoom } from "./training/TrainingRoom";

/** Client physics runs at a fixed 60Hz to match the server, whatever the display does. */
const PHYSICS_DT = 1 / 60;
const MAX_PHYSICS_STEPS = 5;
const RESET_DELAY_MS = 2000;

/** Longest a single rendered frame may simulate — a stall must not rubber-band the world. */
const MAX_FRAME_DT_S = 0.05;
/** ms per second, for converting a wall-clock difference into dt. */
const MILLIS_PER_SECOND = 1000;
/** How far a sound carries from the local fighter, world px — a screen is 800. */
const AUDIO_RANGE_PX = 900;
/** The pan sweep: a sound this far sideways fully hard-pans. */
const AUDIO_PAN_RANGE_PX = 700;
/** The music's bow for an denied ultimate, ms. */
const DUCK_DENY_MS = 400;
/** The music's bow for a cast — the freeze is at least this long, ms. */
const DUCK_ULTIMATE_MIN_MS = 1100;
/** The match-over fanfare owns this many ms of lowered music. */
const DUCK_MATCH_OVER_MS = 2600;
/** The play-of-the-game fanfare ducks this long, ms. */
const DUCK_POTG_MS = 1400;
/** The offline reload's dt clamp: a stall cannot reload the whole magazine at once. */
const MAX_RELOAD_STEP_SECONDS = 0.25;
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

/**
 * How long the replay's impact shake lasts on a scoring beat.
 *
 * Shorter than a sword impact's, because it fires under slow motion: the same
 * duration that reads as a thump at full speed reads as a wobble at 0.32x.
 */
const POTG_SHAKE_MS = 180;

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
		item: output.item,
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
	private readonly rootedFx: RootedFx;
	private readonly items: ItemFx;
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
	 * Which hero this client's own fighter plays. From `?hero=` (the menu's
	 * hero select writes it), or the Esc menu's hero select mid-match — the
	 * server confirms the change in the next snapshot, and this field follows
	 * the echo.
	 */
	private hero: HeroId = DEFAULT_HERO;
	/** `?botHero=` — the hero every bot in a room this client creates plays. */
	private botHero: HeroId | null = null;
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
	private dragonFx!: DragonFx;
	private blossomFx!: BlossomFx;

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
	/** The ultimate button's state last fixed step, for the dragon's release edge. */
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
		// `?hero=` picks who this client plays before the room exists. Invalid
		// values fall back to the default rather than failing to boot.
		this.hero = isHeroId(launch.hero) ? launch.hero : DEFAULT_HERO;
		this.botHero = launch.botHero;
		// The hero picked the moment the match boots owns the music — each
		// fighter has a theme. The menu's title theme hands off under the
		// engine's crossfade; `onLocalHero` re-points it mid-match.
		sound.setMusic(this.hero);
		drawArena(stage.background, stage.arena, this.arena);

		this.queries = createQueries(this.world);
		this.fx = new MeleeFx(stage.effects, stage);
		// Two layers: the hole itself goes *behind* the fighters and its particles in
		// front of them. See `BlackHoleFx` — a 150px black disc drawn over the actors
		// hid the fighters it was holding.
		this.blackHole = new BlackHoleFx(stage.field, stage.effects, stage);
		// The dragon rides in the effects layer too: it is a wake that follows
		// the rider, never a field the arena has to make room for.
		this.dragonFx = new DragonFx(stage.field, stage.effects);
		// The Death Blossom: a ring and an area under the fighters (the same
		// reason the hole's core sits behind them) and the heaviest particle
		// budget in the game in front of them.
		this.blossomFx = new BlossomFx(stage.field, stage.effects, stage);
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
		// And the ROOTED caption, the Jumanji half of the same register — a trap
		// springing is a moment worth shouting over the fighter it just caught.
		this.rootedFx = new RootedFx(stage.nameplates);
		// The items: HE grenades fly in the projectile layer, their blasts in the
		// effects layer, and the traps sit on the floor under the fighters — a
		// pad you can see is the whole of the counterplay.
		this.items = new ItemFx(stage.field, stage.effects, this.arena, stage);
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
				// The offline foe plays the mirror hero, so the escape hatch
				// exercises both kits without needing a server.
				this.foeHero(),
			);
			// No server, so no roster to be named by.
			this.offlineFoe.fighter.name = "Rival";
			this.local.fighter.name = "You";
			// A new life is a new magazine — and a match that has not started
			// is a life that just began. The online bodies spawn with a full
			// mag because `createPlayerState` fills them from the kit; the
			// escape hatch's own counters are only filled by `resetFight`, so
			// without this a fresh offline match opened at 0/30 and the gun
			// could not fire until somebody died. (The reload used to mask it
			// by silently refilling an empty mag in sword stance.)
			this.localAmmo = kitFor(this.hero).ranged.magazine;
			this.localReserve = reserveRoundsFor(kitFor(this.hero).ranged);
			this.remoteAmmo = kitFor(this.foeHero()).ranged.magazine;
			this.remoteReserve = reserveRoundsFor(kitFor(this.foeHero()).ranged);
			this.localReload = 0;
			this.remoteReload = 0;
			if (this.aiMode) this.startOfflineAi();
		}

		EventBus.emit("current-scene-ready", this);
		this.installHeroSelect();
		this.installRoomControls();
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
		hero: HeroId = this.hero,
	): FighterEntity {
		// The strip's idle frame comes from the hero's own clip table — see
		// `HERO_CLIPS` in ecs/systems.ts, where `left-idle` and `right-idle`
		// name each hero's own frames. The scale comes from the sheet's own
		// cells, so Anands' hand-drawn 168x152 art draws at the same size the
		// collider has always been.
		const idleTex = idleTexture(hero, facing);
		const sprite = new Sprite(idleTex ?? heroFrames(HEROES[hero].sheet)[4]);
		sprite.anchor.set(SPRITE_ANCHOR_CENTRE);
		sprite.scale.set(sheetScale(HEROES[hero].sheet));
		this.stage.actors.addChild(sprite);

		const entity = this.world.add({
			key: id,
			// The name is filled in from the roster once it arrives; until then a
			// plate shows a bar and no label, which is honest — nobody has told this
			// client who that is yet.
			// No side until a snapshot says otherwise, which is also what every
			// fighter in a free-for-all keeps for the whole match.
			fighter: {
				id,
				local,
				hp: MAX_HP,
				maxHp: MAX_HP,
				name: "",
				team: null,
				hero,
			},
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
	private lastHudHero: HudState["hero"] = "lia";

	private emitHud(force = false) {
		const session = this.online;
		const foeId = this.online?.primaryRemoteId ?? "";
		// The magazine and the reload bar. Online, the local body carries the
		// server's authoritative ammo (reconciled like everything else); the
		// offline escape hatch keeps its own counters. A clip reload fills the
		// whole magazine in one action, so the bar runs against the single
		// `reloadMs`; a shell reload loads a round per cycle, so the bar
		// includes the round being pumped. Either way it reads "how full is
		// the gun becoming".
		const ranged = kitFor(this.hero).ranged;
		const ammo = this.onlineMode ? this.local.body.ammo : this.localAmmo;
		const reserve = this.onlineMode
			? this.local.body.reserveRounds
			: this.localReserve;
		const reloadTimer = this.onlineMode
			? this.local.body.reloadTimer
			: this.localReload;
		const reloadTotal =
			ranged.reloadStyle === "clip"
				? ranged.reloadMs
				: ammo === 0
					? (ranged.reloadFirstRoundMs ?? ranged.reloadRoundMs)
					: ranged.reloadRoundMs;
		const roundProgress =
			reloadTimer > 0 ? 1 - Math.max(0, reloadTimer) / reloadTotal : 0;
		const reloadProgress =
			(ammo + roundProgress * (ranged.magazine - ammo)) / ranged.magazine;
		const state: HudState = {
			hp: this.local.fighter.hp,
			maxHp: this.local.fighter.maxHp,
			ult: session ? session.localUlt : 0,
			itemCharges: session ? session.localItemCharges : 0,
			itemMaxCharges: kitFor(this.hero).item.maxCharges,
			itemLabel: kitFor(this.hero).item.label,
			ammo: Math.max(0, Math.min(ranged.magazine, ammo)),
			magazine: ranged.magazine,
			reserveRounds: Math.max(0, Math.round(reserve)),
			reloadProgress: Math.max(0, Math.min(1, reloadProgress)),
			stance: this.local.body.stance,
			hero: this.hero,
			foeHero: this.onlineMode
				? (session?.heroOf(foeId) ?? "lia")
				: this.foeHero(),
			name: this.local.fighter.name,
			foeName: this.onlineMode
				? (this.online?.nameOf(foeId) ?? "")
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
		const heroChanged = state.hero !== this.lastHudHero;
		this.lastHudStance = state.stance;
		this.lastHudName = state.name;
		this.lastHudHero = state.hero;
		if (!force && !stanceChanged && !nameChanged && !heroChanged) {
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

	/**
	 * The Esc menu's hero select. The request goes to the server (reliably —
	 * it is a one-shot, like `join`), and the change comes home in the next
	 * snapshot's `hero` field, where `onLocalHero` swaps the sheet and the
	 * HUD. The client never applies it optimistically, so a refused request
	 * cannot leave the two sides disagreeing about whose kit is whose.
	 */
	private installHeroSelect() {
		EventBus.on("hero-select", ((hero: unknown) => {
			if (!isHeroId(hero)) return;
			if (hero === this.hero) return;
			this.online?.requestHero(hero);
		}) as never);
	}

	private installRoomControls() {
		EventBus.on("team-select", ((team: unknown) => {
			if (team !== 0 && team !== 1) return;
			this.online?.requestTeam(team as TeamId);
		}) as never);
		EventBus.on("bot-add", ((team: unknown) => {
			if (team !== 0 && team !== 1 && team !== null && team !== undefined)
				return;
			this.online?.requestBotAdd((team as TeamId | null) ?? null);
		}) as never);
		EventBus.on("bot-remove", ((team: unknown) => {
			if (team !== 0 && team !== 1 && team !== null && team !== undefined)
				return;
			this.online?.requestBotRemove((team as TeamId | null) ?? null);
		}) as never);
		EventBus.on("admin-toggle", ((data: unknown) => {
			const m = data as { targetId?: unknown; admin?: unknown } | null;
			if (typeof m?.targetId !== "string" || typeof m?.admin !== "boolean")
				return;
			this.online?.requestAdmin(m.targetId, m.admin);
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
				onLocalHero: (hero) => {
					// The server echoed a hero change (the URL's `?hero=`, or the
					// Esc menu). Swap the sheet under the fighter, the kit the HUD
					// describes, the aim preview's shape — and the music: each
					// hero has their own theme (see audio/README.md).
					if (hero === this.hero) return;
					this.hero = hero;
					this.local.fighter.hero = hero;
					this.local.anim = { clip: "right-idle", frame: 0, elapsedMs: 0 };
					const idleTex = idleTexture(hero, this.local.body.facing);
					if (idleTex) this.local.sprite.texture = idleTex;
					this.local.sprite.scale.set(sheetScale(HEROES[hero].sheet));
					sound.setMusic(hero);
					this.emitHud(true);
				},
				onReconcile: (result) => {
					// A predicted dragon ride the server refused snaps the fighter
					// back from wherever the ride had carried it — a legitimate
					// discontinuity, like a respawn, and announced as one. The
					// glide takes longer than a hit's: the ride can end 75px from
					// where the prediction was when the wall stopped it.
					if (result.dragonDropped) {
						this.diagnostics.markTeleport(DRAGON_DROP_SUPPRESSION_FRAMES);
					}
					// The mirror: the server caught this fighter in a dive. The
					// catch is a hit — unpredictable, and with no melee event to
					// announce itself — so the rewind lands up to a full fall
					// ahead of the prediction. Same announcement, same size.
					if (result.carryStarted) {
						this.diagnostics.markTeleport(CARRY_START_SUPPRESSION_FRAMES);
						this.diagnostics.recordPlungeCatch();
					}
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
				onTeleport: (frames) => this.diagnostics.markTeleport(frames),
				onPlungeCatch: () => this.diagnostics.recordPlungeCatch(),
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
					// And the ceremony with it. A new match has started; a replay of the
					// last one still running over it would be showing fighters at
					// positions the live arena has already moved them away from.
					this.potgAnnounce = null;
					if (this.potgReplay) this.endPlayOfTheGame();
					else EventBus.emit("potg-end", null);
					// The victory window with it: a card (or a ceremony waiting for its
					// turn) must not survive the match it announced.
					this.victoryMsg = null;
					this.victoryShowAt = null;
					this.victoryDoneAt = null;
					this.victoryWindowOver = false;
					this.pendingPotg = null;
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
					// The sound: a guard that stops a swing is a guard-break
					// clang; the blast and the bomb's nudge are the heavy thump;
					// a backstab is the extra-skinny foomp. Attenuated by where
					// the exchange happened.
					this.playAt(
						event.outcome === "parried"
							? "guardbreak"
							: event.outcome === "hit"
								? "hit"
								: "hit-heavy",
						event.x,
						event.y,
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
					// The two-note drop, and a short duck: a denied ultimate is the
					// fight's biggest anticlimax, and the music sits under it.
					this.playAt("deny", event.x, event.y);
					sound.duck(DUCK_DENY_MS);
				},
				onKill: (event) => {
					// The frag, for the feed. Names and the killer's kit are
					// resolved here, so the DOM overlay never reaches into a roster
					// or an info map. Effects only, like a deny: the score already
					// travelled in the snapshot.
					const killerId = event.killerId;
					if (killerId === this.online?.manager.myId) {
						// Your own frag earns one clear confirmation; other people's
						// kills carry their own hit sounds and need no more.
						sound.play("kill");
					}
					EventBus.emit(HUD_EVENTS.kill, {
						killerId,
						killer:
							killerId === null
								? "the arena"
								: (this.online?.nameOf(killerId) ?? killerId),
						victimId: event.victimId,
						victim: this.online?.nameOf(event.victimId) ?? event.victimId,
						cause: event.cause,
						hero:
							killerId === null
								? null
								: (this.online?.heroOf(killerId) ?? null),
						mine:
							killerId === this.online?.manager.myId ||
							event.victimId === this.online?.manager.myId,
					});
				},
				onExplosion: (event) => {
					// The blast, and nothing else: the damage already travelled in
					// the state. The training room counts it, because an HE blast is
					// a first-class outcome there.
					this.items.explode(event.x, event.y, event.radius);
					this.training?.recordExplosion();
					this.playAt("explosion", event.x, event.y);
				},
				onRooted: (event) => {
					// The caption and the burst, and nothing else: the root already
					// travelled in the victim's state. The burst is the trap going
					// off — it is single-use, and the server has already removed it
					// from the world. Pure presentation, exactly like a deny.
					this.rootedFx.rooted(event.x, event.y);
					this.items.trapBurst(event.x, event.y);
					this.training?.recordRooted();
					this.playAt("root", event.x, event.y);
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
						// The caster's hero: the portrait card draws the caster's
						// own sheet, not a hue-shifted stranger.
						hero: this.online?.heroOf(casterId) ?? this.hero,
						mine: casterId === this.online?.manager.myId,
						durationMs: this.online?.cinematic?.totalMs ?? 0,
					});
					// The bots' ultimate is measured through this same event: the local
					// brain's cast is the one the diagnostic can watch, and it fires
					// here on the snapshot that announced the cinematic.
					if (casterId === this.online?.manager.myId) {
						this.diagnostics.recordUltimateCast();
					}
					// The boom and the song's bow out: the cinematic freeze is a
					// held moment, and the music ducks under it exactly as long.
					sound.play("ult-cast");
					sound.duck(this.online?.cinematic?.totalMs ?? DUCK_ULTIMATE_MIN_MS);
					console.log(
						`[ULT] ${this.online?.nameOf(casterId) ?? casterId} casts`,
					);
				},
				onSingularityOpened: (field) => {
					this.blackHole.detonate(field.x, field.y, field.ownerTeam);
					this.playAt("hole-open", field.x, field.y);
					// An announced discontinuity, like a melee hit: the server has just
					// started yanking fighters toward a point no client could have
					// predicted, and the first frame of that is tens of pixels. Counting
					// it as jitter would report a working ultimate as broken physics.
					this.diagnostics.markTeleport(TELEPORT_GRACE_FRAMES);
				},
				onBlossomOpened: (field) => {
					// The storm's one-shot: the shockwave and the shake that announce
					// the freeze's payload. The damage and the ring are full state and
					// arrive with every snapshot; this is only the loud first beat.
					this.blossomFx.open(field.x, field.y, field.ownerTeam);
					this.playAt("blossom", field.x, field.y);
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
					// The judgment sting: won, lost, drawn — the music already
					// knows which side this seat is on.
					const myTeam = this.online?.myTeam ?? null;
					const judgment =
						msg.team === null
							? "draw"
							: msg.team === myTeam
								? "round-win"
								: "round-lose";
					sound.play(judgment);
					console.log(`[ROUND] ${msg.round}: ${who} (${msg.scores.join("-")})`);
				},
				onRoundLive: (msg) => {
					// The one moment everybody has to see together. The countdown that
					// led to it is in the snapshot and drawn from there; this is the
					// server saying "now", so no two screens can start on different
					// frames because their clocks drifted.
					EventBus.emit(HUD_EVENTS.status, "FIGHT!");
					sound.play("fight");
					console.log(`[ROUND] ${msg.round} live`);
				},
				onMatchOver: (msg) => {
					console.log(
						`[MATCH] over by ${msg.reason}, winner ${msg.winnerId ?? "nobody"}`,
					);
					EventBus.emit("match-over", msg);
					// The final verdict: a fanfare, and the music sits under it —
					// the ceremony (card, reel, podium) owns this half-minute.
					sound.play("match-over");
					sound.duck(DUCK_MATCH_OVER_MS);
					// The victory card's payload, filled in when it arrives — the
					// announcement beats `match-over` onto the wire, so the window is
					// scheduled here and the card is drawn from the freshest standings.
					this.victoryMsg = msg;
					this.scheduleVictoryWindow();
				},
				onPotg: (msg) => {
					// The sting that says a play of the game exists — before the
					// reel itself has proved either.
					sound.play("potg-announce");
					// Parked until the victory window has closed: the ceremony must not
					// cut the card (or the breathing) short. If the window is already
					// over — a client that joined after the match ended — it begins
					// immediately, exactly as it always did.
					this.pendingPotg = msg;
					this.scheduleVictoryWindow();
					if (this.victoryWindowOver) this.beginPendingPotg();
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
			// The hero is a per-client choice: it rides the join like the name.
			hero: this.hero,
			...(this.botHero === null ? {} : { botHero: this.botHero }),
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
			this.localBrain = new EnemyBrain(fightConfig(), this.arena, this.hero);
			console.log("[AI-ONLINE] AI brain created for local player");
		}
	}

	/** A fighter appeared in a snapshot. Give it something to be drawn with. */
	private addRemoteFighter(id: string) {
		if (this.remotes.has(id)) return;
		const state = this.online?.remotes.get(id)?.state;
		// The snapshot that announced the fighter also named its hero — spawn
		// with that, never with the local fighter's. A remote born as the host's
		// hero rendered with the wrong sheet *and* the wrong punch scale until
		// the next snapshot corrected it, and one of the two (the fx latch)
		// never corrected at all.
		const hero = this.online?.heroOf(id) ?? this.hero;
		const entity = this.spawnFighter(
			id,
			false,
			state?.x ?? START_ENEMY_X,
			state?.y ?? START_ENEMY_Y,
			state?.facing ?? -1,
			hero,
		);
		this.remotes.set(id, entity);
		console.log(`[ONLINE] fighter joined: ${this.online?.nameOf(id) ?? id}`);
	}

	private startOfflineAi() {
		this.localBrain = new EnemyBrain(fightConfig(), this.arena, this.hero);
		this.remoteBrain = new EnemyBrain(
			fightConfig(),
			this.arena,
			this.foeHero(),
		);
		console.log("=== AI VS AI MODE ENABLED ===");
	}

	/** Torn down on destroy, like the name listener. */
	private potgSkipUnsubscribe: (() => void) | undefined;

	/**
	 * Let the player out of the ceremony.
	 *
	 * The overlay asks; the game decides — the same shape every other overlay
	 * follows. Skipping ends the replay immediately rather than fast-forwarding
	 * it: somebody who skips wants the scoreboard, not the same footage sooner.
	 */
	private installPotgSkip() {
		this.potgSkipUnsubscribe = EventBus.on("potg-skip", (() => {
			this.potgAnnounce = null;
			if (this.potgReplay) this.endPlayOfTheGame();
			else EventBus.emit("potg-end", null);
		}) as never);
	}

	private installDebugHooks() {
		this.installPotgSkip();
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
			// The item's charges, for the controls probe to read a binding off.
			itemCharges: this.online?.localItemCharges ?? 0,
			itemMaxCharges: kitFor(this.hero).item.maxCharges,
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
		// a clock, and `scripts/deathmatch-probe.ts` reads exactly this.
		window.__matchState = () => {
			const status = this.online?.matchStatus;
			const standings = this.online?.standings() ?? [];
			const winnerId = status?.winnerId ?? null;
			return {
				// The mode and the round scoreboard, for `scripts/tdm-probe.ts`.
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
		// `scripts/ultimate-probe.ts` reads exactly this.
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
		// Play of the Game is invisible to every other probe, and in a way that
		// would not fail anything: the deathmatch probe stops reading the moment
		// the match ends, which is the frame this begins. `scripts/potg-probe.ts`
		// reads exactly this — including `track`, because the pre-roll's entire job
		// is to move a camera nothing else in the game measures.
		window.__potgState = () => {
			const clip = this.potgReplay?.clip ?? null;
			const shot = this.potgSample?.shot ?? null;
			return {
				announced: this.potgAnnounce,
				active: this.replaying,
				phase: shot?.phase ?? null,
				clipMs: shot?.clipMs ?? 0,
				rate: shot?.rate ?? 0,
				zoom: this.stage.zoom,
				letterbox: shot?.letterbox ?? 0,
				/** How much of the arena the title card is covering, 0..1. */
				curtain: shot?.curtain ?? 0,
				intro: shot?.intro ?? 0,
				clip: clip && {
					roomId: clip.roomId,
					durationMs: clip.durationMs,
					actionAtMs: clip.actionAtMs,
					frames: clip.frames.length,
					cast: clip.cast.length,
					beats: clip.beats.length,
					protagonist: clip.protagonist.name,
				},
				/** One entry per camera movement, in the order they ran. */
				track: this.potgTrack.map((t) => ({ ...t })),
				/** How many fighters the replay is drawing this frame. */
				drawn: this.potgSample?.fighters.length ?? 0,
				ghosts: this.potgGhosts.size,
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
		// simulation an angle and never touch a cursor. `scripts/aim-probe.ts`
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
		// and Playwright cannot press a physical button. `scripts/pad-probe.ts`
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
		// Room controls for probes: team switching and mid-match bot management.
		// Mirrors the Esc menu's Room panel, so a probe can drive the same path a
		// player takes without synthesising clicks.
		window.__rosterState = () => this.online?.roster ?? [];
		window.__sendTeam = (t: number) => this.online?.requestTeam(t as TeamId);
		window.__sendBotAdd = (t?: number | null) =>
			this.online?.requestBotAdd((t as TeamId | null) ?? null);
		window.__sendBotRemove = (t?: number | null) =>
			this.online?.requestBotRemove((t as TeamId | null) ?? null);
		window.__sendAdmin = (id: string, admin: boolean) =>
			this.online?.requestAdmin(id, admin);
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

		this.stepVictoryWindow();

		// Before anything reads an aim or an intent. The gamepad has no events, so
		// this is where a pad button becomes a held code, and where the handover
		// between the Contra aim and the fine stick advances by one frame.
		this.input.poll(dtMs, this.local.body.facing);

		if (this.onlineMode) this.updateOnline(dtSec);
		else this.updateOffline(dtSec);

		// The Play of the Game replay, between the live update and the presentation
		// systems. That position is the whole trick: the live update has just
		// re-pointed every entity at predicted state, this re-points them at
		// recorded state, and the systems below draw whichever one wrote last.
		const shot = this.stepReplay(dtMs);

		// Who the smoke hides, from this viewer's seat — decided before the
		// presentation systems so they only ever *read* the answer. A replay
		// draws the clip it recorded and the clip records no smoke, so a
		// replay never conceals anyone.
		this.updateSmokeOcclusion();
		// An attack lights a hidden fighter back up — same frame's occlusion,
		// so the reveal only ever touches somebody actually concealed.
		this.updateSmokeReveal(dtMs);
		// A swing, a shot, a step — the sounds ride the same edges the reveal
		// reads, in the same frame, for the same state.
		this.scrubAudioCues();

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
		this.rootedFx.update(dtMs);
		this.updateItems(dtMs);
		this.updateUltimate(dtMs);
		this.stage.update(dtMs);
		if (shot) this.applyReplayCamera(shot.shot, dtMs);
		else this.updateCamera();

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
			// A beam out of a fighter in a replay would be pointing wherever this
			// client's cursor happens to be sitting now, over footage from a minute
			// ago. Nothing about a replay is aimed.
			!this.replaying &&
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
	 * Everything the items draw: the HE grenades in flight, their blasts, and
	 * the traps on the floor.
	 *
	 * Runs on every frame including the frozen ones, like the ultimate. A
	 * replay draws the items *it recorded*, not whatever the live match is
	 * doing underneath — the same rule the black hole follows.
	 */
	private updateItems(dtMs: number) {
		const session = this.online;
		if (!session || this.potgSample) {
			// No server (`?offline=true`) or a replay running: the recorded frames
			// do not carry the item world state, so nothing is drawn — the same
			// rule the black hole's replay follows, minus the recorded field.
			this.items.syncHeGrenades([], this.itemClock);
			this.items.syncTrapCanisters([], this.itemClock);
			this.items.syncTraps([], "", null);
			this.items.syncSmokeGrenades([], this.itemClock);
			this.items.syncSmokeClouds([], "", null);
			this.items.update(dtMs);
			return;
		}

		this.items.syncHeGrenades(session.heGrenades, session.renderClock);
		this.items.syncTrapCanisters(session.trapCanisters, session.renderClock);
		this.items.syncTraps(session.traps, session.manager.myId, session.myTeam);
		this.items.syncSmokeGrenades(session.smokeGrenades, session.renderClock);
		this.items.syncSmokeClouds(
			session.smokeClouds,
			session.manager.myId,
			session.myTeam,
		);
		this.items.update(dtMs);

		// The deck's item button carries the charge count, so it is told on the
		// integer boundary — every snapshot — rather than on every frame.
		const charges = session.localItemCharges;
		if (charges !== this.lastItemCharges) {
			this.lastItemCharges = charges;
			EventBus.emit("item-charge", charges);
		}
	}

	/** Last value pushed over `item-charge`, so the deck is told only on a change. */
	private lastItemCharges = -1;

	/**
	 * Recompute which fighters this viewer must not see, because they are
	 * standing in their own side's smoke.
	 *
	 * The rule is the simulation's (`smokeHidesFrom` — the fighter must be in
	 * a cloud that belongs to *their* side, and the viewer must be hostile to
	 * them) and the answer is presentation only, written onto each fighter
	 * entity for the systems to read. The local fighter is concealed too when
	 * standing in their own smoke, so the ghost is the cue that they are
	 * invisible — you know where you are standing because you are faded, not
	 * because you are exempt.
	 *
	 * Asked against the *drawn* position: the render smoother deliberately
	 * offsets a sprite from its body, and a concealment that followed the body
	 * would leave a ghost of the fighter the enemy is not supposed to know is
	 * there.
	 */
	private updateSmokeOcclusion() {
		const session = this.online;
		for (const e of this.queries.drawnFighters) {
			e.fighter.smokeHidden = false;
		}
		if (!session || this.potgSample) return;
		const clouds = session.smokeClouds;
		if (clouds.length === 0) return;
		const myId = session.manager.myId;
		const myTeam = session.myTeam;
		for (const e of this.queries.drawnFighters) {
			const at = e.renderPos ?? e.body;
			// The local fighter's entity is keyed `"local"` while the cloud's
			// `ownerId` is the server's id for the same fighter — translate it
			// (exactly like the black hole's friendly-fire rule does), or the
			// "cloud must be your own side's" test never matches your own cloud
			// and the self-concealment ghost never fires.
			const fighterId = this.serverIdOf(e.fighter.id);
			for (const cloud of clouds) {
				if (
					smokeHidesFrom(
						cloud,
						fighterId,
						e.fighter.team,
						myId,
						myTeam,
						at.x,
						at.y,
					)
				) {
					e.fighter.smokeHidden = true;
					break;
				}
			}
		}
	}

	/** A render clock for the item effects in a replay, where there is no server. */
	private itemClock = 0;

	/** ms of attack-reveal left, per fighter id. Presentation only. */
	private smokeRevealMs = new Map<string, number>();

	// Audio cue edges: what each fighter's body was last frame, per id. A change
	// between frames is the sound. Everything here is presentation — the state
	// itself is the server's; this map is the client's memory of it.
	private cueGrounded = new Map<string, boolean>();
	private cueAirJumps = new Map<string, number>();
	private cueDashing = new Map<string, boolean>();
	private cueRolling = new Map<string, boolean>();
	private cueMelee = new Map<string, string>();
	private cuePlunging = new Map<string, boolean>();
	private cueAmmo = new Map<string, number>();
	private cueReloading = new Map<string, boolean>();
	private cueDead = new Map<string, boolean>();

	/** The last frame's melee action, per fighter id — a change is a swing starting. */
	private lastMeleeAction = new Map<string, MeleeAction>();

	/** The last frame's plunge flag, per fighter id — a lift is a dive starting. */
	private lastPlunging = new Map<string, boolean>();

	/** The last frame's magazine, per fighter id — a drop is a shot. */
	private lastAmmo = new Map<string, number>();

	/**
	 * Every item id the client has already seen, keyed `"kind:id"`. An id that
	 * was not here last frame is an item that was just thrown — and the throw
	 * is the attack item use counts as for smoke reveal.
	 */
	private itemIdsSeen = new Set<string>();

	/**
	 * Reveal a concealed fighter who just attacked, and run their reveal
	 * timers out.
	 *
	 * A fighter hidden in their own side's smoke is invisible to the enemy
	 * right up until they commit — a swing, a shot, an item use — and the
	 * commit pops them back at the ghost alpha for `SMOKE_REVEAL_MS` (still
	 * no shadow, nameplate, health bar or blade, exactly the look the
	 * always-on ghost had). The attacks are read from the same states the
	 * renderer is already reading: `meleeAction` for a swing (the chain's
	 * three links are three different names, so each link reveals alone —
	 * which is right, every link is a commit), `plunging` when the Massive's
	 * dive starts, an ammo decrease for a shot, and a fresh canister in one
	 * of the item lists for an item use.
	 *
	 * Presentation only, like the occlusion above: nothing here is written
	 * back into the simulation. The enemy's client reads the same states
	 * from the same snapshots, so its reveal for a remote fighter's swing is
	 * as long as the swing the swing's owner committed to.
	 */
	private updateSmokeReveal(dtMs: number) {
		// What was just thrown this frame, per owner's server id.
		const freshItems = new Map<string, string[]>();
		const session = this.online;
		if (session) {
			this.noteFreshItems(freshItems, "he", session.heGrenades);
			this.noteFreshItems(freshItems, "trap", session.trapCanisters);
			this.noteFreshItems(freshItems, "smoke", session.smokeGrenades);
		}

		for (const e of this.queries.drawnFighters) {
			const id = e.fighter.id;
			const attacked = this.attackedThisFrame(e, freshItems);
			const left = (this.smokeRevealMs.get(id) ?? 0) - dtMs;
			let revealed = left > 0;
			if (attacked) {
				this.smokeRevealMs.set(id, SMOKE_REVEAL_MS);
				revealed = true;
			} else if (revealed) {
				this.smokeRevealMs.set(id, left);
			} else {
				this.smokeRevealMs.delete(id);
			}
			e.fighter.smokeRevealed = Boolean(e.fighter.smokeHidden) && revealed;
		}
	}

	/**
	 * Did this fighter commit an attack since the last frame?
	 *
	 * Every branch also advances that attack's tracker, so the edge is only
	 * ever reported once. Asks nothing that is not already on this client:
	 * a dead or stunned fighter's states never move here, so none of the
	 * edges can fire for one.
	 */
	private attackedThisFrame(
		e: { fighter: { id: string }; body: PlayerPosition },
		freshItems: Map<string, string[]>,
	): boolean {
		const id = e.fighter.id;
		const body = e.body;
		let attacked = false;

		const action = body.meleeAction;
		if (action !== "none" && action !== this.lastMeleeAction.get(id)) {
			attacked = true;
		}
		this.lastMeleeAction.set(id, action);

		const plunging = body.plunging;
		if (plunging && !this.lastPlunging.get(id)) attacked = true;
		this.lastPlunging.set(id, plunging);

		const ammo = body.ammo;
		if (ammo < (this.lastAmmo.get(id) ?? ammo)) attacked = true;
		this.lastAmmo.set(id, ammo);

		if (freshItems.get(this.serverIdOf(id))?.length) attacked = true;

		return attacked;
	}

	/** Register the item entries added to `out` that the client has not seen yet. */
	private noteFreshItems(
		out: Map<string, string[]>,
		kind: string,
		items: readonly { id: number; ownerId: string }[],
	) {
		for (const item of items) {
			const key = `${kind}:${item.id}`;
			if (this.itemIdsSeen.has(key)) continue;
			this.itemIdsSeen.add(key);
			const owned = out.get(item.ownerId);
			if (owned) owned.push(key);
			else out.set(item.ownerId, [key]);
		}
	}

	// =========================================================
	//  AUDIO CUES
	// =========================================================

	/**
	 * How loud and how displaced a sound at `x,y` must be, from the local
	 * fighter's seat. 1 and 0 at your own feet; silence past `AUDIO_RANGE_PX`.
	 * A swing two screens away stays in the fight without the fight becoming a
	 * single 25Hz roar.
	 */
	private soundAt(x: number, y: number): { gain: number; pan: number } {
		const me = this.local.renderPos ?? this.local.body;
		const dx = x - me.x;
		const dy = y - me.y;
		const gain = clamp(1 - Math.hypot(dx, dy) / AUDIO_RANGE_PX, 0, 1);
		return { gain, pan: clamp(dx / AUDIO_PAN_RANGE_PX, -1, 1) };
	}

	/**
	 * Play a sound at a world position, with distance falloff and panning.
	 * Position-less sounds (UI, the FIGHT sting) go straight to the facade.
	 */
	private playAt(
		name: string,
		x: number,
		y: number,
		opts: { gain?: number } = {},
	) {
		const spot = this.soundAt(x, y);
		if (spot.gain <= 0) return;
		const gain = Math.max(0, spot.gain * (opts.gain ?? 1));
		if (gain === 0) return;
		sound.play(name, { gain, pan: spot.pan });
	}

	/**
	 * The one movement/weapon sound per fighter, when his body's state changes.
	 *
	 * The same edges the smoke reveal reads — a change in `meleeAction` is a
	 * swing starting, an ammo drop is a shot, a fresh item is a throw — plus
	 * the locomotion edges (grounded, dash, tumble, reload, a death and a
	 * life). A duel hears its own fight at full volume; a sixteen-fighter room
	 * hears only what is near the camera, because `playAt` attenuates and
	 * `sfx.ts` cooldowns per name.
	 *
	 * A replay does not make sound: the projector re-points the entities at
	 * recorded frames, and the recorded clip is the *past*. Only the live room
	 * makes noise.
	 */
	private scrubAudioCues() {
		if (this.potgSample) return;
		for (const e of this.queries.drawnFighters) {
			const id = e.fighter.id;
			const b = e.body;

			const grounded = this.cueGrounded.get(id) ?? b.grounded;
			if (grounded && !b.grounded) this.playAt("jump", b.x, b.y);
			else if (!grounded && b.grounded) this.playAt("land", b.x, b.y);
			this.cueGrounded.set(id, b.grounded);

			const jumps = this.cueAirJumps.get(id) ?? b.airJumps;
			if (jumps > b.airJumps) this.playAt("jump-air", b.x, b.y);
			this.cueAirJumps.set(id, b.airJumps);

			const dashing = this.cueDashing.get(id) ?? b.dashActiveTimer > 0;
			if (!dashing && b.dashActiveTimer > 0) this.playAt("dash", b.x, b.y);
			this.cueDashing.set(id, b.dashActiveTimer > 0);

			const rolling = this.cueRolling.get(id) ?? b.tumbleActiveTimer > 0;
			if (!rolling && b.tumbleActiveTimer > 0) this.playAt("roll", b.x, b.y);
			this.cueRolling.set(id, b.tumbleActiveTimer > 0);

			const move = b.meleeAction as string;
			if (move !== "none" && move !== this.cueMelee.get(id)) {
				this.playAt(this.swingSound(move), b.x, b.y);
			}
			this.cueMelee.set(id, move);

			if (b.plunging && !this.cuePlunging.get(id)) {
				this.playAt("massive-swing", b.x, b.y, { gain: 0.7 });
			}
			this.cuePlunging.set(id, b.plunging);

			const ammo = b.ammo;
			if (ammo < (this.cueAmmo.get(id) ?? ammo)) {
				this.playAt(this.shotSound(e.fighter.hero), b.x, b.y, { gain: 0.8 });
			}
			this.cueAmmo.set(id, ammo);

			const reloading = b.reloadTimer > 0;
			if (reloading && !this.cueReloading.get(id)) {
				this.playAt(this.reloadSound(e.fighter.hero), b.x, b.y, { gain: 0.8 });
			}
			this.cueReloading.set(id, reloading);

			const dead = e.fighter.hp <= 0;
			if (dead && !this.cueDead.get(id)) this.playAt("die", b.x, b.y);
			else if (!dead && this.cueDead.get(id)) this.playAt("spawn", b.x, b.y);
			this.cueDead.set(id, dead);
		}
	}

	/** The swing's whoosh, by move: a slash; the chain links rise; nothing else. */
	private swingSound(move: string): string {
		switch (move) {
			case "slash":
				return "swing";
			case "slash2":
				return "swing";
			case "slash3":
				return "swing";
			case "stab":
				return "swing-stab";
			case "thrust":
				return "thrust";
			case "uppercut":
			case "shoryuken":
				return "uppercut";
			case "massive":
				return "massive-swing";
			default:
				return "swing";
		}
	}

	/**
	 * The one-shot's name, by the hero's ranged weapon: the rifle barks, the
	 * machine gun chatters, the shotgun booms. See specs/heroes.md.
	 */
	private shotSound(hero: string): string {
		return hero === "jeffs" ? "shot-heavy" : "shot";
	}

	/** The reload's rack: a clip weapon reloads in one action; the shotgun
	 * pumps a shell at a time. */
	private reloadSound(hero: string): string {
		return hero === "jeffs" ? "reload-shell" : "reload";
	}

	private updateUltimate(dtMs: number) {
		// A replay draws the hole *it recorded*, not whatever the live match is
		// doing underneath — the room keeps playing during the ceremony, and a
		// black hole that opened after the final whistle would otherwise be drawn
		// on top of footage of a different one.
		const replay = this.potgSample;
		if (replay) {
			this.ultAim.update(dtMs, false, 0, 0, 0, this.arena);
			const held: PlayerPosition[] = [];
			if (replay.singularity) {
				for (const fighter of replay.fighters) {
					if (fighter.hp <= 0) continue;
					const mine = fieldFor(
						replay.singularity,
						fighter.member.id,
						fighter.member.team,
					);
					if (
						singularityGrip(mine, fighter.state.x, fighter.state.y) === "held"
					)
						held.push(fighter.state);
				}
			}
			this.blackHole.syncGrenades(replay.grenades, dtMs);
			this.blackHole.update(
				replay.singularity,
				held,
				dtMs,
				this.online?.manager.myId ?? "",
				this.online?.myTeam ?? null,
			);
			return;
		}

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
			if (readyNow) sound.play("ult-ready");
			EventBus.emit("ult-charge", charge);
		}

		// The aim phase: while the ultimate button is held and a cast is legal,
		// show where the ultimate will go. Lia's is the grenade's arc; Anands'
		// is the dragon's straight line; Jeffs' is the storm's radius — the
		// same preview rule, three geometries.
		const at = this.local.renderPos ?? this.local.body;
		const centre = bodyCentre(at.x, at.y);
		const ultKind = kitFor(this.hero).ultimate;
		const aimMode: "arc" | "beam" | "radial" =
			ultKind === "dragon-thrust"
				? "beam"
				: ultKind === "death-blossom"
					? "radial"
					: "arc";
		this.ultAim.update(
			dtMs,
			this.ultAimVisible(),
			centre.x,
			centre.y,
			this.aimAngle,
			this.arena,
			aimMode,
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
		this.blackHole.update(
			field,
			victims,
			dtMs,
			session.manager.myId,
			session.myTeam,
		);

		// The storm: a spinning field of gunfire around whoever is channelling.
		// The field is the *area* — the caster's own spin is already on their
		// sprite, drawn by the animation system from `blossomTimer`.
		this.blossomFx.update(session.blossom, dtMs);

		// The dragon: a serpent behind whoever is riding. The rider's drawn
		// position is what the trail chases — the same smoothing rule as the
		// nameplates and the shadows. Anands' ride is her own art now (see
		// `HERO_CLIPS` in ecs/systems.ts), so the generated serpent has no
		// rider left.
		let rider: { x: number; y: number; vx: number; vy: number } | null = null;
		for (const e of this.queries.fighters) {
			if (e.body.dragonTimer <= 0 || e.fighter.hero === "anands") continue;
			const pos = e.renderPos ?? e.body;
			rider = {
				x: pos.x + PLAYER_WIDTH / 2,
				y: pos.y + PLAYER_HEIGHT / 2,
				vx: e.body.dragonVX,
				vy: e.body.dragonVY,
			};
			break;
		}
		this.dragonFx.update(rider, dtMs);
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
		// Lia's cast is refused while a hole is open — one black hole per room.
		// Anands' is not: the hole is the *counter* to the dragon, and a dragon
		// thrown into one is a dragon about to be caught, which is a real
		// decision the aim has to be able to show. The blossom is refused while
		// a storm is open, exactly like the hole — two storms would argue
		// about whose radius a fighter inside both is being shredded by.
		if (kitFor(this.hero).ultimate === "black-hole") {
			if (session.singularity) return false;
			if (session.grenades.length > 0) return false;
		}
		if (kitFor(this.hero).ultimate === "death-blossom") {
			if (session.blossom) return false;
		}
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
	 * their own hole. Found by `scripts/ultimate-probe.ts`, which reported the
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

	// =========================================================
	//  PLAY OF THE GAME
	// =========================================================
	//
	// The ceremony that runs between the final frag and the podium: a pre-roll of
	// camera work over the moment the server picked, then the footage itself.
	//
	// **The replay is a projector bolted onto the live match, not a second
	// renderer.** Everything below re-points the entities that are already on
	// screen at recorded state and hands the camera to `PotgDirector`; the
	// animation, sprite-sync, nameplate, shadow and sword-effect systems then run
	// exactly as they do in a fight, which is why a replay shows guard sparks and
	// swing trails without a line of code that knows about replays. Nothing here
	// touches the netcode: the session keeps predicting, reconciling and sending
	// input underneath, and the next live frame re-points every body back at it.

	/** The running replay, or undefined outside the ceremony. */
	private potgReplay: PotgReplay | undefined;
	/** What the server announced, kept for the overlay and the probe. */
	private potgAnnounce: PotgAnnounce | null = null;
	/**
	 * The victory card's timing, driven off `elapsed` rather than timers so the
	 * ceremony stays in step with the loop that draws it.
	 *
	 * The match ends, the arena is left alone for `VICTORY_BREATHING_MS`, the
	 * victory card slams in for `VICTORY_HOLD_MS`, and only then may the Play of
	 * the Game begin — the cut from the last frag straight to a full-screen
	 * ceremony was the abruptness the breathing exists to fix. The announce
	 * travels in the same breath as `match-over`, so it is parked in
	 * `pendingPotg` until the window has closed.
	 */
	private victoryMsg: MatchOverMsg | null = null;
	private victoryShowAt: number | null = null;
	private victoryDoneAt: number | null = null;
	private victoryWindowOver = false;
	private pendingPotg: PotgAnnounce | null = null;
	/** The sample drawn this frame, so the camera and the ultimate FX agree on it. */
	private potgSample: ReplaySample | null = null;
	/**
	 * Entities for cast members who are no longer in the room.
	 *
	 * A fighter can leave between the play and the ceremony, and a replay missing
	 * the person who was killed in it is not a replay of that play. Keyed under a
	 * `potg:` prefix so a ghost's effects, nameplate and shadow can never collide
	 * with a live fighter's.
	 */
	private readonly potgGhosts = new Map<string, FighterEntity>();
	/** Live fighters hidden for the duration, because the clip does not contain them. */
	private readonly potgHidden = new Set<string>();
	/** The replay's own projectile layer, so live bullets can be hidden wholesale. */
	private potgProjectiles: Container | undefined;
	private potgBulletPool: SpritePool | undefined;
	/**
	 * Where the camera went, sampled per phase, for `scripts/potg-probe.ts`.
	 *
	 * The pre-roll's entire job is to move the camera, and nothing else in the
	 * game can see that it did: no metric reads zoom, and a cinematic that
	 * silently degraded into a static shot would still pass every other probe.
	 */
	private readonly potgTrack: PotgTrackEntry[] = [];

	/**
	 * Open the victory window: breathing room first, then the card, then the
	 * ceremony. Idempotent — the first caller (whichever of `match-over` and
	 * the announcement lands first) sets the schedule, and the other fills in
	 * the payload.
	 */
	private scheduleVictoryWindow() {
		if (this.victoryShowAt !== null || this.victoryWindowOver) return;
		const now = this.elapsed;
		this.victoryShowAt = now + VICTORY_BREATHING_MS;
		this.victoryDoneAt = now + VICTORY_BREATHING_MS + VICTORY_HOLD_MS;
	}

	/**
	 * Advance the victory window on the game loop's own clock.
	 *
	 * Driven off `elapsed` rather than `setTimeout` for the same reason the
	 * director is driven off a delta: the ceremony is a sequence of moments,
	 * and the loop that draws them should be the one that decides when they
	 * happen. A tab that stalls the loop stalls the card with it, which is
	 * exactly what a timer-based version would not do.
	 */
	private stepVictoryWindow() {
		if (this.victoryShowAt !== null && this.elapsed >= this.victoryShowAt) {
			this.victoryShowAt = null;
			EventBus.emit("victory-show", {
				over: this.victoryMsg,
				myId: this.online?.manager.myId ?? "",
				myTeam: this.local.fighter.team,
			});
		}
		if (this.victoryDoneAt !== null && this.elapsed >= this.victoryDoneAt) {
			this.victoryDoneAt = null;
			this.victoryWindowOver = true;
			// The card takes itself down and — in the same frame, so React sees
			// one transition — the ceremony begins. If no announcement ever came,
			// the podium takes the screen instead.
			EventBus.emit("victory-done", null);
			this.beginPendingPotg();
		}
	}

	/** Start the ceremony if an announcement is waiting for the window to close. */
	private beginPendingPotg() {
		if (!this.pendingPotg) return;
		const msg = this.pendingPotg;
		this.pendingPotg = null;
		this.beginPlayOfTheGame(msg);
	}

	/**
	 * The server picked a play. Put the card up, then go and get the footage.
	 *
	 * The card is up *before* the fetch resolves, deliberately: the announcement
	 * is a datagram that has already arrived and the clip is a few hundred
	 * kilobytes over HTTP. A ceremony that waited for the footage would show
	 * nothing at all on a slow link, and nothing is exactly what a lost fetch
	 * would leave behind.
	 */
	private beginPlayOfTheGame(msg: PotgAnnounce) {
		this.potgAnnounce = msg;
		this.potgTrack.length = 0;
		EventBus.emit("potg-begin", msg);
		console.log(
			`[POTG] ${msg.protagonistName}: ${msg.headline} (${msg.score})`,
		);
		if (!msg.hasClip) {
			// Scored, but the footage did not survive — a play in the opening seconds
			// of a match has almost no lead-in to cut from. The card stands on its
			// own and takes itself down.
			EventBus.emit("potg-cardonly", msg);
			return;
		}
		void this.loadPlayOfTheGame(msg);
	}

	private async loadPlayOfTheGame(msg: PotgAnnounce) {
		const clip = await fetchPotgClip(msg.roomId);
		// The match may have restarted, or the player skipped, while this was in
		// flight. Both clear the announcement, and starting a replay against a
		// match that has moved on is how a cutscene ends up over a live fight.
		if (!clip || this.potgAnnounce !== msg) {
			if (this.potgAnnounce === msg) EventBus.emit("potg-cardonly", msg);
			return;
		}
		this.potgReplay = new PotgReplay(clip);
		this.potgSample = null;
		this.potgHidden.clear();
		this.ensurePotgLayers();
		// The reel's own theme: the announcement already stung; now the reel
		// really starts, and the music clears the floor for it.
		sound.play("potg");
		sound.duck(DUCK_POTG_MS);
		// The live projectiles belong to a match that is still running underneath
		// this. Hidden as a layer rather than released one by one: the session owns
		// that pool and will keep filling it.
		this.stage.projectiles.visible = false;
		EventBus.emit("potg-start", {
			roomId: clip.roomId,
			durationMs: clip.durationMs,
			frames: clip.frames.length,
		});
	}

	private ensurePotgLayers() {
		if (this.potgProjectiles) return;
		const layer = new Container();
		// Directly above the live projectile layer, so replayed bullets sit in the
		// same place in the draw order the real ones do — in front of the fighters,
		// behind the effects and the nameplates.
		const at = this.stage.shake.getChildIndex(this.stage.projectiles) + 1;
		this.stage.shake.addChildAt(layer, at);
		this.potgProjectiles = layer;
		this.potgBulletPool = new SpritePool(layer, tex(TEX.fireball));
	}

	/**
	 * Advance the replay and re-point every entity at recorded state.
	 *
	 * Called *after* the live update, which has just re-pointed the same entities
	 * at predicted state — so this is the last writer and wins for the frame, and
	 * the moment it stops running the live bindings are back with no restore step
	 * to forget.
	 */
	private stepReplay(dtMs: number): ReplaySample | null {
		const replay = this.potgReplay;
		if (!replay) return null;

		const sample = replay.step(dtMs);
		if (!sample) {
			this.endPlayOfTheGame();
			return null;
		}
		this.potgSample = sample;

		const present = new Set<string>();
		for (const fighter of sample.fighters) {
			const entity = this.replayActor(fighter.member);
			present.add(fighter.member.id);
			entity.body = fighter.state;
			// Pointed at the body rather than cleared: the render smoother's offset
			// belongs to a prediction that is not happening, and `renderPos` is not
			// optional-assignable under `exactOptionalPropertyTypes`.
			entity.renderPos = { x: fighter.state.x, y: fighter.state.y };
			entity.fighter.hp = fighter.hp;
			entity.fighter.name = fighter.member.name;
			entity.fighter.team = fighter.member.team;
			entity.sprite.visible = true;
		}
		this.hideAbsentFighters(present);

		this.syncReplayBullets(sample);
		EventBus.emit("potg-shot", sample.shot);
		return sample;
	}

	/** The entity that draws one cast member, conjuring a ghost if it must. */
	private replayActor(member: PotgCastMember): FighterEntity {
		if (member.id === this.online?.manager.myId) return this.local;
		const live = this.remotes.get(member.id);
		if (live) return live;
		const known = this.potgGhosts.get(member.id);
		if (known) return known;
		const ghost = this.spawnFighter(`potg:${member.id}`, false, 0, 0, 1);
		this.potgGhosts.set(member.id, ghost);
		return ghost;
	}

	/**
	 * Take fighters the clip does not contain off the screen.
	 *
	 * Somebody who joined after the play was cut is still in the room and still
	 * being predicted, and leaving them standing in the replay would put a fighter
	 * in the footage who was demonstrably not there. Their plate and shadow are
	 * forgotten as well as their sprite hidden — a nameplate floating over an
	 * invisible fighter is worse than the fighter.
	 */
	private hideAbsentFighters(present: ReadonlySet<string>) {
		for (const [id, entity] of this.remotes) {
			if (present.has(id) || this.potgHidden.has(id)) continue;
			this.potgHidden.add(id);
			entity.sprite.visible = false;
			this.plates.forget(entity.fighter.id);
			this.shadows.forget(entity.fighter.id);
		}
		const myId = this.online?.manager.myId ?? "";
		if (!present.has(myId) && !this.potgHidden.has(myId)) {
			this.potgHidden.add(myId);
			this.local.sprite.visible = false;
			this.plates.forget(this.local.fighter.id);
			this.shadows.forget(this.local.fighter.id);
		}
	}

	private syncReplayBullets(sample: ReplaySample) {
		const pool = this.potgBulletPool;
		if (!pool) return;
		const sprites = pool.take(sample.bullets.length);
		sample.bullets.forEach((b, i) => {
			sprites[i]?.position.set(b.x, b.y);
		});
	}

	/**
	 * Summarise each camera movement as it runs, for `scripts/potg-probe.ts`.
	 *
	 * Ranges rather than a final sample, and that is the whole value of it: a whip
	 * pan *ends* back on its subject, so the last position of the movement says
	 * nothing about whether it swung. `travel` is the furthest the camera got from
	 * where the movement started, which is the only number that can tell a pan
	 * from a static shot.
	 */
	private trackReplayCamera(shot: PotgShot, dtMs: number) {
		const x = this.stage.cameraX;
		const y = this.stage.cameraY;
		const zoom = this.stage.zoom;
		const last = this.potgTrack[this.potgTrack.length - 1];
		if (!last || last.phase !== shot.phase) {
			this.potgTrack.push({
				phase: shot.phase,
				ms: dtMs,
				x0: x,
				y0: y,
				x,
				y,
				travel: 0,
				minZoom: zoom,
				maxZoom: zoom,
				minRate: shot.rate,
				maxRate: shot.rate,
				shakes: shot.shake > 0 ? 1 : 0,
			});
			return;
		}
		last.ms += dtMs;
		last.x = x;
		last.y = y;
		last.travel = Math.max(last.travel, Math.hypot(x - last.x0, y - last.y0));
		last.minZoom = Math.min(last.minZoom, zoom);
		last.maxZoom = Math.max(last.maxZoom, zoom);
		last.minRate = Math.min(last.minRate, shot.rate);
		last.maxRate = Math.max(last.maxRate, shot.rate);
		if (shot.shake > 0) last.shakes++;
	}

	/**
	 * The replay's camera: the director's focus, clamped to the arena at whatever
	 * zoom it asked for.
	 *
	 * The clamp is the only thing this adds, and it is not optional: the director
	 * frames a fighter, and a fighter standing at the left wall would otherwise be
	 * centred by scrolling the camera off the end of the world and drawing a
	 * screen half full of nothing. Wider zooms clamp harder, because the visible
	 * world is `view / zoom`.
	 */
	private applyReplayCamera(shot: PotgShot, dtMs: number) {
		// **Never wider than the world.** The director asks for an establishing shot
		// at 0.82, which on an arena exactly one viewport tall would draw a 656x492
		// world inside an 800x600 canvas and frame the ceremony with a border of
		// void. The floor is the zoom at which the arena still fills the view, so a
		// wide shot is as wide as the level allows and no wider — and on a level
		// that is ever bigger than a screen, the director gets what it asked for.
		const zoom = Math.max(
			shot.zoom,
			this.view.width / this.arena.right,
			this.view.height / this.arena.bottom,
		);
		const halfW = this.view.width / (2 * zoom);
		const halfH = this.view.height / (2 * zoom);
		// **The letterbox bars are allowed to hang off the world.** They are opaque
		// and they cover 8% of the frame each — which, on an arena exactly one
		// viewport tall, is the floor everybody is standing on and the sky above
		// them. Letting the camera pan that far past the top and bottom puts the
		// floor line exactly on the bottom bar's edge instead of behind it, and
		// nothing is revealed because the bar is what is drawn there.
		const margin = (this.view.height * POTG_BAR_FRACTION) / zoom;
		const maxX = Math.max(0, this.arena.right - halfW * 2);
		const maxY = Math.max(-margin, this.arena.bottom - halfH * 2 + margin);
		const centreX = shot.focusX + PLAYER_WIDTH / 2;
		const centreY = shot.focusY + PLAYER_HEIGHT / 2;
		this.stage.setCamera(
			clamp(centreX - halfW, 0, maxX),
			clamp(centreY - halfH, -margin, maxY),
			zoom,
		);
		if (shot.shake > 0) this.stage.startShake(POTG_SHAKE_MS, shot.shake);
		// Recorded here rather than where the shot was produced, because what the
		// probe has to be able to prove is where the camera actually *went* — the
		// clamp above is entirely capable of turning a 400px pan into no pan at all
		// at the edge of a one-screen arena.
		this.trackReplayCamera(shot, dtMs);
	}

	/** Hand the camera and the entities back to the live match. */
	private endPlayOfTheGame() {
		this.potgReplay = undefined;
		this.potgSample = null;
		this.potgAnnounce = null;
		for (const ghost of this.potgGhosts.values()) {
			this.plates.forget(ghost.fighter.id);
			this.shadows.forget(ghost.fighter.id);
			this.fx.forget(ghost.fighter.id);
			ghost.sprite.destroy();
			this.world.remove(ghost);
		}
		this.potgGhosts.clear();
		for (const id of this.potgHidden) {
			const entity =
				id === this.online?.manager.myId ? this.local : this.remotes.get(id);
			if (entity) entity.sprite.visible = true;
		}
		this.potgHidden.clear();
		this.potgBulletPool?.releaseAll();
		this.stage.projectiles.visible = true;
		// Back to a one-to-one camera before the next frame's follow camera runs,
		// so a live match can never inherit a cinematic's zoom.
		this.stage.setCamera(this.stage.cameraX, this.stage.cameraY, 1);
		EventBus.emit("potg-end", null);
	}

	/** True while the ceremony owns the screen. */
	private get replaying(): boolean {
		return this.potgReplay !== undefined;
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
			// The primary remote's id, so the melee tracker knows when its
			// "remote" subject has changed — comparing fighter A's swing to
			// fighter B's idle is how a switch reads as a broken state machine.
			enemyId: this.online?.primaryRemoteId ?? null,
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
		foeHero: HeroId,
		selfHP: number,
		enemyHP: number,
	): AIInput {
		const dx = foe.x - self.x;
		const dy = foe.y - self.y;

		const allies: AllyInfo[] = [];
		const foes: FoeInfo[] = [];
		let selfTeam: TeamId | null = null;
		let selfUltCharge = 0;
		let selfItemCharges = 0;
		let enemyConcealed = false;
		const fields: { x: number; y: number; hostile: boolean }[] = [];
		const traps: { x: number; y: number }[] = [];
		let selfId = "local";
		const enemyGrounded = foe.grounded;

		const session = this.online;
		if (session?.connected) {
			const myId = session.manager.myId;
			selfId = myId;
			selfTeam = session.myTeam;
			selfUltCharge = session.localUlt;
			selfItemCharges = session.localItemCharges;
			for (const [id, fighter] of session.remotes) {
				const d = Math.hypot(
					fighter.state.x - self.x,
					fighter.state.y - self.y,
				);
				const team = session.teamOf(id);
				if (hostile(selfTeam, team)) {
					if (session.aliveOf(id)) {
						// Same concealment rule the renderer's fade uses, answered for
						// *this* bot's view: a fighter hidden in its own side's smoke
						// is invisible, and invisible enemies are not shoot at.
						const concealed = session.smokeClouds.some((c) =>
							smokeHidesFrom(
								c,
								id,
								team,
								session.manager.myId,
								selfTeam,
								fighter.state.x,
								fighter.state.y,
							),
						);
						foes.push({
							id,
							x: fighter.state.x,
							y: fighter.state.y,
							hp: session.hpOf(id),
							distance: d,
							concealed,
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
						hero: session.heroOf(id) ?? "lia",
					});
				}
			}
			// The row for the fighter the brain was handed as "the enemy" — the
			// same `state` object the session's `nearestFoe` returned, so identity
			// is exact even when two remotes are equidistant.
			enemyConcealed =
				foes.find((f) => session.remotes.get(f.id)?.state === foe)?.concealed ??
				false;
			const field = session.singularity;
			if (field) {
				fields.push({
					x: field.x,
					y: field.y,
					hostile: fieldAffects(field, myId, selfTeam),
				});
			}
			for (const trap of session.traps) {
				if (trap.ownerId === myId) continue;
				if (!hostile(trap.ownerTeam, selfTeam)) continue;
				traps.push({ x: trap.x, y: trap.y });
			}
		} else if (this.offlineFoe) {
			foes.push({
				id: OFFLINE_FOE_ID,
				x: foe.x,
				y: foe.y,
				hp: enemyHP,
				distance: Math.hypot(dx, dy),
				concealed: false,
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
			hasLineOfSight:
				!enemyConcealed &&
				hasLineOfSight(self.x, self.y, foe.x, foe.y, 24, this.arena),
			selfHP,
			enemyHP,
			enemyAction: foe.meleeAction,
			enemyPhase: meleePhase(foe),
			enemyBlocking: foe.blocking,
			enemyStunned: foe.stunTimer > 0,
			enemyPlunging: foe.plunging,
			enemyStuck: foe.plungeStuckTimer > 0,
			selfAction: self.meleeAction,
			selfStunned: self.stunTimer > 0,
			selfPlunging: self.plunging,
			selfStuck: self.plungeStuckTimer > 0,
			selfMassiveReady: self.massiveReady,
			selfCharging: self.chargeTimer > 0 || self.massiveReady,
			selfId,
			selfHero: this.hero,
			enemyHero: foeHero,
			enemyConcealed,
			enemyGrounded,
			selfAirJumps: self.airJumps,
			selfUltCharge,
			enemyVX: foe.vx,
			enemyVY: foe.vy,
			selfTeam,
			roundNumber: session?.matchStatus?.teams?.round ?? 1,
			allies,
			foes,
			fields,
			traps,
			selfItemCharges,
			// The magazine and the reserve, from the same body the HUD reads:
			// wire-updated online, mirrored onto the body offline. A brain that
			// does not know the gun is dry keeps pressing a trigger nothing
			// answers.
			selfAmmo: self.ammo,
			selfReserveRounds: self.reserveRounds,
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
						foe.state,
						foe.hero,
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
			// double-taps and nothing happened, which read as a cooldown far
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
			// Same argument, one field over: the hero chooses the strip and the
			// poses, and it arrives on the snapshot like everything else. A hero
			// change swaps the sheet on the next snapshot.
			const hero = session.heroOf(id);
			if (hero !== entity.fighter.hero) {
				entity.fighter.hero = hero;
				// The remote's own sheet, resolved through the animation
				// system's clip table — the idle frame is the hero's own.
				const idleTex = idleTexture(hero, entity.body.facing);
				if (idleTex) entity.sprite.texture = idleTex;
				entity.sprite.scale.set(sheetScale(HEROES[hero].sheet));
				entity.anim = { clip: "right-idle", frame: 0, elapsedMs: 0 };
			}
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
				this.local.body = tickPlayer(
					this.local.body,
					intent,
					dt,
					this.arena,
					null,
					kitFor(this.hero),
				);
			}
			if (foe.fighter.hp > 0) {
				foe.body = tickPlayer(
					foe.body,
					this.remoteIntent,
					dt,
					this.arena,
					null,
					kitFor(this.foeHero()),
				);
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
					this.foeHero(),
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
					this.hero,
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

	/**
	 * The offline foe's hero: the mirror of the local fighter's, so the escape
	 * hatch always pairs two different kits without needing a server. Jeffs'
	 * mirror is the dagger — a blade against the dagger, a shotgun against
	 * the stream.
	 */
	private foeHero(): HeroId {
		const mirror: Record<HeroId, HeroId> = {
			lia: "anands",
			anands: "lia",
			jeffs: "anands",
		};
		return mirror[this.hero];
	}

	private handleOfflineAttacks(foe: FighterEntity) {
		const now = this.elapsed;
		const localKit = kitFor(this.hero);
		const foeKit = kitFor(this.foeHero());

		// A fighter holds a melee weapon or a ranged one, never both. The rate
		// and the round are the hero's weapon's, exactly as the server decides
		// them — a shotgun fans its pellets here the same way the server fans
		// them, so the escape hatch never becomes a second set of combat rules.
		// The magazine is the same contract: a shot spends one round, and the
		// auto-reload below refills it.
		if (
			this.local.body.stance === "gun" &&
			this.localIntent.attack &&
			this.localAmmo > 0 &&
			canFire(this.localAttackAt, now, localKit.ranged.cooldownMs)
		) {
			this.localAttackAt = now;
			this.localAmmo--;
			const c = bodyCentre(this.local.body.x, this.local.body.y);
			this.bullets.fireFan(c.x, c.y, this.aimAngle, "player", localKit.ranged);
			EventBus.emit("bullet-fired");
		}

		if (
			foe.fighter.hp > 0 &&
			foe.body.stance === "gun" &&
			this.remoteIntent.attack &&
			this.remoteAmmo > 0 &&
			canFire(this.remoteAttackAt, now, foeKit.ranged.cooldownMs)
		) {
			this.remoteAttackAt = now;
			this.remoteAmmo--;
			const c = bodyCentre(foe.body.x, foe.body.y);
			this.bullets.fireFan(
				c.x,
				c.y,
				this.remoteBrainAim,
				"enemy",
				foeKit.ranged,
			);
			EventBus.emit("bullet-fired");
		}

		// The offline reload, mirrored from the server's: the same shared
		// `tickReload` against the same intents, so the escape hatch's guns
		// obey the same magazine as the online ones. The same gates the server
		// applies before calling it apply here too — a dead, frozen or stunned
		// fighter reloads nothing — so the offline magazine never becomes a
		// second set of reload rules.
		this.tickOfflineReload(
			this.localAmmo,
			(ammo) => (this.localAmmo = ammo),
			this.localReserve,
			(reserve) => (this.localReserve = reserve),
			this.localReload,
			(t) => (this.localReload = t),
			this.localIntent.attack,
			localKit,
			now,
			this.local.fighter.hp,
			this.local.body,
		);
		this.tickOfflineReload(
			this.remoteAmmo,
			(ammo) => (this.remoteAmmo = ammo),
			this.remoteReserve,
			(reserve) => (this.remoteReserve = reserve),
			this.remoteReload,
			(t) => (this.remoteReload = t),
			this.remoteIntent.attack,
			foeKit,
			now,
			foe.fighter.hp,
			foe.body,
		);

		this.resolveOfflineMelee(foe);
		this.bullets.resolve(this.bulletTargets(foe));

		// Mirror the escape hatch's magazines onto the bodies, so the
		// animation system's firing detection (an ammo drop) works offline
		// exactly as it does online. The sim never touches `ammo` — the wire
		// and the offline counters are its only writers.
		this.local.body.ammo = this.localAmmo;
		this.local.body.reserveRounds = this.localReserve;
		this.local.body.reloadTimer = this.localReload;
		foe.body.ammo = this.remoteAmmo;
		foe.body.reserveRounds = this.remoteReserve;
		foe.body.reloadTimer = this.remoteReload;
	}

	private localAttackAt = 0;
	private remoteAttackAt = 0;
	private remoteBrainAim = 0;
	/** The escape hatch's own magazines, mirrored from the server's model. */
	private localAmmo = 0;
	private remoteAmmo = 0;
	/** And the reserve behind them — the rest of the life's magazines. */
	private localReserve = 0;
	private remoteReserve = 0;
	private localReload = 0;
	private remoteReload = 0;

	/**
	 * Drive the offline reload for one fighter: a small mutable wrapper around
	 * the shared `tickReload`, since the offline path has no `PlayerPosition`
	 * to mutate in place.
	 *
	 * Gates exactly like the server's own wrapper: a dead, frozen or stunned
	 * fighter reloads nothing and drops any reload in progress.
	 */
	private tickOfflineReload(
		ammo: number,
		setAmmo: (n: number) => void,
		reserve: number,
		setReserve: (n: number) => void,
		reload: number,
		setReload: (t: number) => void,
		attack: boolean,
		kit: HeroKit,
		now: number,
		hp: number,
		body: PlayerPosition,
	) {
		if (hp <= 0 || isFrozen(body) || isStunned(body) || isKnockedDown(body)) {
			setReload(0);
			return;
		}
		const state = {
			ammo,
			reserveRounds: reserve,
			reloadTimer: reload,
			stance: body.stance,
		};
		const dt = Math.min(
			MAX_RELOAD_STEP_SECONDS,
			(now - this.offlineReloadLastAt) / MILLIS_PER_SECOND,
		);
		this.offlineReloadLastAt = now;
		tickReload(state, { attack }, kit, dt);
		setAmmo(state.ammo);
		setReserve(state.reserveRounds);
		setReload(state.reloadTimer);
	}

	private offlineReloadLastAt = 0;

	/**
	 * Judge sword hits without a server. `?offline=true` only.
	 *
	 * Mirrors `GameRoom.resolveMeleeHits` because both call the same simulation
	 * code — the escape hatch must not become a second, divergent set of combat
	 * rules, since it is the one path nobody dogfoods. The dagger's thrust is
	 * swept here the way the server sweeps it, so an offline dagger duel is
	 * the same fight it would be online.
	 */
	private resolveOfflineMelee(foe: FighterEntity) {
		const sides: [FighterEntity, FighterEntity][] = [
			[this.local, foe],
			[foe, this.local],
		];

		for (const [attacker, defender] of sides) {
			if (attacker.fighter.hp <= 0 || defender.fighter.hp <= 0) continue;

			// The thrust's sweep: multi-target, like the server's. The offline
			// room is a duel, so one sweep box against the one defender. Same
			// gate as the server: a dive is immune to melee, thrust included.
			const box = sweptThrustBox(attacker.body);
			if (
				box &&
				!defender.body.plunging &&
				rectsOverlap(box, bodyRect(defender.body.x, defender.body.y))
			) {
				const damage = applyHitToDefender(defender.body, {
					move: "thrust",
					outcome: "hit",
					damage: MOVES.thrust.damage,
					x: box.x + box.w / 2,
					y: box.y + box.h / 2,
					dir: attacker.body.facing >= 0 ? 1 : -1,
				});
				this.fx.impact(
					{
						move: "thrust",
						outcome: "hit",
						x: box.x + box.w / 2,
						y: box.y + box.h / 2,
						dir: attacker.body.facing >= 0 ? 1 : -1,
					},
					defender.fighter.id,
				);
				if (damage > 0)
					this.applyOfflineDamage(defender, damage, attacker, "thrust");
				continue;
			}

			const result = resolveMelee(attacker.body, defender.body);
			if (!result) continue;

			const damage = applyMeleeResult(attacker.body, defender.body, result);
			this.fx.impact(result as ImpactEvent, defender.fighter.id);
			if (damage > 0)
				this.applyOfflineDamage(defender, damage, attacker, result.move);
		}
	}

	private bulletTargets(foe: FighterEntity): BulletTarget[] {
		const localRanged = kitFor(this.hero).ranged;
		const foeRanged = kitFor(this.foeHero()).ranged;
		return [
			{
				owner: "enemy",
				x: foe.body.x,
				y: foe.body.y,
				alive: foe.fighter.hp > 0,
				state: foe.body,
				// The round that landed rides the callback so the falloff the
				// server reads at range is read here too — a shotgun pellet
				// that flew 150px hurts the same online and off.
				onHit: (b) =>
					this.applyOfflineDamage(
						foe,
						pelletDamageAt(localRanged, bulletDistanceFromMuzzle(b)),
						this.local,
						"bullet",
					),
			},
			{
				owner: "player",
				x: this.local.body.x,
				y: this.local.body.y,
				alive: this.local.fighter.hp > 0,
				state: this.local.body,
				onHit: (b) =>
					this.applyOfflineDamage(
						this.local,
						pelletDamageAt(foeRanged, bulletDistanceFromMuzzle(b)),
						foe,
						"bullet",
					),
			},
		];
	}

	private applyOfflineDamage(
		victim: FighterEntity,
		damage: number,
		attacker: FighterEntity,
		cause: KillCause,
	) {
		victim.fighter.hp = Math.max(0, victim.fighter.hp - damage);
		const who = victim.fighter.local ? "Player" : "Enemy";
		console.log(`[FIGHT] ${who} hit by ${cause}! HP: ${victim.fighter.hp}`);

		if (victim.fighter.local) {
			this.emitHud(true);
		}

		if (victim.fighter.hp <= 0 && this.resetAt < 0) {
			console.log(`[FIGHT] ${who} defeated!`);
			// The escape hatch is a duel, so it can name the killer straight off
			// the fighter entities — the same shape the online feed emits, so the
			// HUD treats both modes the same way.
			EventBus.emit(HUD_EVENTS.kill, {
				killerId: attacker.fighter.id,
				killer: attacker.fighter.name,
				victimId: victim.fighter.id,
				victim: victim.fighter.name,
				cause,
				hero: attacker.fighter.local ? this.hero : this.foeHero(),
				mine: victim.fighter.local || attacker.fighter.local,
			});
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
		// A new life is a new magazine and a fresh reserve, online or off.
		this.localAmmo = kitFor(this.hero).ranged.magazine;
		this.localReserve = reserveRoundsFor(kitFor(this.hero).ranged);
		this.localReload = 0;
		this.remoteAmmo = kitFor(this.foeHero()).ranged.magazine;
		this.remoteReserve = reserveRoundsFor(kitFor(this.foeHero()).ranged);
		this.remoteReload = 0;

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
		this.blossomFx.reset();
		this.denyFx.reset();
		this.rootedFx.reset();
		this.items.reset();
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
		this.potgSkipUnsubscribe?.();
		window.clearTimeout(this.shareHintTimer);
		this.input.destroy();
		this.blackHole.destroy();
		this.aimLine.destroy();
		this.ultAim.destroy();
		this.denyFx.destroy();
		this.rootedFx.destroy();
		this.items.destroy();
		this.training?.destroy();
		this.online?.disconnect();
		// Leaving a match returns the title screen's music to the page even
		// though the page itself never changes — the menu reappears after.
		sound.setMusic("title");
	}
}

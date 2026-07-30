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

import { type Container, Sprite, Text } from "pixi.js";
import type { AIConfig } from "./characters/AIConfig";
import EnemyBrain, {
	type AIInput,
	type AIOutput,
} from "./characters/EnemyBrain";
import { BulletSystem, type BulletTarget } from "./combat/BulletSystem";
import {
	PhysicsDiagnostics,
	RESPAWN_CORRECTION_PX,
} from "./diagnostics/PhysicsDiagnostics";
import { EventBus } from "./EventBus";
import {
	animationSystem,
	bindFxBodies,
	meleeFxSystem,
	nameplateSystem,
	spriteSyncSystem,
} from "./ecs/systems";
import {
	createQueries,
	createWorld,
	type FighterEntity,
	type GameWorld,
	type Queries,
} from "./ecs/world";
import { Input } from "./input/Input";
import { OnlineSession } from "./online/OnlineSession";
import { requestedRoomId, showRoomInUrl } from "./online/room";
import { bodyCentre, drawArena } from "./render/ArenaRenderer";
import { dudeFrames, TEX, tex } from "./render/assets";
import { type ImpactEvent, MeleeFx } from "./render/MeleeFx";
import { Nameplates } from "./render/Nameplates";
import type { Stage } from "./render/Stage";
import { timeLeftMs } from "./simulation/Deathmatch";
import {
	applyMeleeResult,
	BULLET_DAMAGE,
	canFire,
	createPlayerState,
	hasLineOfSight,
	meleePhase,
	NEUTRAL_INTENT,
	type PlayerIntent,
	type PlayerPosition,
	resolveMelee,
	tickPlayer,
} from "./simulation/Physics";
import { TrainingRoom } from "./training/TrainingRoom";

/** Client physics runs at a fixed 60Hz to match the server, whatever the display does. */
const PHYSICS_DT = 1 / 60;
const MAX_PHYSICS_STEPS = 5;
const RESET_DELAY_MS = 2000;

const START_PLAYER_X = 100;
const START_PLAYER_Y = 480;
const START_ENEMY_X = 668;
const START_ENEMY_Y = 480;

/** The offline escape hatch's single opponent. Never used in an online match. */
const OFFLINE_FOE_ID = "offline-foe";
const LOCAL_ID = "local";

/** Where a returning player's name is kept, so they only type it once. */
const NAME_KEY = "vento.playerName";

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
	};
}

function fightConfig(): AIConfig {
	return {
		skillLevel: 4 + Math.floor(Math.random() * 4),
		reactionTime: 150 + Math.floor(Math.random() * 250),
		accuracy: 0.45 + Math.random() * 0.4,
		aggressiveness: 0.35 + Math.random() * 0.45,
		dodgeChance: 0.2 + Math.random() * 0.4,
	};
}

/** A name for a client whose fighter is a bot, so the scoreboard is readable. */
function aiClientName(): string {
	const n = 100 + Math.floor(Math.random() * 900);
	return `AI-${n}`;
}

export class Match {
	private readonly world: GameWorld = createWorld();
	private readonly queries: Queries;
	private readonly fx: MeleeFx;
	private readonly plates: Nameplates;
	private readonly input: Input;
	private readonly diagnostics: PhysicsDiagnostics;
	private readonly bullets: BulletSystem;

	private readonly local: FighterEntity;
	/** Every other fighter in the room, keyed by the id the server scores it under. */
	private readonly remotes = new Map<string, FighterEntity>();
	/** The offline escape hatch's opponent. Created only when there is no server. */
	private offlineFoe: FighterEntity | undefined;

	private hpText!: Text;
	private scoreText!: Text;
	private timeText!: Text;
	private statusText!: Text;

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

	constructor(
		private readonly stage: Stage,
		canvas: HTMLCanvasElement,
		/** Logical view size — `app.screen`, never the canvas backing store. */
		screen: { readonly width: number; readonly height: number },
	) {
		drawArena(stage.background, stage.arena);

		this.queries = createQueries(this.world);
		this.fx = new MeleeFx(stage.effects, stage);
		this.plates = new Nameplates(stage.nameplates);
		this.bullets = new BulletSystem(stage.projectiles, tex(TEX.fireball));
		this.diagnostics = new PhysicsDiagnostics(
			() => (this.onlineMode ? "online" : "offline"),
			() => this.online?.netSummary() ?? null,
		);

		this.local = this.spawnFighter(
			LOCAL_ID,
			true,
			START_PLAYER_X,
			START_PLAYER_Y,
			1,
		);

		this.buildHud(stage.hud);
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

		const params = new URLSearchParams(window.location.search);
		this.aiMode = params.get("ai") === "true";
		// Which room, from the URL — or a new one. There is no matchmaking queue:
		// sharing the link is how two people end up in the same match.
		this.roomId = requestedRoomId();
		// Vestigial, and kept only for the status line and the debug hooks. Rooms are
		// addressed by id, so there is no "solo" placement to choose — and bots are
		// opt-in, so this no longer decides how a room is filled either. Every room is
		// served, predicted, reconciled, and a room somebody else can be sent to.
		this.soloMatch = params.get("online") !== "true";
		// `?offline=true` is an escape hatch for working without a game server. It
		// is not the supported path — it bypasses the netcode entirely.
		this.onlineMode = params.get("offline") !== "true";
		// Both spellings, because both get typed.
		this.trainingMode =
			params.get("training") === "true" ||
			params.get("training-room") === "true";
		// `bots=0` is meaningful — an empty room — so it cannot go through the
		// positive-integer parser the other counts use.
		this.botCount = countParam(params, "bots");
		this.fillCount = numberParam(params, "fill");
		// Shortened rules, for a probe. Honoured server-side only for the client that
		// *creates* the room, so a latecomer cannot end a match already in progress.
		this.scoreLimit = numberParam(params, "scoreLimit");
		const timeLimitSec = numberParam(params, "timeLimit");
		this.timeLimitMs =
			timeLimitSec === undefined ? undefined : timeLimitSec * 1000;

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
		const sprite = new Sprite(dudeFrames[facing < 0 ? 0 : 5]);
		sprite.anchor.set(0.5);
		this.stage.actors.addChild(sprite);

		const entity = this.world.add({
			key: id,
			// The name is filled in from the roster once it arrives; until then a
			// plate shows a bar and no label, which is honest — nobody has told this
			// client who that is yet.
			fighter: { id, local, hp: 100, maxHp: 100, name: "" },
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
	}

	private buildHud(hud: Container) {
		const style = { fontFamily: "monospace", fontSize: 22, fill: 0x000000 };
		this.hpText = new Text({ text: "hp: 100", style });
		this.hpText.position.set(16, 16);

		this.scoreText = new Text({ text: "frags: 0/21", style });
		this.scoreText.position.set(16, 44);

		this.timeText = new Text({ text: "5:00", style });
		this.timeText.anchor.set(1, 0);
		this.timeText.position.set(784, 16);

		this.statusText = new Text({
			text: "",
			style: { ...style, fontSize: 22, fill: 0xffffff },
		});
		this.statusText.anchor.set(0.5);
		this.statusText.position.set(400, 300);

		hud.addChild(this.hpText, this.scoreText, this.timeText, this.statusText);
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

		this.statusText.text = "";
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
		this.statusText.text = "Connecting...";

		this.online = new OnlineSession(
			this.stage.projectiles,
			tex(TEX.fireball),
			START_PLAYER_X,
			START_PLAYER_Y,
			{
				onStatus: (msg) => {
					if (msg) console.log(`[ONLINE] ${msg}`);
					this.statusText.text = msg;
				},
				onLocalHp: (hp) => {
					this.local.fighter.hp = hp;
					this.hpText.text = `hp: ${Math.max(0, hp)}`;
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
					// Takes the podium down. Without this the previous match's winner
					// screen would sit over a live fight forever.
					EventBus.emit("match-reset");
				},
				onMeleeEvent: (event) => {
					// The victim comes from the event now. Deriving it from
					// `attackerId === myId` was correct in a duel and wrong the moment a
					// third fighter existed: every hit between two other players punched
					// the local fighter's sprite.
					this.fx.impact(event, event.victimId);
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
				onFighterAdded: (id) => this.addRemoteFighter(id),
				onFighterRemoved: (id) => this.despawnFighter(id),
				onMatch: (status, standings) => {
					const mine = standings.find(
						(s) => s.id === this.online?.manager.myId,
					);
					this.scoreText.text = `frags: ${mine?.kills ?? 0}/${status.scoreLimit}`;
					this.timeText.text = formatClock(
						timeLeftMs(status.elapsedMs, status.timeLimitMs),
					);
					// The React overlay owns the scoreboard and the podium; the canvas
					// HUD stays to the two numbers a player reads mid-fight.
					EventBus.emit("match-status", {
						status,
						standings,
						myId: this.online?.manager.myId ?? "",
					});
				},
				onMatchOver: (msg) => {
					console.log(
						`[MATCH] over by ${msg.reason}, winner ${msg.winnerId ?? "nobody"}`,
					);
					EventBus.emit("match-over", msg);
				},
				onSeated: (roomId) => {
					// The server decides the id, so the address bar follows it rather
					// than the proposal. They agree unless the proposal was malformed.
					this.roomId = roomId;
					if (!this.trainingMode) {
						showRoomInUrl(roomId);
						EventBus.emit("room-id", roomId);
					}
					console.log(`[ONLINE] room ${roomId}`);
				},
				onRoomFull: (roomId) => {
					this.statusText.text = "That room is full.";
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
			this.localBrain = new EnemyBrain(fightConfig());
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
		this.localBrain = new EnemyBrain(fightConfig());
		this.remoteBrain = new EnemyBrain(fightConfig());
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
				? (this.online?.remoteHp ?? 100)
				: (this.offlineFoe?.fighter.hp ?? 100),
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
		});
		// The deathmatch's own contract. `__gameState` describes two fighters
		// because that is what a duel is; a sixteen-player match is a scoreboard and
		// a clock, and `scripts/deathmatch-probe.mjs` reads exactly this.
		window.__matchState = () => {
			const status = this.online?.matchStatus;
			const standings = this.online?.standings() ?? [];
			const winnerId = status?.winnerId ?? null;
			return {
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
		const dtSec = Math.min(dtMs / 1000, 0.05);
		this.elapsed += dtMs;

		if (this.onlineMode) this.updateOnline(dtSec);
		else this.updateOffline(dtSec);

		// Presentation, in dependency order: animation picks the frame, sync moves
		// the sprites, effects read the same state, then the camera settles.
		animationSystem(this.queries, dtMs);
		spriteSyncSystem(this.queries);
		nameplateSystem(this.queries, this.plates);
		meleeFxSystem(this.queries, this.fx, dtMs);
		this.fx.update(dtMs);
		this.stage.update(dtMs);

		this.training?.update(dtMs);
		this.record(dtMs);
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

	/** Build the perception an AI brain reads, from simulation state only. */
	private perceive(
		self: PlayerPosition,
		foe: PlayerPosition,
		selfHP: number,
		enemyHP: number,
	): AIInput {
		const dx = foe.x - self.x;
		const dy = foe.y - self.y;
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
			hasLineOfSight: hasLineOfSight(self.x, self.y, foe.x, foe.y),
			selfHP,
			enemyHP,
			enemyAction: foe.meleeAction,
			enemyPhase: meleePhase(foe),
			enemyBlocking: foe.blocking,
			enemyStunned: foe.stunTimer > 0,
			selfAction: self.meleeAction,
			selfStunned: self.stunTimer > 0,
			selfMassiveReady: self.massiveReady,
		};
	}

	// =========================================================
	//  ONLINE
	// =========================================================

	private updateOnline(dtSec: number) {
		const session = this.online;
		if (!session?.connected) return;

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
					dtSec * 1000,
				);
				this.localIntent = intentFromAI(output);
				this.aimAngle = output.aimAngle;
			}
		} else {
			this.aimAngle = this.input.aimAngle(this.local.body.x, this.local.body.y);
			this.localIntent = this.input.intent(this.aimAngle);
		}

		this.diagSteps = this.runFixedSteps(dtSec, (dt) => {
			session.fixedStep(this.localIntent, this.aimAngle, dt);
		});

		// The predicted state object is replaced every tick, so the entity has to
		// be re-pointed at the current one rather than holding a stale copy. Same
		// for every remote: `tickPlayer` is pure, so rolling one forward hands back
		// a new object.
		this.local.body = session.predicted.state;
		this.local.renderPos = session.render(dtSec);

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
				this.local.body = tickPlayer(this.local.body, this.localIntent, dt);
			}
			if (foe.fighter.hp > 0) {
				foe.body = tickPlayer(foe.body, this.remoteIntent, dt);
			}
			this.bullets.step(dt);
		});

		this.handleOfflineAttacks(foe);
		this.tickReset(dtSec);
	}

	private gatherOfflineIntents(dtSec: number, foe: FighterEntity) {
		const dtMs = dtSec * 1000;

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
			this.hpText.text = `hp: ${victim.fighter.hp}`;
		}

		if (victim.fighter.hp <= 0 && this.resetAt < 0) {
			console.log(`[FIGHT] ${who} defeated!`);
			this.resetAt = RESET_DELAY_MS;
		}
	}

	private tickReset(dtSec: number) {
		if (this.resetAt < 0) return;
		this.resetAt -= dtSec * 1000;
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
		this.local.fighter.hp = 100;
		this.localIntent = { ...NO_INTENT };
		this.remoteIntent = { ...NO_INTENT };

		if (this.offlineFoe) {
			this.offlineFoe.body = createPlayerState(
				START_ENEMY_X,
				START_ENEMY_Y,
				-1,
			);
			this.offlineFoe.fighter.hp = 100;
		}

		if (this.localBrain) this.localBrain = new EnemyBrain(fightConfig());
		if (this.remoteBrain) this.remoteBrain = new EnemyBrain(fightConfig());

		this.bullets.clear();
		this.fx.reset();
		this.stage.reset();
		this.hpText.text = "hp: 100";
	}

	private toggleAiVsAi() {
		if (this.localBrain) {
			this.localBrain = undefined;
			this.remoteBrain = undefined;
			console.log("=== AI VS AI MODE DISABLED ===");
			return;
		}
		this.localBrain = new EnemyBrain(fightConfig());
		if (!this.onlineMode) this.remoteBrain = new EnemyBrain(fightConfig());
		if (!this.onlineMode) this.resetFight();
		console.log("=== AI VS AI MODE ENABLED ===");
		console.log("Press 'P' to exit, or call window.__gameState()");
	}

	destroy() {
		this.nameUnsubscribe?.();
		this.input.destroy();
		this.training?.destroy();
		this.online?.disconnect();
	}
}

/** A positive integer URL parameter, or undefined when absent or nonsense. */
function numberParam(params: URLSearchParams, key: string): number | undefined {
	const raw = params.get(key);
	if (raw === null) return undefined;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Like `numberParam`, but zero is a legitimate answer. */
function countParam(params: URLSearchParams, key: string): number | undefined {
	const raw = params.get(key);
	if (raw === null) return undefined;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function formatClock(ms: number): string {
	const total = Math.ceil(ms / 1000);
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function readStoredName(): string | null {
	try {
		return window.localStorage.getItem(NAME_KEY);
	} catch {
		// Private browsing, or storage disabled. A name prompt every session is a
		// far better failure than a game that will not start.
		return null;
	}
}

function storeName(name: string) {
	try {
		window.localStorage.setItem(NAME_KEY, name);
	} catch {
		/* not fatal — see readStoredName */
	}
}

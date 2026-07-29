/**
 * One match: the fixed-timestep loop, the entity world, and the wiring between
 * the simulation, the netcode and the renderer.
 *
 * This is the only place that knows about all of them. Systems read simulation
 * state and write presentation; the netcode owns truth; the simulation is pure.
 * Keeping the crossings in one file is what stops those responsibilities leaking
 * into each other — which is exactly how the old scene grew to 800 lines.
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
	spriteSyncSystem,
} from "./ecs/systems";
import {
	createQueries,
	createWorld,
	type FighterEntity,
	type GameWorld,
	type Queries,
	type Side,
} from "./ecs/world";
import { Input } from "./input/Input";
import { OnlineSession } from "./online/OnlineSession";
import { bodyCentre, drawArena } from "./render/ArenaRenderer";
import { dudeFrames, TEX, tex } from "./render/assets";
import { type ImpactEvent, MeleeFx } from "./render/MeleeFx";
import type { Stage } from "./render/Stage";
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

export class Match {
	private readonly world: GameWorld = createWorld();
	private readonly queries: Queries;
	private readonly fx: MeleeFx;
	private readonly input: Input;
	private readonly diagnostics: PhysicsDiagnostics;
	private readonly bullets: BulletSystem;

	private readonly local: FighterEntity;
	private readonly remote: FighterEntity;

	private hpText!: Text;
	private enemyHpText!: Text;
	private statusText!: Text;

	/**
	 * The game is online-first: every match runs through the authoritative
	 * server, including single-player. Playing it is dogfooding the netcode.
	 */
	private onlineMode = true;
	/** The local fighter is AI-driven (`?ai=true`), online or not. */
	private aiMode = false;
	/** Solo: the server fills the other slot with a bot instead of a human. */
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

	constructor(
		private readonly stage: Stage,
		canvas: HTMLCanvasElement,
		/** Logical view size — `app.screen`, never the canvas backing store. */
		screen: { readonly width: number; readonly height: number },
	) {
		drawArena(stage.background, stage.arena);

		this.queries = createQueries(this.world);
		this.fx = new MeleeFx(stage.effects, stage);
		this.bullets = new BulletSystem(stage.projectiles, tex(TEX.fireball));
		this.diagnostics = new PhysicsDiagnostics(() =>
			this.onlineMode ? "online" : "offline",
		);

		this.local = this.spawnFighter("local", START_PLAYER_X, START_PLAYER_Y, 1);
		this.remote = this.spawnFighter("remote", START_ENEMY_X, START_ENEMY_Y, -1);
		bindFxBodies(this.queries, this.fx);

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
		// `?online=true` asks for a human opponent; otherwise the server supplies a
		// bot. Either way the match is served, predicted and reconciled.
		this.soloMatch = params.get("online") !== "true";
		// `?offline=true` is an escape hatch for working without a game server. It
		// is not the supported path — it bypasses the netcode entirely.
		this.onlineMode = params.get("offline") !== "true";
		// Both spellings, because both get typed.
		this.trainingMode =
			params.get("training") === "true" ||
			params.get("training-room") === "true";

		if (this.trainingMode) {
			// A training room is an ordinary online, single-human match by
			// construction. `?offline=true&training=true` is not a mode: offline
			// bypasses the server, and the dummy lives there.
			this.onlineMode = true;
			this.soloMatch = true;
		}

		if (this.onlineMode) this.startOnline();
		else if (this.aiMode) this.startOfflineAi();

		EventBus.on("enemy-hp-changed", (hp: number) => {
			this.enemyHpText.text = `enemy hp: ${Math.max(0, hp)}`;
		});
		EventBus.emit("current-scene-ready", this);
	}

	// =========================================================
	//  SETUP
	// =========================================================

	private spawnFighter(
		side: Side,
		x: number,
		y: number,
		facing: number,
	): FighterEntity {
		const sprite = new Sprite(dudeFrames[facing < 0 ? 0 : 5]);
		sprite.anchor.set(0.5);
		this.stage.actors.addChild(sprite);

		return this.world.add({
			key: side,
			fighter: { side, hp: 100 },
			body: createPlayerState(x, y, facing),
			sprite,
			anim: { clip: "right-idle", frame: 0, elapsedMs: 0 },
		});
	}

	private buildHud(hud: Container) {
		const style = { fontFamily: "monospace", fontSize: 26, fill: 0x000000 };
		this.hpText = new Text({ text: "hp: 100", style });
		this.hpText.position.set(16, 16);

		this.enemyHpText = new Text({ text: "enemy hp: 100", style });
		this.enemyHpText.position.set(560, 16);

		this.statusText = new Text({
			text: "",
			style: { ...style, fontSize: 22, fill: 0xffffff },
		});
		this.statusText.anchor.set(0.5);
		this.statusText.position.set(400, 300);

		hud.addChild(this.hpText, this.enemyHpText, this.statusText);
	}

	private startOnline() {
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
				onRemoteHp: (hp) => {
					this.remote.fighter.hp = hp;
					this.enemyHpText.text = `enemy hp: ${Math.max(0, hp)}`;
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
				onRoundReset: () => this.diagnostics.markRoundReset(),
				onMeleeEvent: (event) => {
					const byLocal = event.attackerId === this.online?.manager.myId;
					const victim: Side = byLocal ? "remote" : "local";
					this.fx.impact(event, victim);
					this.diagnostics.recordMeleeEvent(event.move, event.outcome);
					this.training?.recordMeleeEvent(event, byLocal);
					// A hit is an announced discontinuity, exactly like a respawn. Only
					// the server can know a swing connected, so the client necessarily
					// mispredicts the stun and knockback and then rewinds into them —
					// tens of pixels in one frame, from correct netcode.
					this.diagnostics.markTeleport(2);
				},
			},
		);
		this.online.connect(this.soloMatch, this.trainingMode);

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
				? (this.online?.remoteHp ?? this.remote.fighter.hp)
				: this.remote.fighter.hp,
			playerState: this.localBrain?.getCurrentState(),
			enemyState: this.remoteBrain?.getCurrentState(),
			playerPhys: this.local.body,
			enemyPhys: this.remote.body,
			remote: this.onlineMode
				? this.online?.remotePosition
				: { x: this.remote.body.x, y: this.remote.body.y },
			bulletCount: this.onlineMode
				? (this.online?.bullets.length ?? 0)
				: this.bullets.count,
		});
		window.__physicsDiagnostic = (durationMs = 5000) =>
			this.diagnostics.start(durationMs);
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
			enemy: this.onlineMode
				? (this.online?.remotePosition ?? null)
				: { x: this.remote.body.x, y: this.remote.body.y },
			// The full opponent state, so blocks and parries the local fighter is on
			// the receiving end of are measured too.
			enemyState: this.onlineMode
				? (this.online?.remoteState ?? null)
				: this.remote.body,
			bullets: this.onlineMode
				? [...(this.online?.bullets ?? [])]
				: this.bullets.snapshot(),
			// Camera *scroll*, never the shake offset: shake is cosmetic and would
			// otherwise report every heavy sword impact as camera jitter.
			cameraX: this.stage.cameraX,
			cameraY: this.stage.cameraY,
		});
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
			// The remote fighter's full authoritative state, not just a position: the
			// brain has to see what the opponent's sword is doing to block, punish or
			// uppercut a guard.
			const foe = session.remoteState;
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
		// be re-pointed at the current one rather than holding a stale copy.
		this.local.body = session.predicted.state;

		this.local.renderPos = session.render(dtSec);

		const remoteState = session.remoteState;
		if (remoteState) this.remote.body = remoteState;
		this.remote.fighter.hp = session.remoteHp;
	}

	// =========================================================
	//  OFFLINE ESCAPE HATCH
	// =========================================================

	private updateOffline(dtSec: number) {
		this.gatherOfflineIntents(dtSec);

		this.diagSteps = this.runFixedSteps(dtSec, (dt) => {
			if (this.local.fighter.hp > 0) {
				this.local.body = tickPlayer(this.local.body, this.localIntent, dt);
			}
			if (this.remote.fighter.hp > 0) {
				this.remote.body = tickPlayer(this.remote.body, this.remoteIntent, dt);
			}
			this.bullets.step(dt);
		});

		this.handleOfflineAttacks();
		this.tickReset(dtSec);
	}

	private gatherOfflineIntents(dtSec: number) {
		const dtMs = dtSec * 1000;

		if (this.localBrain) {
			const output = this.localBrain.decide(
				this.perceive(
					this.local.body,
					this.remote.body,
					this.local.fighter.hp,
					this.remote.fighter.hp,
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
					this.remote.body,
					this.local.body,
					this.remote.fighter.hp,
					this.local.fighter.hp,
				),
				this.elapsed,
				dtMs,
			);
			this.remoteIntent = intentFromAI(output);
			this.remoteBrainAim = output.aimAngle;
		}
	}

	private handleOfflineAttacks() {
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
			this.remote.fighter.hp > 0 &&
			this.remote.body.stance === "gun" &&
			this.remoteIntent.attack &&
			canFire(this.remoteAttackAt, now)
		) {
			this.remoteAttackAt = now;
			const c = bodyCentre(this.remote.body.x, this.remote.body.y);
			this.bullets.fire(c.x, c.y, this.remoteBrainAim, "enemy");
			EventBus.emit("bullet-fired");
		}

		this.resolveOfflineMelee();
		this.bullets.resolve(this.bulletTargets());
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
	private resolveOfflineMelee() {
		const sides: [FighterEntity, FighterEntity][] = [
			[this.local, this.remote],
			[this.remote, this.local],
		];

		for (const [attacker, defender] of sides) {
			if (attacker.fighter.hp <= 0 || defender.fighter.hp <= 0) continue;

			const result = resolveMelee(attacker.body, defender.body);
			if (!result) continue;

			const damage = applyMeleeResult(attacker.body, defender.body, result);
			this.fx.impact(result as ImpactEvent, defender.fighter.side);
			if (damage > 0) this.applyOfflineDamage(defender, damage, "sword");
		}
	}

	private bulletTargets(): BulletTarget[] {
		return [
			{
				owner: "enemy",
				x: this.remote.body.x,
				y: this.remote.body.y,
				alive: this.remote.fighter.hp > 0,
				onHit: () =>
					this.applyOfflineDamage(this.remote, BULLET_DAMAGE, "bullet"),
			},
			{
				owner: "player",
				x: this.local.body.x,
				y: this.local.body.y,
				alive: this.local.fighter.hp > 0,
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
		const who = victim.fighter.side === "local" ? "Player" : "Enemy";
		console.log(`[FIGHT] ${who} hit by ${kind}! HP: ${victim.fighter.hp}`);

		if (victim.fighter.side === "local") {
			this.hpText.text = `hp: ${victim.fighter.hp}`;
		} else {
			this.enemyHpText.text = `enemy hp: ${victim.fighter.hp}`;
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
		this.remote.body = createPlayerState(START_ENEMY_X, START_ENEMY_Y, -1);
		this.local.fighter.hp = 100;
		this.remote.fighter.hp = 100;
		this.localIntent = { ...NO_INTENT };
		this.remoteIntent = { ...NO_INTENT };

		if (this.localBrain) this.localBrain = new EnemyBrain(fightConfig());
		if (this.remoteBrain) this.remoteBrain = new EnemyBrain(fightConfig());

		this.bullets.clear();
		this.fx.reset();
		this.stage.reset();
		this.hpText.text = "hp: 100";
		this.enemyHpText.text = "enemy hp: 100";
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
		this.input.destroy();
		this.training?.destroy();
		this.online?.disconnect();
	}
}

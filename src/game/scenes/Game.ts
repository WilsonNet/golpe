import Phaser from "phaser";
import { createDudeAnims } from "../anims/dude/dudeAnims";
import type { AIConfig } from "../characters/AIConfig";
import AIEnemy from "../characters/AIEnemy";
import { playableControls } from "../characters/Controls";
import EnemyBrain, { type AIInput } from "../characters/EnemyBrain";
import Player from "../characters/Player";
import { MovementState } from "../characters/playerStates";
import { BulletSystem, type BulletTarget } from "../combat/BulletSystem";
import { PhysicsDiagnostics } from "../diagnostics/PhysicsDiagnostics";
import { EventBus } from "../EventBus";
import { OnlineSession } from "../online/OnlineSession";
import {
	bodyCentre,
	drawArena,
	syncSpriteToBody,
} from "../render/ArenaRenderer";
import {
	BULLET_DAMAGE,
	canFire,
	createPlayerState,
	hasLineOfSight,
	type PlayerIntent,
	type PlayerPosition,
	tickPlayer,
} from "../simulation/Physics";

/** Client physics runs at a fixed 60Hz to match the server, whatever the display does. */
const PHYSICS_DT = 1 / 60;
const MAX_PHYSICS_STEPS = 5;
const DASH_SPEED = 1000;
const RESET_DELAY_MS = 2000;

const START_PLAYER_X = 100;
const START_PLAYER_Y = 480;
const START_ENEMY_X = 668;
const START_ENEMY_Y = 480;

const NO_INTENT: PlayerIntent = { left: false, right: false, up: false };

export default class Game extends Phaser.Scene {
	private player?: Player;
	private aiEnemy?: AIEnemy;
	private cursors!: Record<string, Phaser.Input.Keyboard.Key>;
	private hpText?: Phaser.GameObjects.Text;
	private enemyHpText?: Phaser.GameObjects.Text;
	private onlineStatusText?: Phaser.GameObjects.Text;

	private playerPhys: PlayerPosition = createPlayerState(
		START_PLAYER_X,
		START_PLAYER_Y,
	);
	private enemyPhys: PlayerPosition = createPlayerState(
		START_ENEMY_X,
		START_ENEMY_Y,
	);

	private bullets!: BulletSystem;
	private diagnostics!: PhysicsDiagnostics;

	private aiVsAIMode = false;
	private playerBrain?: EnemyBrain;
	private resetScheduled = false;

	private onlineMode = false;
	private onlineAIMode = false;
	private online?: OnlineSession;

	private physicsAccumulator = 0;
	private playerIntent: PlayerIntent = { ...NO_INTENT };
	private enemyIntent: PlayerIntent = { ...NO_INTENT };
	private playerAimAngle = 0;
	private playerWantsAttack = false;
	private diagPhysicsSteps = 0;

	constructor() {
		super("Game");
	}

	// =========================================================
	//  SETUP
	// =========================================================

	create() {
		createDudeAnims(this.anims);
		this.cameras.main.setBounds(0, 0, 800, 600, true);

		drawArena(this);

		this.player = new Player(this, START_PLAYER_X, START_PLAYER_Y, "dude");
		this.aiEnemy = new AIEnemy(this, START_ENEMY_X, START_ENEMY_Y, "dude");
		this.bullets = new BulletSystem(this);
		this.diagnostics = new PhysicsDiagnostics(() =>
			this.onlineMode ? "online" : "offline",
		);

		this.hpText = this.add.text(16, 16, "hp: 100", {
			fontSize: "32px",
			color: "#000",
		});
		this.enemyHpText = this.add.text(580, 16, "enemy hp: 100", {
			fontSize: "32px",
			color: "#000",
		});

		this.resetFight();
		this.bindInput();
		this.installDebugHooks();

		EventBus.on("enemy-hp-changed", (hp: number) => {
			this.enemyHpText?.setText(`enemy hp: ${Math.max(0, hp)}`);
		});
		EventBus.emit("current-scene-ready", this);

		const params = new URLSearchParams(window.location.search);
		this.onlineMode = params.get("online") === "true";
		this.onlineAIMode = params.get("ai") === "true";
		if (this.onlineMode) {
			this.initOnlineMode();
		} else if (this.onlineAIMode) {
			// `?ai=true` means the same thing offline as online: the local fighter
			// is AI-driven. Without this, offline AI-vs-AI was only reachable by
			// pressing P, so it could not be linked to or launched by a harness.
			this.toggleAIVsAI();
		}
	}

	private bindInput() {
		this.cursors = this.input.keyboard!.addKeys(playableControls) as Record<
			string,
			Phaser.Input.Keyboard.Key
		>;

		this.input.keyboard?.on("keydown-P", () => this.toggleAIVsAI());
		this.input.mouse?.disableContextMenu();

		this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
			if (!this.player) return;
			const centre = bodyCentre(this.playerPhys.x, this.playerPhys.y);
			this.playerAimAngle = Phaser.Math.Angle.Between(
				centre.x,
				centre.y,
				pointer.worldX,
				pointer.worldY,
			);
			this.player.setMouseAngle(this.playerAimAngle);
		});
	}

	private installDebugHooks() {
		const win = window as unknown as Record<string, unknown>;
		win.__toggleAIVsAI = () => this.toggleAIVsAI();
		win.__gameState = () => ({
			aiVsAIMode: this.aiVsAIMode,
			onlineMode: this.onlineMode,
			onlineAIMode: this.onlineAIMode,
			playerHP: this.player?.hp,
			enemyHP: this.onlineMode ? this.online?.remoteHp : this.aiEnemy?.hp,
			playerState: this.playerBrain?.getCurrentState(),
			enemyState: this.aiEnemy?.getCurrentAIState(),
			playerPhys: this.playerPhys,
			enemyPhys: this.enemyPhys,
		});
		win.__physicsDiagnostic = (durationMs = 5000) =>
			this.diagnostics.start(durationMs);
	}

	private initOnlineMode() {
		this.onlineStatusText = this.add
			.text(400, 300, "Connecting...", { fontSize: "24px", color: "#fff" })
			.setOrigin(0.5);

		this.online = new OnlineSession(this, START_PLAYER_X, START_PLAYER_Y, {
			onStatus: (msg) => {
				if (msg) console.log(`[ONLINE] ${msg}`);
				this.onlineStatusText?.setText(msg);
			},
			onLocalHp: (hp) => {
				if (this.player) this.player.hp = hp;
				this.hpText?.setText(`hp: ${Math.max(0, hp)}`);
			},
			onRemoteHp: (hp) => {
				this.enemyHpText?.setText(`enemy hp: ${Math.max(0, hp)}`);
			},
			onReconcile: (errorPx, replayed) => {
				this.diagnostics.recordReconciliation(errorPx, replayed);
				// A correction this large is a respawn, not a misprediction.
				if (errorPx > 100) this.diagnostics.markTeleport();
			},
			onTeleport: () => this.diagnostics.markTeleport(),
		});
		this.online.connect();

		// The AI enemy is server-driven in online mode.
		this.aiEnemy?.setVisible(false);
		this.aiEnemy?.setActive(false);

		if (this.onlineAIMode) {
			this.playerBrain = new EnemyBrain(this.generateFightConfig());
			console.log("[AI-ONLINE] AI brain created for local player");
		}
	}

	// =========================================================
	//  UPDATE
	// =========================================================

	update(t: number, dt: number) {
		const dtSec = Math.min(dt / 1000, 0.05);

		if (this.onlineMode) {
			this.updateOnline(t, dtSec);
		} else {
			this.updateOffline(t, dtSec);
		}

		if (this.diagnostics.isActive) {
			this.diagnostics.record({
				t,
				dt,
				physicsSteps: this.diagPhysicsSteps,
				player: this.playerPhys,
				enemy: this.onlineMode
					? (this.online?.remotePosition ?? null)
					: { x: this.enemyPhys.x, y: this.enemyPhys.y },
				cameraX: this.cameras.main.scrollX,
				cameraY: this.cameras.main.scrollY,
			});
		}
	}

	/**
	 * Run the fixed-timestep accumulator, calling `step` once per 1/60s.
	 * Returns how many steps ran, for the diagnostic.
	 */
	private runFixedSteps(dtSec: number, step: (dt: number) => void): number {
		this.physicsAccumulator += dtSec;
		let steps = 0;
		while (this.physicsAccumulator >= PHYSICS_DT && steps < MAX_PHYSICS_STEPS) {
			step(PHYSICS_DT);
			this.physicsAccumulator -= PHYSICS_DT;
			steps++;
		}
		return steps;
	}

	// =========================================================
	//  OFFLINE
	// =========================================================

	private updateOffline(t: number, dtSec: number) {
		const now = this.game.loop.time;

		this.gatherOfflineIntents(t, dtSec);

		this.diagPhysicsSteps = this.runFixedSteps(dtSec, (dt) => {
			this.playerPhys = tickPlayer(this.playerPhys, this.playerIntent, dt);
			if (this.aiEnemy && this.aiEnemy.hp > 0) {
				this.enemyPhys = tickPlayer(this.enemyPhys, this.enemyIntent, dt);
			}
			this.bullets.step(dt);
		});

		this.syncOfflineSprites();
		this.handleOfflineAttacks(now);
	}

	private gatherOfflineIntents(t: number, dtSec: number) {
		if (this.aiVsAIMode && this.playerBrain) {
			this.gatherPlayerAIIntent(t, dtSec);
		} else {
			this.gatherKeyboardIntent(t);
		}
		this.gatherEnemyIntent(t, dtSec);
	}

	private gatherKeyboardIntent(t: number) {
		if (!this.player || !this.cursors) return;

		this.player.update(t, 16, this.cursors);

		this.playerIntent = {
			left: this.cursors.left?.isDown ?? false,
			right: this.cursors.right?.isDown ?? false,
			up: this.cursors.up?.isDown ?? false,
		};

		// A dash is an impulse on the shared simulation, not a separate movement
		// path — it sets velocity and then normal physics carries it.
		if (this.player.movementState === MovementState.DASHING_LEFT) {
			this.playerPhys.vx = -DASH_SPEED;
			this.playerIntent = { ...NO_INTENT };
		} else if (this.player.movementState === MovementState.DASHING_RIGHT) {
			this.playerPhys.vx = DASH_SPEED;
			this.playerIntent = { ...NO_INTENT };
		}

		this.playerAimAngle = this.player.getMouseAngle();
		this.playerWantsAttack = this.input.activePointer.isDown;
	}

	private gatherPlayerAIIntent(t: number, dtSec: number) {
		if (!this.player || !this.playerBrain || !this.aiEnemy) return;
		if (this.player.hp <= 0) return;

		const output = this.playerBrain.decide(
			this.perceive(
				this.playerPhys,
				this.enemyPhys,
				this.player.hp,
				this.aiEnemy.hp,
				this.aiEnemy.getFacingDirection(),
			),
			t,
			dtSec * 1000,
		);
		this.player.setAIOverride(output);

		this.playerIntent = {
			left: output.moveLeft,
			right: output.moveRight,
			up: output.jump,
		};
		this.playerAimAngle = output.aimAngle;
		this.playerWantsAttack = output.attack;
	}

	private gatherEnemyIntent(t: number, dtSec: number) {
		if (!this.aiEnemy || !this.player || this.aiEnemy.hp <= 0) return;

		const los = hasLineOfSight(
			this.enemyPhys.x,
			this.enemyPhys.y,
			this.playerPhys.x,
			this.playerPhys.y,
		);

		this.aiEnemy.update(
			t,
			dtSec * 1000,
			this.playerPhys.x,
			this.playerPhys.y,
			this.player.getFacingDirection(),
			los,
			this.player.hp,
			this.enemyPhys.wallTouch,
		);

		const output = this.aiEnemy.lastAIOutput;
		this.enemyIntent = {
			left: output.moveLeft,
			right: output.moveRight,
			up: output.jump,
		};
	}

	/** Build the perception an AI brain reads, from simulation state only. */
	private perceive(
		self: PlayerPosition,
		foe: PlayerPosition,
		selfHP: number,
		enemyHP: number,
		foeFacing: number,
	): AIInput {
		const dx = foe.x - self.x;
		const dy = foe.y - self.y;
		return {
			playerX: foe.x,
			playerY: foe.y,
			selfX: self.x,
			selfY: self.y,
			distanceToPlayer: Math.sqrt(dx * dx + dy * dy),
			playerFacingDirection: foeFacing,
			touchingDown: self.grounded,
			touchingLeft: self.wallTouch === "left",
			touchingRight: self.wallTouch === "right",
			hasLineOfSight: hasLineOfSight(self.x, self.y, foe.x, foe.y),
			selfHP,
			enemyHP,
		};
	}

	private syncOfflineSprites() {
		if (this.player) {
			syncSpriteToBody(this.player, this.playerPhys.x, this.playerPhys.y);
			this.player.grounded = this.playerPhys.grounded;
		}
		if (this.aiEnemy && this.aiEnemy.hp > 0) {
			syncSpriteToBody(this.aiEnemy, this.enemyPhys.x, this.enemyPhys.y);
			this.aiEnemy.grounded = this.enemyPhys.grounded;

			const output = this.aiEnemy.lastAIOutput;
			this.aiEnemy.lastFacingDirection = output.moveLeft
				? -1
				: output.moveRight
					? 1
					: this.aiEnemy.lastFacingDirection;
		}
	}

	private handleOfflineAttacks(now: number) {
		if (!this.player || !this.aiEnemy) return;

		if (this.playerWantsAttack && canFire(this.player.lastAttackTime, now)) {
			this.player.lastAttackTime = now;
			const c = bodyCentre(this.playerPhys.x, this.playerPhys.y);
			this.bullets.fire(c.x, c.y, this.playerAimAngle, "player");
			EventBus.emit("bullet-fired");
		}

		const enemyOutput = this.aiEnemy.lastAIOutput;
		if (
			this.aiEnemy.hp > 0 &&
			enemyOutput.attack &&
			canFire(this.aiEnemy.lastAttackTime, now)
		) {
			this.aiEnemy.lastAttackTime = now;
			const c = bodyCentre(this.enemyPhys.x, this.enemyPhys.y);
			this.bullets.fire(c.x, c.y, enemyOutput.aimAngle, "enemy");
			EventBus.emit("bullet-fired");
		}

		this.bullets.resolve(this.bulletTargets());
	}

	private bulletTargets(): BulletTarget[] {
		const targets: BulletTarget[] = [];
		if (this.aiEnemy) {
			targets.push({
				owner: "enemy",
				x: this.enemyPhys.x,
				y: this.enemyPhys.y,
				alive: this.aiEnemy.hp > 0,
				onHit: () => this.onEnemyHit(),
			});
		}
		if (this.player) {
			targets.push({
				owner: "player",
				x: this.playerPhys.x,
				y: this.playerPhys.y,
				alive: this.player.hp > 0,
				onHit: () => this.onPlayerHit(),
			});
		}
		return targets;
	}

	private onEnemyHit() {
		if (!this.aiEnemy) return;
		this.aiEnemy.takeDamage(BULLET_DAMAGE);
		console.log(
			`[FIGHT] Player bullet hit enemy! Enemy HP: ${Math.max(0, this.aiEnemy.hp)}`,
		);
		if (this.aiEnemy.hp <= 0) {
			console.log("[FIGHT] Enemy defeated!");
			this.scheduleReset();
		}
	}

	private onPlayerHit() {
		if (!this.player) return;
		this.player.takeDamage(BULLET_DAMAGE);
		this.hpText?.setText(`hp: ${Math.max(0, this.player.hp)}`);
		console.log(
			`[FIGHT] Enemy bullet hit player! Player HP: ${Math.max(0, this.player.hp)}`,
		);
		if (this.player.hp <= 0) {
			console.log("[FIGHT] Player defeated!");
			this.scheduleReset();
		}
	}

	// =========================================================
	//  ONLINE
	// =========================================================

	private updateOnline(t: number, dtSec: number) {
		const session = this.online;
		if (!this.player || !session?.connected) return;

		if (this.onlineAIMode && this.playerBrain) {
			this.gatherOnlineAIIntent(t, dtSec);
		} else {
			this.playerIntent = {
				left: this.cursors.left?.isDown ?? false,
				right: this.cursors.right?.isDown ?? false,
				up: this.cursors.up?.isDown ?? false,
			};
			this.playerAimAngle = this.player.getMouseAngle?.() ?? 0;
			this.playerWantsAttack = this.input.activePointer?.isDown ?? false;
		}

		this.diagPhysicsSteps = this.runFixedSteps(dtSec, (dt) => {
			session.fixedStep(
				this.playerIntent,
				this.playerWantsAttack,
				this.playerAimAngle,
				dt,
			);
		});

		this.playerPhys = session.predicted.state;

		const drawAt = session.render(dtSec);
		syncSpriteToBody(this.player, drawAt.x, drawAt.y);
		this.player.grounded = this.playerPhys.grounded;

		this.playOnlineLocalAnim();
		session.playRemoteAnim();
		session.applyDeathAlpha(this.player);
	}

	private playOnlineLocalAnim() {
		if (!this.player) return;
		if (this.playerIntent.left) {
			this.player.anims.play("left", true);
		} else if (this.playerIntent.right) {
			this.player.anims.play("right", true);
		} else {
			this.player.decideIdle();
		}
	}

	private gatherOnlineAIIntent(t: number, dtSec: number) {
		const session = this.online;
		if (!this.player || !this.playerBrain || !session) return;

		const remote = session.remotePosition;
		if (!remote) return;

		// `remotePosition` is already body space, matching the local sim.
		const foe = createPlayerState(remote.x, remote.y);
		const output = this.playerBrain.decide(
			this.perceive(
				this.playerPhys,
				foe,
				this.player.hp,
				session.remoteHp,
				session.remoteFacing,
			),
			t,
			dtSec * 1000,
		);

		this.playerIntent = {
			left: output.moveLeft,
			right: output.moveRight,
			up: output.jump,
		};
		this.playerAimAngle = output.aimAngle;
		this.playerWantsAttack = output.attack;
	}

	// =========================================================
	//  FIGHT LIFECYCLE
	// =========================================================

	private resetFight() {
		if (!this.player || !this.aiEnemy) return;
		this.diagnostics?.markTeleport();

		if (this.aiVsAIMode) {
			if (this.playerBrain) {
				this.playerBrain = new EnemyBrain(this.generateFightConfig());
			}
			this.aiEnemy.updateConfig(this.generateFightConfig());
			this.aiEnemy.resetBrain();
		}

		this.player.hp = 100;
		this.aiEnemy.hp = 100;

		this.playerPhys = createPlayerState(START_PLAYER_X, START_PLAYER_Y);
		this.enemyPhys = createPlayerState(START_ENEMY_X, START_ENEMY_Y);
		this.playerIntent = { ...NO_INTENT };
		this.enemyIntent = { ...NO_INTENT };

		syncSpriteToBody(this.player, this.playerPhys.x, this.playerPhys.y);
		syncSpriteToBody(this.aiEnemy, this.enemyPhys.x, this.enemyPhys.y);

		this.bullets?.clear();
		this.hpText?.setText("hp: 100");
		this.enemyHpText?.setText("enemy hp: 100");
		this.resetScheduled = false;
	}

	private scheduleReset() {
		if (!this.aiVsAIMode || this.resetScheduled) return;
		this.resetScheduled = true;
		this.time.delayedCall(RESET_DELAY_MS, () => {
			this.resetScheduled = false;
			this.resetFight();
			console.log("=== FIGHT RESET ===");
		});
	}

	private generateFightConfig(): AIConfig {
		return {
			skillLevel: 4 + Math.floor(Math.random() * 4),
			reactionTime: 150 + Math.floor(Math.random() * 250),
			accuracy: 0.45 + Math.random() * 0.4,
			aggressiveness: 0.35 + Math.random() * 0.45,
			dodgeChance: 0.2 + Math.random() * 0.4,
		};
	}

	private toggleAIVsAI() {
		this.aiVsAIMode = !this.aiVsAIMode;
		if (this.aiVsAIMode && this.player && this.aiEnemy) {
			this.playerBrain = new EnemyBrain(this.generateFightConfig());
			this.resetFight();
			console.log("=== AI VS AI MODE ENABLED ===");
			console.log("Press 'P' to exit, or call window.__gameState()");
		} else {
			this.playerBrain = undefined;
			this.player?.setAIOverride(null);
			console.log("=== AI VS AI MODE DISABLED ===");
		}
	}
}

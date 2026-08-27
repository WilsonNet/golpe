/**
 * The fighter stage — a hero and its targets, for previews.
 *
 * This is the reusable half of the move list's Storybook: mount it in any
 * element, hand it a hero and a story (`stories.ts`), and it plays the story
 * through the **real** game — the real `tickPlayer`, the real animation and
 * melee-effect systems, the hero's own sheet — on a fixed 60Hz loop. Nothing
 * here is pre-rendered and nothing is faked in CSS: a retune re-times every
 * preview for free, and a new hero's previews exist the moment its sheet and
 * clip table do.
 *
 * The stage also stands in for the **server** for every decision a lone
 * fighter cannot make alone — firing a bullet, throwing an item, casting an
 * ultimate, and judging what all of them do to the story's **target dummies**.
 * It runs the same simulation functions the server runs (`launchHeGrenade`,
 * `resolveMelee`, `dragonSweptRect`, `blossomSweeps`, …) and feeds the results
 * to the same presentation modules a match feeds (`ItemFx`, `BlackHoleFx`,
 * `DragonFx`, `BlossomFx`, `Nameplates`, `BulletSystem`). That is the whole
 * trick: the preview is a projector over real state, never a second
 * implementation of anything — and because the dummies are real fighters
 * ticked through the real `tickPlayer`, a hit's consequences (the stagger,
 * the knockdown, the launch, the root, the hole's grip) are the game's own,
 * not poses this file invented.
 *
 * Presentation only: it reads the simulation and writes sprites, exactly like
 * `Match`'s render path, and it never touches the network or the DOM input.
 */

import { Application, Sprite } from "pixi.js";
import { MAX_HP } from "../../tweakables/combat";
import {
	HE_GRENADE_GRAVITY,
	HE_GRENADE_RADIUS,
	HE_GRENADE_SPEED,
	SMOKE_DURATION_MS,
	TRAP_COLLIDE_R,
	TRAP_DAMAGE,
	TRAP_THROW_GRAVITY,
	TRAP_THROW_SPEED,
} from "../../tweakables/items";
import { pelletDamageAt } from "../../tweakables/ranged";
import {
	BLOSSOM_TICK_DAMAGE,
	BLOSSOM_TICK_MS,
	DRAGON_RIDE_MS,
	DRAGON_SPEED,
	GRENADE_GRAVITY,
	GRENADE_SPEED,
	SINGULARITY_DAMAGE_INTERVAL_MS,
	SINGULARITY_DURATION_MS,
	SINGULARITY_TICK_DAMAGE,
} from "../../tweakables/ultimate";
import { BulletSystem } from "../combat/BulletSystem";
import {
	animationSystem,
	bindFxBodies,
	idleTexture,
	meleeFxSystem,
	nameplateSystem,
	spriteSyncSystem,
} from "../ecs/systems";
import { createQueries, createWorld, type FighterEntity } from "../ecs/world";
import { drawArena, syncSpriteToBody } from "../render/ArenaRenderer";
import {
	createFxTextures,
	loadAssets,
	sheetScale,
	TEX,
	tex,
} from "../render/assets";
import { BlackHoleFx } from "../render/BlackHoleFx";
import { BlossomFx } from "../render/BlossomFx";
import { DragonFx } from "../render/DragonFx";
import { ItemFx } from "../render/ItemFx";
import { type ImpactEvent, MeleeFx } from "../render/MeleeFx";
import { Nameplates } from "../render/Nameplates";
import { Stage } from "../render/Stage";
import {
	buildWorld,
	GROUND,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type World,
} from "../simulation/Arena";
import {
	HEROES,
	type HeroId,
	type HeroKit,
	kitFor,
	LIA_KIT,
} from "../simulation/Heroes";
import {
	type HeGrenadeState,
	heBlastDamage,
	heGrenadeEnd,
	heGrenadeTouches,
	launchHeGrenade,
	launchSmokeGrenade,
	launchTrapCanister,
	type SmokeCloud,
	type SmokeGrenadeState,
	smokeGrenadeEnd,
	type Trap,
	type TrapCanisterState,
	tickHeGrenade,
	tickSmokeGrenade,
	tickTrapCanister,
	trapCatches,
	trapFor,
} from "../simulation/Items";
import {
	applyHitToDefender,
	applyMeleeResult,
	bodyRect,
	bombBlastFor,
	bombFallHeight,
	bulletDistanceFromMuzzle,
	canFire,
	createPlayerState,
	MASSIVE_BLAST_DAMAGE,
	MASSIVE_BLAST_KNOCKBACK_PX_S,
	MASSIVE_BLAST_RADIUS_PX,
	MASSIVE_BLAST_STUN_MS,
	MELEE_IFRAME_MS,
	MOVES,
	massiveSlamPoint,
	NEUTRAL_INTENT,
	type PlayerIntent,
	type PlayerPosition,
	rectsOverlap,
	reserveRoundsFor,
	resolveMelee,
	sweptThrustBox,
	tickPlayer,
	tickReload,
} from "../simulation/Physics";
import {
	BLOSSOM_DURATION_MS,
	type Blossom,
	blossomSweeps,
	DRAGON_DAMAGE,
	DRAGON_KNOCKBACK_PX_S,
	DRAGON_STUN_MS,
	dragonSweptRect,
	dragonVelocity,
	fieldFor,
	type GrenadeState,
	grenadeEnd,
	grenadeTouches,
	launchGrenade,
	type Singularity,
	singularityGrip,
	tickGrenade,
} from "../simulation/Ultimate";
import { HitNumbers } from "./HitNumbers";
import { EMPTY_STORY, PULSE_MS, type Story } from "./stories";

/** The fixed simulation step — the same 60Hz every other clock in the game keeps. */
const STEP_MS = 1000 / 60;
const DT = STEP_MS / 1000;

// ---- presentation constants (this stage's own camera language) ----

/**
 * Draw zoom: stage height over this many world px. A close-up on purpose —
 * the fighter reads at roughly a third of the stage — and the sky's overscan
 * is what lets the camera look past the arena's edges instead of filling the
 * width with black bars.
 */
const ZOOM_REF_HEIGHT_PX = 100;
const ZOOM_MIN = 1.1;
/** How far the sky extends past each world edge, in world widths per side. */
const SKY_OVERSCAN = 1;
/** Camera chase per frame — snappy enough for a dash, soft enough to read as a camera. */
const CAMERA_LERP = 0.12;
/** How far ahead of the fighter the camera looks, in seconds of velocity. */
const CAMERA_LEAD_S = 0.06;
/**
 * Where the interest centre sits down the view: below the middle, so the
 * nameplates above the fighters keep headroom — a TARGET label clipped by
 * the frame's top edge is the read nobody needs — while the floor line they
 * stand on stays in frame.
 */
const CAMERA_Y_BIAS = 0.66;
/**
 * The bomb landing's small sideways shove — the same value the server's
 * `resolveBlasts` applies to a fighter it knocks up out of a crater. It lives
 * there as a private constant because the blast is the one knockup with a
 * pinch of steer; duplicated here rather than exported from `server/`, which
 * a client module must never reach into.
 */
const BOMB_KNOCKBACK_VX = 120;

/** The stage's world: the classic one-screen arena. */
function previewWorld(): World {
	return buildWorld(1);
}

/** Where the loop's fighter starts when the story names no lane: open ground
 * on the left, facing right — clear of the pillars, with runway to the right.
 */
function spawnState(world: World, spawnX?: number): PlayerPosition {
	const x = spawnX ?? Math.max(world.left + 100, world.left + PLAYER_WIDTH * 2);
	return createPlayerState(x, GROUND.y - PLAYER_HEIGHT, 1);
}

/**
 * The low-arc launch angle that lands on a target, for the scripted throws.
 *
 * The preview's throws should land *on* the target — a black hole that opens
 * on the dummy it is about to hold teaches the hold; one that sails into the
 * offscreen distance teaches nothing. Solved from the projectile equation in
 * screen coordinates (y grows downward, gravity positive), taking the low
 * solution; an unreachable distance falls back to the ordinary lob.
 */
function lobAngle(
	dx: number,
	dy: number,
	speed: number,
	gravity: number,
): number {
	if (dx === 0) return -Math.PI / 4;
	const k = (gravity * Math.abs(dx)) / (2 * speed * speed);
	const disc = 1 - 4 * k * (k - dy / dx);
	if (disc < 0) return -Math.PI / 4;
	const tan = (-1 + Math.sqrt(disc)) / (2 * k);
	return Math.atan(tan);
}

/** What `onFrame` hands its observer, once per rendered frame. */
interface StageFrame {
	/** ms into the current loop. */
	t: number;
	/** The fighter's simulation state, as of the last fixed tick. */
	body: PlayerPosition;
	/** The intent the last fixed tick applied. */
	intent: PlayerIntent;
}

export interface FighterStageOptions {
	hero: HeroId;
	story: Story;
	/** Called once per rendered frame, after the systems have run. */
	onFrame?: (frame: StageFrame) => void;
	/** Playback rate. 1 is real time; 0.25 studies a swing frame by frame. */
	speed?: number;
}

/** A massive blast the hero's tick just earned, awaiting its damage pass. */
interface Blast {
	x: number;
	y: number;
	radiusPx: number;
	damage: number;
	stunMs: number;
	knockupVy: number;
}

/** One target dummy: a real fighter entity at a scripted lane. */
interface Target {
	entity: FighterEntity;
	spawnX: number;
}

export class FighterStage {
	/** Async factory: init the renderer, load the sheets, build the fighter. */
	static async create(
		parent: HTMLElement,
		options: FighterStageOptions,
	): Promise<FighterStage> {
		const stage = new FighterStage(parent, options);
		await stage.boot();
		return stage;
	}

	private readonly parent: HTMLElement;
	private readonly opts: FighterStageOptions;

	private app: Application | undefined;
	private stage: Stage | undefined;
	private resizeObserver: ResizeObserver | undefined;
	private destroyed = false;

	private readonly world: World = previewWorld();
	private readonly ecs = createWorld();
	private readonly queries = createQueries(this.ecs);
	private fighter: FighterEntity | undefined;
	private targets: Target[] = [];

	private fx: MeleeFx | undefined;
	private items: ItemFx | undefined;
	private blackHole: BlackHoleFx | undefined;
	private blossomFx: BlossomFx | undefined;
	private dragonFx: DragonFx | undefined;
	private plates: Nameplates | undefined;
	private numbers: HitNumbers | undefined;
	private bullets: BulletSystem | undefined;

	private kit: HeroKit;
	private story: Story = EMPTY_STORY;
	/** Playback rate — 1 in the UI, lower when a probe studies frames. */
	private speed = 1;

	// ---- loop clock ----
	private t = 0;
	private accMs = 0;
	private firedCues = new Set<number>();
	private prevAttack = false;
	private holdingUlt = false;
	/** Monotonic render clock for the effects that dead-reckon (`ItemFx`). */
	private clockMs = 0;
	/** The fire cooldown's own clock — `canFire`, exactly as the server asks it. */
	private lastShotAt = Number.NEGATIVE_INFINITY;

	// ---- the scripted server's world state ----
	private heGrenades: HeGrenadeState[] = [];
	private trapCanisters: TrapCanisterState[] = [];
	private traps: Trap[] = [];
	private smokeGrenades: SmokeGrenadeState[] = [];
	private clouds: SmokeCloud[] = [];
	private grenade: GrenadeState | null = null;
	private singularity: Singularity | null = null;
	private blossom: Blossom | null = null;
	private nextId = 1;

	// ---- the server halves' accumulators and latches ----
	private singularityDamageAcc = 0;
	private blossomDamageAcc = 0;
	/** One dragon hit per dummy per cast, exactly like the server's latch set. */
	private dragonLatches = new Set<string>();
	/** One sweep hit per dummy per thrust, exactly like the server's latch set. */
	private thrustLatches = new Set<string>();

	/** What the probe reads: did the preview's hits actually land? */
	private score = {
		bulletsFired: 0,
		bulletHits: 0,
		meleeHits: 0,
		damageDealt: 0,
		trapsSprung: 0,
	};

	private constructor(parent: HTMLElement, options: FighterStageOptions) {
		this.parent = parent;
		this.opts = options;
		this.kit = kitFor(options.hero);
		this.speed = options.speed ?? 1;
		if (options.story) this.story = options.story;
	}

	private async boot(): Promise<void> {
		const app = new Application();
		const w = Math.max(1, this.parent.clientWidth);
		const h = Math.max(1, this.parent.clientHeight || 340);
		await app.init({
			width: w,
			height: h,
			backgroundAlpha: 0,
			antialias: false,
			roundPixels: true,
			resolution: window.devicePixelRatio || 1,
			autoDensity: true,
		});
		if (this.destroyed) {
			app.destroy(true, { children: true });
			return;
		}
		this.parent.appendChild(app.canvas);
		app.canvas.style.width = "100%";
		app.canvas.style.height = "100%";
		this.app = app;

		// The sheets and the generated combat art are global and cached; a
		// second stage (or the match behind this menu) reuses what loaded first.
		await loadAssets();
		createFxTextures(app.renderer);

		const stage = new Stage(app.stage);
		this.stage = stage;
		drawArena(stage.background, stage.arena, this.world);

		// A wider sky behind the arena's own, so the close-up camera can look
		// past the world's edges without letterboxing: a wide stage gets a
		// bigger fighter rather than black bars past the arena's rim.
		const sky = new Sprite(tex(TEX.sky));
		sky.anchor.set(0.5);
		sky.position.set(this.world.right / 2, this.world.bottom / 2);
		sky.width = this.world.right * SKY_OVERSCAN;
		sky.height = this.world.bottom;
		stage.background.addChild(sky);

		this.fx = new MeleeFx(stage.effects, stage);
		this.items = new ItemFx(stage.field, stage.effects, this.world, stage);
		this.blackHole = new BlackHoleFx(stage.field, stage.effects, stage);
		this.blossomFx = new BlossomFx(stage.field, stage.effects, stage);
		this.dragonFx = new DragonFx(stage.field, stage.effects);
		// The dummies' names and health bars, and the floating damage numbers,
		// and the bullets — all drawn by the modules a match feeds.
		this.plates = new Nameplates(stage.nameplates, this.world);
		this.numbers = new HitNumbers(stage.effects);
		this.bullets = new BulletSystem(
			stage.projectiles,
			tex(TEX.fireball),
			this.world,
		);

		this.spawnFighter(this.opts.hero);
		this.rebuildTargets();
		this.resetLoop();

		app.ticker.add(this.frame);
		this.resizeObserver = new ResizeObserver(() => this.syncSize());
		this.resizeObserver.observe(this.parent);
	}

	/**
	 * The probes' window into the preview, like `window.__physicsDiagnostic`
	 * is the match's. What a move preview must prove is that the scripted
	 * intent actually reached the simulation — a story whose attack never
	 * fired would otherwise preview as a fighter standing still — and, now
	 * the stage has targets, that the hits actually landed on them.
	 *
	 * A getter rather than something `boot` installs: React StrictMode boots
	 * two stages per open and destroys the first *after* the second has
	 * resolved, so whoever installs at boot time can be torn down after the
	 * survivor has claimed the global. The caller publishes on resolve — only
	 * the stage that was kept ever installs.
	 */
	get probeState(): NonNullable<Window["__previewState"]> {
		return () => {
			const f = this.fighter;
			return {
				t: this.t,
				story: this.story.loopMs,
				speed: this.speed,
				x: f?.body.x ?? 0,
				y: f?.body.y ?? 0,
				meleeAction: f?.body.meleeAction ?? "none",
				meleeTimer: f?.body.meleeTimer ?? 0,
				dragonTimer: f?.body.dragonTimer ?? 0,
				stance: f?.body.stance ?? "sword",
				vx: f?.body.vx ?? 0,
				grounded: f?.body.grounded ?? false,
				ammo: f?.body.ammo ?? 0,
				...this.score,
				singularity: this.singularity
					? {
							x: this.singularity.x,
							y: this.singularity.y,
							remainingMs: this.singularity.remainingMs,
						}
					: null,
				targets: this.targets.map((d) => ({
					id: d.entity.fighter.id,
					x: d.entity.body.x,
					y: d.entity.body.y,
					hp: d.entity.fighter.hp,
					maxHp: d.entity.fighter.maxHp,
					stun: d.entity.body.stunTimer > 0,
					down: d.entity.body.knockdownTimer > 0,
					root: d.entity.body.rootTimer > 0,
					held:
						singularityGrip(
							fieldFor(this.singularity, d.entity.fighter.id, null),
							d.entity.body.x,
							d.entity.body.y,
						) === "held",
				})),
			};
		};
	}

	/** Playback rate, for the probes that study a swing frame by frame. */
	setSpeed(speed: number): void {
		this.speed = speed;
	}

	// =========================================================================
	//  The cast: the hero, and the story's target dummies
	// =========================================================================

	private spawnFighter(hero: HeroId): void {
		const app = this.app;
		const stage = this.stage;
		if (!app || !stage) return;

		// Exactly what `Match.spawnFighter` does: the hero's own idle frame,
		// centre-anchored, scaled by the sheet's own cells — the preview draws
		// the same fighter the arena would, at the same size.
		const body = spawnState(this.world);
		const sprite = new Sprite(idleTexture(hero, 1));
		sprite.anchor.set(0.5);
		sprite.scale.set(sheetScale(HEROES[hero].sheet));
		stage.actors.addChild(sprite);

		const entity = this.ecs.add({
			key: "preview",
			fighter: {
				id: "preview",
				local: true,
				hp: MAX_HP,
				maxHp: MAX_HP,
				name: "",
				team: null,
				hero,
			},
			body,
			sprite,
			anim: { clip: "right-idle", frame: 0, elapsedMs: 0 },
		}) as FighterEntity;
		this.armHero(entity);
		this.fighter = entity;
	}

	/**
	 * Build the story's target dummies: real fighter entities, one per x the
	 * story names. They are Lia — the reference kit, a fixed hero so a story
	 * swap never has to re-dress them — and they face the hero's spawn, so
	 * every read a fighter gets in a match (the stance, the nameplate, the
	 * facing) is the read the preview teaches.
	 */
	private rebuildTargets(): void {
		const stage = this.stage;
		if (!stage) return;

		for (const old of this.targets) {
			this.fx?.forget(old.entity.fighter.id);
			this.ecs.remove(old.entity);
			old.entity.sprite.destroy();
		}
		this.targets = [];

		const lanes = this.story.targets ?? [];
		for (const [i, x] of lanes.entries()) {
			const heroX = this.fighter?.body.x ?? spawnState(this.world).x;
			const facing = x >= heroX ? -1 : 1;
			const sprite = new Sprite(idleTexture("lia", facing));
			sprite.anchor.set(0.5);
			sprite.scale.set(sheetScale(HEROES.lia.sheet));
			stage.actors.addChild(sprite);
			const entity = this.ecs.add({
				key: `target-${i}`,
				fighter: {
					id: `target-${i}`,
					local: false,
					hp: MAX_HP,
					maxHp: MAX_HP,
					name: "TARGET",
					team: null,
					hero: "lia",
				},
				body: createPlayerState(x, GROUND.y - PLAYER_HEIGHT, facing),
				sprite,
				anim: {
					clip: facing < 0 ? "left-idle" : "right-idle",
					frame: 0,
					elapsedMs: 0,
				},
			}) as FighterEntity;
			syncSpriteToBody(entity.sprite, entity.body.x, entity.body.y);
			this.targets.push({ entity, spawnX: x });
		}

		// Rebind the effects layer's body sprites — the punches land on the
		// sprite, and a rebuilt dummy is a new sprite.
		if (this.fx && this.fighter) bindFxBodies(this.queries, this.fx);
	}

	private frame = (): void => {
		const app = this.app;
		const stage = this.stage;
		if (!app || !stage || this.destroyed) return;

		// Playback rate scales only the *simulation* clock; the presentation
		// systems keep real frame time, exactly like the game's own slow-mo
		// would — a swing studied at 0.25x still animates smoothly.
		const dtMs = Math.min(app.ticker.deltaMS, 100);
		this.accMs += dtMs * this.speed;
		while (this.accMs >= STEP_MS) {
			this.tick();
			this.accMs -= STEP_MS;
		}

		const f = this.fighter;
		if (!f) return;

		animationSystem(this.queries, dtMs);
		spriteSyncSystem(this.queries);
		const fx = this.fx;
		if (fx) {
			meleeFxSystem(this.queries, fx, dtMs, () => this.holdingUlt);
			fx.update(dtMs);
		}
		if (this.plates) nameplateSystem(this.queries, this.plates);
		stage.update(dtMs);

		// The scripted server's objects, drawn by the modules a match feeds.
		this.clockMs += dtMs;
		const items = this.items;
		if (items) {
			items.syncHeGrenades(this.heGrenades, this.clockMs);
			items.syncTrapCanisters(this.trapCanisters, this.clockMs);
			// Viewer "" is nobody the trap belongs to, so the mine draws vivid —
			// the read a victim needs, which is the read a preview teaches.
			items.syncTraps(this.traps, "", null);
			items.syncSmokeGrenades(this.smokeGrenades, this.clockMs);
			items.syncSmokeClouds(this.clouds, "", null);
		}
		const blackHole = this.blackHole;
		if (blackHole) {
			blackHole.syncGrenades(this.grenade ? [this.grenade] : [], dtMs);
			// The hole in a preview is the hero's own cast, so the ring reads as
			// the caster sees it: violet, not the hostile red a match shows for
			// somebody else's. The preview teaches the move, not the threat.
			blackHole.update(this.singularity, [], dtMs, "preview", null);
		}
		this.blossomFx?.update(this.blossom, dtMs);
		this.dragonFx?.update(this.dragonRider(), dtMs);

		// The bullets: despawn spent rounds, land hits, move the sprites — the
		// same `resolve` the offline hatch runs, against the dummies.
		if (this.bullets) {
			this.bullets.resolve(
				this.targets.map((d) => ({
					owner: "enemy" as const,
					x: d.entity.body.x,
					y: d.entity.body.y,
					alive: d.entity.fighter.hp > 0,
					state: d.entity.body,
					onHit: (b) => {
						this.score.bulletHits++;
						this.hurt(
							d,
							pelletDamageAt(this.kit.ranged, bulletDistanceFromMuzzle(b)),
							b.x,
							b.y,
						);
					},
				})),
			);
		}

		this.numbers?.update(dtMs);

		this.followCamera(stage, f);

		this.opts.onFrame?.({ t: this.t, body: f.body, intent: this.lastIntent });
	};

	private lastIntent: PlayerIntent = { ...NEUTRAL_INTENT };

	// =========================================================================
	//  One fixed tick: story clock → intent → the real simulation → the
	//  server halves that decide what it did to the targets
	// =========================================================================

	private tick(): void {
		const f = this.fighter;
		if (!f) return;

		this.t += STEP_MS;
		if (this.t >= this.story.loopMs) {
			this.resetLoop();
			return;
		}

		const intent: PlayerIntent = { ...NEUTRAL_INTENT };
		for (const step of this.story.steps) {
			if (step.input === undefined) continue;
			const hold = step.for ?? PULSE_MS;
			if (this.t >= step.at && this.t < step.at + hold) {
				Object.assign(intent, step.input);
			}
		}
		for (const [i, step] of this.story.steps.entries()) {
			if (step.cue === undefined || this.firedCues.has(i)) continue;
			if (this.t >= step.at) {
				this.firedCues.add(i);
				this.fireCue(step.cue);
			}
		}

		// The blast boundary the server reads during the hero's own tick: a
		// massive's slam, a bomb's landing. Both are transitions `tickPlayer`
		// produces identically on every client; only the damage is the server's.
		const prev = {
			action: f.body.meleeAction,
			timer: f.body.meleeTimer,
			plunging: f.body.plunging,
		};

		f.body = tickPlayer(
			f.body,
			intent,
			DT,
			this.world,
			// The friendly-fire rule, asked the way every caller asks it: the
			// caster is simply handed null and never pulled by their own hole.
			fieldFor(this.singularity, f.fighter.id, f.fighter.team),
			this.kit,
			// The fighter's own traps are simply not handed to it.
			trapFor(this.traps, f.fighter.id, f.fighter.team),
		);
		const blasts = this.noteBlasts(f, prev);

		// The dummies simulate too — neutral intent, but the real physics: a
		// knocked-back dummy flies, a held dummy orbits the hole, a rooted one
		// stands. Every hit reaction below is the game's own, not a pose.
		for (const d of this.targets) {
			d.entity.body = tickPlayer(
				d.entity.body,
				NEUTRAL_INTENT,
				DT,
				this.world,
				fieldFor(this.singularity, d.entity.fighter.id, null),
				LIA_KIT,
				trapFor(this.traps, d.entity.fighter.id, null),
			);
		}

		// ---- the server halves, in the server's own order ----
		this.resolveBlasts(f, blasts);
		this.resolveMeleeHits(f);
		this.fireBullet(intent, f);
		this.resolveThrusts(f);
		this.resolveDragonHits(f);
		this.tickBullets();
		this.tickSingularity();
		this.tickBlossom();
		this.springTraps();

		// Ammo is server-ticked in a match; the preview stands in for that
		// server the same way the `?offline=true` hatch does — a spent round
		// per firing edge, and the *shared* `tickReload` for the reload rhythm.
		// This exists so the gun-fire clip plays: the animation system reads an
		// ammo drop as firing, exactly as it does on the wire.
		const attackEdge = intent.attack && !this.prevAttack;
		if (attackEdge && f.body.stance === "gun" && f.body.ammo > 0) {
			f.body.ammo--;
		}
		tickReload(f.body, intent, this.kit, DT);
		this.prevAttack = intent.attack;
		this.holdingUlt = intent.ultimate;
		this.lastIntent = intent;

		this.tickScriptedWorld();
	}

	/** The scripted server: advance every world object it has spawned. */
	private tickScriptedWorld(): void {
		const dt = DT;

		this.heGrenades = this.heGrenades.filter((g) => {
			tickHeGrenade(g, dt, this.world);
			// A direct hit on a dummy detonates on them, like the server's
			// `touched` test.
			const touched = this.targets.some((d) =>
				heGrenadeTouches(
					g,
					d.entity.fighter.id,
					d.entity.body.x,
					d.entity.body.y,
					d.entity.fighter.team,
				),
			);
			if (!heGrenadeEnd(g, touched)) return true;
			this.explodeHeGrenade(g);
			return false;
		});

		this.trapCanisters = this.trapCanisters.filter((c) => {
			if (!tickTrapCanister(c, dt, this.world)) return true;
			this.traps.push({
				id: c.id,
				ownerId: c.ownerId,
				ownerTeam: c.ownerTeam,
				x: c.x,
				y: c.y + TRAP_COLLIDE_R,
			});
			return false;
		});

		this.smokeGrenades = this.smokeGrenades.filter((g) => {
			tickSmokeGrenade(g, dt, this.world);
			if (!smokeGrenadeEnd(g)) return true;
			this.clouds.push({
				id: g.id,
				ownerId: g.ownerId,
				ownerTeam: g.ownerTeam,
				x: g.x,
				y: g.y,
				remainingMs: SMOKE_DURATION_MS,
			});
			return false;
		});
		this.clouds = this.clouds.filter((c) => {
			c.remainingMs -= dt * 1000;
			return c.remainingMs > 0;
		});

		if (this.grenade) {
			const g = this.grenade;
			tickGrenade(g, dt);
			// The ult grenade lands on a dummy it touches — but a dummy has no
			// guard to deny with, so there is no deny branch to mirror.
			const touched = this.targets.some((d) =>
				grenadeTouches(
					g,
					d.entity.fighter.id,
					d.entity.body.x,
					d.entity.body.y,
					d.entity.fighter.team,
				),
			);
			const end = grenadeEnd(g, this.world, touched);
			if (end !== null) {
				const { x, y } = g;
				this.singularity = {
					id: g.id,
					ownerId: g.ownerId,
					ownerTeam: g.ownerTeam,
					// Clamped into the arena, exactly like the server's
					// `openSingularity` — a grenade that ends on a wall edge
					// still opens a whole hole *at* the wall.
					x: Math.max(this.world.left, Math.min(x, this.world.right)),
					y: Math.max(this.world.top, Math.min(y, this.world.bottom)),
					remainingMs: SINGULARITY_DURATION_MS,
				};
				this.singularityDamageAcc = 0;
				this.blackHole?.detonate(x, y, g.ownerTeam);
				this.grenade = null;
			}
		}
		if (this.singularity) {
			this.singularity.remainingMs -= dt * 1000;
			if (this.singularity.remainingMs <= 0) this.singularity = null;
		}
		if (this.blossom) {
			this.blossom.remainingMs -= dt * 1000;
			if (this.blossom.remainingMs <= 0) this.blossom = null;
		}
	}

	// =========================================================================
	//  The server halves
	// =========================================================================

	/**
	 * Notice the two ways a massive reaches the floor — the ground slam and the
	 * bomb's landing — exactly as `GameRoom.noteBlasts` reads them off the same
	 * `tickPlayer` transitions.
	 */
	private noteBlasts(
		f: FighterEntity,
		prev: {
			action: PlayerPosition["meleeAction"];
			timer: number;
			plunging: boolean;
		},
	): Blast[] {
		const s = f.body;
		const blasts: Blast[] = [];

		const activeEnd = MOVES.massive.startupMs + MOVES.massive.activeMs;
		if (
			prev.action === "massive" &&
			prev.timer < activeEnd &&
			s.meleeAction === "massive" &&
			s.meleeTimer >= activeEnd
		) {
			const point = massiveSlamPoint(s);
			blasts.push({
				x: point.x,
				y: point.y,
				radiusPx: MASSIVE_BLAST_RADIUS_PX,
				damage: MASSIVE_BLAST_DAMAGE,
				stunMs: MASSIVE_BLAST_STUN_MS,
				knockupVy: 0,
			});
		}

		if (prev.plunging && !s.plunging && s.grounded) {
			const blast = bombBlastFor(bombFallHeight(s.plungeOriginY, s.y));
			blasts.push({
				x: s.x + PLAYER_WIDTH / 2,
				y: s.y + PLAYER_HEIGHT / 2,
				radiusPx: blast.radiusPx,
				damage: blast.damage,
				stunMs: blast.stunMs,
				knockupVy: blast.knockupVy,
			});
		}
		return blasts;
	}

	/**
	 * Apply every blast this tick earned, to every dummy it reaches — the
	 * server's `resolveBlasts`, verbatim in its writes. A blast ignores a
	 * guard entirely and never touches the fighter who made it.
	 */
	private resolveBlasts(f: FighterEntity, blasts: Blast[]): void {
		for (const blast of blasts) {
			let first = "";
			for (const d of this.targets) {
				const victim = d.entity;
				if (victim.fighter.hp <= 0) continue;
				const cx = victim.body.x + PLAYER_WIDTH / 2;
				const cy = victim.body.y + PLAYER_HEIGHT / 2;
				if (Math.hypot(cx - blast.x, cy - blast.y) > blast.radiusPx) continue;
				if (!first) first = victim.fighter.id;

				const v = victim.body;
				v.stunTimer = Math.max(v.stunTimer, blast.stunMs);
				v.iframeTimer = MELEE_IFRAME_MS;
				if (blast.knockupVy !== 0) {
					if (v.plungeCarryTimer > 0) {
						// Pinned, not launched — the server's carried-victim branch.
						v.plungeCarryTimer = 0;
						v.knockdownTimer = Math.max(v.knockdownTimer, blast.stunMs);
					} else {
						v.vy = blast.knockupVy;
						v.grounded = false;
						v.vx += (Math.sign(cx - blast.x) || 1) * BOMB_KNOCKBACK_VX;
					}
				} else {
					v.vx += (Math.sign(cx - blast.x) || 1) * MASSIVE_BLAST_KNOCKBACK_PX_S;
				}
				v.plungeStuckTimer = 0;
				v.meleeAction = "none";
				v.meleeTimer = 0;
				v.hitLatch = false;
				v.blocking = false;
				v.comboStep = 0;
				v.comboTimer = 0;
				this.hurt(d, blast.damage, blast.x, blast.y, 0xffd166);
			}
			this.fx?.impact(
				{
					move: "massive",
					outcome: blast.knockupVy !== 0 ? "bomb" : "blast",
					x: blast.x,
					y: blast.y,
					dir: f.body.facing >= 0 ? 1 : -1,
					radiusPx: blast.radiusPx,
				} as ImpactEvent,
				first,
				f.fighter.id,
			);
		}
	}

	/**
	 * Judge the hero's live melee hitbox against every dummy — the server's
	 * `resolveMeleeHits` with one attacker. A hit latches the attacker's
	 * swing, which is also what keeps the thrust's sweep (run after this, in
	 * the server's order) from hitting a body the reach box already caught.
	 */
	private resolveMeleeHits(f: FighterEntity): void {
		for (const d of this.targets) {
			const victim = d.entity;
			if (victim.fighter.hp <= 0) continue;

			const result = resolveMelee(f.body, victim.body);
			if (!result) continue;
			const dealt = applyMeleeResult(f.body, victim.body, result);
			this.fx?.impact(result as ImpactEvent, victim.fighter.id, f.fighter.id);
			if (dealt > 0) this.score.meleeHits++;
			this.hurt(d, dealt, result.x, result.y);
		}
	}

	/**
	 * The thrust's sweep: multi-target, once each per cast — the server's
	 * `resolveThrusts`, latch set and all. It runs after the ordinary pass,
	 * so a body the reach box caught (which spent the attacker's latch) is
	 * already out of the sweep's way, and the sweep exists for exactly the
	 * bodies the lunge passed through.
	 */
	private resolveThrusts(f: FighterEntity): void {
		if (f.body.meleeAction !== "thrust") this.thrustLatches.clear();
		const box = sweptThrustBox(f.body);
		if (!box) return;
		for (const d of this.targets) {
			const victim = d.entity;
			if (victim.fighter.hp <= 0) continue;
			if (victim.body.plunging) continue;
			if (this.thrustLatches.has(victim.fighter.id)) continue;
			if (!rectsOverlap(box, bodyRect(victim.body.x, victim.body.y))) continue;
			this.thrustLatches.add(victim.fighter.id);
			const dir = f.body.facing >= 0 ? 1 : -1;
			const result = {
				move: "thrust" as const,
				outcome: "hit" as const,
				damage: MOVES.thrust.damage,
				x: box.x + box.w / 2,
				y: box.y + box.h / 2,
				dir,
			};
			const dealt = applyHitToDefender(victim.body, result);
			this.fx?.impact(result as ImpactEvent, victim.fighter.id, f.fighter.id);
			this.score.meleeHits++;
			this.hurt(d, dealt, result.x, result.y);
		}
	}

	/**
	 * The gun: fire on the trigger, through the same fan the server spawns —
	 * cooldown, magazine, pellets and all. The angle is the story's aim, the
	 * same way a match's is the player's cursor.
	 */
	private fireBullet(intent: PlayerIntent, f: FighterEntity): void {
		if (
			f.body.stance !== "gun" ||
			!intent.attack ||
			f.body.ammo <= 0 ||
			!canFire(this.lastShotAt, this.t, this.kit.ranged.cooldownMs)
		) {
			return;
		}
		this.lastShotAt = this.t;
		const muzzleX = f.body.x + PLAYER_WIDTH / 2;
		const muzzleY = f.body.y + PLAYER_HEIGHT / 2;
		const facing = f.body.facing >= 0 ? 1 : -1;
		const aim =
			this.story.aim !== undefined
				? facing > 0
					? this.story.aim
					: Math.PI - this.story.aim
				: facing > 0
					? 0
					: Math.PI;
		this.bullets?.fireFan(muzzleX, muzzleY, aim, "player", this.kit.ranged);
		this.score.bulletsFired += this.kit.ranged.pellets ?? 1;
	}

	/** Advance and let `resolve` land the hits, on the fixed step. */
	private tickBullets(): void {
		this.bullets?.step(DT);
	}

	/**
	 * The dragon's sweep: everyone on the ridden line is knocked back and
	 * damaged once per cast, with the server's exact writes and its
	 * `thrust`-shaped impact event.
	 */
	private resolveDragonHits(f: FighterEntity): void {
		const box = dragonSweptRect(f.body);
		if (!box) {
			this.dragonLatches.clear();
			return;
		}
		const nx = f.body.dragonVX / DRAGON_SPEED;
		const ny = f.body.dragonVY / DRAGON_SPEED;
		for (const d of this.targets) {
			const victim = d.entity;
			if (victim.fighter.hp <= 0) continue;
			if (this.dragonLatches.has(victim.fighter.id)) continue;
			if (!rectsOverlap(box, bodyRect(victim.body.x, victim.body.y))) continue;
			this.dragonLatches.add(victim.fighter.id);
			const v = victim.body;
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
			const impact = {
				move: "thrust" as const,
				outcome: "hit" as const,
				x: box.x + box.w / 2,
				y: box.y + box.h / 2,
				dir: nx >= 0 ? 1 : -1,
			};
			this.fx?.impact(impact as ImpactEvent, victim.fighter.id, f.fighter.id);
			this.hurt(d, DRAGON_DAMAGE, impact.x, impact.y);
		}
	}

	/** The hole's tick damage: every dummy it holds, once per interval. */
	private tickSingularity(): void {
		const field = this.singularity;
		if (!field) return;
		this.singularityDamageAcc += DT * 1000;
		if (this.singularityDamageAcc < SINGULARITY_DAMAGE_INTERVAL_MS) return;
		this.singularityDamageAcc -= SINGULARITY_DAMAGE_INTERVAL_MS;
		for (const d of this.targets) {
			const victim = d.entity;
			if (victim.fighter.hp <= 0) continue;
			const mine = fieldFor(field, victim.fighter.id, victim.fighter.team);
			if (singularityGrip(mine, victim.body.x, victim.body.y) !== "held") {
				continue;
			}
			this.hurt(d, SINGULARITY_TICK_DAMAGE, field.x, field.y, 0xd9b3ff);
		}
	}

	/** The storm's tick damage: every dummy the blossom sweeps, per interval. */
	private tickBlossom(): void {
		const field = this.blossom;
		if (!field) return;
		this.blossomDamageAcc += DT * 1000;
		if (this.blossomDamageAcc < BLOSSOM_TICK_MS) return;
		this.blossomDamageAcc -= BLOSSOM_TICK_MS;
		for (const d of this.targets) {
			const victim = d.entity;
			if (victim.fighter.hp <= 0) continue;
			if (
				!blossomSweeps(
					field,
					victim.fighter.id,
					victim.fighter.team,
					victim.body.x,
					victim.body.y,
					this.world,
				)
			) {
				continue;
			}
			this.hurt(d, BLOSSOM_TICK_DAMAGE, field.x, field.y, 0xff9a4d);
		}
	}

	/**
	 * Spring the traps on the dummies. The lock itself already happened inside
	 * their `tickPlayer` — this is the consequence, which only the server owns:
	 * the single-use trap is destroyed, the burst fires, the damage lands.
	 */
	private springTraps(): void {
		if (this.traps.length === 0) return;
		let kept = 0;
		for (const trap of this.traps) {
			let sprung = false;
			for (const d of this.targets) {
				const victim = d.entity;
				if (victim.fighter.hp <= 0) continue;
				if (
					trapFor([trap], victim.fighter.id, victim.fighter.team).length === 0
				) {
					continue;
				}
				if (!trapCatches(trap, victim.body.x, victim.body.y)) continue;
				sprung = true;
				this.items?.trapBurst(victim.body.x, victim.body.y);
				this.numbers?.pop(
					victim.body.x + PLAYER_WIDTH / 2,
					victim.body.y,
					"ROOTED!",
					0x7ff0f4,
				);
				this.score.trapsSprung++;
				this.hurt(d, TRAP_DAMAGE, trap.x, trap.y, 0x7ff0f4);
			}
			if (!sprung) this.traps[kept++] = trap;
		}
		this.traps.length = kept;
	}

	/** The HE blast's damage pass — the server's `explodeHeGrenade`. */
	private explodeHeGrenade(g: HeGrenadeState): void {
		this.items?.explode(g.x, g.y, HE_GRENADE_RADIUS);
		for (const d of this.targets) {
			const victim = d.entity;
			if (victim.fighter.hp <= 0) continue;
			if (victim.fighter.id === g.ownerId) continue;
			const dx = g.x - (victim.body.x + PLAYER_WIDTH / 2);
			const dy = g.y - (victim.body.y + PLAYER_HEIGHT / 2);
			const damage = heBlastDamage(Math.hypot(dx, dy));
			if (damage <= 0) continue;
			this.hurt(d, damage, g.x, g.y, 0xff9a4d);
		}
	}

	/** Deal damage to a dummy and announce it. The one damage funnel the stage has. */
	private hurt(
		d: Target,
		damage: number,
		x?: number,
		y?: number,
		tint = 0xffe6a8,
	): void {
		if (damage <= 0) return;
		d.entity.fighter.hp = Math.max(0, d.entity.fighter.hp - damage);
		this.score.damageDealt += damage;
		this.numbers?.pop(
			x ?? d.entity.body.x + PLAYER_WIDTH / 2,
			y ?? d.entity.body.y,
			`${Math.round(damage)}`,
			tint,
		);
	}

	/**
	 * The per-life magazine, filled exactly as the server's `refillMagazine`
	 * fills it on spawn. Without it the preview's hero carried the
	 * `createPlayerState` zero and the gun could never fire a round — the
	 * rifle preview mimed its trigger pulls forever.
	 */
	private armHero(f: FighterEntity): void {
		f.body.ammo = this.kit.ranged.magazine;
		f.body.reserveRounds = reserveRoundsFor(this.kit.ranged);
		f.body.reloadTimer = 0;
	}

	/** Interpret a cue with the hero's own kit — the stage, not the story, knows the weapons. */
	private fireCue(cue: "throw-item" | "cast-ult"): void {
		const f = this.fighter;
		if (!f) return;
		const cx = f.body.x + PLAYER_WIDTH / 2;
		const cy = f.body.y + PLAYER_HEIGHT / 2;
		const facing = f.body.facing < 0 ? -1 : 1;
		const id = this.nextId++;

		// The scripted throws aim at the first target when the story names one —
		// a lob solved to land on the dummy teaches the landing; a lob that
		// sails offstage teaches nothing.
		const aimAt = this.targets[0];
		const solved = (
			speed: number,
			gravity: number,
			fallback: number,
		): number => {
			if (!aimAt) return fallback;
			const tx = aimAt.entity.body.x + PLAYER_WIDTH / 2;
			const ty = aimAt.entity.body.y + PLAYER_HEIGHT / 2;
			const a = lobAngle(Math.abs(tx - cx), ty - cy, speed, gravity);
			return facing > 0 ? a : Math.PI - a;
		};

		if (cue === "throw-item") {
			// A forward lob — solved onto the target when there is one, the
			// standing 45° throw when there is not.
			const angle = solved(
				HE_GRENADE_SPEED,
				HE_GRENADE_GRAVITY,
				facing > 0 ? -Math.PI / 4 : Math.PI + Math.PI / 4,
			);
			switch (this.kit.item.id) {
				case "he-grenade":
					this.heGrenades.push(
						launchHeGrenade(id, "preview", cx, cy - 12, angle, null),
					);
					break;
				case "trap":
					this.trapCanisters.push(
						launchTrapCanister(
							id,
							"preview",
							cx,
							cy - 12,
							solved(TRAP_THROW_SPEED, TRAP_THROW_GRAVITY, angle),
							f.body.vx,
							f.body.vy,
							null,
						),
					);
					break;
				case "smoke-grenade":
					this.smokeGrenades.push(
						launchSmokeGrenade(id, "preview", cx, cy - 12, angle, null),
					);
					break;
			}
			return;
		}

		// cast-ult, per the kit's ultimate — the same writes the server makes.
		switch (this.kit.ultimate) {
			case "black-hole": {
				// The story's measured line when it names one; otherwise a lob
				// solved onto the first target, so the hold happens *on* somebody.
				const a =
					this.story.castAngle ?? solved(GRENADE_SPEED, GRENADE_GRAVITY, -0.6);
				const g = launchGrenade(id, "preview", cx, cy, a, null);
				this.grenade = g;
				this.blackHole?.launch(cx, cy, null);
				break;
			}
			case "dragon-thrust": {
				// The story's own measured line, or the shallow climb that
				// clears the ground-level pillars.
				const a = this.story.castAngle ?? (facing > 0 ? -0.55 : Math.PI + 0.55);
				const v = dragonVelocity(a);
				f.body.dragonTimer = DRAGON_RIDE_MS;
				f.body.dragonVX = v.vx;
				f.body.dragonVY = v.vy;
				break;
			}
			case "death-blossom": {
				f.body.blossomTimer = BLOSSOM_DURATION_MS;
				this.blossom = {
					id,
					ownerId: "preview",
					ownerTeam: null,
					x: cx,
					y: cy,
					remainingMs: BLOSSOM_DURATION_MS,
				};
				this.blossomFx?.open(cx, cy, null);
				break;
			}
		}
	}

	/** The dragon trail chases a rider; Anands' own ride art carries her instead. */
	private dragonRider(): {
		x: number;
		y: number;
		vx: number;
		vy: number;
	} | null {
		const f = this.fighter;
		if (!f || f.body.dragonTimer <= 0) return null;
		if (f.fighter.hero === "anands") return null;
		return {
			x: f.body.x + PLAYER_WIDTH / 2,
			y: f.body.y + PLAYER_HEIGHT / 2,
			vx: f.body.dragonVX,
			vy: f.body.dragonVY,
		};
	}

	// =========================================================================
	//  Camera, loop reset, story swap, teardown
	// =========================================================================

	private camX = 0;
	private camY = 0;

	/** The stage's view of the world at its current size. */
	private view(): { zoom: number; viewW: number; viewH: number } | null {
		const app = this.app;
		if (!app) return null;
		const zoom = Math.max(
			ZOOM_MIN,
			app.screen.height / ZOOM_REF_HEIGHT_PX,
			app.screen.width / this.world.right,
		);
		return {
			zoom,
			viewW: app.screen.width / zoom,
			viewH: app.screen.height / zoom,
		};
	}

	/**
	 * Frame the whole scene: the fighter **and** its consequences.
	 *
	 * The old camera chased the fighter alone, and a preview taught moves the
	 * way a film teaches them with the camera glued to the lead — the black
	 * hole's grenade flew offstage and opened out of frame, so the cast read
	 * as nothing happening. The interest set is the hero, the dummies and
	 * every live world object; the camera sits at the middle of all of it,
	 * clamped to the arena's own overshoot.
	 */
	private followCamera(stage: Stage, f: FighterEntity): void {
		const view = this.view();
		if (!view) return;
		const { zoom, viewW, viewH } = view;

		let minX = f.body.x + PLAYER_WIDTH / 2;
		let maxX = minX;
		let minY = f.body.y + PLAYER_HEIGHT / 2;
		let maxY = minY;
		const consider = (x: number, y: number) => {
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			minY = Math.min(minY, y);
			maxY = Math.max(maxY, y);
		};
		const leadX = f.body.vx * CAMERA_LEAD_S;
		consider(minX + leadX, minY + f.body.vy * CAMERA_LEAD_S);
		for (const d of this.targets) {
			consider(
				d.entity.body.x + PLAYER_WIDTH / 2,
				d.entity.body.y + PLAYER_HEIGHT / 2,
			);
		}
		if (this.singularity) consider(this.singularity.x, this.singularity.y);
		if (this.grenade) consider(this.grenade.x, this.grenade.y);
		if (this.blossom) consider(this.blossom.x, this.blossom.y);
		for (const g of this.heGrenades) consider(g.x, g.y);
		for (const c of this.trapCanisters) consider(c.x, c.y);

		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;
		const overX = Math.max(0, viewW - this.world.right) / 2;
		const overY = Math.max(0, viewH - this.world.bottom) / 2;
		const targetX = clamp(
			cx - viewW / 2,
			this.world.left - overX,
			this.world.right + overX - viewW,
		);
		const targetY = clamp(
			cy - viewH * CAMERA_Y_BIAS,
			this.world.top - overY,
			this.world.bottom + overY - viewH,
		);
		this.camX += (targetX - this.camX) * CAMERA_LERP;
		this.camY += (targetY - this.camY) * CAMERA_LERP;
		stage.setCamera(this.camX, this.camY, zoom);
	}

	/** Reset the loop: a fresh fighter, fresh dummies, an empty scripted world, quiet effects. */
	private resetLoop(): void {
		this.t = 0;
		this.accMs = 0;
		this.firedCues.clear();
		this.prevAttack = false;
		this.holdingUlt = false;
		this.lastIntent = { ...NEUTRAL_INTENT };
		this.lastShotAt = Number.NEGATIVE_INFINITY;
		this.singularityDamageAcc = 0;
		this.blossomDamageAcc = 0;
		this.dragonLatches.clear();
		this.score = {
			bulletsFired: 0,
			bulletHits: 0,
			meleeHits: 0,
			damageDealt: 0,
			trapsSprung: 0,
		};

		const f = this.fighter;
		if (f) {
			f.body = spawnState(this.world, this.story.spawnX);
			this.armHero(f);
			f.anim = { clip: "right-idle", frame: 0, elapsedMs: 0 };
			f.sprite.rotation = 0;
			f.sprite.alpha = 1;
			f.sprite.tint = 0xffffff;
			f.sprite.scale.set(sheetScale(HEROES[f.fighter.hero].sheet));
			syncSpriteToBody(f.sprite, f.body.x, f.body.y);
		}

		// The dummies take their marks again: fresh bodies, full health, and a
		// facing that looks at wherever the hero now stands.
		const heroX = f?.body.x ?? 0;
		for (const d of this.targets) {
			const facing = d.spawnX >= heroX ? -1 : 1;
			d.entity.body = createPlayerState(
				d.spawnX,
				GROUND.y - PLAYER_HEIGHT,
				facing,
			);
			d.entity.fighter.hp = d.entity.fighter.maxHp;
			d.entity.anim = {
				clip: facing < 0 ? "left-idle" : "right-idle",
				frame: 0,
				elapsedMs: 0,
			};
			d.entity.sprite.rotation = 0;
			d.entity.sprite.alpha = 1;
			d.entity.sprite.tint = 0xffffff;
			d.entity.sprite.scale.set(sheetScale(HEROES.lia.sheet));
			syncSpriteToBody(d.entity.sprite, d.entity.body.x, d.entity.body.y);
		}

		this.heGrenades = [];
		this.trapCanisters = [];
		this.traps = [];
		this.smokeGrenades = [];
		this.clouds = [];
		this.grenade = null;
		this.singularity = null;
		this.blossom = null;

		this.fx?.reset();
		this.items?.reset();
		this.blackHole?.reset();
		this.blossomFx?.reset();
		this.dragonFx?.reset();
		this.bullets?.clear();
		this.numbers?.reset();

		// Snap the camera to the new spawn rather than gliding across the arena.
		const view = this.view();
		if (view) {
			const { viewW, viewH } = view;
			const overX = Math.max(0, viewW - this.world.right) / 2;
			const overY = Math.max(0, viewH - this.world.bottom) / 2;
			const at = f?.body;
			const focusX = at ? at.x + PLAYER_WIDTH / 2 : this.world.right / 2;
			const focusY = at ? at.y + PLAYER_HEIGHT / 2 : this.world.bottom / 2;
			this.camX = clamp(
				focusX - viewW / 2,
				this.world.left - overX,
				this.world.right + overX - viewW,
			);
			this.camY = clamp(
				focusY - viewH / 2,
				this.world.top - overY,
				this.world.bottom + overY - viewH,
			);
		}
	}

	/** Swap the story (and optionally the hero) without tearing the stage down. */
	setStory(options: { hero?: HeroId; story: Story }): void {
		this.opts.hero = options.hero ?? this.opts.hero;
		this.kit = kitFor(this.opts.hero);
		this.story = options.story;
		const f = this.fighter;
		if (f && options.hero && f.fighter.hero !== options.hero) {
			f.fighter.hero = options.hero;
			const tex = idleTexture(options.hero, 1);
			if (tex) f.sprite.texture = tex;
			f.sprite.scale.set(sheetScale(HEROES[options.hero].sheet));
			// The blade sprites carry the old hero's scale; rebind from scratch.
			if (this.fx) {
				this.fx.forget(f.fighter.id);
				bindFxBodies(this.queries, this.fx);
			}
		}
		// The dummies are the story's: a new story is a new set of lanes.
		this.rebuildTargets();
		this.resetLoop();
	}

	private syncSize(): void {
		const app = this.app;
		if (!app || this.destroyed) return;
		const w = Math.max(1, this.parent.clientWidth);
		const h = Math.max(1, this.parent.clientHeight);
		app.renderer.resize(w, h);
	}

	destroy(): void {
		this.destroyed = true;
		this.resizeObserver?.disconnect();
		this.numbers?.destroy();
		const app = this.app;
		if (app) {
			app.ticker.remove(this.frame);
			// `releaseGlobalResources: false` is load-bearing: this page always
			// has another renderer alive (the match behind the menu), and the
			// default releases the *shared* batch and texture state out from
			// under it — every renderer on the page then throws inside its
			// batcher. React StrictMode's double-mount makes this fire on
			// every open, so it is not a corner.
			app.destroy(
				{ removeView: true, releaseGlobalResources: false },
				{ children: true },
			);
			this.app = undefined;
		}
	}
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}

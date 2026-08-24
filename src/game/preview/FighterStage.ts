/**
 * The fighter stage — a one-fighter match, for previews.
 *
 * This is the reusable half of the move list's Storybook: mount it in any
 * element, hand it a hero and a story (`stories.ts`), and it plays the story
 * through the **real** game — the real `tickPlayer`, the real animation and
 * melee-effect systems, the hero's own sheet — on a fixed 60Hz loop. Nothing
 * here is pre-rendered and nothing is faked in CSS: a retune re-times every
 * preview for free, and a new hero's previews exist the moment its sheet and
 * clip table do.
 *
 * The stage also stands in for the **server** for the two decisions a lone
 * fighter cannot make alone — an item throw and an ultimate cast — by running
 * the same simulation functions the server runs (`launchHeGrenade`,
 * `launchGrenade`, `dragonVelocity`, …) and feeding the results to the same
 * presentation modules a match feeds (`ItemFx`, `BlackHoleFx`, `DragonFx`,
 * `BlossomFx`). That is the whole trick: the preview is a projector over real
 * state, never a second implementation of anything.
 *
 * Presentation only: it reads the simulation and writes sprites, exactly like
 * `Match`'s render path, and it never touches the network or the DOM input.
 */

import { Application, Sprite } from "pixi.js";
import { MAX_HP } from "../../tweakables/combat";
import {
	HE_GRENADE_RADIUS,
	SMOKE_DURATION_MS,
	TRAP_COLLIDE_R,
} from "../../tweakables/items";
import {
	DRAGON_RIDE_MS,
	SINGULARITY_DURATION_MS,
} from "../../tweakables/ultimate";
import {
	animationSystem,
	bindFxBodies,
	idleTexture,
	meleeFxSystem,
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
import { MeleeFx } from "../render/MeleeFx";
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
} from "../simulation/Heroes";
import {
	type HeGrenadeState,
	heGrenadeEnd,
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
	trapFor,
} from "../simulation/Items";
import {
	createPlayerState,
	NEUTRAL_INTENT,
	type PlayerIntent,
	type PlayerPosition,
	tickPlayer,
	tickReload,
} from "../simulation/Physics";
import {
	BLOSSOM_DURATION_MS,
	type Blossom,
	dragonVelocity,
	type GrenadeState,
	grenadeEnd,
	launchGrenade,
	type Singularity,
	tickGrenade,
} from "../simulation/Ultimate";
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
/** The fighter sits this far down the view, so what is *above* them stays visible. */
const CAMERA_Y_BIAS = 0.62;
/** How far ahead of the fighter the camera looks, in seconds of velocity. */
const CAMERA_LEAD_S = 0.06;

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

	private fx: MeleeFx | undefined;
	private items: ItemFx | undefined;
	private blackHole: BlackHoleFx | undefined;
	private blossomFx: BlossomFx | undefined;
	private dragonFx: DragonFx | undefined;

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

		this.spawnFighter(this.opts.hero);
		this.resetLoop();

		app.ticker.add(this.frame);
		this.resizeObserver = new ResizeObserver(() => this.syncSize());
		this.resizeObserver.observe(this.parent);

		// The probes' window into the preview, like `window.__physicsDiagnostic`
		// is the match's. What a move preview must prove is that the scripted
		// intent actually reached the simulation — a story whose attack never
		// fired would otherwise preview as a fighter standing still.
		window.__previewState = () => {
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
			};
		};
		window.__previewSpeed = (s: number) => {
			this.speed = s;
		};
	}

	// =========================================================================
	//  The fighter
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

		this.fighter = this.ecs.add({
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

		if (this.fx) bindFxBodies(this.queries, this.fx);
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
			blackHole.update(this.singularity, [], dtMs);
		}
		this.blossomFx?.update(this.blossom, dtMs);
		this.dragonFx?.update(this.dragonRider(), dtMs);

		this.followCamera(stage, f);

		this.opts.onFrame?.({ t: this.t, body: f.body, intent: this.lastIntent });
	};

	private lastIntent: PlayerIntent = { ...NEUTRAL_INTENT };

	// =========================================================================
	//  One fixed tick: story clock → intent → the real simulation
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

		f.body = tickPlayer(
			f.body,
			intent,
			DT,
			this.world,
			this.singularity,
			this.kit,
			// The friendly-fire rule, asked the way every caller asks it: the
			// fighter's own traps are simply not handed to it.
			trapFor(this.traps, f.fighter.id, f.fighter.team),
		);

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
		const items = this.items;

		this.heGrenades = this.heGrenades.filter((g) => {
			tickHeGrenade(g, dt, this.world);
			if (!heGrenadeEnd(g, false)) return true;
			items?.explode(g.x, g.y, HE_GRENADE_RADIUS);
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
			tickGrenade(this.grenade, dt);
			const end = grenadeEnd(this.grenade, this.world, false);
			if (end !== null) {
				const { x, y } = this.grenade;
				this.singularity = {
					id: this.grenade.id,
					ownerId: this.grenade.ownerId,
					ownerTeam: this.grenade.ownerTeam,
					x,
					y,
					remainingMs: SINGULARITY_DURATION_MS,
				};
				this.blackHole?.detonate(x, y, this.grenade.ownerTeam);
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

	/** Interpret a cue with the hero's own kit — the stage, not the story, knows the weapons. */
	private fireCue(cue: "throw-item" | "cast-ult"): void {
		const f = this.fighter;
		if (!f) return;
		const cx = f.body.x + PLAYER_WIDTH / 2;
		const cy = f.body.y + PLAYER_HEIGHT / 2;
		const facing = f.body.facing < 0 ? -1 : 1;
		const id = this.nextId++;

		if (cue === "throw-item") {
			// A forward lob, the angle a standing throw is.
			const angle = facing > 0 ? -Math.PI / 4 : Math.PI + Math.PI / 4;
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
							angle,
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
				const a = this.story.castAngle ?? (facing > 0 ? -0.6 : Math.PI - 0.6);
				const g = launchGrenade(
					id,
					"preview",
					cx,
					cy,
					facing > 0 ? a : Math.PI - a,
					null,
				);
				this.grenade = g;
				this.blackHole?.launch(cx, cy, null);
				break;
			}
			case "dragon-thrust": {
				// The story's own measured line, or the shallow climb that
				// clears the ground-level pillars.
				const a = this.story.castAngle ?? (facing > 0 ? -0.55 : Math.PI + 0.55);
				const v = dragonVelocity(facing > 0 ? a : Math.PI - a);
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

	private followCamera(stage: Stage, f: FighterEntity): void {
		const view = this.view();
		if (!view) return;
		const { zoom, viewW, viewH } = view;

		// Follow the drawn position — the same rule the nameplates keep —
		// lead by a fraction of a second of velocity, so a dash or a dragon
		// ride stays in frame instead of outrunning the camera. The clamp lets
		// the camera look `overshoot` past each world edge, where the
		// overscanned sky is, but never further.
		const at = f.renderPos ?? f.body;
		const cx = at.x + PLAYER_WIDTH / 2 + f.body.vx * CAMERA_LEAD_S;
		const cy = at.y + PLAYER_HEIGHT / 2 + f.body.vy * CAMERA_LEAD_S;
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

	/** Reset the loop: a fresh fighter, an empty scripted world, quiet effects. */
	private resetLoop(): void {
		this.t = 0;
		this.accMs = 0;
		this.firedCues.clear();
		this.prevAttack = false;
		this.holdingUlt = false;
		this.lastIntent = { ...NEUTRAL_INTENT };

		const f = this.fighter;
		if (f) {
			f.body = spawnState(this.world, this.story.spawnX);
			f.anim = { clip: "right-idle", frame: 0, elapsedMs: 0 };
			f.sprite.rotation = 0;
			f.sprite.alpha = 1;
			f.sprite.tint = 0xffffff;
			f.sprite.scale.set(sheetScale(HEROES[f.fighter.hero].sheet));
			syncSpriteToBody(f.sprite, f.body.x, f.body.y);
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

		// Snap the camera to the new spawn rather than gliding across the arena.
		const view = this.view();
		if (f && view) {
			const { viewW, viewH } = view;
			const overX = Math.max(0, viewW - this.world.right) / 2;
			const overY = Math.max(0, viewH - this.world.bottom) / 2;
			this.camX = clamp(
				f.body.x + PLAYER_WIDTH / 2 - viewW / 2,
				this.world.left - overX,
				this.world.right + overX - viewW,
			);
			this.camY = clamp(
				f.body.y + PLAYER_HEIGHT / 2 - viewH * CAMERA_Y_BIAS,
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
		delete window.__previewState;
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

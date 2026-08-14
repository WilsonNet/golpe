/**
 * The items, drawn: Lia's HE grenades in flight and their blasts, and Anands'
 * floor traps.
 *
 * Presentation only, like everything in `render/` — nothing here is ever read
 * back by the simulation, and everything runs on frame time, so no amount of it
 * can desync a match.
 *
 * The HE grenade is a server-owned projectile (like a bullet), so the client
 * **anchors it once on first sight and runs the shared `tickHeGrenade` off the
 * local clock** — the same dead-reckon the bullets use, with the grenade's own
 * bounces — so a throw does not stutter at snapshot cadence and it bounces in
 * exactly the places the server's does.
 *
 * A trap is world state (like the singularity): a stationary landmine the whole
 * room can see, since the *being able to see it* is the whole of the
 * counterplay. It is single-use — the server removes it the tick it springs,
 * and the burst that accompanies the caption is the trap going off.
 */

import { type Container, Graphics, Sprite } from "pixi.js";
import { PLAYER_HEIGHT, PLAYER_WIDTH, type World } from "../simulation/Arena";
import {
	HE_GRENADE_FUSE_MS,
	type HeGrenadeState,
	SMOKE_GRENADE_FUSE_MS,
	SMOKE_PUFF_SCALE,
	type TrapCanisterState,
	tickHeGrenade,
	tickSmokeGrenade,
	tickTrapCanister,
} from "../simulation/Items";
import { sameTeam, type TeamId } from "../simulation/Teams";
import { TEX, tex } from "./assets";
import { ParticleSystem } from "./Particles";
import type { Stage } from "./Stage";

/** The HE blast's palette. Hot white flash, orange shards, an olive body. */
const COLOR = {
	body: 0x7d8a4f,
	flash: 0xffffff,
	shard: 0xff9a4d,
	ring: 0xffe0b3,
	/** The trap's burst: its own teal, so a spring reads as *that* trap going. */
	trap: 0x7ff0f4,
	/**
	 * The smoke's dark grey — the cloud's one tint, lightened for the ally
	 * haze. Dark enough that a wall reads as a wall rather than a light fog,
	 * grey enough that it never reads as a team colour.
	 */
	smoke: 0x32383f,
} as const;

/** A grenade the client is running off its own clock, bounced like the server's. */
interface HeFlight {
	state: HeGrenadeState;
	/** Local render clock at the last step, ms. */
	lastMs: number;
	sprite: Sprite;
}

/** A trap canister the client is running off its own clock, like a grenade. */
interface TrapFlight {
	state: TrapCanisterState;
	lastMs: number;
	sprite: Sprite;
}

/** One expanding blast ring. */
interface BlastRing {
	ring: Graphics;
	radius: number;
	lifeMs: number;
	t: number;
}

/** The bit of a grenade the renderer needs: a position and a heading. */
interface HeGrenadeView {
	id: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
}

/**
 * One smoke cloud, drawn as a slowly breathing drift of puffs.
 *
 * The cloud is anchored where it bloomed; the *puffs* wander inside it on
 * seeded phases, so a cloud reads as smoke rather than as a disc. `friendly`
 * is the side answer from the last sync — a cloud does not change sides any
 * more than it changes position.
 */
/** The layered puffs that make one cloud, with their own drift phases. */
interface CloudPuffs {
	sprites: Sprite[];
	/** Per-puff phase offsets, seeded once so the drift is not a single blob. */
	phases: number[];
	/** The cloud's anchor — where it bloomed, which never moves. */
	x: number;
	y: number;
	/** Whether the last sync said this cloud is ours — sets the haze level. */
	friendly: boolean;
	/** ms the cloud has been alive, for the drift clock and the mote emitter. */
	ageMs: number;
	/** ms until the next drift mote, so the emitter does not spray every frame. */
	moteAccMs: number;
}

export class ItemFx {
	private readonly particles: ParticleSystem;
	private readonly heGrenades = new Map<number, HeFlight>();
	private readonly trapFlights = new Map<number, TrapFlight>();
	private readonly trapSprites = new Map<number, Sprite>();
	private readonly smokeFlights = new Map<number, HeFlight>();
	private readonly smokeClouds = new Map<number, CloudPuffs>();
	private readonly rings: BlastRing[] = [];

	constructor(
		/** Traps sit on the floor, under the fighters — see `Stage.field`. */
		private readonly fieldLayer: Container,
		private readonly effectsLayer: Container,
		private readonly world: World,
		private readonly stage: Stage,
	) {
		this.particles = new ParticleSystem(effectsLayer);
	}

	/**
	 * Draw the HE grenades in flight.
	 *
	 * Keyed by id, exactly like the bullet sprites and for exactly the same
	 * reason: indexing by array position makes a sprite jump to a different
	 * grenade the moment the server splices a spent one out.
	 */
	syncHeGrenades(live: readonly HeGrenadeView[], nowMs: number) {
		const seen = new Set<number>();
		for (const g of live) {
			seen.add(g.id);
			let flight = this.heGrenades.get(g.id);
			if (!flight) {
				const sprite = new Sprite(tex(TEX.heGrenade));
				sprite.anchor.set(0.5);
				this.effectsLayer.addChild(sprite);
				flight = {
					state: {
						id: g.id,
						ownerId: "",
						ownerTeam: null,
						x: g.x,
						y: g.y,
						vx: g.vx,
						vy: g.vy,
						fuseMs: HE_GRENADE_FUSE_MS,
					},
					lastMs: nowMs,
					sprite,
				};
				this.heGrenades.set(g.id, flight);
				// A puff at the hand, so the throw reads as thrown rather than as a
				// grenade that teleported into the air.
				this.particles.burst({
					texture: TEX.spark,
					count: 8,
					x: g.x,
					y: g.y,
					tint: COLOR.body,
					speed: [20, 120],
					lifeMs: 260,
					scale: [1, 0],
					alpha: [0.7, 0],
				});
			}
			// Advance the local sim by the frame's own time, through the same
			// deterministic `tickHeGrenade` the server runs. The anchor is the
			// snapshot's position, so the visual is the server's path delayed by
			// the snapshot's age — which is exactly what dead-reckoning should
			// show — and it bounces in the same places.
			const dtSec = Math.max(0, nowMs - flight.lastMs) / 1000;
			flight.lastMs = nowMs;
			if (dtSec > 0) tickHeGrenade(flight.state, dtSec, this.world);
			flight.sprite.position.set(flight.state.x, flight.state.y);
			// A slow tumble, so the throw reads as a physical object.
			flight.sprite.rotation += dtSec * 4;
		}

		for (const [id, flight] of this.heGrenades) {
			if (seen.has(id)) continue;
			flight.sprite.destroy();
			this.heGrenades.delete(id);
		}
	}

	/**
	 * Draw the trap canisters in flight, dead-reckoned exactly like the HE
	 * grenades — anchored on first sight, flown through the same deterministic
	 * `tickTrapCanister` the server runs, so the arc plants where the server's
	 * does. The sprite is the trap's own, tumbling: the throw is the counterplay
	 * announcement, and the mine that lands is the same object the whole room
	 * watched come down.
	 */
	syncTrapCanisters(live: readonly HeGrenadeView[], nowMs: number) {
		const seen = new Set<number>();
		for (const c of live) {
			seen.add(c.id);
			let flight = this.trapFlights.get(c.id);
			if (!flight) {
				const sprite = new Sprite(tex(TEX.trap));
				sprite.anchor.set(0.5);
				this.effectsLayer.addChild(sprite);
				flight = {
					state: {
						id: c.id,
						ownerId: "",
						ownerTeam: null,
						x: c.x,
						y: c.y,
						vx: c.vx,
						vy: c.vy,
					},
					lastMs: nowMs,
					sprite,
				};
				this.trapFlights.set(c.id, flight);
			}
			const dtSec = Math.max(0, nowMs - flight.lastMs) / 1000;
			flight.lastMs = nowMs;
			if (dtSec > 0) tickTrapCanister(flight.state, dtSec, this.world);
			flight.sprite.position.set(flight.state.x, flight.state.y);
			// A fast tumble — heavier than the grenades', because it is going to
			// be planted, not lobbed.
			flight.sprite.rotation += dtSec * 8;
		}

		for (const [id, flight] of this.trapFlights) {
			if (seen.has(id)) continue;
			flight.sprite.destroy();
			this.trapFlights.delete(id);
		}
	}

	/**
	 * Draw the traps. Static world objects: created and destroyed with the list.
	 *
	 * `myId`/`myTeam` decide *friendliness*: your own traps and every teammate's
	 * are faded out, because a trap you never need to worry about should not be
	 * doing the worrying for you. An enemy's trap is full-strength — and gone,
	 * not spent, the moment it springs.
	 */
	syncTraps(
		live: readonly {
			id: number;
			x: number;
			y: number;
			ownerId: string;
			ownerTeam: TeamId | null;
		}[],
		myId: string,
		myTeam: TeamId | null,
	) {
		const seen = new Set<number>();
		for (const trap of live) {
			seen.add(trap.id);
			let sprite = this.trapSprites.get(trap.id);
			if (!sprite) {
				sprite = new Sprite(tex(TEX.trap));
				// Bottom-anchored: the mine's flat base sits on the floor the trap
				// was placed on, which is where the trigger test is.
				sprite.anchor.set(0.5, 1);
				this.fieldLayer.addChild(sprite);
				this.trapSprites.set(trap.id, sprite);
			}
			sprite.position.set(trap.x, trap.y);
			const friendly =
				trap.ownerId === myId || sameTeam(trap.ownerTeam, myTeam);
			sprite.tint = 0xffffff;
			// Friendly traps fade to a hint — your own and your team's are a
			// "noted, no danger" rather than a live hazard. Enemy traps are
			// full-strength; a sprung trap no longer exists to be drawn.
			sprite.alpha = friendly ? 0.45 : 1;
		}
		for (const [id, sprite] of this.trapSprites) {
			if (seen.has(id)) continue;
			sprite.destroy();
			this.trapSprites.delete(id);
		}
	}

	/**
	 * A trap just sprang. One-shot, from the server's trapped event — the burst
	 * *is* the trap going off, at the victim's feet.
	 */
	trapBurst(x: number, y: number) {
		const atX = x + PLAYER_WIDTH / 2;
		const atY = y + PLAYER_HEIGHT;
		this.particles.burst({
			texture: TEX.shard,
			count: 14,
			x: atX,
			y: atY,
			tint: COLOR.trap,
			speed: [30, 220],
			lifeMs: 340,
			scale: [1, 0],
			alpha: [0.9, 0],
			gravity: 320,
		});
		this.particles.burst({
			texture: TEX.halo,
			count: 1,
			x: atX,
			y: atY,
			tint: 0xd9fff4,
			speed: [0, 8],
			lifeMs: 140,
			scale: [0.7, 1.5],
			alpha: [0.8, 0],
		});
	}

	/**
	 * Draw the smoke canisters in flight, dead-reckoned exactly like the HE
	 * grenades — anchored on first sight, flown through the same deterministic
	 * `tickSmokeGrenade` the server runs, so a lob bounces in the same places.
	 */
	syncSmokeGrenades(live: readonly HeGrenadeView[], nowMs: number) {
		const seen = new Set<number>();
		for (const g of live) {
			seen.add(g.id);
			let flight = this.smokeFlights.get(g.id);
			if (!flight) {
				const sprite = new Sprite(tex(TEX.smokeGrenade));
				sprite.anchor.set(0.5);
				this.effectsLayer.addChild(sprite);
				flight = {
					state: {
						id: g.id,
						ownerId: "",
						ownerTeam: null,
						x: g.x,
						y: g.y,
						vx: g.vx,
						vy: g.vy,
						fuseMs: SMOKE_GRENADE_FUSE_MS,
					},
					lastMs: nowMs,
					sprite,
				};
				this.smokeFlights.set(g.id, flight);
				// A little hiss at the hand, quieter than the HE's puff — the
				// smoke is thrown to be *un*noticed.
				this.particles.burst({
					texture: TEX.smoke,
					count: 4,
					x: g.x,
					y: g.y,
					tint: COLOR.smoke,
					speed: [8, 60],
					lifeMs: 500,
					scale: [0.4, 1.2],
					alpha: [0.5, 0],
				});
			}
			const dtSec = Math.max(0, nowMs - flight.lastMs) / 1000;
			flight.lastMs = nowMs;
			if (dtSec > 0) tickSmokeGrenade(flight.state, dtSec, this.world);
			flight.sprite.position.set(flight.state.x, flight.state.y);
			flight.sprite.rotation += dtSec * 6;
		}

		for (const [id, flight] of this.smokeFlights) {
			if (seen.has(id)) continue;
			flight.sprite.destroy();
			this.smokeFlights.delete(id);
		}
	}

	/**
	 * Draw the smoke clouds.
	 *
	 * **The side a cloud belongs to is the whole feature**: your own and every
	 * teammate's cloud is a near-transparent haze — you are supposed to see
	 * through it — while a hostile cloud is a full-strength wall of smoke that
	 * answers "who is in there" with a shrug. The fade-in and the fade-out
	 * frame the cloud's life from the server's own `remainingMs`, and the
	 * puffs wander on seeded phases so a cloud breathes instead of sitting.
	 */
	syncSmokeClouds(
		live: readonly {
			id: number;
			x: number;
			y: number;
			ownerId: string;
			ownerTeam: TeamId | null;
			remainingMs: number;
		}[],
		myId: string,
		myTeam: TeamId | null,
	) {
		const seen = new Set<number>();
		for (const cloud of live) {
			seen.add(cloud.id);
			const friendly =
				cloud.ownerId === myId || sameTeam(cloud.ownerTeam, myTeam);
			let puffs = this.smokeClouds.get(cloud.id);
			if (!puffs) {
				puffs = this.makeCloudPuffs(cloud.id, cloud.x, cloud.y);
				this.smokeClouds.set(cloud.id, puffs);
				// The bloom: the canister's pop, a ring of puffs scaling out of
				// the canister's landing point — the loudest the smoke ever is.
				this.particles.burst({
					texture: TEX.smoke,
					count: 10,
					x: cloud.x,
					y: cloud.y,
					tint: COLOR.smoke,
					speed: [10, 90],
					lifeMs: 900,
					scale: [0.5, 2],
					alpha: [0.55, 0],
				});
			}
			puffs.x = cloud.x;
			puffs.y = cloud.y;
			puffs.friendly = friendly;
			// The haze is where the cloud's side is read: full for a wall, a
			// whisper for your own. The last 800ms of the server's life fade
			// the cloud out so it never pops out of existence.
			const fadeOut = Math.min(1, cloud.remainingMs / 800);
			const breathe = 1 + Math.sin(puffs.ageMs / 700 + cloud.id) * 0.06;
			puffs.sprites.forEach((sprite, i) => {
				sprite.scale.set(
					SMOKE_PUFF_SCALE * breathe,
					SMOKE_PUFF_SCALE * breathe,
				);
				sprite.alpha = (friendly ? 0.3 : 1) * fadeOut;
				sprite.rotation = (i * 0.7 + cloud.id * 0.13) % (Math.PI * 2);
			});
		}

		for (const [id, puffs] of this.smokeClouds) {
			if (seen.has(id)) continue;
			for (const sprite of puffs.sprites) sprite.destroy();
			this.smokeClouds.delete(id);
		}
	}

	/** Build one cloud's puff layers: six blurred blobs on a seeded drift. */
	private makeCloudPuffs(id: number, x: number, y: number): CloudPuffs {
		const sprites: Sprite[] = [];
		const phases: number[] = [];
		for (let i = 0; i < 6; i++) {
			const sprite = new Sprite(tex(TEX.smoke));
			sprite.anchor.set(0.5);
			// The texture ships white so a single tint can be faded for allies;
			// the dark grey is the cloud's own, applied once here.
			sprite.tint = COLOR.smoke;
			// The puffs sit under the fighters — the concealment is drawn by
			// hiding the fighters, not by painting over them.
			this.fieldLayer.addChild(sprite);
			sprite.position.set(x, y);
			sprites.push(sprite);
			// Seeded per puff and per cloud, so no two clouds jiggle the same
			// way and the layers never collapse into one.
			phases.push((i * 1.7 + id * 0.31) % (Math.PI * 2));
		}
		return { sprites, phases, x, y, friendly: false, ageMs: 0, moteAccMs: 0 };
	}

	/** An HE grenade went off. One-shot, from the server's explosion event. */
	explode(x: number, y: number, radius: number) {
		this.particles.burst({
			texture: TEX.shard,
			count: 26,
			x,
			y,
			tint: COLOR.shard,
			speed: [50, 340],
			lifeMs: 420,
			scale: [1.2, 0],
			alpha: [0.9, 0],
			gravity: 420,
		});
		this.particles.burst({
			texture: TEX.halo,
			count: 2,
			x,
			y,
			tint: COLOR.flash,
			speed: [0, 10],
			lifeMs: 150,
			scale: [1.2, 2.4],
			alpha: [0.9, 0],
		});
		const ring = new Graphics();
		ring.circle(0, 0, 1).stroke({ width: 3, color: COLOR.ring, alpha: 0.9 });
		ring.position.set(x, y);
		this.effectsLayer.addChild(ring);
		this.rings.push({ ring, radius, lifeMs: 260, t: 0 });
		// The shake is the "that was an explosion" beat, midway between a sword
		// impact and the ultimate — an item should be felt, never as much as a
		// black hole.
		this.stage.startShake(280, 8);
	}

	update(dtMs: number) {
		for (let i = this.rings.length - 1; i >= 0; i--) {
			const r = this.rings[i];
			if (!r) continue;
			r.t += dtMs;
			const p = Math.min(1, r.t / r.lifeMs);
			r.ring.scale.set(1 + p * (r.radius - 1));
			r.ring.alpha = 1 - p;
			if (p >= 1) {
				r.ring.destroy();
				this.rings.splice(i, 1);
			}
		}

		// The clouds breathe: each puff wanders its own small circle around
		// the cloud's anchor, so a cloud reads as slow smoke instead of a
		// painted disc. Position is set here, on frame time, and never in the
		// sync — the sync owns scale and opacity, this owns where the layers
		// sit, and the two never fight.
		for (const puffs of this.smokeClouds.values()) {
			puffs.ageMs += dtMs;
			const t = puffs.ageMs / 1000;
			puffs.sprites.forEach((sprite, i) => {
				const phase = puffs.phases[i] ?? 0;
				// The puffs wander in a wider circle than the old small cloud —
				// the drift is the breathing, and a cloud four times the area
				// needs a longer stride to still read as alive.
				const radius = 34 + ((i * 11) % 36);
				const speed = 0.25 + ((i * 7) % 10) / 40;
				sprite.position.set(
					puffs.x + Math.cos(t * speed + phase) * radius,
					puffs.y - 30 + Math.sin(t * speed * 0.8 + phase) * radius * 0.7,
				);
			});

			// Drift motes: the cloud's own slow curl, emitted inside the haze.
			// Enemy clouds are the wall — they shed motes that linger — and a
			// friendly cloud's hint is barely there, so it never reads as fog.
			puffs.moteAccMs += dtMs;
			const interval = puffs.friendly ? 400 : 160;
			while (puffs.moteAccMs >= interval) {
				puffs.moteAccMs -= interval;
				this.particles.burst({
					texture: TEX.smoke,
					count: 1,
					x: puffs.x + (Math.random() - 0.5) * 260,
					y: puffs.y - 40 + (Math.random() - 0.5) * 160,
					tint: COLOR.smoke,
					speed: [2, 14],
					lifeMs: 1400,
					scale: [0.8, 1.6],
					alpha: puffs.friendly ? [0.16, 0] : [0.34, 0],
				});
			}
		}

		this.particles.update(dtMs);
	}

	reset() {
		for (const flight of this.heGrenades.values()) flight.sprite.destroy();
		this.heGrenades.clear();
		for (const flight of this.trapFlights.values()) flight.sprite.destroy();
		this.trapFlights.clear();
		for (const flight of this.smokeFlights.values()) flight.sprite.destroy();
		this.smokeFlights.clear();
		for (const sprite of this.trapSprites.values()) sprite.destroy();
		this.trapSprites.clear();
		for (const puffs of this.smokeClouds.values()) {
			for (const sprite of puffs.sprites) sprite.destroy();
		}
		this.smokeClouds.clear();
		for (const r of this.rings) r.ring.destroy();
		this.rings.length = 0;
		this.particles.clear();
	}

	destroy() {
		this.reset();
	}
}

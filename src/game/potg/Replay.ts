/**
 * Playing a Play of the Game clip back.
 *
 * This is a **projector**, not a simulation. It never calls `tickPlayer`, never
 * predicts and never reconciles: every fighter's position comes straight out of
 * the recorded frame, because the whole point of a replay is that it shows what
 * actually happened rather than a re-derivation of it. Re-simulating from
 * recorded inputs was the obvious alternative and is the wrong one — it would
 * need the exact server tick alignment, and the first floating-point difference
 * would have the replay diverge from the match it is a replay of.
 *
 * What it *does* reuse is the encoding. A frame's fighter is a `PackedState`,
 * the same one the snapshot carries, so unpacking gives a real `PlayerPosition`
 * and the ordinary animation, sprite-sync, nameplate, shadow and sword-effect
 * systems draw the replay with no second code path. That reuse is why a replay
 * shows guard sparks and swing trails at all.
 *
 * Frames arrive at the server's 20Hz broadcast rate and are drawn at whatever
 * the display runs at, so positions are interpolated between them. Only
 * position and velocity are: every timer, flag and enum is taken from the
 * earlier frame, because half a stun is not a state the game has.
 */

import { unpackState } from "../online/wire";
import {
	type PlayerPosition,
	SINGULARITY_DURATION_MS,
	type Singularity,
} from "../simulation/Physics";
import { PotgDirector, type PotgShot, type Subject } from "./Director";

/** A bullet packs as an (id, x, y) triplet — the stride of `a.b`. */
const BULLET_STRIDE = 3;

/**
 * How far a grenade may travel between two recorded frames and still be the
 * same grenade, in world px.
 *
 * A slot that jumps further than this is a different grenade taking the exploded
 * one's place — the slot has no id to match on, so distance is the only proof,
 * and the fastest throw (780 px/s) moves under 40px per 50ms broadcast.
 */
const MAX_GRENADE_STEP_PX = 80;

import type { PotgCastMember, PotgClip } from "./types";

/** The replay's singularity is not the room's, so it gets an id nothing else uses. */
const REPLAY_FIELD_ID = -1;

/** One fighter, as the replay wants it drawn this frame. */
interface ReplayFighter {
	member: PotgCastMember;
	state: PlayerPosition;
	hp: number;
	alive: boolean;
}

/** Everything to draw for one rendered frame of the replay. */
export interface ReplaySample {
	shot: PotgShot;
	fighters: ReplayFighter[];
	bullets: { id: number; x: number; y: number }[];
	grenades: { id: number; x: number; y: number }[];
	singularity: Singularity | null;
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

export class PotgReplay {
	private readonly director: PotgDirector;
	/**
	 * Where in the frame array the last sample landed.
	 *
	 * Monotonic, because `clipMs` is: the director only ever moves the footage
	 * cursor forward, so a scan from here is O(1) amortised and a binary search
	 * every frame would be solving a problem this does not have.
	 */
	private cursor = 0;
	private finished = false;

	constructor(readonly clip: PotgClip) {
		this.director = new PotgDirector(clip, (ms) => this.subjectAt(ms));
	}

	get done(): boolean {
		return this.finished;
	}

	/** End it now. What the skip button and a match reset both do. */
	skip() {
		this.director.skip();
		this.finished = true;
	}

	/**
	 * Advance one rendered frame.
	 *
	 * Returns null once the sequence is over, which is the caller's signal to hand
	 * the camera and the entities back to the live match.
	 */
	step(dtMs: number): ReplaySample | null {
		if (this.finished) return null;
		const shot = this.director.step(dtMs);
		if (shot.phase === "done") {
			this.finished = true;
			return null;
		}

		const { a, b, t } = this.bracket(shot.clipMs);
		const fighters: ReplayFighter[] = [];
		for (const p of a.p) {
			const member = this.clip.cast[p.c];
			if (!member) continue;
			const state = unpackState(p.s);
			// The matching fighter in the next frame, by cast index rather than by
			// array position: a fighter who joins or leaves mid-clip shifts the array,
			// and interpolating one fighter toward another's position is the worst
			// possible artefact — a body sliding across the arena for one frame.
			const next = b?.p.find((q) => q.c === p.c);
			if (next && t > 0) {
				const to = unpackState(next.s);
				state.x = lerp(state.x, to.x, t);
				state.y = lerp(state.y, to.y, t);
				state.vx = lerp(state.vx, to.vx, t);
				state.vy = lerp(state.vy, to.vy, t);
			}
			fighters.push({ member, state, hp: p.hp, alive: p.a === 1 });
		}

		const bullets: { id: number; x: number; y: number }[] = [];
		// Matched between frames **by id**, then interpolated with the fighters.
		// The recording is 20Hz and the screen is not: a bullet drawn at the
		// earlier frame's position alone steps forward in 40px jumps while every
		// fighter glides, and the mismatch is exactly the "not like the match"
		// the reel is not allowed to have. A bullet born or gone between the two
		// frames has no partner and is drawn where the earlier frame had it.
		const nextBullets = new Map<number, { x: number; y: number }>();
		if (b) {
			for (let i = 0; i + BULLET_STRIDE - 1 < b.b.length; i += BULLET_STRIDE) {
				const id = b.b[i];
				if (id === undefined) continue;
				nextBullets.set(id, { x: b.b[i + 1] ?? 0, y: b.b[i + 2] ?? 0 });
			}
		}
		for (let i = 0; i + BULLET_STRIDE - 1 < a.b.length; i += BULLET_STRIDE) {
			const id = a.b[i] ?? 0;
			let x = a.b[i + 1] ?? 0;
			let y = a.b[i + 2] ?? 0;
			const to = t > 0 ? nextBullets.get(id) : undefined;
			if (to) {
				x = lerp(x, to.x, t);
				y = lerp(y, to.y, t);
			}
			bullets.push({ id, x, y });
		}
		const grenades: { id: number; x: number; y: number }[] = [];
		for (let i = 0; i + 1 < a.g.length; i += 2) {
			// Keyed by slot rather than by a recorded id: there is at most one
			// grenade in the air per cast, so the slot *is* the identity. But a
			// grenade that explodes shifts its neighbours' slots, so a slot is
			// only interpolated toward the next frame's when the two are close
			// enough to be the same grenade — lerping across a shift would slide
			// one across the arena.
			let x = a.g[i] ?? 0;
			let y = a.g[i + 1] ?? 0;
			const nx = b?.g[i];
			const ny = b?.g[i + 1];
			if (
				t > 0 &&
				nx !== undefined &&
				ny !== undefined &&
				Math.hypot(nx - x, ny - y) <= MAX_GRENADE_STEP_PX
			) {
				x = lerp(x, nx, t);
				y = lerp(y, ny, t);
			}
			grenades.push({ id: i, x, y });
		}

		const hole = a.h;
		const singularity: Singularity | null = hole
			? {
					id: REPLAY_FIELD_ID,
					ownerId: this.clip.cast[hole[2]]?.id ?? "",
					ownerTeam: this.clip.cast[hole[2]]?.team ?? null,
					x: hole[0],
					y: hole[1],
					// Not recorded, and deliberately: nothing in the replay reads it —
					// the effect draws the hole it is given and the projector never
					// simulates a pull. A full duration keeps the effect from playing its
					// own closing animation over footage that is still open.
					remainingMs: SINGULARITY_DURATION_MS,
				}
			: null;

		return { shot, fighters, bullets, grenades, singularity };
	}

	/** Where the protagonist was, for the director's camera. */
	private subjectAt(clipMs: number): Subject {
		const { a } = this.bracket(clipMs);
		const index = this.clip.cast.findIndex(
			(c) => c.id === this.clip.protagonist.id,
		);
		const entry = a.p.find((p) => p.c === index);
		if (!entry) return { x: 0, y: 0, vx: 0, facing: 1 };
		const state = unpackState(entry.s);
		return { x: state.x, y: state.y, vx: state.vx, facing: state.facing };
	}

	/**
	 * The two frames `clipMs` falls between, and how far between them it is.
	 *
	 * `b` is undefined past the end of the footage, which is the outro holding on
	 * the last frame — the one moment in the sequence where a still image is
	 * exactly what is wanted.
	 */
	private bracket(clipMs: number) {
		const frames = this.clip.frames;
		while (
			this.cursor + 1 < frames.length &&
			(frames[this.cursor + 1]?.t ?? 0) <= clipMs
		) {
			this.cursor++;
		}
		const a = frames[this.cursor] ?? frames[0];
		const b = frames[this.cursor + 1];
		if (!a) throw new Error("replay clip has no frames");
		const span = b ? b.t - a.t : 0;
		const t = span > 0 ? Math.min(1, Math.max(0, (clipMs - a.t) / span)) : 0;
		return { a, b, t };
	}
}

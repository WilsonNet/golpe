/**
 * The entity world.
 *
 * ECS stops at the entity and presentation layer on purpose. `simulation/` stays
 * plain data and pure functions, because that is what makes rewind-and-replay a
 * three-line loop and what gets reconciliation to a measured 0.00px. Turning
 * authoritative state into component stores would buy nothing at two fighters
 * and would put the one part of the codebase that demonstrably works at risk.
 *
 * So: the simulation owns truth, and the world owns *things that are drawn* —
 * which is where the entity count actually grows.
 */

import { World } from "miniplex";
import type { Sprite } from "pixi.js";
import type { PlayerPosition } from "../simulation/Physics";
import type { ClipName } from "./systems";

/** Which side of the match a fighter is on. Also its effects key. */
export type Side = "local" | "remote";

export interface AnimState {
	clip: ClipName;
	frame: number;
	elapsedMs: number;
}

/**
 * One entity. Every field is optional — presence is what defines an archetype,
 * so a query for `("body", "sprite")` matches exactly the things that both
 * simulate and draw.
 */
export interface Entity {
	/** Stable identity, for effects and debugging. */
	key: string;

	/** A duellist. */
	fighter?: {
		side: Side;
		hp: number;
	};

	/** A server-owned projectile, keyed by the id the server assigned. */
	bullet?: {
		id: number;
	};

	/**
	 * Simulation state, referenced rather than copied.
	 *
	 * The reference is deliberate: prediction replaces the local fighter's state
	 * object every tick, so entities hold whatever the simulation currently says
	 * rather than a snapshot that would immediately go stale.
	 */
	body?: PlayerPosition;

	/** World position for things with no physics body. */
	position?: { x: number; y: number };

	/**
	 * Where to draw, when that differs from where the body actually is.
	 *
	 * Reconciliation snaps the simulation to the authoritative answer immediately
	 * so gameplay stays correct, while the sprite is drawn at a decaying offset —
	 * turning a pop into a glide. The two must stay separate: drawing from `body`
	 * would undo the smoothing, and simulating from this would make the smoothing
	 * authoritative.
	 */
	renderPos?: { x: number; y: number };

	sprite?: Sprite;
	anim?: AnimState;
}

/**
 * A fighter, with the components it is guaranteed to have.
 *
 * Archetype queries narrow types at the iteration site, but the two duellists
 * are also held directly by `Match` for their whole lifetime. Naming that
 * guarantee once beats a non-null assertion at every use.
 */
export type FighterEntity = Entity &
	Required<Pick<Entity, "fighter" | "body" | "sprite" | "anim">>;

export type GameWorld = World<Entity>;

export function createWorld(): GameWorld {
	return new World<Entity>();
}

/**
 * The archetypes systems iterate.
 *
 * Built once and reused: miniplex keeps each bucket up to date as components are
 * added and removed, so re-deriving them per frame would throw away the whole
 * point of the index.
 */
export function createQueries(world: GameWorld) {
	return {
		fighters: world.with("fighter", "body"),
		drawnFighters: world.with("fighter", "body", "sprite"),
		animated: world.with("body", "sprite", "anim"),
		bullets: world.with("bullet", "position", "sprite"),
	};
}

export type Queries = ReturnType<typeof createQueries>;

/** Find a fighter by side. There are only ever two, so a scan is fine. */
export function fighterOf(queries: Queries, side: Side): Entity | undefined {
	for (const e of queries.fighters) {
		if (e.fighter.side === side) return e;
	}
	return undefined;
}

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
import type { HeroId } from "../simulation/Heroes";
import type { PlayerPosition } from "../simulation/Physics";
import type { TeamId } from "../simulation/Teams";
import type { ClipName } from "./systems";

/**
 * What identifies a fighter.
 *
 * This used to be `"local" | "remote"`, which was the whole world at two
 * fighters and is a bug at sixteen: it was also the effects key, so every remote
 * fighter's swing trail, guard and impact punch would land on one shared set of
 * sprites. A fighter is identified by the id the server scores it under.
 */
type FighterId = string;

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
interface Entity {
	/** Stable identity, for effects and debugging. */
	key: string;

	/** A duellist. */
	fighter?: {
		/** The id the server knows this fighter by, and its effects key. */
		id: FighterId;
		/** True for the one fighter this client predicts and owns the input of. */
		local: boolean;
		hp: number;
		/** Full health, for the bar's fraction. Not always 100 — a training dummy differs. */
		maxHp: number;
		/** What the nameplate says. Empty until the roster names this fighter. */
		name: string;
		/**
		 * Which side, in team deathmatch — `null` in a free-for-all.
		 *
		 * Presentation reads this constantly (the nameplate's colour, the cast
		 * shadow, every particle a fighter emits) but never *decides* anything with
		 * it. The rule it comes from lives in the simulation; this is the copy the
		 * renderer is allowed to look at, refreshed from the snapshot like `hp`.
		 */
		team: TeamId | null;
		/**
		 * Which hero this fighter is, for presentation: which strip the walk
		 * cycle is cut from, which generated poses it wears, and which blade
		 * the effects layer draws. Refreshed from the snapshot, like `team` —
		 * a hero change mid-match swaps the sheet on the next snapshot.
		 */
		hero: HeroId;
		/**
		 * Is this fighter concealed inside an ally's smoke cloud, as this
		 * viewer sees it? Presentation-only, recomputed every frame by the
		 * match from the smoke list: while set, the fighter is not drawn, not
		 * shadowed and not named — the enemy is not allowed to know who is in
		 * the smoke. The local fighter is never set.
		 */
		smokeHidden?: boolean;
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
 * Archetype queries narrow types at the iteration site, but `Match` also holds
 * fighters directly — the local one for the whole match, each remote one for as
 * long as it is in the room. Naming that guarantee once beats a non-null
 * assertion at every use.
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
		// Animation reads the hero (for the strip and the poses), so a fighter
		// without one — there are none, but an archetype is a promise — is not
		// animated.
		animated: world.with("fighter", "body", "sprite", "anim"),
		bullets: world.with("bullet", "position", "sprite"),
	};
}

export type Queries = ReturnType<typeof createQueries>;

/**
 * The decoration catalogue: every prop the map maker can place, its category
 * and how it attaches.
 *
 * Generated with the art (`scripts/tilesets/props.py` → `generate.py` →
 * `propCatalog.json`), so a prop's name, size and frame count exist in exactly
 * one place — the editor's palette, its placement rules and the atlas the game
 * draws cannot disagree. Presentation only: no prop ever reaches the simulation.
 */

import catalog from "./propCatalog.json";

/**
 * How a prop meets the map:
 * - `stand` — its bottom row sits on the surface under it;
 * - `hang` — its top row hangs from the ceiling above it;
 * - `wall` — mounted on a platform's face, kept inside that platform;
 * - `air` — exactly where it was put (flying birds, balloons, clouds).
 */
export type PropAttach = "stand" | "hang" | "wall" | "air";

export interface PropDef {
	type: string;
	label: string;
	category: string;
	attach: PropAttach;
	w: number;
	h: number;
	/** Animation frames, when the prop is animated in the game. */
	frames?: number;
}

export interface PropCategory {
	id: string;
	label: string;
}

export const PROP_CATEGORIES: readonly PropCategory[] = catalog.categories;
export const PROP_CATALOG: readonly PropDef[] = catalog.props as PropDef[];

const BY_TYPE = new Map(PROP_CATALOG.map((p) => [p.type, p]));

/** The catalogue entry for a prop type, or null for a name the art lacks. */
export function propDef(type: string): PropDef | null {
	return BY_TYPE.get(type) ?? null;
}

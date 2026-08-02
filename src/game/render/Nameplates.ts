/**
 * Floating name and health bar above each fighter, the way a MOBA does it.
 *
 * Presentation only, like everything in `render/` — nothing here is ever read
 * back by the simulation.
 *
 * **In the world, not the HUD.** A nameplate has to track a fighter that is
 * moving, so it lives inside the camera and is positioned from the same body
 * coordinates the sprite is. It sits in its own layer above the actors, because a
 * label buried behind a sprite is worse than no label.
 *
 * The whole point is telling sixteen fighters apart mid-fight: which one is you,
 * which one is nearly dead, and who the stranger about to swing at you actually
 * is. The screen HUD answers the local fighter's own numbers, and the Tab
 * scoreboard answers the rest only when you are not fighting.
 */

import { Container, Sprite, Text, Texture } from "pixi.js";
import { DEFAULT_WORLD, type World } from "../simulation/Arena";

/** Wider than the fighter (32px), so a nearly-empty bar is still readable. */
const BAR_WIDTH = 40;
const BAR_HEIGHT = 5;
/** How far above the body's top edge the bar sits. */
const ABOVE_HEAD = 14;

/** Health colours, high to low. Green reads as safe at a glance; red does not. */
const HEALTHY = 0x4ade80;
const HURT = 0xfacc15;
const CRITICAL = 0xef4444;

/** Matches the scoreboard's "this is you" highlight, so the two agree. */
const OWN_NAME = 0x7ff0f4;
const OTHER_NAME = 0xf2f2f2;

/** Blend two packed RGB colours. */
function mixRgb(from: number, to: number, t: number): number {
	const f = Math.max(0, Math.min(1, t));
	const r =
		((from >> 16) & 0xff) + (((to >> 16) & 0xff) - ((from >> 16) & 0xff)) * f;
	const g =
		((from >> 8) & 0xff) + (((to >> 8) & 0xff) - ((from >> 8) & 0xff)) * f;
	const b = (from & 0xff) + ((to & 0xff) - (from & 0xff)) * f;
	return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/**
 * Green through yellow to red.
 *
 * Two segments rather than a straight green→red blend, which passes through a
 * muddy brown at exactly the half-health moment a player most needs to read.
 */
export function healthColour(fraction: number): number {
	const f = Math.max(0, Math.min(1, fraction));
	return f > 0.5
		? mixRgb(HURT, HEALTHY, (f - 0.5) * 2)
		: mixRgb(CRITICAL, HURT, f * 2);
}

interface Plate {
	root: Container;
	fill: Sprite;
	label: Text;
	/** Last name written, so the text is only re-rasterised when it changes. */
	name: string;
	local: boolean;
}

export class Nameplates {
	private readonly plates = new Map<string, Plate>();

	/**
	 * The arena's right edge, so a plate is kept inside the *world* — on a
	 * multi-screen map that is not the viewport edge, but a plate pushed past it
	 * would sit off the end of the map nobody can see.
	 */
	constructor(
		private readonly layer: Container,
		private readonly world: World = DEFAULT_WORLD,
	) {}

	private plate(key: string): Plate {
		const existing = this.plates.get(key);
		if (existing) return existing;

		const root = new Container();

		// `Texture.WHITE` scaled and tinted, rather than a `Graphics` redrawn every
		// frame: a health bar changes width constantly, and rebuilding sixteen
		// geometries per frame to move a rectangle is work with nothing to show for
		// it.
		const bar = (tint: number, width: number) => {
			const s = new Sprite(Texture.WHITE);
			s.width = width;
			s.height = BAR_HEIGHT;
			s.tint = tint;
			s.x = -width / 2;
			return s;
		};

		const backing = bar(0x101014, BAR_WIDTH + 2);
		backing.height = BAR_HEIGHT + 2;
		backing.y = -1;
		const fill = bar(HEALTHY, BAR_WIDTH);

		const label = new Text({
			text: "",
			style: {
				fontFamily: "monospace",
				fontSize: 10,
				fill: OTHER_NAME,
				// An outline, because a name is drawn over whatever the arena happens
				// to be behind it — sky, a ledge, or another fighter.
				stroke: { color: 0x000000, width: 2 },
			},
		});
		label.anchor.set(0.5, 1);
		// Clear of the bar. Touching it reads as one smeared object at this size.
		label.y = -5;

		root.addChild(backing, fill, label);
		this.layer.addChild(root);

		const plate: Plate = { root, fill, label, name: "", local: false };
		this.plates.set(key, plate);
		return plate;
	}

	/**
	 * Place and fill one fighter's plate.
	 *
	 * `centreX` and `topY` are *drawn* coordinates — the same ones the sprite uses,
	 * so a plate never lags the fighter it belongs to by a frame.
	 */
	sync(
		key: string,
		centreX: number,
		topY: number,
		hp: number,
		maxHp: number,
		name: string,
		local: boolean,
	) {
		const p = this.plate(key);

		// A dead fighter keeps its plate hidden rather than showing an empty bar:
		// the corpse is already faded, and an empty bar over it reads as a live
		// fighter about to die.
		if (hp <= 0) {
			p.root.visible = false;
			return;
		}
		p.root.visible = true;
		p.root.position.set(this.onScreenX(centreX, p), topY - ABOVE_HEAD);

		const fraction = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
		p.fill.width = BAR_WIDTH * fraction;
		p.fill.tint = healthColour(fraction);

		if (name !== p.name) {
			p.name = name;
			p.label.text = name;
		}
		if (local !== p.local) {
			p.local = local;
			p.label.style.fill = local ? OWN_NAME : OTHER_NAME;
		}
	}

	/**
	 * Keep a plate inside the arena.
	 *
	 * Fighters spawn at x=40 and x=760 and fight in the corners, and a sixteen
	 * character name centred on one of them runs off the edge — the name is far
	 * wider than the fighter it labels. Nudging it inward decouples it from the
	 * body slightly, which is the right trade: a plate a few pixels off its owner is
	 * still readable, and a clipped one is not.
	 */
	private onScreenX(centreX: number, p: Plate): number {
		const half = Math.max(p.label.width, BAR_WIDTH + 2) / 2 + 2;
		return Math.max(half, Math.min(this.world.right - half, centreX));
	}

	/** Release a fighter's plate. Fighters are transient; their sprites must not be. */
	forget(key: string) {
		const p = this.plates.get(key);
		if (!p) return;
		p.root.destroy({ children: true });
		this.plates.delete(key);
	}

	reset() {
		for (const key of [...this.plates.keys()]) this.forget(key);
	}
}

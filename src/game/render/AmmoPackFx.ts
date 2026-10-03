import { Container, Graphics, Sprite } from "pixi.js";
import { CP_AMMO_PACK_BOB_PX } from "../../tweakables/control";
import { TEX, tex } from "./assets";

/** How much of a second the spawn pop takes, and the pickup burst's life. */
const SPAWN_POP_MS = 260;
const BURST_MS = 320;
/** How many pickup bursts can be in the air at once. */
const BURST_POOL = 4;

/** The crate's palette: dark steel, a brass strap, brass bullets. */
const BODY = 0x232833;
const LID = 0x3a4254;
const STRAP = 0xc8993f;
const ROUND = 0xe8c15a;
/** The hover glow, warm brass rather than team-coloured — supply is neutral. */
const GLOW = 0xffcf6a;
const GLOW_ALPHA = 0.2;
const GLOW_PULSE = 0.07;

/** The crate's size, and how big its glow is drawn behind it. */
const CRATE_W = 22;
const CRATE_H = 16;
const GLOW_SCALE = 1.15;

interface PackNode {
	root: Container;
	glow: Sprite;
	/** ms since the pack (re)appeared, for the spawn pop. */
	ageMs: number;
	/** Was this pack in the previous frame's list? */
	present: boolean;
}

interface Burst {
	sprite: Sprite;
	ageMs: number;
}

/**
 * The control map's ammo packs, drawn: a floating crate with a warm glow.
 *
 * Presentation only, like everything in `render/`. The server owns where the
 * packs are and who took one — this reads the snapshot's list, places a crate
 * per id and hides the ones the snapshot stopped listing. The **bob is
 * presentation**: pickup measures against the static spot the server knows,
 * so a crate mid-bob is collectable exactly when the crate under it is.
 *
 * A respawn pops the crate back in, and a pickup fires a brass burst, so both
 * ends of a pack's life are visible without reading the HUD.
 */
export class AmmoPackFx {
	private readonly root = new Container();
	private readonly nodes = new Map<number, PackNode>();
	private readonly bursts: Burst[] = [];
	private burstCursor = 0;
	private timeMs = 0;

	constructor(layer: Container) {
		this.root.visible = false;
		layer.addChild(this.root);
		for (let i = 0; i < BURST_POOL; i++) {
			const sprite = new Sprite(tex(TEX.halo));
			sprite.anchor.set(0.5);
			sprite.visible = false;
			sprite.blendMode = "add";
			sprite.tint = GLOW;
			this.root.addChild(sprite);
			this.bursts.push({ sprite, ageMs: BURST_MS });
		}
	}

	/**
	 * Place the crates the snapshot lists, and hide the rest.
	 *
	 * `packs` is empty outside a control match and during the Play of the Game
	 * replay — the clip records no packs, exactly like the items — so the
	 * layer simply leaves the screen.
	 */
	update(
		packs: readonly { id: number; x: number; y: number }[],
		dtMs: number,
	) {
		this.timeMs += dtMs;
		for (const node of this.nodes.values()) node.present = false;

		for (const pack of packs) {
			let node = this.nodes.get(pack.id);
			if (!node) {
				node = this.createNode();
				this.nodes.set(pack.id, node);
			}
			if (!node.present) node.ageMs = 0;
			node.present = true;
			node.root.visible = true;
			const bob =
				Math.sin((this.timeMs / 1600) * Math.PI * 2) * CP_AMMO_PACK_BOB_PX;
			// The snapshot's spot *is* the hovered centre (`PACK_HOVER_Y` bakes
			// `CP_AMMO_PACK_HOVER_PX` in), so the bob is the only offset left.
			node.root.position.set(pack.x, pack.y + bob);
			// The spawn pop: an absent pack comes back growing, so its return is
			// an event rather than a sprite blinking on.
			const grow = Math.min(1, node.ageMs / SPAWN_POP_MS);
			const scale = 0.6 + 0.4 * grow;
			node.root.scale.set(scale);
			node.glow.alpha =
				(GLOW_ALPHA +
					GLOW_PULSE * Math.sin((this.timeMs / 900) * Math.PI * 2)) *
				grow;
			node.ageMs += dtMs;
		}

		let any = false;
		for (const node of this.nodes.values()) {
			if (!node.present) node.root.visible = false;
			else any = true;
		}
		this.root.visible = any || this.bursts.some((b) => b.ageMs < BURST_MS);

		for (const burst of this.bursts) {
			if (burst.ageMs >= BURST_MS) {
				burst.sprite.visible = false;
				continue;
			}
			burst.ageMs += dtMs;
			const t = Math.min(1, burst.ageMs / BURST_MS);
			burst.sprite.scale.set(0.3 + t * 1.1);
			burst.sprite.alpha = 0.5 * (1 - t);
		}
	}

	/** A pack was taken: a brass pop at where it floated. */
	burst(x: number, y: number) {
		const burst = this.bursts[this.burstCursor % this.bursts.length];
		this.burstCursor++;
		if (!burst) return;
		burst.ageMs = 0;
		burst.sprite.visible = true;
		burst.sprite.position.set(x, y);
		burst.sprite.scale.set(0.3);
		burst.sprite.alpha = 0.5;
		this.root.visible = true;
	}

	private createNode(): PackNode {
		const root = new Container();
		const glow = new Sprite(tex(TEX.halo));
		glow.anchor.set(0.5);
		glow.blendMode = "add";
		glow.tint = GLOW;
		glow.alpha = GLOW_ALPHA;
		glow.scale.set(GLOW_SCALE);
		const crate = new Graphics();
		// A dark steel box, a lighter lid, a brass strap and two brass rounds:
		// readable as "supply" at a glance and at 1x.
		crate.roundRect(-CRATE_W / 2, -CRATE_H / 2, CRATE_W, CRATE_H, 4).fill({
			color: BODY,
		});
		crate
			.roundRect(-CRATE_W / 2, -CRATE_H / 2, CRATE_W, CRATE_H / 2 + 1, 4)
			.fill({ color: LID });
		crate.rect(-3.5, -CRATE_H / 2, 7, CRATE_H).fill({ color: STRAP });
		for (const side of [-1, 1]) {
			const x = side * 6.4;
			crate.roundRect(x - 1.6, -1, 3.2, 6, 1.2).fill({ color: ROUND });
			crate
				.poly([x - 2.4, -1, x + 2.4, -1, x, -4.4])
				.fill({ color: ROUND });
		}
		root.addChild(glow, crate);
		this.root.addChild(root);
		return { root, glow, ageMs: SPAWN_POP_MS, present: false };
	}
}

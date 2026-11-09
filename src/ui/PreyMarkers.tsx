/**
 * Ibiriki's prey markers: a red pin over every bleeding hostile, and on the
 * frame's edge when the foe is outside it.
 *
 * The bloodlust is only as strong as the nearest low foe, so a predator needs
 * to know which way the blood is. Presentation only — the positions come from
 * Match.update/hudPrey (per frame at high frequency) and Match.emitHud (snapshots),
 * in screen fractions; nothing here decides anything the server would disagree with.
 * See specs/ibiriki.md.
 */

import { useEffect, useRef } from "react";
import { EventBus } from "../game/EventBus";
import { HUD_EVENTS, type HudPrey } from "../game/hud";

/**
 * The safe rectangle the pins are clamped into, as fractions of the frame.
 * The margins keep a pin clear of the fighter panels, the clock and the
 * bottom-right meters — the same sizes in container units the HUD uses.
 */
const EDGE_LEFT = 0.04;
const EDGE_RIGHT = 1 - EDGE_LEFT;
const EDGE_TOP = 0.14;
const EDGE_BOTTOM = 1 - 0.12;

/** How far above a foe's body centre the in-view pin floats, in view fractions. */
const ABOVE_HEAD = 0.13;

function clamp(value: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, value));
}

/** Where a prey pin goes, and which way its arrow points. */
export interface PreyPin {
	id: string;
	hp: number;
	/** Centre of the pin, as a fraction of the frame. */
	x: number;
	y: number;
	/** Arrow rotation, degrees clockwise from pointing right. */
	degrees: number;
	/** Whether the foe is in view (arrow pointing down above head) or off screen (edge arrow). */
	inView: boolean;
}

/**
 * Place every pin. Exported pure so the edge clamp can be tested without a
 * browser: an off-screen foe is pinned to the safe rectangle along the ray from
 * the frame's centre, pointing at the foe; a foe in view gets a downward arrow
 * just above its nameplate.
 */
export function preyPins(prey: readonly HudPrey[]): PreyPin[] {
	const pins: PreyPin[] = [];
	for (const foe of prey) {
		const inView =
			foe.screenX >= EDGE_LEFT &&
			foe.screenX <= EDGE_RIGHT &&
			foe.screenY >= EDGE_TOP &&
			foe.screenY <= EDGE_BOTTOM;

		if (inView) {
			pins.push({
				id: foe.id,
				hp: foe.hp,
				x: clamp(foe.screenX, EDGE_LEFT, EDGE_RIGHT),
				y: clamp(foe.screenY - ABOVE_HEAD, EDGE_TOP, EDGE_BOTTOM),
				degrees: 90,
				inView: true,
			});
			continue;
		}

		// Off-screen: project ray from screen centre (0.5, 0.5) to target (screenX, screenY)
		// onto the safe rectangle boundary.
		const cx = 0.5;
		const cy = 0.5;
		const dx = foe.screenX - cx;
		const dy = foe.screenY - cy;
		const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;

		let tMin = Infinity;
		if (dx > 1e-6) {
			const t = (EDGE_RIGHT - cx) / dx;
			if (t > 0) tMin = Math.min(tMin, t);
		} else if (dx < -1e-6) {
			const t = (EDGE_LEFT - cx) / dx;
			if (t > 0) tMin = Math.min(tMin, t);
		}
		if (dy > 1e-6) {
			const t = (EDGE_BOTTOM - cy) / dy;
			if (t > 0) tMin = Math.min(tMin, t);
		} else if (dy < -1e-6) {
			const t = (EDGE_TOP - cy) / dy;
			if (t > 0) tMin = Math.min(tMin, t);
		}

		let pinX: number;
		let pinY: number;
		if (tMin < Infinity) {
			pinX = clamp(cx + tMin * dx, EDGE_LEFT, EDGE_RIGHT);
			pinY = clamp(cy + tMin * dy, EDGE_TOP, EDGE_BOTTOM);
		} else {
			pinX = clamp(foe.screenX, EDGE_LEFT, EDGE_RIGHT);
			pinY = clamp(foe.screenY, EDGE_TOP, EDGE_BOTTOM);
		}

		pins.push({
			id: foe.id,
			hp: foe.hp,
			x: pinX,
			y: pinY,
			degrees,
			inView: false,
		});
	}
	return pins;
}

function syncPinsToDom(container: HTMLElement, pins: PreyPin[]) {
	const activeIds = new Set<string>();

	for (const pin of pins) {
		activeIds.add(pin.id);
		let el = container.querySelector<HTMLElement>(`[data-id="${pin.id}"]`);

		if (!el) {
			el = document.createElement("div");
			el.className = "vdh-prey";
			el.dataset["id"] = pin.id;

			const hp = document.createElement("span");
			hp.className = "vdh-prey-hp";
			el.appendChild(hp);

			const arrow = document.createElement("span");
			arrow.className = "vdh-prey-arrow";
			el.appendChild(arrow);

			container.appendChild(el);
		}

		const hpEl = el.querySelector<HTMLElement>(".vdh-prey-hp");
		const arrowEl = el.querySelector<HTMLElement>(".vdh-prey-arrow");

		el.style.left = `${pin.x * 100}%`;
		el.style.top = `${pin.y * 100}%`;
		el.dataset["inview"] = pin.inView ? "true" : "false";
		el.title = `bleeding prey — ${Math.round(pin.hp * 100)}% HP`;

		if (hpEl) {
			const hpText = `${Math.round(pin.hp * 100)}%`;
			if (hpEl.textContent !== hpText) {
				hpEl.textContent = hpText;
			}
		}

		if (arrowEl) {
			arrowEl.style.transform = `rotate(${pin.degrees}deg)`;
		}
	}

	const children = Array.from(container.children) as HTMLElement[];
	for (const child of children) {
		const id = child.dataset["id"];
		if (id && !activeIds.has(id)) {
			container.removeChild(child);
		}
	}
}

export function PreyMarkers({ prey }: { prey: readonly HudPrey[] }) {
	const containerRef = useRef<HTMLDivElement>(null);

	// Initial or prop-based sync
	useEffect(() => {
		if (containerRef.current) {
			syncPinsToDom(containerRef.current, preyPins(prey));
		}
	}, [prey]);

	// High-frequency per-frame sync from Match loop
	useEffect(() => {
		const off = EventBus.on(HUD_EVENTS.prey, ((livePrey: HudPrey[]) => {
			if (containerRef.current) {
				syncPinsToDom(containerRef.current, preyPins(livePrey));
			}
		}) as never);
		return off;
	}, []);

	return <div ref={containerRef} className="vdh-prey-layer" />;
}

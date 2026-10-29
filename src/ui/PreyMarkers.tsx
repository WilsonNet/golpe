/**
 * Ibiriki's prey markers: a red pin over every bleeding hostile, and on the
 * frame's edge when the foe is outside it.
 *
 * The bloodlust is only as strong as the nearest low foe, so a predator needs
 * to know which way the blood is. Presentation only — the positions come from
 * `Match.emitHud`, already in screen fractions; nothing here decides anything
 * the server would disagree with. See specs/ibiriki.md.
 */

import type { HudPrey } from "../game/hud";

/** Outside this band the foe is off screen and the pin moves to the edge. */
const INSIDE_LOW = 0.015;
const INSIDE_HIGH = 1 - INSIDE_LOW;

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
}

/**
 * Place every pin. Exported pure so the edge clamp can be tested without a
 * browser: an off-screen foe is pinned to the safe rectangle and its arrow
 * points from the frame's centre at it; a foe in view gets a downward arrow
 * just above its nameplate.
 */
export function preyPins(prey: readonly HudPrey[]): PreyPin[] {
	const pins: PreyPin[] = [];
	for (const foe of prey) {
		const outside =
			foe.screenX < INSIDE_LOW ||
			foe.screenX > INSIDE_HIGH ||
			foe.screenY < INSIDE_LOW ||
			foe.screenY > INSIDE_HIGH;
		if (outside) {
			pins.push({
				id: foe.id,
				hp: foe.hp,
				x: clamp(foe.screenX, EDGE_LEFT, EDGE_RIGHT),
				y: clamp(foe.screenY, EDGE_TOP, EDGE_BOTTOM),
				degrees: (Math.atan2(foe.screenY - 0.5, foe.screenX - 0.5) * 180) / Math.PI,
			});
			continue;
		}
		pins.push({
			id: foe.id,
			hp: foe.hp,
			x: clamp(foe.screenX, EDGE_LEFT, EDGE_RIGHT),
			y: clamp(foe.screenY - ABOVE_HEAD, EDGE_TOP, EDGE_BOTTOM),
			degrees: 90,
		});
	}
	return pins;
}

export function PreyMarkers({ prey }: { prey: readonly HudPrey[] }) {
	const pins = preyPins(prey);
	if (pins.length === 0) return null;
	return (
		<>
			{pins.map((pin) => (
				<div
					key={pin.id}
					className="vdh-prey"
					style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
					title={`bleeding prey — ${Math.round(pin.hp * 100)}% HP`}
				>
					<span
						className="vdh-prey-arrow"
						style={{ transform: `rotate(${pin.degrees}deg)` }}
					/>
					<span className="vdh-prey-hp">{Math.round(pin.hp * 100)}%</span>
				</div>
			))}
		</>
	);
}

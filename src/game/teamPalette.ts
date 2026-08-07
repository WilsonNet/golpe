/**
 * The team colours, and the one function that applies them.
 *
 * Presentation, but deliberately **dependency-free**: the canvas renderer, the
 * React HUD and the podium all need the same two colours, and a module that
 * imported Pixi could not be used by the overlay. Nothing in `simulation/` may
 * import this — a colour is not a rule.
 *
 * ## Why blue and orange
 *
 * They are complementary, so they separate at any size and against both the
 * bright sky and the dark ledges; they survive the two common colour-vision
 * deficiencies, which red/green does not; and neither collides with a colour the
 * game already uses to *mean* something — green/amber/red is health, violet is
 * the ultimate, gold is the HUD's frame. A team colour has to be legible without
 * ever being mistaken for one of those.
 *
 * ## Why tinting is a mix and not a replacement
 *
 * Every combat colour in this game already carries information: white is the
 * first slash, amber the finisher, cyan the uppercut, violet the ultimate. Paint
 * those flat team-blue and the move data is gone — you would know *whose* swing
 * it was and no longer *what* it was. So a team tint is a **blend toward** the
 * side's colour, at a strength chosen per effect: heavy where the source colour
 * was neutral (sparks, dash wind, shadows), light where it was already saying
 * something (a swing trail, the black hole).
 *
 * The result is that a fight reads twice: what happened, from the colour it has
 * always been, and who did it, from the direction that colour is pulled in.
 */

import type { TeamId } from "./simulation/Teams";

/**
 * The two sides, as packed RGB.
 *
 * Chosen bright enough to hold their hue after being mixed 35% into a white
 * spark, which is the weakest tint anything here uses — a duller pair simply
 * disappeared at that strength.
 */
const TEAM_COLORS: readonly number[] = [
	/** AZURE — a cool, saturated blue. */ 0x4ea8ff,
	/** EMBER — a warm orange, its complement. */ 0xff8a4c,
];

/** The same colours as CSS, for the DOM overlay. */
const TEAM_CSS: readonly string[] = ["#4ea8ff", "#ff8a4c"];

/** Untinted white, for a fighter with no team. */
export const NEUTRAL = 0xffffff;

/**
 * Tint strengths, named so the whole scheme can be retuned in one place.
 *
 * They are a scale of "how much information was in the original colour": the
 * more the source colour meant, the less of it is allowed to be replaced.
 */
export const TINT = {
	/** Swing trails, ultimate violet, the black hole. The colour still means something. */
	subtle: 0.34,
	/**
	 * Impact sparks and shards. Mostly move-coloured, pulled clearly toward the side.
	 *
	 * Raised from a half after looking at a real fight: most of these are drawn
	 * **additively over a bright sky**, which washes any tint toward white — the
	 * same thing that forced the ultimate's aura to be painted rather than added.
	 * A blend that reads as "clearly blue" in isolation reads as "white" at 50%
	 * on this background.
	 */
	medium: 0.62,
	/** Dash wind, charge motes, stun stars — near-neutral to begin with. */
	strong: 0.8,
	/** Names, shadows, bullets. The colour *is* the identity. */
	full: 1,
} as const;

/** Blend two packed RGB colours. `t` is how far toward `to`. */
export function mixRgb(from: number, to: number, t: number): number {
	const f = Math.max(0, Math.min(1, t));
	const r =
		((from >> 16) & 0xff) + (((to >> 16) & 0xff) - ((from >> 16) & 0xff)) * f;
	const g =
		((from >> 8) & 0xff) + (((to >> 8) & 0xff) - ((from >> 8) & 0xff)) * f;
	const b = (from & 0xff) + ((to & 0xff) - (from & 0xff)) * f;
	return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/** A side's colour, or white when there are no sides. */
export function teamColor(team: TeamId | null | undefined): number {
	return team === null || team === undefined
		? NEUTRAL
		: (TEAM_COLORS[team] ?? NEUTRAL);
}

/**
 * Pull a colour toward a side's.
 *
 * **The only way team colour is ever applied.** Every effect calls this with its
 * own colour and a strength from `TINT`, so a fighter with no team gets its
 * colour back unchanged — which is what keeps free-for-all looking exactly as it
 * always has, with no branch in any effect.
 */
export function teamTint(
	base: number,
	team: TeamId | null | undefined,
	strength: number = TINT.medium,
): number {
	if (team === null || team === undefined) return base;
	return mixRgb(base, teamColor(team), strength);
}

/**
 * The colour a fighter's cast shadow is painted.
 *
 * Darker and more saturated than the team colour itself: a shadow is a shadow
 * first, so it has to sit under the fighter as an absence of light that happens
 * to be tinted, not as a coloured puddle. Mixed *toward black* rather than
 * alpha'd down, because the shadow is drawn in normal blend mode over a bright
 * sky where a faint tint would wash out entirely.
 */
export function teamShadowColor(team: TeamId | null | undefined): number {
	// A *tinted* shadow, not a black one — darkened only as far as the hue
	// survives. Half-way to black looked correct as a colour value and rendered as
	// grey on the arena's pale sky, which is the whole point of the thing lost.
	// The alpha it is drawn at is what makes it read as shade; this only decides
	// which side's shade it is. A teamless fighter gets an ordinary dark shadow.
	return mixRgb(teamColor(team), 0x000000, team === null ? 0.7 : 0.32);
}

/** CSS for a side, for the HUD and the podium. */
export function teamCss(team: TeamId | null | undefined): string {
	return team === null || team === undefined
		? "#cfd8e3"
		: (TEAM_CSS[team] ?? "#cfd8e3");
}

/**
 * The hero select: who am I playing?
 *
 * Shared by the root menu (where the choice becomes the URL's `?hero=`) and
 * the Esc menu (where it becomes a `hero-select` message the match sends to
 * the server). Two cards, one per hero: the sprite is the hero's own sheet
 * blown up with `image-rendering: pixelated`, exactly like the ultimate
 * cinematic's portrait — the sheet is the character, and a card that drew
 * something else would be a card that lied.
 */

import { HERO_IDS, HEROES, type HeroId } from "../game/simulation/Heroes";
import { HUD_CSS } from "./hudStyles";

/**
 * The sheet-frame drawing rules shared by the hero select and the root menu's
 * compact fighter picker. One source of truth for how a hero's sprite is
 * rendered: the face-on frame (cell 4 of every nine-cell strip) from the
 * hero's own sheet, blown up pixel-perfect.
 */
export const HERO_SPRITE_CSS = `
.hp-sprite {
	width: 64px;
	height: 96px;
	background-size: 576px 96px;
	image-rendering: pixelated;
	image-rendering: crisp-edges;
	/* The face-on frame is cell 4 of every nine-cell strip. */
	background-position: -256px 0;
}
.hp-sprite-lia { background-image: url("assets/dude.png"); }
.hp-sprite-anands { background-image: url("assets/anands.png"); }
.hp-sprite-jeffs { background-image: url("assets/jeffs.png"); }
`;

/** The ultimate's name per hero, so the card never invents one. */
const ULT_NAMES: Record<string, string> = {
	"black-hole": "Black Hole",
	"dragon-thrust": "Dragon Thrust",
	"death-blossom": "Death Blossom",
};

const HERO_CSS = `
${HERO_SPRITE_CSS}
.hp-cards {
	display: flex;
	gap: 14px;
	justify-content: center;
	margin: 12px 0 4px;
}
.hp-card {
	flex: 1 1 0;
	max-width: 220px;
	background: rgba(18, 12, 34, 0.92);
	border: 1px solid rgba(255, 209, 102, 0.35);
	border-radius: 8px;
	padding: 10px 12px 12px;
	cursor: pointer;
	text-align: center;
	transition: border-color 120ms, box-shadow 120ms;
}
.hp-card:hover { border-color: rgba(255, 209, 102, 0.8); }
.hp-card-on {
	border-color: #ffd166;
	box-shadow: 0 0 12px rgba(255, 209, 102, 0.35);
}
.hp-sprite {
	margin: 0 auto 6px;
}
.hp-name {
	font: 700 15px/1.1 var(--vd-font, inherit);
	color: #ffd166;
	letter-spacing: 0.04em;
	margin-bottom: 2px;
}
.hp-kit {
	font-size: 11px;
	color: #cfc4e4;
	margin-bottom: 4px;
	line-height: 1.35;
}
.hp-kit b { color: #f2e8ff; font-weight: 600; }
.hp-blurb {
	font-size: 11px;
	color: #9a8fb8;
	line-height: 1.35;
}
.hp-note {
	font-size: 11px;
	color: #8a7fa8;
	text-align: center;
	margin-top: 6px;
}
`;

function HeroCard({
	hero,
	selected,
	onPick,
}: {
	hero: HeroId;
	selected: boolean;
	onPick: (hero: HeroId) => void;
}) {
	const def = HEROES[hero];
	return (
		<button
			type="button"
			className={`hp-card${selected ? " hp-card-on" : ""}`}
			aria-pressed={selected}
			onClick={() => onPick(hero)}
		>
			<div className={`hp-sprite hp-sprite-${hero}`} />
			<div className="hp-name">{def.name}</div>
			<div className="hp-kit">
				<b>{def.melee.label}</b> · <b>{def.ranged.label}</b>
				<br />
				Ult — {ULT_NAMES[def.ultimate] ?? "?"}
			</div>
			<div className="hp-blurb">{def.blurb}</div>
		</button>
	);
}

/**
 * The two hero cards. `current` is the selected hero; `onPick` receives the
 * choice. The cards render the hero's actual sheet frame, so what a player
 * picks is what they will see in the arena.
 */
export function HeroSelect({
	current,
	onPick,
}: {
	current: HeroId;
	onPick: (hero: HeroId) => void;
}) {
	return (
		<>
			<style>{HUD_CSS}</style>
			<style>{HERO_CSS}</style>
			<div className="hp-cards">
				{HERO_IDS.map((hero) => (
					<HeroCard
						key={hero}
						hero={hero}
						selected={current === hero}
						onPick={onPick}
					/>
				))}
			</div>
			<div className="hp-note">
				{current === "lia"
					? "The duelist: a guard to read with, a chain to walk, a black hole to earn."
					: current === "anands"
						? "The storm: no guard at all — stabs, a lunge that knocks down, a dragon."
						: "The executioner: a one-blast kill at point blank, a smoke to vanish in, a storm."}
			</div>
		</>
	);
}

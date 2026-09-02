/**
 * The fight HUD's stylesheet.
 *
 * Two tiers, deliberately:
 *
 * - **Gameplay** — the fighter panels, the clock and the ultimate meter.
 *   Competitive minimal: slim translucent strips in the arena's own colours,
 *   a hairline of the game's cyan accent (#7ff0f4 — the aim beam, every menu)
 *   instead of a gold frame, and no ornament. These elements are always on
 *   screen; the less they look like a window, the less they block the view.
 * - **Interrupt** — the battle message window. It exists to take the eye, so
 *   it keeps the Chrono Trigger / Fire Emblem gold codex frame. Same reason
 *   the podium and the menus keep their frames.
 *
 * The HUD is DOM, because subpixel-crisp text at any DPR and CSS transitions
 * are exactly what canvas text is bad at — see the `hud-design` skill.
 *
 * Sizing is authored in **container units** (`cqw`/`cqh`) against the HUD's
 * own box, which is exactly the displayed canvas rectangle. The game is
 * authored at 800x600 and the canvas is scaled to fit, so 1cqw = 8 logical
 * px and 1cqh = 6 logical px at every display size — the HUD scales with the
 * arena instead of drifting off it, with no JS measurement anywhere.
 */

export const FIGHT_HUD_CSS = `
.vdh-hud {
	position: absolute;
	inset: 0;
	z-index: 10;
	pointer-events: none;
	container-type: size;
	user-select: none;
	-webkit-user-select: none;
	touch-action: none;
	font-family: ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace;
	color: #d9f4f6;
	letter-spacing: 0.05em;
}
.vdh-hud * {
	box-sizing: border-box;
}

/* ---- the interrupt frame: the gold codex ----
   Only the message window wears this. A dark inked window, a gold frame, an
   inner hairline, L-shaped corner ornaments. */
.vdh-frame {
	position: relative;
	background: linear-gradient(180deg, rgba(18, 22, 40, 0.94), rgba(7, 10, 20, 0.9));
	border: 1px solid #b8944a;
	border-radius: 4px;
	box-shadow:
		0 0 0 1px rgba(0, 0, 0, 0.65),
		0 6px 22px rgba(0, 0, 0, 0.6),
		inset 0 0 0 1px rgba(243, 212, 136, 0.25);
}
.vdh-frame::before,
.vdh-frame::after {
	content: "";
	position: absolute;
	width: 1.8cqw;
	height: 1.4cqh;
	pointer-events: none;
}
.vdh-frame::before {
	top: -2px;
	left: -2px;
	border-top: 2px solid #f3d488;
	border-left: 2px solid #f3d488;
}
.vdh-frame::after {
	bottom: -2px;
	right: -2px;
	border-bottom: 2px solid #f3d488;
	border-right: 2px solid #f3d488;
}

/* ---- the fighter panels, top-left and top-right ----
   Gameplay tier: a thin translucent strip in the sky's own dark teal, edged
   with a hairline of the aim beam's cyan. No frame, no corners — it reads as
   part of the arena, not as a window over it. */
.vdh-panel {
	position: absolute;
	top: 1.4cqh;
	width: 24cqw;
	padding: 0.8cqh 1.2cqw 0.9cqh;
	/* Translucent enough that the sky bleeds through — a strip in the world,
	   not a window over it. Text legibility comes from the shadows, not the
	   backing. */
	background: linear-gradient(180deg, rgba(6, 18, 30, 0.42), rgba(6, 18, 30, 0.2));
	border: 1px solid rgba(127, 240, 244, 0.16);
	border-radius: 2px;
}
.vdh-panel.vdh-foe {
	left: auto;
	right: 1.4cqw;
}
.vdh-panel.vdh-self {
	left: 1.4cqw;
}
/* The foe panel is the self panel's mirror: name reads off the right edge,
   the HP number off the left, so both bars deplete toward the arena's
   centre the way a fighting game's twin bars do. */
.vdh-foe .vdh-plaque,
.vdh-foe .vdh-hp-row {
	flex-direction: row-reverse;
}
.vdh-foe .vdh-frags {
	text-align: right;
}
/* In a training room the scriptable panel owns the top-left corner; the HUD
   drops below it rather than sitting under it. */
.vdh-panel.vdh-beside-training {
	top: 8.7cqh;
}

.vdh-plaque {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 1cqw;
	margin-bottom: 0.6cqh;
}
.vdh-name {
	font-size: 1.4cqw;
	font-weight: bold;
	color: #7ff0f4;
	text-shadow: 0 0.2cqh 0 rgba(0, 0, 0, 0.7);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 14cqw;
}
.vdh-stance {
	font-size: 1.05cqw;
	letter-spacing: 0.18em;
	color: rgba(217, 244, 246, 0.55);
	white-space: nowrap;
}
/* The foe panel's hero chip: who you are fighting, in the same plaque. */
.vdh-hero {
	font-size: 1.05cqw;
	letter-spacing: 0.18em;
	color: rgba(255, 209, 102, 0.65);
	white-space: nowrap;
}
.vdh-stance.vdh-stance-gun {
	color: rgba(226, 177, 132, 0.8);
}
/* The Massive Strike is armed: the badge breathes gold, the fireball's gold. */
.vdh-stance.vdh-massive {
	color: #ffd166;
	animation: vdh-massive-breathe 800ms ease-in-out infinite;
}
@keyframes vdh-massive-breathe {
	0%, 100% { text-shadow: 0 0 0 rgba(255, 209, 102, 0); }
	50% { text-shadow: 0 0 1.2cqw rgba(255, 209, 102, 0.85); }
}

.vdh-hp {
	position: relative;
	/* Every child is absolutely positioned, so the track has no intrinsic
	   width — without flex-grow it collapses to a hairline and the fills,
	   the ghost and the ticks render at zero width. This is the fix for the
	   HUD that showed bars that were not there. */
	flex: 1;
	min-width: 0;
	height: 1.3cqh;
	background: rgba(4, 8, 14, 0.72);
	border: 1px solid rgba(0, 0, 0, 0.7);
	border-radius: 1px;
	box-shadow: inset 0 0.3cqh 0.5cqh rgba(0, 0, 0, 0.55);
	overflow: hidden;
}
/* The FE battle-forecast ghost: where the bar *was*, draining after the hit. */
.vdh-hp-ghost {
	position: absolute;
	inset: 0;
	background: #ffffff;
	transition: width 700ms ease-out 220ms;
}
.vdh-hp-fill {
	position: absolute;
	inset: 0;
	transition: width 240ms ease-out;
}
.vdh-hp-fill::after {
	content: "";
	position: absolute;
	left: 0;
	right: 0;
	top: 0;
	height: 45%;
	/* Kept low so it lights the bar's top edge without washing the fill's
	   green/amber/red state out to a different colour. */
	background: linear-gradient(180deg, rgba(255, 255, 255, 0.26), rgba(255, 255, 255, 0));
}
/* The FE segment ticks at one- and two-thirds: dark dividers that stay
   visible over any fill colour. */
.vdh-hp-ticks {
	position: absolute;
	inset: 0;
	pointer-events: none;
	background-image: linear-gradient(
		90deg,
		transparent calc(33.333% - 1.5px),
		rgba(0, 0, 0, 0.9) 33.333%,
		transparent calc(33.333% + 1.5px),
		transparent calc(66.666% - 1.5px),
		rgba(0, 0, 0, 0.9) 66.666%,
		transparent calc(66.666% + 1.5px)
	);
}

.vdh-hp-row {
	display: flex;
	align-items: center;
	gap: 1cqw;
}
.vdh-hp-num {
	font-size: 1.7cqw;
	font-variant-numeric: tabular-nums;
	color: #d9f4f6;
	text-shadow: 0 0.2cqh 0 rgba(0, 0, 0, 0.7);
	white-space: nowrap;
}

.vdh-frags {
	margin-top: 0.7cqh;
	font-size: 1.15cqw;
	letter-spacing: 0.16em;
	color: rgba(217, 244, 246, 0.5);
	text-transform: uppercase;
	white-space: nowrap;
}
.vdh-frags b {
	color: #7ff0f4;
	font-weight: bold;
	font-variant-numeric: tabular-nums;
}
/* A frag scored: the counter pops cyan and a +1 rises off it. */
.vdh-killpop {
	display: inline-block;
	margin-left: 0.8cqw;
	color: #ffd166;
	font-weight: bold;
	animation: vdh-killpop-rise 900ms ease-out both;
}
@keyframes vdh-killpop-rise {
	0% { opacity: 1; transform: translateY(0); }
	100% { opacity: 0; transform: translateY(-2cqh); }
}

/* Damage landed on this fighter: the strip's hairline flushes red and a glow
   breathes behind it. Re-triggered by re-adding the class, so a rapid volley
   reads as a rattle rather than one long flash. */
.vdh-panel.vdh-damaged {
	animation: vdh-hit 400ms ease-out;
}
@keyframes vdh-hit {
	0% { border-color: rgba(255, 93, 93, 0.85); box-shadow: 0 0 1.8cqw rgba(255, 93, 93, 0.4); }
	70% { border-color: rgba(255, 93, 93, 0.4); }
	100% { border-color: rgba(127, 240, 244, 0.16); }
}
/* Low HP: the bar's red deepens and pulses — an alarm visible in peripheral
   vision without ever taking the eyes off the fight. */
.vdh-hp-fill.vdh-low {
	animation: vdh-low-pulse 900ms ease-in-out infinite;
}
@keyframes vdh-low-pulse {
	0%, 100% { filter: brightness(1); }
	50% { filter: brightness(1.45); }
}

/* ---- freezetime, centre screen ----
   The one element allowed to own the middle of the arena, and only because for
   the ten seconds it is up there is nothing behind it to own: nobody can move.
   It is the mode's held breath — CS's freezetime — so it is drawn like a title
   card and not like a HUD widget. */
.vdh-freeze {
	position: absolute;
	left: 50%;
	top: 34cqh;
	transform: translateX(-50%);
	text-align: center;
	pointer-events: none;
}
.vdh-freeze-round {
	font-size: 1.8cqw;
	letter-spacing: 0.34em;
	text-transform: uppercase;
	color: rgba(243, 212, 136, 0.9);
	text-shadow:
		0 0.2cqh 0 rgba(0, 0, 0, 0.85),
		0 0 1cqw rgba(0, 0, 0, 0.5);
}
.vdh-freeze-count {
	font-size: 9cqw;
	font-weight: bold;
	line-height: 1;
	font-variant-numeric: tabular-nums;
	color: #f6f2e8;
	text-shadow:
		0 0.5cqh 0 rgba(0, 0, 0, 0.7),
		0 0 3cqw rgba(0, 0, 0, 0.45);
	/* Re-mounted on every second (keyed on the number), so the beat restarts
	   rather than easing once and sitting still — a countdown that does not tick
	   visibly is a number, not a countdown. */
	animation: vdh-freeze-tick 1s ease-out;
}
@keyframes vdh-freeze-tick {
	0% { transform: scale(1.45); opacity: 0.35; }
	18% { transform: scale(1); opacity: 1; }
	100% { transform: scale(1); opacity: 0.85; }
}
/* The last three seconds are the adrenaline. */
.vdh-freeze-count.vdh-freeze-soon {
	color: #ffd166;
}
.vdh-freeze-sides {
	margin-top: 0.6cqh;
	font-size: 1.5cqw;
	letter-spacing: 0.16em;
	text-transform: uppercase;
	text-shadow: 0 0.2cqh 0 rgba(0, 0, 0, 0.85);
}

/* ---- the match clock, top-centre ----
   Gameplay tier, the one element that may stay big: the timer is the match.
   Plain gold numerals floating over the arena — no backing at all — so it
   reads from the corner of the eye and never feels like furniture. */
.vdh-clock {
	position: absolute;
	top: 1.2cqh;
	left: 50%;
	transform: translateX(-50%);
	text-align: center;
}
.vdh-clock-time {
	font-size: 3.4cqw;
	font-weight: bold;
	font-variant-numeric: tabular-nums;
	line-height: 1;
	color: #ffd166;
	text-shadow:
		0 0.3cqh 0 rgba(0, 0, 0, 0.6),
		0 0 1.4cqw rgba(0, 0, 0, 0.3);
}
.vdh-clock-sub {
	margin-top: 0.4cqh;
	font-size: 1.5cqw;
	letter-spacing: 0.2em;
	color: rgba(243, 212, 136, 0.9);
	text-transform: uppercase;
	white-space: nowrap;
	text-shadow:
		0 0.2cqh 0 rgba(0, 0, 0, 0.8),
		0 0 0.8cqw rgba(0, 0, 0, 0.4);
}
/* ---- the team scoreboard, under the clock (TDM only) ----
   Two round scores in their own colours with the living count between them.
   In a wipe-out mode "4 v 2" is the single most decision-changing number on
   screen — it is what tells you whether to push or to hold — so it sits in the
   one place the eye already goes for the clock, and nowhere else. */
.vdh-teams {
	display: flex;
	align-items: baseline;
	justify-content: center;
	gap: 0.9cqw;
	margin-top: 0.3cqh;
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}
.vdh-team-score {
	font-size: 2.6cqw;
	font-weight: bold;
	line-height: 1;
	text-shadow:
		0 0.2cqh 0 rgba(0, 0, 0, 0.8),
		0 0 0.9cqw rgba(0, 0, 0, 0.45);
}
/* The side that just took a round flares once, then settles. A score that
   changed silently is a score nobody saw change. */
.vdh-team-score.vdh-team-won {
	animation: vdh-team-won 900ms ease-out;
}
@keyframes vdh-team-won {
	0% { transform: scale(1.55); filter: brightness(1.8); }
	100% { transform: scale(1); filter: none; }
}
.vdh-team-alive {
	font-size: 1.15cqw;
	letter-spacing: 0.1em;
	color: rgba(226, 236, 245, 0.75);
	text-shadow: 0 0.2cqh 0 rgba(0, 0, 0, 0.8);
}
/* The side with nobody left is one hit from losing the round; say so. */
.vdh-team-alive.vdh-team-critical {
	color: #ff9c6b;
}
.vdh-round {
	margin-top: 0.25cqh;
	font-size: 1.2cqw;
	letter-spacing: 0.2em;
	text-transform: uppercase;
	color: rgba(243, 212, 136, 0.75);
	text-shadow: 0 0.2cqh 0 rgba(0, 0, 0, 0.8);
}

.vdh-clock.vdh-clock-danger .vdh-clock-time {
	color: #ff5d5d;
	animation: vdh-clock-danger 1s ease-in-out infinite;
}
@keyframes vdh-clock-danger {
	0%, 100% { text-shadow: 0 0.3cqh 0 rgba(0, 0, 0, 0.6); }
	50% { text-shadow: 0 0 1.6cqw rgba(255, 93, 93, 0.85); }
}

/* ---- the magazine and the reload, bottom-right above the item ----
   Gameplay tier, same register: the weapon's own resource sits above the
   kit's finite one. The count is the readable part ("3/5"), and the bar is
   the *becoming* — a shell climbing into a shotgun, the whole magazine
   refilling the rifle and the machine gun. The CSS glide smooths the 20Hz
   snapshot steps into a continuous fill. */
.vdh-ammo {
	position: absolute;
	bottom: 9.2cqh;
	right: 1.4cqw;
	display: flex;
	align-items: center;
	gap: 0.8cqw;
	width: 28cqw;
}
.vdh-ammo-label {
	font-size: 1.1cqw;
	letter-spacing: 0.18em;
	color: rgba(217, 244, 246, 0.55);
	white-space: nowrap;
	text-shadow: 0 0.2cqh 0 rgba(0, 0, 0, 0.7);
}
.vdh-ammo-count {
	font-size: 1.15cqw;
	font-weight: bold;
	font-variant-numeric: tabular-nums;
	color: #f2e8ff;
	min-width: 5cqw;
	text-align: right;
	text-shadow: 0 0.2cqh 0 rgba(0, 0, 0, 0.75);
}
/* The gun has nothing left in this life: the magazine is empty and there is
   no reserve to draw from. It flashes so the "go melee" moment is impossible
   to miss, not a quiet grey. */
.vdh-ammo-count-dry {
	color: #ff5d5d;
	animation: vdh-dry-flash 0.9s ease-in-out infinite;
}
@keyframes vdh-dry-flash {
	0%,
	100% {
		text-shadow: 0 0 0.8cqw rgba(255, 93, 93, 0.7);
	}
	50% {
		text-shadow: 0 0 0.2cqw rgba(255, 93, 93, 0.2);
	}
}
.vdh-ammo-track {
	position: relative;
	flex: 1;
	min-width: 0;
	height: 0.9cqh;
	background: rgba(10, 20, 32, 0.6);
	border: 1px solid rgba(127, 240, 244, 0.25);
	border-radius: 1px;
	box-shadow: inset 0 0.3cqh 0.5cqh rgba(0, 0, 0, 0.4);
	overflow: hidden;
}
.vdh-ammo-fill {
	position: absolute;
	inset: 0;
	background: #7fa8e8;
	transition: width 160ms linear;
}

/* ---- the item charges, bottom-right above the ultimate ----
   Gameplay tier, same register as the ultimate meter: the item is the finite
   resource next to the earned one, so its pips sit directly above the ult
   sliver in the same corner. A pip greys out with each use and refills on the
   next life — reading "how much item do I have left" should cost nothing. */
.vdh-item {
	position: absolute;
	bottom: 5.2cqh;
	right: 1.4cqw;
	display: flex;
	align-items: center;
	gap: 0.8cqw;
	width: 28cqw;
}
.vdh-item-label {
	font-size: 1.1cqw;
	letter-spacing: 0.18em;
	color: rgba(217, 244, 246, 0.7);
	white-space: nowrap;
	text-shadow: 0 0.2cqh 0 rgba(0, 0, 0, 0.7);
}
.vdh-item-pips {
	display: flex;
	gap: 0.5cqw;
	flex: 1;
	min-width: 0;
}
.vdh-item-pip {
	flex: 1;
	height: 1.1cqh;
	border: 1px solid rgba(127, 240, 244, 0.4);
	background: #5a8fd0;
	transition: background 180ms linear, opacity 180ms linear;
}
.vdh-item-pip-empty {
	background: rgba(10, 20, 32, 0.6);
	opacity: 0.5;
}
.vdh-item-key {
	font-size: 1.15cqw;
	color: #7ff0f4;
	border: 1px solid rgba(127, 240, 244, 0.4);
	border-radius: 2px;
	padding: 0.2cqh 0.7cqw;
	background: rgba(4, 8, 14, 0.55);
	min-width: 3cqw;
	text-align: center;
	text-transform: uppercase;
}

/* ---- the ultimate meter, bottom-right ----
   Gameplay tier: a thin sliver tucked into the corner, the black hole's own
   violet when armed. Bottom-left belongs to the hint; the arena's ground band
   stays clear between them. The percentage readout carries the readability —
   a thin bar alone cannot answer "how close am I". */
.vdh-ult {	position: absolute;
	bottom: 1.2cqh;
	right: 1.4cqw;
	display: flex;
	align-items: center;
	gap: 1cqw;
	width: 28cqw;
}
.vdh-ult-label {
	font-size: 1.2cqw;
	letter-spacing: 0.2em;
	color: rgba(217, 244, 246, 0.85);
	white-space: nowrap;
	text-shadow: 0 0.2cqh 0 rgba(0, 0, 0, 0.7);
}
.vdh-ult-pct {
	font-size: 1.35cqw;
	font-weight: bold;
	font-variant-numeric: tabular-nums;
	color: #ffd166;
	text-shadow: 0 0.2cqh 0 rgba(0, 0, 0, 0.75);
	/* "100%" is four glyphs — hold the width so the bar never jiggles as the
	   number climbs. */
	min-width: 3.8cqw;
	text-align: right;
}
.vdh-ult-ready .vdh-ult-pct {
	color: #b06bff;
	animation: vdh-ult-ready-breathe 900ms ease-in-out infinite;
}
@keyframes vdh-ult-ready-breathe {
	0%, 100% { text-shadow: 0 0 0 rgba(176, 107, 255, 0); }
	50% { text-shadow: 0 0 1.4cqw rgba(176, 107, 255, 0.9); }
}
.vdh-ult-track {
	position: relative;
	flex: 1;
	min-width: 0;
	height: 1.3cqh;
	/* Lighter than the HP track: an empty ultimate must still answer "how
	   close am I" — the bar is invisible until it is almost full otherwise. */
	background: rgba(10, 20, 32, 0.6);
	border: 1px solid rgba(127, 240, 244, 0.3);
	border-radius: 1px;
	box-shadow: inset 0 0.3cqh 0.5cqh rgba(0, 0, 0, 0.4);
	overflow: hidden;
}
.vdh-ult-fill {
	position: absolute;
	inset: 0;
	transition: width 180ms linear;
}
.vdh-ult-fill::after {
	content: "";
	position: absolute;
	left: 0;
	right: 0;
	top: 0;
	height: 45%;
	background: linear-gradient(180deg, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0));
}
.vdh-ult-ready .vdh-ult-fill {
	animation: vdh-ult-pulse 900ms ease-in-out infinite;
}
@keyframes vdh-ult-pulse {
	0%, 100% { filter: brightness(1); }
	50% { filter: brightness(1.4); }
}
.vdh-ult-key {
	font-size: 1.15cqw;
	color: #7ff0f4;
	border: 1px solid rgba(127, 240, 244, 0.4);
	border-radius: 2px;
	padding: 0.2cqh 0.7cqw;
	background: rgba(4, 8, 14, 0.55);
	min-width: 3cqw;
	text-align: center;
	text-transform: uppercase;
}

/* ---- the battle message window ----
   Interrupt tier: the one thing in this file that is allowed to take the eye,
   so it keeps the gold codex frame. Slides up when there is something to say
   and hides itself when there is not. */
.vdh-msg {
	position: absolute;
	bottom: 13.5cqh;
	left: 50%;
	transform: translateX(-50%) translateY(1cqh);
	max-width: 62cqw;
	padding: 1.2cqh 2.4cqw;
	font-size: 1.9cqw;
	color: #f3d488;
	text-shadow: 0 0.3cqh 0 rgba(0, 0, 0, 0.85);
	text-align: center;
	opacity: 0;
	pointer-events: none;
	transition: opacity 260ms ease-out, transform 260ms ease-out;
}
.vdh-msg.vdh-msg-show {
	opacity: 1;
	transform: translateX(-50%) translateY(0);
}

/* ---- the kill feed, top-right below the foe panel ----
   Gameplay tier, wearing the fighter panels' register: the one thing on screen
   whose job is to be picked up by an eye never pointed at it. Just the names,
   the means icon and the means' name — then it is gone. The winner wears the
   HUD's cyan and the loser a soft red in a free-for-all; in a team match the
   inline style overrides both with each fighter's actual team colour, so a
   row never paints a fixed side as the one that died. The means sits in the
   killpop's gold: the icon is what happened, the label is what to respect
   next fight.
   A row one fighter in it is careful to read gets the brighter hairline. */
.vdh-killfeed {
	position: absolute;
	top: 10cqh;
	right: 1.4cqw;
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 0.5cqh;
	pointer-events: none;
}
.vdh-kill-row {
	display: flex;
	align-items: center;
	gap: 0.7cqw;
	padding: 0.4cqh 1cqw;
	max-width: 36cqw;
	background: linear-gradient(180deg, rgba(6, 18, 30, 0.52), rgba(6, 18, 30, 0.28));
	border: 1px solid rgba(127, 240, 244, 0.18);
	border-radius: 2px;
	white-space: nowrap;
	/* The enter completes in 260ms and the exit is a class flip at 5.58s:
	   the animation ends on the row's resting state, so the transition owns
	   everything after it. */
	animation: vdh-kill-in 260ms ease-out;
	transition: opacity 380ms ease-out, transform 380ms ease-out;
}
.vdh-kill-row.vdh-kill-mine {
	border-color: rgba(127, 240, 244, 0.55);
}
.vdh-kill-row.vdh-kill-out {
	opacity: 0;
	transform: translateX(1.6cqw);
}
@keyframes vdh-kill-in {
	from {
		opacity: 0;
		transform: translateX(1.6cqw);
	}
	to {
		opacity: 1;
		transform: translateX(0);
	}
}
.vdh-kill-name {
	/* A flex item's min-width is its content width by default; without this a
	   long name overflows the row instead of ellipsizing. */
	flex: 0 1 auto;
	min-width: 0;
	font-size: 1.3cqw;
	color: #7ff0f4;
	text-shadow: 0 0.2cqh 0 rgba(0, 0, 0, 0.75);
	max-width: 12cqw;
	overflow: hidden;
	text-overflow: ellipsis;
}
.vdh-kill-means {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	gap: 0.5cqw;
}
.vdh-kill-icon {
	width: 2.3cqw;
	height: 2.3cqw;
	color: #ffd166;
	filter: drop-shadow(0 0.2cqh 0 rgba(0, 0, 0, 0.65));
}
.vdh-kill-label {
	font-size: 1.1cqw;
	letter-spacing: 0.12em;
	color: rgba(243, 212, 136, 0.95);
	text-shadow: 0 0.2cqh 0 rgba(0, 0, 0, 0.75);
}
.vdh-kill-victim {
	flex: 0 1 auto;
	min-width: 0;
	font-size: 1.3cqw;
	color: #ffa3a3;
	text-shadow: 0 0.2cqh 0 rgba(0, 0, 0, 0.75);
	max-width: 12cqw;
	overflow: hidden;
	text-overflow: ellipsis;
}

/* ---- the controls hint ----
   Bottom-left corner, under the self panel: the two things a new player asks
   for, without ever covering the fight. */
.vdh-hint {
	position: absolute;
	left: 1.6cqw;
	bottom: 3cqh;
	font-size: 1.3cqw;
	color: rgba(217, 244, 246, 0.45);
	letter-spacing: 0.12em;
	white-space: nowrap;
	text-shadow: 0 0.2cqh 0 rgba(0, 0, 0, 0.6);
}
`;

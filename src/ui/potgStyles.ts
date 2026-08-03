/**
 * The Play of the Game overlay's stylesheet, as a string.
 *
 * Injected by the component, exactly like the ultimate cinematic's and the
 * deck's: the ceremony appears for twenty seconds at the end of a match and a
 * global stylesheet carrying two hundred lines for it would be paid for on
 * every page load of a game that is mostly canvas.
 *
 * **Almost nothing here has a duration.** The ultimate's cutscene could time its
 * animations in CSS because the freeze is a fixed 1100ms; this cannot, because
 * the length of a replay is the length of a play and the pre-roll's movements
 * are paced by `PotgDirector` against footage that runs at a variable speed. So
 * the director drives four custom properties — `--potg-bars`, `--potg-title`,
 * `--potg-card` and `--potg-progress` — and CSS only ever *maps* them onto
 * opacity, translation and width. One timeline, in one place, and no way for the
 * overlay to fall out of step with the camera it is narrating.
 *
 * Every class is prefixed `vp-` (vento play) so it cannot collide with the
 * deathmatch overlay's `vd-`, the fight HUD's `vf-` or the cinematic's `vu-`.
 *
 * The bar height is the one number this file does **not** own: the replay's
 * camera pans exactly that far past the top and bottom of the world so the bars
 * cover void rather than the floor, so it comes from the director.
 */

import { POTG_BAR_FRACTION } from "../game/potg/Director";

/** The bars' share of the frame, as a percentage string for `calc()`. */
const BARS = `${POTG_BAR_FRACTION * 100}%`;

export const POTG_CSS = `
.vp-root {
	position: absolute;
	inset: 0;
	z-index: 45;
	overflow: hidden;
	pointer-events: none;
	/* Sized in container units against the canvas rectangle, exactly like the
	   fight HUD: the game is authored at 800x600 and scaled to fit, so a title
	   measured in viewport units would be a different size relative to the arena
	   on every window. See the \`hud-design\` skill. */
	container-type: size;
	font-family: "Segoe UI", system-ui, sans-serif;
	color: #f6efe0;
	/* Defaults are the *card-only* state: fully framed, title and card up. A
	   ceremony whose footage never downloaded still has to look composed. */
	--potg-bars: 1;
	--potg-title: 1;
	--potg-card: 1;
	--potg-progress: 0;
	--potg-gold: #ffd166;
	--potg-accent: #ffd166;
}

/* ---- the frame ----
   Bars rather than a dim: the arena underneath is the point, and a veil over a
   replay would be hiding the only thing anybody is here to see. */
.vp-bar {
	position: absolute;
	left: 0;
	right: 0;
	height: calc(var(--potg-bars) * ${BARS});
	background: #05050a;
	box-shadow: 0 0 24px rgba(0, 0, 0, 0.9);
	will-change: height;
}
.vp-bar.top { top: 0; border-bottom: 1px solid rgba(255, 209, 102, 0.35); }
.vp-bar.bottom { bottom: 0; border-top: 1px solid rgba(255, 209, 102, 0.35); }

/* A vignette that tightens as the bars close, so the corners of a 4:3 arena
   stop competing with the middle of the frame. */
.vp-vignette {
	position: absolute;
	inset: 0;
	background: radial-gradient(
		ellipse at 50% 48%,
		rgba(0, 0, 0, 0) 42%,
		rgba(0, 0, 0, 0.55) 100%
	);
	opacity: calc(var(--potg-bars) * 0.9);
}

/* ---- the title ----
   Held over the establishing shot and gone by the time the push lands. */
.vp-title {
	position: absolute;
	inset: 0;
	display: grid;
	place-content: center;
	justify-items: center;
	opacity: var(--potg-title);
	will-change: opacity;
}

.vp-burst {
	position: absolute;
	width: min(120vh, 92vw);
	height: min(120vh, 92vw);
	background: url("assets/potg-burst.png") center / contain no-repeat;
	opacity: calc(var(--potg-title) * 0.45);
	animation: vp-spin 26s linear infinite;
	mix-blend-mode: screen;
}

.vp-emblem {
	width: 92px;
	height: 92px;
	background: url("assets/potg-emblem.png") center / contain no-repeat;
	filter: drop-shadow(0 4px 18px rgba(0, 0, 0, 0.75));
	animation: vp-emblem-in 700ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.vp-title-line {
	position: relative;
	margin-top: 14px;
	font-size: clamp(24px, 5.2cqw, 54px);
	font-weight: 800;
	letter-spacing: 0.34em;
	/* The trailing letter-space pushes the word off-centre otherwise — the
	   classic tracked-heading bug, and very visible on a centred title. */
	text-indent: 0.34em;
	color: var(--potg-gold);
	text-shadow:
		0 2px 0 rgba(0, 0, 0, 0.7),
		0 0 26px rgba(255, 209, 102, 0.5);
	animation: vp-title-in 900ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.vp-title-rule {
	position: relative;
	margin-top: 10px;
	width: min(420px, 60vw);
	height: 2px;
	background: linear-gradient(
		90deg,
		transparent,
		var(--potg-gold) 20%,
		var(--potg-gold) 80%,
		transparent
	);
	opacity: 0.8;
}

/* ---- the name card ----
   Slides in under the push and returns for the outro. Bottom-left rather than
   centred: the middle of the frame is the fighter it is naming. */
.vp-card {
	position: absolute;
	left: 4%;
	bottom: calc(var(--potg-bars) * ${BARS} + 26px);
	max-width: 68%;
	opacity: var(--potg-card);
	transform: translateY(calc((1 - var(--potg-card)) * 22px));
	will-change: opacity, transform;
	text-shadow: 0 2px 10px rgba(0, 0, 0, 0.9);
}

.vp-headline {
	font-size: clamp(20px, 4cqw, 40px);
	font-weight: 800;
	letter-spacing: 0.14em;
	color: var(--potg-accent);
	line-height: 1.05;
}

.vp-name {
	margin-top: 6px;
	font-size: clamp(15px, 2.6cqw, 26px);
	font-weight: 700;
	letter-spacing: 0.06em;
	color: #ffffff;
}

.vp-name .vp-you {
	margin-left: 10px;
	padding: 2px 8px;
	font-size: 0.62em;
	letter-spacing: 0.16em;
	border: 1px solid var(--potg-accent);
	border-radius: 3px;
	color: var(--potg-accent);
	vertical-align: middle;
}

.vp-sub {
	margin-top: 4px;
	font-size: clamp(11px, 1.7cqw, 15px);
	letter-spacing: 0.05em;
	color: rgba(246, 239, 224, 0.78);
}

/* ---- the corner tag ----
   The only thing on screen through the roll itself. A replay that said nothing
   at all is a replay a player cannot tell from a live match they have lost
   control of. */
.vp-tag {
	position: absolute;
	left: 4%;
	top: calc(var(--potg-bars) * ${BARS} + 18px);
	display: flex;
	align-items: center;
	gap: 9px;
	font-size: clamp(10px, 1.5cqw, 13px);
	letter-spacing: 0.22em;
	text-transform: uppercase;
	color: rgba(255, 209, 102, 0.85);
	opacity: calc(1 - var(--potg-title));
	text-shadow: 0 2px 8px rgba(0, 0, 0, 0.9);
}
.vp-tag::before {
	content: "";
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: #ff5a5a;
	box-shadow: 0 0 10px #ff5a5a;
	animation: vp-rec 1.4s steps(1, end) infinite;
}

/* ---- footer ----
   The progress of the footage, and the way out. Both live on the bottom bar,
   which is otherwise dead space. */
.vp-progress {
	position: absolute;
	left: 0;
	bottom: 0;
	height: 3px;
	width: calc(var(--potg-progress) * 100%);
	background: linear-gradient(90deg, rgba(255, 209, 102, 0.35), var(--potg-gold));
	box-shadow: 0 0 10px rgba(255, 209, 102, 0.6);
}

.vp-skip {
	position: absolute;
	right: 4%;
	bottom: calc(var(--potg-bars) * ${BARS} + 22px);
	pointer-events: auto;
	appearance: none;
	background: rgba(8, 8, 12, 0.72);
	border: 1px solid rgba(255, 209, 102, 0.45);
	border-radius: 4px;
	padding: 7px 14px;
	font: inherit;
	font-size: clamp(10px, 1.5cqw, 13px);
	letter-spacing: 0.18em;
	text-transform: uppercase;
	color: rgba(255, 209, 102, 0.9);
	cursor: pointer;
}
.vp-skip:hover { background: rgba(255, 209, 102, 0.16); }

@keyframes vp-spin { to { transform: rotate(360deg); } }
@keyframes vp-rec { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0.15; } }
@keyframes vp-emblem-in {
	from { opacity: 0; transform: scale(0.4) rotate(-30deg); }
}
@keyframes vp-title-in {
	from { opacity: 0; letter-spacing: 0.72em; }
}

@media (prefers-reduced-motion: reduce) {
	.vp-burst { animation: none; }
	.vp-emblem, .vp-title-line { animation: none; }
}
`;

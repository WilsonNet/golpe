/**
 * The Play of the Game overlay's stylesheet, as a string.
 *
 * Injected by the component, exactly like the ultimate cinematic's and the
 * deck's: the ceremony appears for twenty-odd seconds at the end of a match and
 * a global stylesheet carrying three hundred lines for it would be paid for on
 * every page load of a game that is mostly canvas.
 *
 * There are **two timing regimes here, and the split is deliberate.**
 *
 * - The *ceremony* — bars, curtain, name card, progress — is paced by
 *   `PotgDirector` against footage running at a variable speed, so it cannot be
 *   timed in CSS. The director drives custom properties and CSS only ever maps
 *   them onto height, opacity and width. One timeline, in one place.
 * - The *title card's own entrance* is the exception, and it is the same
 *   exception the ultimate's cutscene is: the intro has a **fixed** length
 *   (`POTG_INTRO_MS`), so keyframes are safe and are the right tool — four words
 *   arriving one at a time with blur and overshoot is not something worth
 *   driving from JavaScript sixty times a second. The card's whole animation
 *   budget is asserted against the intro's length in `Director.test.ts`, so the
 *   two cannot silently drift apart.
 *
 * Every class is prefixed `vp-` (vento play) so it cannot collide with the
 * deathmatch overlay's `vd-`, the fight HUD's `vf-` or the cinematic's `vu-`.
 */

import { POTG_BAR_FRACTION, POTG_INTRO_MS } from "../game/potg/Director";

/** The bars' share of the frame, as a percentage string for `calc()`. */
const BARS = `${POTG_BAR_FRACTION * 100}%`;

// ---------------------------------------------------------------------------
// The title card's entrance, in milliseconds from the start of the intro
// ---------------------------------------------------------------------------

/** The black holds for a beat before anything happens. Anticipation is cheap. */
const FLASH_AT = 140;
const FLASH_MS = 260;
/** The medal punches in on the flash. */
const EMBLEM_AT = 150;
const EMBLEM_MS = 520;
/** The first word lands just after the flash, and the rest follow. */
const WORD_AT = 260;
const WORD_STAGGER = 130;
const WORD_MS = 420;
/** A bar of light crosses the finished wordmark. */
const SWEEP_AT = WORD_AT + WORD_STAGGER * 3 + WORD_MS;
const SWEEP_MS = 900;
/** The byline arrives last: who it was, and what they did. */
const BYLINE_AT = SWEEP_AT - 220;
const BYLINE_MS = 520;

/**
 * When the card has finished moving.
 *
 * Exported so `Director.test.ts` can assert it fits inside the intro with the
 * wipe still to come — a card still arriving as the curtain opened would be
 * caught mid-flight by the reveal, which is the one way this can look broken
 * without anything throwing.
 */
export const POTG_CARD_MS = Math.max(
	SWEEP_AT + SWEEP_MS,
	BYLINE_AT + BYLINE_MS,
);

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
	/* Defaults are the *card-only* state: curtain down, card up. A ceremony whose
	   footage never downloaded still has to look composed. */
	--potg-bars: 1;
	--potg-curtain: 1;
	--potg-title: 1;
	--potg-card: 0;
	--potg-progress: 0;
	--potg-gold: #ffd166;
	--potg-accent: #ffd166;
	--potg-intro-ms: ${POTG_INTRO_MS}ms;
}

/* ---- the frame, which is also the curtain ----

   One pair of elements does both jobs, and that is the whole trick. At
   \`--potg-curtain: 1\` the two halves meet in the middle and the arena is
   completely hidden — which is what makes the title card an *event* rather than
   a caption over footage that is already playing. At 0 they are exactly the
   letterbox bars. The reveal is therefore not a fade: it is a curtain opening
   into the frame it was always going to be. */
.vp-bar {
	position: absolute;
	left: 0;
	right: 0;
	height: calc(
		var(--potg-bars) * ${BARS} +
		var(--potg-curtain) * (50% - var(--potg-bars) * ${BARS})
	);
	background: linear-gradient(var(--dir, to top), #05050a 60%, #0d0c14 100%);
	will-change: height;
}
/* The gold inner edge is the *letterbox's* line, not the curtain's: while the
   halves are closed they meet in the middle, and two lit edges there drew a rule
   straight through the wordmark. It fades in as they open. */
.vp-bar.top {
	top: 0;
	--dir: to bottom;
	border-bottom: 1px solid
		rgba(255, 209, 102, calc(0.45 * (1 - var(--potg-curtain))));
	box-shadow:
		0 6px 26px rgba(0, 0, 0, 0.9),
		0 1px 12px rgba(255, 209, 102, calc(0.2 * (1 - var(--potg-curtain))));
}
.vp-bar.bottom {
	bottom: 0;
	border-top: 1px solid
		rgba(255, 209, 102, calc(0.45 * (1 - var(--potg-curtain))));
	box-shadow:
		0 -6px 26px rgba(0, 0, 0, 0.9),
		0 -1px 12px rgba(255, 209, 102, calc(0.2 * (1 - var(--potg-curtain))));
}

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

/* ---- the title card ----
   Above the curtain, so it reads on black while the halves are closed. It fades
   out slightly ahead of them, so what the curtain reveals is the arena and not a
   headline sitting on top of it. */
.vp-splash {
	position: absolute;
	inset: 0;
	display: grid;
	place-content: center;
	justify-items: center;
	opacity: var(--potg-title);
	will-change: opacity;
	/* The whole card takes one hit on the slam. Small — this is a punctuation
	   mark, not an earthquake — but it is the difference between the words
	   appearing and the words *arriving*. */
	animation: vp-slam 420ms cubic-bezier(0.22, 1.4, 0.4, 1) ${FLASH_AT}ms both;
}

/* Diagonal speed lines drifting behind everything. A repeating gradient is
   exactly right for straight parallel lines — unlike the sunburst, which was a
   conic gradient once and read as a warning label rather than as light. */
.vp-streaks {
	position: absolute;
	inset: -30%;
	background: repeating-linear-gradient(
		114deg,
		rgba(255, 209, 102, 0) 0px,
		rgba(255, 209, 102, 0) 26px,
		rgba(255, 209, 102, 0.07) 27px,
		rgba(255, 209, 102, 0.07) 30px
	);
	animation: vp-drift 3.2s linear infinite;
	mask-image: radial-gradient(ellipse at 50% 50%, #000 20%, transparent 72%);
	-webkit-mask-image: radial-gradient(ellipse at 50% 50%, #000 20%, transparent 72%);
}

.vp-burst {
	position: absolute;
	/* \`inset: 0; margin: auto\` rather than a top/left transform: the flare is
	   spinning, and a centring transform would be overwritten by its own
	   animation. Auto margins centre a fixed-size absolute box without touching
	   \`transform\` at all — which matters here because \`.vp-splash\` is a grid, and
	   an absolutely positioned child of a grid is otherwise placed at its *cell*
	   rather than at the middle of the card. */
	inset: 0;
	margin: auto;
	width: min(150cqh, 130cqw);
	height: min(150cqh, 130cqw);
	background: url("assets/potg-burst.png") center / contain no-repeat;
	opacity: 0.42;
	animation:
		vp-spin 26s linear infinite,
		vp-burst-in 900ms cubic-bezier(0.16, 1, 0.3, 1) ${FLASH_AT}ms both;
	mix-blend-mode: screen;
}

/* The slam's white flash. One frame of overexposure is what sells an impact
   that has no sound behind it — this game has no audio. */
.vp-flash {
	position: absolute;
	inset: -50%;
	margin: auto;
	background: radial-gradient(
		ellipse at 50% 50%,
		rgba(255, 246, 214, 0.95),
		rgba(255, 209, 102, 0) 62%
	);
	opacity: 0;
	animation: vp-flash ${FLASH_MS}ms ease-out ${FLASH_AT}ms both;
}

.vp-emblem {
	position: relative;
	width: clamp(52px, 12cqh, 104px);
	height: clamp(52px, 12cqh, 104px);
	margin-bottom: 2cqh;
	background: url("assets/potg-emblem.png") center / contain no-repeat;
	filter: drop-shadow(0 4px 18px rgba(0, 0, 0, 0.8));
	animation: vp-emblem-in ${EMBLEM_MS}ms cubic-bezier(0.16, 1, 0.3, 1) ${EMBLEM_AT}ms both;
}

/* ---- the wordmark ----
   Four images, not text. See scripts/make-potg-art.py: the card's whole
   character is a condensed uppercase grotesque, and there is no such face
   present on every platform — a CSS stack would have looked right here and like
   Arial Bold on the next machine. One file per word is also what lets each one
   arrive on its own. */
.vp-words {
	position: relative;
	display: flex;
	align-items: baseline;
	justify-content: center;
	gap: 1.4cqw;
	filter: drop-shadow(0 6px 20px rgba(0, 0, 0, 0.85));
}

.vp-word {
	display: block;
	height: clamp(34px, 12cqh, 116px);
	width: auto;
	/* Each word arrives from the left with motion blur, overshoots and settles.
	   \`both\` matters: without it a word sits at full opacity through its own
	   delay, so all four would be on screen before the first one moved. */
	animation: vp-word-in ${WORD_MS}ms cubic-bezier(0.17, 1.5, 0.4, 1) both;
}
.vp-word.w1 { animation-delay: ${WORD_AT}ms; }
.vp-word.w2 { animation-delay: ${WORD_AT + WORD_STAGGER}ms; }
.vp-word.w3 { animation-delay: ${WORD_AT + WORD_STAGGER * 2}ms; }
.vp-word.w4 { animation-delay: ${WORD_AT + WORD_STAGGER * 3}ms; }
/* "OF" and "THE" are connective tissue; setting them smaller is what stops the
   line reading as four equal shouts. */
.vp-word.small { height: clamp(22px, 7.9cqh, 78px); }

/* A bar of light crossing the finished card.
   At card level rather than inside \`.vp-words\`: an absolutely positioned child
   of a flex row takes its *static* position, so nested here it sized itself to
   the gap between two words and rendered as a grey block over "OF". */
.vp-sweep {
	position: absolute;
	inset: 0;
	background: linear-gradient(
		104deg,
		rgba(255, 255, 255, 0) 42%,
		rgba(255, 255, 255, 0.55) 50%,
		rgba(255, 255, 255, 0) 58%
	);
	mix-blend-mode: screen;
	pointer-events: none;
	animation: vp-sweep ${SWEEP_MS}ms ease-in-out ${SWEEP_AT}ms both;
}

.vp-byline {
	position: relative;
	margin-top: 2.4cqh;
	display: flex;
	align-items: center;
	gap: 1.4cqw;
	font-size: clamp(10px, 2.4cqh, 22px);
	font-weight: 700;
	letter-spacing: 0.26em;
	text-indent: 0.26em;
	text-transform: uppercase;
	white-space: nowrap;
	animation: vp-byline-in ${BYLINE_MS}ms cubic-bezier(0.16, 1, 0.3, 1) ${BYLINE_AT}ms both;
}
.vp-byline .name { color: #ffffff; }
.vp-byline .dot {
	width: 5px;
	height: 5px;
	border-radius: 50%;
	background: var(--potg-accent);
	box-shadow: 0 0 10px var(--potg-accent);
}
.vp-byline .deed { color: var(--potg-accent); }

/* A hairline under the byline, drawn out from the centre. */
.vp-rule {
	position: relative;
	margin-top: 1.6cqh;
	width: min(46cqw, 520px);
	height: 2px;
	background: linear-gradient(
		90deg,
		transparent,
		var(--potg-gold) 18%,
		var(--potg-gold) 82%,
		transparent
	);
	opacity: 0.85;
	animation: vp-rule-in ${BYLINE_MS}ms cubic-bezier(0.16, 1, 0.3, 1) ${BYLINE_AT}ms both;
}

/* ---- the name card ----
   The in-replay lower third. Slides in under the push and returns for the
   outro, bottom-left rather than centred: the middle of the frame is the
   fighter it is naming. */
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
	opacity: calc(1 - var(--potg-curtain));
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
   The progress of the footage, and the way out. */
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
@keyframes vp-drift { to { transform: translateX(-58px); } }
@keyframes vp-rec { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0.15; } }

@keyframes vp-flash {
	0% { opacity: 0; transform: scale(0.7); }
	18% { opacity: 1; transform: scale(1); }
	100% { opacity: 0; transform: scale(1.25); }
}
@keyframes vp-burst-in {
	from { opacity: 0; transform: scale(0.55) rotate(-24deg); }
	to { opacity: 0.42; }
}
@keyframes vp-slam {
	0% { transform: scale(1.16); }
	55% { transform: scale(0.985); }
	100% { transform: scale(1); }
}
@keyframes vp-emblem-in {
	from { opacity: 0; transform: scale(0.35) rotate(-40deg); }
}
@keyframes vp-word-in {
	0% {
		opacity: 0;
		transform: translateX(-14%) scaleX(1.9);
		filter: blur(14px);
	}
	60% { opacity: 1; }
	78% { transform: translateX(0) scaleX(0.97); filter: blur(0); }
	100% { transform: none; filter: blur(0); }
}
@keyframes vp-sweep {
	from { transform: translateX(-115%); }
	to { transform: translateX(115%); }
}
@keyframes vp-byline-in {
	from { opacity: 0; transform: translateY(14px); letter-spacing: 0.6em; }
}
@keyframes vp-rule-in {
	from { opacity: 0; transform: scaleX(0.1); }
}

@media (prefers-reduced-motion: reduce) {
	.vp-burst, .vp-streaks, .vp-sweep { animation: none; }
	.vp-splash, .vp-emblem, .vp-word, .vp-byline, .vp-rule, .vp-flash {
		animation-duration: 1ms;
	}
}
`;

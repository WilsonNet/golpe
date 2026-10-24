/**
 * The two-thumb deck's appearance.
 *
 * Injected as a `<style>` element by `TouchControls`, the way `hudStyles.ts`
 * and the training panel do — the game ships one global stylesheet for the page
 * shell and nothing else, and a deck that only exists on a phone should carry
 * its own paint rather than growing that file.
 *
 * Every class is prefixed `gg-` (golpe gamepad), so it cannot collide with the
 * deathmatch overlay's `gd-` or the training panel's `gt-`.
 *
 * **The deck is an overlay, not a handheld shell.** The old layout put the game
 * on top and a plastic slab underneath in portrait, which pushed every control
 * 200-330px above where a thumb rests and left the bottom of the phone empty.
 * Here the canvas keeps the whole page (fitted 4:3) and the hands float over
 * the bottom corners, transparent enough to see the arena through them. In
 * landscape they sit in the letterbox margins and lap the arena's bottom
 * corners; the middle is always the game.
 *
 * **Size follows reach, not symmetry.** The weapon button is the biggest
 * because it is pressed most; Guard sits under the left thumb's other reach so
 * the right hand never leaves the weapon; the rare controls are smaller but
 * never below 44px.
 */

export const DECK_CSS = `
/* ---- page shell ----
   The deck is fixed over the page, so it must not resize the arena. The only
   layout job it owns is putting the canvas at the top in portrait — a phone in
   one hand wants the fight above the thumbs, not vertically centred with a
   dead band on both sides. */
#app:has(.gg-deck) {
	background:
		radial-gradient(120% 70% at 50% 100%, #1b1726 0%, #0a0910 72%);
}
@media (orientation: portrait) {
	#app:has(.gg-deck) {
		align-items: flex-start;
		padding-top: env(safe-area-inset-top, 0px);
		box-sizing: border-box;
	}
	#app:has(.gg-deck) #game-container {
		align-self: flex-start;
	}
}

.gg-deck {
	/* One source of truth for the notch and the home indicator. A probe can
	   override these with ?safe=top,right,bottom,left; normal play never does. */
	--safe-t: env(safe-area-inset-top, 0px);
	--safe-r: env(safe-area-inset-right, 0px);
	--safe-b: env(safe-area-inset-bottom, 0px);
	--safe-l: env(safe-area-inset-left, 0px);
	--gg-edge: 14px;
	--gg-gap: 8px;
	--gg-gold: #e8b64c;
	--gg-cyan: #0ec3c9;
	--gg-violet: #a06bff;
	--gg-steel: #8fa7c4;
	--gg-ink: #0d0b14;
	position: fixed;
	inset: 0;
	z-index: 20;
	pointer-events: none;
	font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
	color: rgba(255, 255, 255, 0.92);
	touch-action: none;
	user-select: none;
	-webkit-user-select: none;
	-webkit-touch-callout: none;
	-webkit-tap-highlight-color: transparent;
}

/* Every painted surface is a control; the empty space between the hands is
   still the game and must stay touchable by the canvas. */
.gg-deck .gg-control,
.gg-deck .gg-move,
.gg-deck .gg-menu {
	pointer-events: auto;
}

.gg-control,
.gg-move,
.gg-menu,
.gg-coach,
.gg-coach-ok {
	font: inherit;
	-webkit-tap-highlight-color: transparent;
	touch-action: none;
	box-sizing: border-box;
}

.gg-control {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	border: 1px solid rgba(255, 255, 255, 0.18);
	border-radius: 18px;
	background:
		linear-gradient(180deg, rgba(58, 51, 72, 0.86), rgba(24, 20, 34, 0.9));
	box-shadow:
		0 3px 0 rgba(0, 0, 0, 0.45),
		inset 0 1px 0 rgba(255, 255, 255, 0.14);
	color: rgba(255, 255, 255, 0.94);
	font-size: clamp(10px, 2.3vw, 12px);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	font-weight: 700;
	cursor: pointer;
	opacity: 0.8;
	transition: opacity 0.09s, transform 0.05s, box-shadow 0.05s, filter 0.05s;
	text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
}
@media (pointer: coarse) {
	.gg-control { opacity: 0.88; }
}
.gg-control.held,
.gg-control.armed {
	opacity: 1;
	transform: translateY(2px);
	box-shadow:
		0 1px 0 rgba(0, 0, 0, 0.45),
		inset 0 1px 0 rgba(255, 255, 255, 0.2);
	filter: brightness(1.16);
}
.gg-control.on {
	border-color: rgba(14, 195, 201, 0.9);
	box-shadow:
		0 3px 0 rgba(0, 0, 0, 0.45),
		0 0 14px rgba(14, 195, 201, 0.45),
		inset 0 0 10px rgba(14, 195, 201, 0.2);
}
.gg-control.disabled {
	opacity: 0.45;
	filter: saturate(0.4);
}
.gg-control:focus-visible,
.gg-menu:focus-visible,
.gg-coach-ok:focus-visible {
	outline: 2px solid var(--gg-cyan);
	outline-offset: 3px;
}
.gg-label {
	position: relative;
	z-index: 2;
	pointer-events: none;
}

/* The charge / readiness ring. A conic gradient inside a masked padding box,
   so it reads as a ring rather than a pie filling the button and hiding the
   label. The filled arc is near-white on a dark track: gold-on-gold was 2:1. */
.gg-ring {
	position: absolute;
	inset: -4px;
	border-radius: inherit;
	padding: 4px;
	background: conic-gradient(
		#fff2c0 calc(var(--v, 0) * 1turn),
		rgba(0, 0, 0, 0.38) 0
	);
	-webkit-mask:
		linear-gradient(#000 0 0) content-box,
		linear-gradient(#000 0 0);
	-webkit-mask-composite: xor;
	mask:
		linear-gradient(#000 0 0) content-box,
		linear-gradient(#000 0 0);
	mask-composite: exclude;
	pointer-events: none;
	z-index: 1;
}

/* ---- the two hands ----
   Anchored to the bottom corners inside the safe box. Nothing is centred,
   because a thumb is not centred: it rests in a corner and reaches inward. */
.gg-hand {
	position: absolute;
	bottom: calc(var(--safe-b) + var(--gg-edge));
	display: flex;
	flex-direction: column;
	gap: var(--gg-gap);
	pointer-events: none;
	transition: opacity 0.12s ease;
}
/* A fighter at the edge stands under a hand in a one-screen room, where the
   camera cannot scroll it out. Fade the hand, not the fight: the buttons stay
   hit-testable and come back when the feet move. Portrait puts the hands below
   the arena, so there is nothing to fade there. */
@media (orientation: landscape) {
	.gg-deck.fighter-left .gg-hand-left,
	.gg-deck.fighter-right .gg-hand-right {
		opacity: 0.42;
	}
}
.gg-left {
	left: calc(var(--safe-l) + var(--gg-edge));
	align-items: flex-start;
	--pad-w: clamp(120px, min(32dvh, 32vw), 152px);
	width: var(--pad-w);
}
.gg-right {
	right: calc(var(--safe-r) + var(--gg-edge));
	align-items: flex-end;
}

/* ---- the left hand: guard, dash, then the move/jump rocker ---- */
.gg-left-utility {
	display: grid;
	grid-template-columns: 1.18fr 1fr;
	gap: var(--gg-gap);
	width: 100%;
}
.gg-guard,
.gg-dash {
	width: 100%;
	aspect-ratio: 1;
	border-radius: 16px;
}
.gg-guard {
	border-color: rgba(143, 167, 196, 0.55);
	background:
		linear-gradient(180deg, rgba(60, 76, 96, 0.9), rgba(26, 32, 44, 0.94));
	color: #dce9f8;
}
.gg-guard.tap {
	border-color: rgba(232, 182, 76, 0.55);
	background:
		linear-gradient(180deg, rgba(92, 72, 38, 0.9), rgba(36, 27, 18, 0.94));
	color: #ffe6ad;
}
.gg-dash {
	border-color: rgba(14, 195, 201, 0.5);
	background:
		linear-gradient(180deg, rgba(24, 82, 88, 0.9), rgba(12, 30, 36, 0.94));
	color: #bffcff;
}

.gg-move {
	position: relative;
	width: 100%;
	height: clamp(150px, min(44dvh, 44vw), 204px);
	border-radius: 26px;
	border: 1px solid rgba(255, 255, 255, 0.13);
	background:
		radial-gradient(100% 75% at 50% 100%, rgba(52, 45, 68, 0.78), rgba(14, 12, 22, 0.82));
	box-shadow:
		inset 0 4px 14px rgba(0, 0, 0, 0.55),
		0 2px 0 rgba(0, 0, 0, 0.4);
	overflow: hidden;
	opacity: 0.88;
	transition: opacity 0.09s, border-color 0.09s;
}
.gg-move.live {
	opacity: 1;
	border-color: rgba(232, 182, 76, 0.55);
}
.gg-move-jump {
	position: absolute;
	left: 0;
	right: 0;
	top: 0;
	height: 44px;
	display: flex;
	align-items: center;
	justify-content: center;
	border-bottom: 1px dashed rgba(255, 255, 255, 0.13);
	background:
		linear-gradient(180deg, rgba(34, 70, 58, 0.75), rgba(19, 34, 30, 0.35));
	color: rgba(210, 255, 228, 0.82);
	font-size: clamp(10px, 2.1vw, 11px);
	letter-spacing: 0.28em;
	text-transform: uppercase;
	pointer-events: none;
}
.gg-move.jumping .gg-move-jump {
	background:
		linear-gradient(180deg, rgba(63, 190, 130, 0.9), rgba(20, 78, 54, 0.65));
	color: #eafff1;
	box-shadow: 0 0 18px rgba(70, 230, 150, 0.5) inset;
}
/* The horizontal rails: where the thumb goes, not a d-pad's arms. */
.gg-move-stem {
	position: absolute;
	left: 10px;
	right: 10px;
	top: 58%;
	height: 3px;
	border-radius: 2px;
	background:
		linear-gradient(90deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.04) 40%, rgba(255, 255, 255, 0.04) 60%, rgba(255, 255, 255, 0.16));
	pointer-events: none;
}
.gg-move-arrow {
	position: absolute;
	top: 50%;
	transform: translateY(-58%);
	font-size: clamp(24px, 6vw, 38px);
	line-height: 1;
	color: rgba(255, 255, 255, 0.18);
	font-weight: 400;
}
.gg-move-left { left: 8px; }
.gg-move-right { right: 8px; }
.gg-move.left .gg-move-left,
.gg-move.right .gg-move-right {
	color: rgba(255, 233, 168, 0.95);
	text-shadow: 0 0 12px rgba(232, 182, 76, 0.7);
}
.gg-move-nub {
	position: absolute;
	left: 50%;
	top: 58%;
	width: clamp(46px, 13vw, 62px);
	height: clamp(46px, 13vw, 62px);
	margin:
		calc(clamp(46px, 13vw, 62px) / -2)
		0 0
		calc(clamp(46px, 13vw, 62px) / -2);
	border-radius: 50%;
	background: radial-gradient(circle at 36% 30%, #655d7a, #2a2438);
	border: 1px solid rgba(0, 0, 0, 0.55);
	box-shadow:
		0 3px 8px rgba(0, 0, 0, 0.5),
		inset 0 1px 0 rgba(255, 255, 255, 0.14);
	pointer-events: none;
	transition: transform 0.04s;
}
.gg-move.live .gg-move-nub {
	background: radial-gradient(circle at 36% 30%, #ffe9a8, #a97c1c);
	border-color: rgba(232, 182, 76, 0.85);
}
.gg-move-caption {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 7px;
	text-align: center;
	font-size: 10px;
	letter-spacing: 0.24em;
	text-transform: uppercase;
	color: rgba(255, 255, 255, 0.58);
	pointer-events: none;
}

/* ---- the right hand: weapon cluster ----
   A 2-column grid. The weapon button is the bottom-right home; the three kit
   controls sit in a column to its left, and the stance sits above both. The
   thumb rolls left/up without lifting, and no path crosses the centre of the
   screen. */
.gg-combat {
	--side: clamp(56px, min(16dvh, 17vw), 72px);
	--row: clamp(52px, min(14.5dvh, 15vw), 64px);
	--stance-h: 52px;
	--attack: clamp(96px, min(28dvh, 30vw), 128px);
	display: grid;
	grid-template-columns: var(--side) var(--attack);
	grid-template-rows: var(--stance-h) var(--row) var(--row) var(--row);
	grid-template-areas:
		"stance stance"
		"ult    attack"
		"item   attack"
		"upper  attack";
	gap: var(--gg-gap);
	align-items: stretch;
}

.gg-stance {
	grid-area: stance;
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 4px;
	padding: 2px;
	border-radius: 14px;
	border: 1px solid rgba(255, 255, 255, 0.14);
	background: rgba(16, 13, 24, 0.82);
}
.gg-stance-seg {
	border-radius: 10px;
	border: 1px solid transparent;
	background: transparent;
	box-shadow: none;
	opacity: 0.58;
	font-size: clamp(10px, 2.1vw, 11px);
	letter-spacing: 0.1em;
}
.gg-stance-seg.on {
	opacity: 1;
	background:
		linear-gradient(180deg, rgba(232, 182, 76, 0.24), rgba(122, 88, 24, 0.28));
	border-color: rgba(232, 182, 76, 0.65);
	color: #ffe9a8;
	box-shadow: inset 0 0 10px rgba(232, 182, 76, 0.15);
}
.gg-stance-seg.held {
	opacity: 1;
	transform: none;
	box-shadow: none;
	filter: brightness(1.3);
}

.gg-ult {
	grid-area: ult;
	border-radius: 16px;
	border-color: rgba(160, 107, 255, 0.55);
	background:
		linear-gradient(180deg, rgba(74, 40, 122, 0.9), rgba(28, 16, 52, 0.94));
	color: #e9d9ff;
	font-size: clamp(9px, 2.2vw, 11px);
}
.gg-ult:not(.ready) {
	opacity: 0.7;
}
.gg-ult.ready {
	opacity: 1;
	border-color: rgba(214, 168, 255, 0.95);
	box-shadow:
		0 3px 0 rgba(0, 0, 0, 0.45),
		0 0 18px rgba(150, 90, 255, 0.55);
	animation: gg-ult-ready 1.5s ease-in-out infinite;
}
.gg-ult.armed {
	animation: none;
	box-shadow:
		0 0 24px rgba(190, 130, 255, 0.85),
		inset 0 0 18px rgba(160, 107, 255, 0.4);
}
.gg-ult-pct {
	position: absolute;
	right: 5px;
	bottom: 3px;
	font-size: 10px;
	letter-spacing: 0.02em;
	color: rgba(255, 255, 255, 0.82);
	pointer-events: none;
}
@keyframes gg-ult-ready {
	0%, 100% { filter: brightness(1); }
	50% { filter: brightness(1.28); }
}
@media (prefers-reduced-motion: reduce) {
	.gg-ult.ready { animation: none; }
}

.gg-item {
	grid-area: item;
	border-radius: 16px;
	border-color: rgba(109, 138, 79, 0.65);
	background:
		linear-gradient(180deg, rgba(70, 93, 48, 0.92), rgba(26, 36, 18, 0.94));
	color: #eaf2d8;
}
.gg-item-count {
	position: absolute;
	left: 6px;
	top: 3px;
	font-size: clamp(10px, 2.4vw, 13px);
	color: #f4ffd8;
	opacity: 0.9;
	pointer-events: none;
}

.gg-upper {
	grid-area: upper;
	border-radius: 16px;
	border-color: rgba(214, 110, 160, 0.55);
	background:
		linear-gradient(180deg, rgba(110, 45, 78, 0.92), rgba(40, 16, 30, 0.94));
	color: #ffe0ef;
}

.gg-attack {
	grid-area: attack;
	align-self: end;
	justify-self: end;
	width: var(--attack);
	height: var(--attack);
	border-radius: 50%;
	border: 2px solid rgba(255, 232, 168, 0.7);
	background:
		radial-gradient(circle at 36% 28%, rgba(255, 213, 106, 0.98), rgba(154, 106, 24, 0.96) 72%);
	color: #241905;
	font-size: clamp(13px, 3.4vw, 18px);
	letter-spacing: 0.06em;
	text-shadow: 0 1px 0 rgba(255, 255, 255, 0.25);
	box-shadow:
		0 5px 0 rgba(61, 39, 4, 0.75),
		0 0 0 5px rgba(20, 16, 28, 0.32);
}
.gg-attack.held {
	transform: translateY(3px);
	box-shadow:
		0 2px 0 rgba(61, 39, 4, 0.75),
		0 0 0 5px rgba(20, 16, 28, 0.32);
}
.gg-attack.ready {
	border-color: #fff1be;
	box-shadow:
		0 5px 0 rgba(61, 39, 4, 0.75),
		0 0 26px rgba(255, 208, 92, 0.7);
}
.gg-attack.gun {
	border-color: rgba(127, 240, 244, 0.85);
	background:
		radial-gradient(circle at 36% 28%, rgba(26, 132, 138, 0.98), rgba(8, 48, 56, 0.97) 74%);
	color: #d8feff;
	text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
	box-shadow:
		0 5px 0 rgba(3, 26, 30, 0.8),
		0 0 0 5px rgba(20, 16, 28, 0.32);
}
.gg-attack.gun .gg-ring {
	background: conic-gradient(
		#bffcff calc(var(--v, 0) * 1turn),
		rgba(0, 0, 0, 0.38) 0
	);
}
.gg-ammo {
	position: absolute;
	right: 12px;
	bottom: 11px;
	font-size: clamp(10px, 2.5vw, 13px);
	letter-spacing: 0;
	color: rgba(220, 255, 255, 0.95);
	pointer-events: none;
}
.gg-ammo-reserve {
	opacity: 0.78;
	font-size: 0.8em;
}
.gg-charge-hint {
	position: absolute;
	left: 50%;
	bottom: 7px;
	transform: translateX(-50%);
	padding: 1px 7px;
	border-radius: 999px;
	background: rgba(13, 11, 20, 0.84);
	white-space: nowrap;
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.1em;
	color: #ffffff;
	pointer-events: none;
}
.gg-charge-hint.gun {
	color: #ffffff;
	text-shadow: none;
}
.gg-aim-dot {
	position: absolute;
	left: 50%;
	top: 50%;
	width: 12px;
	height: 12px;
	margin: -6px 0 0 -6px;
	border-radius: 50%;
	background: #fff;
	box-shadow:
		0 0 0 3px rgba(14, 195, 201, 0.55),
		0 0 14px rgba(14, 195, 201, 0.9);
	pointer-events: none;
	transition: transform 0.03s;
}

/* ---- menu ----
   The only way off the deck on a phone, so it is deliberately outside the
   thumb's combat arc. Landscape: the right letterbox margin, past the enemy
   panel. Portrait: the band under the canvas, not over the fight. */
.gg-menu {
	position: absolute;
	top: calc(var(--safe-t) + 8px);
	right: calc(var(--safe-r) + 10px);
	min-width: 64px;
	min-height: 44px;
	padding: 0 12px;
	border-radius: 999px;
	border: 1px solid rgba(255, 255, 255, 0.26);
	background: rgba(12, 10, 18, 0.62);
	color: rgba(255, 255, 255, 0.72);
	font-size: 11px;
	letter-spacing: 0.16em;
	text-transform: uppercase;
	cursor: pointer;
}
@media (orientation: portrait) {
	/* The canvas is 75vw tall in portrait, so the band under it starts there.
	   36dvh was only below the canvas on very tall phones and put the only menu
	   button over the arena (and the HUD) on a 320x568 or a 375x667. */
	.gg-menu {
		top: calc(var(--safe-t) + 75vw + 12px);
	}
}

/* ---- first-run coach ----
   A top toast, not a card over the thumbs. Only its button takes a touch; the
   body lets the tap through to the fight, and the whole thing goes on the first
   deliberate touch or on "Got it". */
.gg-coach {
	position: absolute;
	left: calc(50% + (var(--safe-l) - var(--safe-r)) / 2);
	top: calc(var(--safe-t) + 4px);
	transform: translateX(-50%);
	display: flex;
	align-items: center;
	gap: 8px;
	width: min(
		420px,
		calc(100vw - var(--safe-l) - var(--safe-r) - 16px)
	);
	padding: 6px 8px 6px 12px;
	border-radius: 12px;
	border: 1px solid rgba(232, 182, 76, 0.55);
	background: rgba(14, 12, 22, 0.96);
	box-shadow: 0 8px 30px rgba(0, 0, 0, 0.55);
	font-size: 10px;
	line-height: 1.3;
	letter-spacing: 0.01em;
	color: rgba(255, 255, 255, 0.9);
	pointer-events: none;
}
.gg-coach-copy {
	flex: 1 1 auto;
	min-width: 0;
}
.gg-coach-line b {
	color: #ffe0a0;
	font-weight: 700;
}
.gg-coach-line.dim {
	color: rgba(255, 255, 255, 0.7);
}
.gg-coach-ok {
	flex: 0 0 auto;
	margin: 0;
	min-height: 44px;
	min-width: 76px;
	padding: 0 12px;
	border-radius: 999px;
	border: 1px solid rgba(14, 195, 201, 0.8);
	background: rgba(14, 195, 201, 0.2);
	color: #d8ffff;
	font-size: 11px;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	cursor: pointer;
	pointer-events: auto;
}

/* ---- the bare deck ----
   The deck is off, but a phone still needs a way into the menu. This is the
   same pill, nothing else. */
.gg-deck-bare {
	background: none;
}

/* ---- the training room ----
   Its panel starts open and is 300px wide; on a phone it sat exactly on the
   left hand. Put it at the top centre, where it can cover sky but never a
   thumb, and let the player collapse it. */
#app:has(.gg-deck:not(.gg-deck-bare)) .gt-panel {
	top: calc(env(safe-area-inset-top, 0px) + 6px);
	left: 50%;
	transform: translateX(-50%);
	width: min(320px, calc(100vw - 24px));
	max-height: 46dvh;
}

/* ---- the mobile HUD ----
   The keyboard hint is a lie on a phone, and the deck already draws the ammo,
   item and ultimate readouts on the thumbs that use them. Hide the copies the
   right hand sits on. */
#app:has(.gg-deck:not(.gg-deck-bare)) .vdh-hint,
#app:has(.gg-deck:not(.gg-deck-bare)) .vdh-ammo,
#app:has(.gg-deck:not(.gg-deck-bare)) .vdh-item,
#app:has(.gg-deck:not(.gg-deck-bare)) .vdh-ult {
	display: none;
}
@media (pointer: coarse) {
	.vdh-hint { display: none; }
}

/* ---- contrast and system settings ---- */
@media (prefers-contrast: more) {
	.gg-control,
	.gg-move,
	.gg-menu,
	.gg-coach {
		background: #14111d;
		border-color: #ffffff;
		opacity: 1;
	}
	.gg-control.disabled { opacity: 0.6; }
	.gg-move-caption,
	.gg-stance-seg { color: rgba(255, 255, 255, 0.85); }
	/* The high-contrast background is dark; the gold button's ink was not. */
	.gg-attack,
	.gg-attack.gun,
	.gg-attack .gg-label,
	.gg-charge-hint,
	.gg-ammo,
	.gg-ammo-reserve {
		color: #ffffff;
	}
	.gg-attack,
	.gg-attack.gun {
		background: #14111d;
		border-color: #ffffff;
	}
	.gg-charge-hint { background: #000000; }
}
@media (forced-colors: active) {
	.gg-control,
	.gg-control *,
	.gg-move,
	.gg-move *,
	.gg-menu,
	.gg-coach,
	.gg-coach * {
		forced-color-adjust: none;
		background-image: none !important;
		text-shadow: none !important;
		color: ButtonText !important;
		opacity: 1;
	}
	.gg-control,
	.gg-move,
	.gg-menu,
	.gg-coach {
		background-color: Canvas !important;
		border: 1px solid ButtonText;
	}
	.gg-control.on,
	.gg-control.ready,
	.gg-control.armed,
	.gg-stance-seg.on,
	.gg-ult.ready {
		outline: 3px solid Highlight;
		outline-offset: 2px;
	}
	.gg-control.disabled {
		color: GrayText !important;
		border-style: dashed;
		opacity: 1;
	}
	.gg-coach-ok {
		background: Canvas !important;
		border-color: ButtonText !important;
		color: ButtonText !important;
	}
	.gg-ring { display: none; }
}

/* A short viewport: keep the hands inside it without shrinking a target under
   44px. The stance row gives up 8px first, then the kit rows. */
@media (max-height: 340px) {
	.gg-deck { --gg-edge: 8px; --gg-gap: 6px; }
	.gg-combat { --stance-h: 50px; --row: 48px; }
	.gg-move { height: clamp(132px, 42dvh, 160px); }
}
`;

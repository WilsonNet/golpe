/**
 * The on-screen gamepad's appearance.
 *
 * Injected as a `<style>` element by `TouchControls`, the way `hudStyles.ts` and
 * the training panel do — the game ships one global stylesheet for the page shell
 * and nothing else, and a deck that only exists on a phone should carry its own
 * paint rather than growing that file.
 *
 * Every class is prefixed `vg-` (vento gamepad), so it cannot collide with the
 * deathmatch overlay's `vd-` or the training panel's `vt-`.
 *
 * **It is a handheld, on purpose.** A 4:3 game on a portrait phone leaves the
 * bottom half of the screen empty, and the shape that fills it — screen up top,
 * cross on the left, face buttons on the right, a wordmark between them — is a
 * Game Boy. Borrowing the silhouette means a player knows where their thumbs go
 * before reading a single label.
 *
 * The palette is the game's, not Nintendo's: charcoal-plum shell, gold trim, the
 * `#0ec3c9` the rest of the UI already uses for anything live.
 */

export const DECK_CSS = `
/* ---- page shell ----
   The deck's presence is what turns the page from "a centred canvas" into a
   handheld: screen on top, controls underneath. Keyed off :has() so nothing has
   to thread a boolean from React down into the global stylesheet — the deck
   renders or it does not, and the layout follows. */
#app:has(.vg-deck) {
	flex-direction: column;
	justify-content: flex-start;
	align-items: stretch;
	gap: 0;
	background:
		radial-gradient(120% 60% at 50% 0%, #2b2438 0%, #14121c 60%, #0a0910 100%);
}
/* **No bezel, no padding, no rounding.** The handheld this borrows from has a
   thick plastic surround; a phone cannot afford one. The arena is 800x600 of
   fixed authored space scaled to fit, so every pixel spent on a frame is arena a
   player cannot see — and on a 390px-wide screen, 20px of padding is 5% of the
   fight. The screen goes edge to edge and the shell starts where it ends. */
#app:has(.vg-deck) #game-container {
	flex: 0 1 auto;
	min-height: 0;
	width: 100%;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 0;
	box-sizing: border-box;
}

.vg-deck {
	flex: 1 1 auto;
	min-height: 0;
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 8px 12px 14px;
	box-sizing: border-box;
	/* The shell: a lit top edge and a dark bottom, which is the whole trick to
	   making flat CSS read as a moulded plastic body. */
	background: linear-gradient(180deg, #3a3348 0%, #2a2436 38%, #1a1624 100%);
	border-top: 1px solid rgba(232, 182, 76, 0.45);
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
	font-family: monospace;
	color: rgba(255, 255, 255, 0.88);
	/* A thumb dragging across the deck must never scroll the page or fire the
	   browser's double-tap zoom. The canvas sets the same property for the same
	   reason. */
	touch-action: none;
	user-select: none;
	-webkit-user-select: none;
	-webkit-tap-highlight-color: transparent;
	z-index: 10;
}

/* ---- the wordmark ----
   Where the handheld this borrows from puts its own. Two weights on one line,
   the way that logo is two words in two faces. */
.vg-brand {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 10px;
	padding: 2px 0 4px;
	flex: 0 0 auto;
}
.vg-brand-mark {
	font-family: Georgia, "Times New Roman", serif;
	font-style: italic;
	font-size: clamp(15px, 4.6vw, 24px);
	letter-spacing: 0.02em;
	background: linear-gradient(180deg, #ffe9a8 0%, #e8b64c 55%, #a97c1c 100%);
	-webkit-background-clip: text;
	background-clip: text;
	color: transparent;
	text-shadow: 0 1px 0 rgba(0, 0, 0, 0.35);
}
.vg-brand-mark b {
	font-weight: 700;
	letter-spacing: 0.06em;
}
.vg-brand-sub {
	font-size: clamp(7px, 2.1vw, 10px);
	letter-spacing: 0.34em;
	text-transform: uppercase;
	color: rgba(255, 255, 255, 0.32);
}
.vg-menu {
	position: absolute;
	right: 12px;
	font: inherit;
	font-size: 10px;
	letter-spacing: 0.16em;
	text-transform: uppercase;
	color: rgba(255, 255, 255, 0.55);
	background: none;
	border: 1px solid rgba(255, 255, 255, 0.22);
	border-radius: 999px;
	padding: 5px 12px;
	touch-action: none;
	cursor: pointer;
	pointer-events: auto;
}

/* ---- the four clusters ----
   Placed by area rather than by source order, so a rotation moves them without
   touching the DOM — and therefore without dropping a button a thumb is holding
   through the rotation. */
.vg-body {
	flex: 1 1 auto;
	min-height: 0;
	display: grid;
	grid-template-columns: 1fr 1fr;
	grid-template-areas:
		"cross face"
		"stance stick";
	/* Spread rather than centred: on a tall phone the two rows should reach down
	   towards where thumbs actually rest, not huddle in the middle of the shell. */
	align-content: space-evenly;
	justify-items: center;
	align-items: center;
	gap: clamp(10px, 3vh, 26px) 6px;
}
.vg-cell {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	min-width: 0;
}
.vg-cell.cross { grid-area: cross; }
.vg-cell.face { grid-area: face; }
.vg-cell.stance { grid-area: stance; }
.vg-cell.stick { grid-area: stick; }

/* The canvas HUD's keyboard hint is a lie on a device with no keyboard. */
#app:has(.vg-deck) .vd-hint {
	display: none;
}

/* ---- the left stick (was "the cross") ----
   One element, not four buttons, and a round analog pad, not a d-pad. A thumb
   rolling from left to up-left has to stay on the control the whole way, and
   four adjacent buttons each with their own hit test drop the input in the gap
   between them. The movement sector is worked out from where the thumb is, by
   the same eight-way quantiser the physical left stick uses — and the raw thumb
   position is handed over as the analog Contra aim, so it is the deck's left
   stick rather than a d-pad. It used to be drawn as a d-pad and read as one, so
   now it looks like what it is: a pad and a nub, the nub gold because gold is
   the Contra aim's colour and this is the stick that drives it. */
.vg-cross {
	position: relative;
	/* Sized off both axes, because which one runs out first depends entirely on
	   how the phone is held: the height is the constraint in landscape and the
	   width is the constraint in portrait. */
	width: min(40vw, 30vh, 190px);
	aspect-ratio: 1;
	border-radius: 50%;
	background: radial-gradient(circle at 50% 40%, #221d2e 0%, #14111d 70%);
	border: 1px solid rgba(255, 255, 255, 0.1);
	box-shadow: inset 0 3px 8px rgba(0, 0, 0, 0.7);
	touch-action: none;
	flex: 0 0 auto;
}
.vg-cross-nub {
	position: absolute;
	left: 50%;
	top: 50%;
	width: 42%;
	height: 42%;
	margin: -21% 0 0 -21%;
	border-radius: 50%;
	background: radial-gradient(circle at 35% 30%, #59526b, #26212f);
	border: 1px solid rgba(0, 0, 0, 0.6);
	box-shadow: 0 2px 4px rgba(0, 0, 0, 0.55);
	pointer-events: none;
}
.vg-cross.live .vg-cross-nub {
	background: radial-gradient(circle at 35% 30%, #ffe9a8, #a97c1c);
	border-color: #e8b64c;
}
.vg-cross-label {
	position: absolute;
	left: 0;
	right: 0;
	bottom: -14px;
	text-align: center;
	font-size: 8px;
	letter-spacing: 0.22em;
	text-transform: uppercase;
	color: rgba(255, 255, 255, 0.3);
	pointer-events: none;
}

/* ---- the fine-aim stick ----
   The layer that is *not* eight directions. It always leaves from the centre,
   which is why the nub is drawn from a transform rather than from where the
   thumb is: releasing it must put the aim back at rest, visibly. */
.vg-stick {
	position: relative;
	width: min(30vw, 20vh, 128px);
	aspect-ratio: 1;
	border-radius: 50%;
	background: radial-gradient(circle at 50% 40%, #221d2e 0%, #14111d 70%);
	border: 1px solid rgba(255, 255, 255, 0.1);
	box-shadow: inset 0 3px 8px rgba(0, 0, 0, 0.7);
	touch-action: none;
	flex: 0 0 auto;
}
.vg-stick-nub {
	position: absolute;
	left: 50%;
	top: 50%;
	width: 42%;
	height: 42%;
	margin: -21% 0 0 -21%;
	border-radius: 50%;
	background: radial-gradient(circle at 35% 30%, #59526b, #26212f);
	border: 1px solid rgba(0, 0, 0, 0.6);
	box-shadow: 0 2px 4px rgba(0, 0, 0, 0.55);
	pointer-events: none;
}
.vg-stick.live .vg-stick-nub {
	background: radial-gradient(circle at 35% 30%, #7ff0f4, #0e8a8f);
	border-color: #0ec3c9;
}
.vg-stick-label {
	position: absolute;
	left: 0;
	right: 0;
	bottom: -14px;
	text-align: center;
	font-size: 8px;
	letter-spacing: 0.22em;
	text-transform: uppercase;
	color: rgba(255, 255, 255, 0.3);
	pointer-events: none;
}

/* ---- face buttons ----
   A diamond, because the handheld's two-button diagonal is the shape a thumb
   already knows, and four actions need one axis more than two. */
.vg-face {
	position: relative;
	width: min(44vw, 33vh, 210px);
	aspect-ratio: 1;
	flex: 0 0 auto;
}
.vg-btn {
	position: absolute;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 50%;
	border: 1px solid rgba(0, 0, 0, 0.55);
	font: inherit;
	font-size: clamp(8px, 2.4vw, 10px);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: rgba(255, 255, 255, 0.9);
	background: radial-gradient(circle at 35% 28%, #6d3350, #3a1a2c);
	box-shadow: 0 3px 0 rgba(0, 0, 0, 0.55);
	touch-action: none;
	cursor: pointer;
	padding: 0;
	transition: transform 0.05s, box-shadow 0.05s, filter 0.05s;
}
.vg-btn.held {
	transform: translateY(2px);
	box-shadow: 0 1px 0 rgba(0, 0, 0, 0.55);
	filter: brightness(1.45);
}
/* A diamond, and the geometry is load-bearing: four circles in a square box
   overlap unless their centres are further apart than the sum of their radii.
   Slash is the button pressed most, so it is the biggest and sits under the
   thumb's resting position on the outside edge. */
.vg-btn.slash {
	width: 46%; height: 46%; right: 0; top: 27%;
	background: radial-gradient(circle at 35% 28%, #f0c463, #a2761f);
	color: #241905;
	font-weight: bold;
}
.vg-btn.jump   { width: 42%; height: 42%; left: 0; top: 29%; }
.vg-btn.upper  { width: 34%; height: 34%; left: 33%; top: 0; }
.vg-btn.block  { width: 34%; height: 34%; left: 33%; bottom: 0; }

/* ---- stance pills ----
   Where a handheld puts SELECT and START, and for the same reason: two things
   pressed between exchanges rather than during one. */
.vg-stance {
	display: flex;
	gap: 8px;
	flex: 0 0 auto;
}
.vg-pill {
	font: inherit;
	font-size: clamp(8px, 2.3vw, 10px);
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: rgba(255, 255, 255, 0.75);
	background: linear-gradient(180deg, #3a3348, #241f30);
	border: 1px solid rgba(0, 0, 0, 0.5);
	border-radius: 999px;
	padding: 7px 14px;
	box-shadow: 0 2px 0 rgba(0, 0, 0, 0.5);
	touch-action: none;
	cursor: pointer;
	transition: transform 0.05s, box-shadow 0.05s, color 0.05s;
}
.vg-pill.held {
	transform: translateY(2px);
	box-shadow: 0 0 0 rgba(0, 0, 0, 0.5);
	color: #0ec3c9;
}

/* ---- the ultimate pill ----
   Drawn only when the meter is full, which is the point: a button that appears
   is a louder "you have it" than a button that changes colour, and a phone has
   no room for a control that does nothing for sixty seconds at a time. The
   violet is the black hole's own colour, used nowhere else on the deck. */
.vg-pill.ult {
	color: #f2e2ff;
	background: linear-gradient(180deg, #7b3fd4, #3d1d70);
	border-color: rgba(214, 168, 255, 0.55);
	box-shadow: 0 2px 0 rgba(0, 0, 0, 0.5), 0 0 14px rgba(150, 90, 255, 0.55);
	animation: vg-ult-ready 1.4s ease-in-out infinite;
}
.vg-pill.ult.held {
	color: #fff;
	animation: none;
}
@keyframes vg-ult-ready {
	0%, 100% { box-shadow: 0 2px 0 rgba(0, 0, 0, 0.5), 0 0 10px rgba(150, 90, 255, 0.45); }
	50% { box-shadow: 0 2px 0 rgba(0, 0, 0, 0.5), 0 0 22px rgba(180, 120, 255, 0.9); }
}
@media (prefers-reduced-motion: reduce) {
	.vg-pill.ult { animation: none; }
}

/* ---- the speaker ----
   Pure decoration, and worth the twenty lines: the shell is otherwise a flat
   slab under the buttons, and the raked grille is the single detail that makes
   a rectangle read as a handheld. Drawn with a repeating gradient rather than
   forty elements, and skewed to get the rake. */
.vg-speaker {
	flex: 0 0 auto;
	align-self: flex-end;
	width: clamp(60px, 20vw, 96px);
	height: 22px;
	margin: 2px 6px 0 0;
	transform: skewX(-22deg);
	background: repeating-linear-gradient(
		90deg,
		rgba(0, 0, 0, 0.5) 0 4px,
		transparent 4px 10px
	);
	border-radius: 2px;
	opacity: 0.7;
	pointer-events: none;
}

/* ---- landscape ----
   A phone turned sideways has no room *below* the game, so the clusters go
   beside it: a 4:3 canvas on a 16:9 screen leaves a margin on each side, and
   that margin is where thumbs already are. The shell dissolves — there is no
   handheld body to draw when the body is the phone itself. */
@media (orientation: landscape) {
	#app:has(.vg-deck) {
		flex-direction: row;
	}
	#app:has(.vg-deck) #game-container {
		flex: 1 1 auto;
		height: 100%;
		padding: 0;
	}
	.vg-deck {
		position: fixed;
		inset: 0;
		justify-content: flex-end;
		background: none;
		border: none;
		box-shadow: none;
		pointer-events: none;
		padding: 0 8px 8px;
	}
	.vg-body {
		/* Two stacks hard against the two edges, and nothing in the middle: the
		   middle is the game. */
		grid-template-columns: auto 1fr auto;
		grid-template-areas:
			"cross . face"
			"stance . stick";
		align-content: end;
		gap: 8px;
	}
	/* Only the controls take the touch, never the empty space between them — the
	   letterbox they sit in is still the game. */
	.vg-deck .vg-cross,
	.vg-deck .vg-stick,
	.vg-deck .vg-btn,
	.vg-deck .vg-pill,
	.vg-deck .vg-brand {
		pointer-events: auto;
	}
	/* No room for the wordmark beside the game, but the menu button is the only
	   way off this deck and has to survive a rotation. */
	.vg-brand-mark,
	.vg-brand-sub {
		display: none;
	}
	.vg-brand {
		position: fixed;
		top: 8px;
		right: 8px;
		padding: 0;
	}
	.vg-menu {
		position: static;
	}
	.vg-speaker {
		display: none;
	}
	/* The labels hang below the pads, and in landscape "below" is off the screen.
	   The nubs say what the pads are well enough once there is no room to say
	   it. */
	.vg-stick-label,
	.vg-cross-label {
		display: none;
	}
}
`;

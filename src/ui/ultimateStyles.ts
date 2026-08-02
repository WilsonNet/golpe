/**
 * The ultimate cinematic's stylesheet, as a string.
 *
 * Kept beside the component and injected by it, exactly like the deck's — the
 * overlay is one self-contained thing that appears for a second and leaves, and
 * a global stylesheet carrying a hundred lines for it would be paid for on
 * every page load of a game most of whose UI is a canvas.
 *
 * **Every duration here is wall-clock CSS, and none of it is authoritative.**
 * The freeze is 1100ms because the *server* says so; these animations are timed
 * to fit inside that and would simply be cut off if it were ever shortened. The
 * component takes the real length as a custom property so they cannot drift.
 */

export const ULTIMATE_CSS = `
.vu-root {
	position: absolute;
	inset: 0;
	z-index: 40;
	display: grid;
	place-items: center;
	pointer-events: none;
	overflow: hidden;
	font-family: "Segoe UI", system-ui, sans-serif;
	--vu-ms: 1100ms;
	--vu-accent: #b07cff;
}

/* ---- the void ----
   A radial wash that darkens the arena without hiding it. The fight is still
   happening underneath and a player should still be able to see where they
   were standing when the world stopped — a full blackout would make the
   cutscene feel like a loading screen. */
.vu-void {
	position: absolute;
	inset: 0;
	background:
		radial-gradient(circle at 50% 48%, rgba(40, 8, 70, 0.35) 0%, rgba(2, 0, 8, 0.88) 65%);
	opacity: 0;
	animation: vu-fade var(--vu-ms) ease-out forwards;
}

/* ---- letterbox ----
   The oldest trick for "this is a cutscene now", and the cheapest. Bars slide
   in from both edges and hold; they are what makes the freeze read as
   deliberate rather than as a dropped frame. */
.vu-bar {
	position: absolute;
	left: 0;
	right: 0;
	height: 11%;
	background: linear-gradient(180deg, #08000f, #000);
	box-shadow: 0 0 24px rgba(0, 0, 0, 0.9);
}
.vu-bar.top { top: 0; animation: vu-bar-down 240ms cubic-bezier(0.2, 0.9, 0.2, 1) both; }
.vu-bar.bottom { bottom: 0; animation: vu-bar-up 240ms cubic-bezier(0.2, 0.9, 0.2, 1) both; }

/* ---- the collapsing star ----
   Drawn behind the portrait: three counter-rotating rings closing on a dark
   core. It is the same idea as the in-world accretion disk, restated at UI
   scale, so the thing that is about to arrive is legible before it does. */
.vu-star {
	position: absolute;
	width: min(78vh, 78vw);
	height: min(78vh, 78vw);
	pointer-events: none;
	opacity: 0;
	animation: vu-star-in var(--vu-ms) ease-out forwards;
}
.vu-ring {
	position: absolute;
	inset: 0;
	border-radius: 50%;
	border: 1px solid rgba(176, 124, 255, 0.35);
}
.vu-ring.a { animation: vu-spin 3.4s linear infinite; inset: 0; border-top-color: rgba(255, 190, 120, 0.85); }
.vu-ring.b { animation: vu-spin 2.1s linear infinite reverse; inset: 9%; border-left-color: rgba(255, 255, 255, 0.8); }
.vu-ring.c { animation: vu-spin 5s linear infinite; inset: 19%; border-bottom-color: rgba(176, 124, 255, 0.9); }
.vu-core {
	position: absolute;
	inset: 33%;
	border-radius: 50%;
	background: radial-gradient(circle, #000 55%, rgba(120, 60, 220, 0.55) 78%, transparent 100%);
	box-shadow: 0 0 60px rgba(150, 90, 255, 0.5) inset;
}

/* ---- the card ----
   Portrait, nameplate, title. Slides up and settles; nothing here moves after
   the first 300ms, because a player is trying to read a name off it. */
.vu-card {
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 10px;
	animation: vu-card-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

/* ---- the portrait frame ----
   An angled plate rather than a rectangle: cut corners read as insignia, a
   rectangle reads as a profile picture. The clip is on the frame and repeated
   on the inner well so the bevel survives it.

   **The bottom is flat.** It started as a pointed hexagon, which is prettier
   empty and useless full: a character standing centred at the bottom has both
   legs cut off by the two lower diagonals, which is exactly what happened. A
   figure needs a floor to stand on. */
.vu-frame {
	position: relative;
	width: 210px;
	height: 232px;
	padding: 3px;
	clip-path: polygon(20% 0, 80% 0, 100% 13%, 100% 88%, 88% 100%, 12% 100%, 0 88%, 0 13%);
	background: linear-gradient(160deg, var(--vu-accent), #2a1150 45%, var(--vu-accent));
	filter: drop-shadow(0 0 22px rgba(150, 90, 255, 0.55));
}
.vu-well {
	position: relative;
	width: 100%;
	height: 100%;
	clip-path: polygon(20% 0, 80% 0, 100% 13%, 100% 88%, 88% 100%, 12% 100%, 0 88%, 0 13%);
	background:
		radial-gradient(circle at 50% 32%, rgba(150, 90, 255, 0.4), rgba(8, 2, 18, 0.98) 70%),
		#05010c;
	overflow: hidden;
	display: flex;
	align-items: flex-end;
	justify-content: center;
}

/* Sweeping light behind the head, so the silhouette has something to sit
   against. Two conic sweeps at different speeds — one alone reads as a
   spinning wedge. */
.vu-sweep {
	position: absolute;
	inset: -40%;
	background: conic-gradient(
		from 0deg,
		transparent 0deg,
		rgba(255, 190, 120, 0.22) 30deg,
		transparent 70deg,
		transparent 180deg,
		rgba(176, 124, 255, 0.28) 215deg,
		transparent 260deg
	);
	animation: vu-spin 6s linear infinite;
}

/* ---- the character ----
   The shipped sprite sheet, sliced to the face-on frame and blown up 6x with
   nearest-neighbour. Using the real character rather than drawn artwork is the
   honest choice: it is unmistakably this fighter, it can never fall out of
   sync with what is on the field, and it costs no new asset. The hue rotation
   is per-fighter, so two casters in one match are not the same portrait. */
.vu-sprite {
	position: relative;
	/* 4x, and the whole figure fits: 32x48 becomes 128x192 inside a 210x232
	   frame, which leaves the head clear of the top bevel and the feet standing on
	   the flat bottom. 6x overflowed the frame in both directions. */
	width: 128px;
	height: 192px;
	margin-bottom: 14px;
	background-image: url("assets/dude.png");
	background-repeat: no-repeat;
	/* 9 frames of 32x48 at 4x = 1152x192, with frame 4 (face-on) at -512px. */
	background-size: 1152px 192px;
	background-position: -512px 0;
	image-rendering: pixelated;
	filter:
		drop-shadow(0 3px 10px rgba(0, 0, 0, 0.7))
		drop-shadow(0 0 16px rgba(176, 124, 255, 0.85))
		contrast(1.12)
		saturate(1.3)
		hue-rotate(var(--vu-hue, 0deg));
	animation: vu-sprite-in 380ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

/* The floor the figure stands on: an ellipse of light under the feet. It costs
   one element and it is what stops the character reading as a sticker pasted
   over a gradient. */
.vu-sprite::after {
	content: "";
	position: absolute;
	left: 50%;
	bottom: -10px;
	width: 118px;
	height: 22px;
	transform: translateX(-50%);
	border-radius: 50%;
	background: radial-gradient(ellipse, rgba(214, 168, 255, 0.55), transparent 70%);
}

/* ---- the nameplate ----
   Under the portrait, angled to match the frame's shoulders. This is the piece
   that has to survive a glance: sixteen fighters means the question the
   cutscene answers is "who". */
.vu-plate {
	position: relative;
	min-width: 220px;
	padding: 7px 30px;
	clip-path: polygon(14px 0, 100% 0, calc(100% - 14px) 100%, 0 100%);
	background: linear-gradient(90deg, rgba(30, 12, 58, 0.96), rgba(70, 30, 130, 0.96), rgba(30, 12, 58, 0.96));
	border-top: 1px solid rgba(200, 165, 255, 0.55);
	border-bottom: 1px solid rgba(200, 165, 255, 0.55);
	text-align: center;
	animation: vu-card-in 380ms 60ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
.vu-name {
	font-size: 21px;
	font-weight: 700;
	letter-spacing: 0.16em;
	text-transform: uppercase;
	color: #fff;
	text-shadow: 0 0 12px rgba(176, 124, 255, 0.9);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 15ch;
}
.vu-you {
	display: block;
	margin-top: 2px;
	font-size: 9px;
	letter-spacing: 0.42em;
	color: #ffd08a;
}

/* ---- the ability ----
   Letterspacing animates open, which is the one bit of motion after the card
   has landed. It reads as the words arriving rather than being pasted. */
.vu-ability {
	margin-top: 4px;
	text-align: center;
	animation: vu-card-in 420ms 120ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
.vu-ability-name {
	font-size: 34px;
	font-weight: 800;
	color: #fff;
	text-transform: uppercase;
	text-shadow:
		0 0 10px rgba(176, 124, 255, 0.95),
		0 0 34px rgba(120, 60, 220, 0.75);
	animation: vu-track 520ms 120ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
.vu-ability-sub {
	margin-top: 2px;
	font-size: 10px;
	letter-spacing: 0.55em;
	text-indent: 0.55em;
	color: rgba(220, 200, 255, 0.7);
	text-transform: uppercase;
}

/* ---- the timer ----
   A hairline that empties over exactly the freeze. Not decoration: it is the
   only thing on screen that tells a player how long they are not in control,
   and a freeze with no visible end is a freeze that feels like a hang. */
.vu-timer {
	margin-top: 12px;
	width: 260px;
	height: 2px;
	background: rgba(255, 255, 255, 0.14);
	overflow: hidden;
}
.vu-timer i {
	display: block;
	height: 100%;
	background: linear-gradient(90deg, var(--vu-accent), #ffd08a);
	transform-origin: left center;
	animation: vu-drain var(--vu-ms) linear forwards;
}

@keyframes vu-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes vu-bar-down { from { transform: translateY(-100%); } to { transform: none; } }
@keyframes vu-bar-up { from { transform: translateY(100%); } to { transform: none; } }
@keyframes vu-spin { to { transform: rotate(360deg); } }
@keyframes vu-star-in {
	from { opacity: 0; transform: scale(1.5); }
	to { opacity: 1; transform: scale(1); }
}
@keyframes vu-card-in {
	from { opacity: 0; transform: translateY(26px); }
	to { opacity: 1; transform: none; }
}
@keyframes vu-sprite-in {
	from { opacity: 0; transform: translateY(20px) scale(0.9); }
	to { opacity: 1; transform: none; }
}
@keyframes vu-track {
	from { letter-spacing: 0.02em; opacity: 0; }
	to { letter-spacing: 0.3em; opacity: 1; }
}
@keyframes vu-drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }

/* A cutscene is exactly the kind of thing this setting exists for. The overlay
   still appears and still says who cast what — only the motion goes. */
@media (prefers-reduced-motion: reduce) {
	.vu-root *,
	.vu-root *::before {
		animation-duration: 1ms !important;
		animation-iteration-count: 1 !important;
	}
	.vu-timer i { animation: vu-drain var(--vu-ms) linear forwards !important; }
}

/* A phone in portrait has no room for a 232px frame beside letterbox bars. */
@media (max-width: 640px), (max-height: 520px) {
	.vu-frame { width: 152px; height: 168px; }
	.vu-sprite { width: 88px; height: 132px; margin-bottom: 10px; background-size: 792px 132px; background-position: -352px 0; }
	.vu-sprite::after { width: 80px; height: 16px; bottom: -8px; }
	.vu-ability-name { font-size: 22px; }
	.vu-name { font-size: 15px; }
	.vu-timer { width: 190px; }
}
`;

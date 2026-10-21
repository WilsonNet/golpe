/**
 * The ultimate cinematic's stylesheet, as a string.
 *
 * Kept beside the component and injected by it, exactly like the deck's — the
 * overlay is one self-contained thing that appears for a second and leaves, and
 * a global stylesheet carrying a few hundred lines for it would be paid for on
 * every page load of a game most of whose UI is a canvas.
 *
 * **Every duration here is wall-clock CSS, and none of it is authoritative.**
 * The freeze is 1100ms because the *server* says so; these animations are timed
 * to fit inside that and would simply be cut off if it were ever shortened. The
 * component takes the real length as a custom property so they cannot drift.
 *
 * **The palette and the motif are keyed by `data-hero`.** One card used to serve
 * every ultimate — a collapsing star over the name "Dragon Thrust" — which was
 * honest while Lia was the only hero. Each hero now gets the colours, the
 * backdrop and the motion of their own kit; the copy lives in `ultimateCards.ts`
 * and the two are keyed by the same id so they cannot drift apart.
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

	/* Lia is the base palette: violet gravity and a warm accretion glow. Every
	   other hero overrides these below, so a hero added tomorrow inherits a
	   working card before it gets a personality. */
	--vu-ms: 1100ms;
	--vu-accent: #b07cff;
	--vu-accent-2: #ffd08a;
	--vu-line: rgba(200, 165, 255, 0.5);
	--vu-wash: rgba(40, 8, 70, 0.38);
	--vu-well: rgba(150, 90, 255, 0.42);
	--vu-ink: #05010c;
	--vu-deep: #2a1150;
	--vu-plate-a: rgba(30, 12, 58, 0.96);
	--vu-plate-b: rgba(70, 30, 130, 0.96);
	--vu-sweep-a: rgba(255, 190, 120, 0.22);
	--vu-sweep-b: rgba(176, 124, 255, 0.28);
	--vu-glow: rgba(150, 90, 255, 0.55);
	--vu-bar: #08000f;
	--vu-title-track: 0.3em;
	--vu-title-size: 42px;
	--vu-title-size-sm: 24px;
}

/* ---- Anands: the storm ----
   Teal goggles, purple hair, no guard and no brakes. Cool light against hot
   magenta, and diagonal streaks instead of rings: her ultimate is a straight
   line at 1500 px/s, so the card is cut by one. */
.vu-root[data-hero="anands"] {
	--vu-accent: #56f0dd;
	--vu-accent-2: #ff6ad5;
	--vu-line: rgba(110, 245, 230, 0.5);
	--vu-wash: rgba(6, 52, 60, 0.4);
	--vu-well: rgba(60, 230, 210, 0.4);
	--vu-ink: #02110f;
	--vu-deep: #073a44;
	--vu-plate-a: rgba(4, 30, 36, 0.96);
	--vu-plate-b: rgba(10, 96, 104, 0.96);
	--vu-sweep-a: rgba(255, 106, 213, 0.22);
	--vu-sweep-b: rgba(86, 240, 221, 0.3);
	--vu-glow: rgba(70, 240, 220, 0.5);
	--vu-bar: #001012;
	--vu-title-track: 0.18em;
	--vu-title-size: 36px;
	--vu-title-size-sm: 21px;
}

/* ---- Jeffs: the executioner ----
   Charcoal trench coat, shotgun smoke, an ember of a muzzle. The backdrop is
   smoke and the six-petal blossom is one petal per pellet. */
.vu-root[data-hero="jeffs"] {
	--vu-accent: #ffb066;
	--vu-accent-2: #b9c7b4;
	--vu-line: rgba(185, 199, 180, 0.45);
	--vu-wash: rgba(28, 30, 26, 0.46);
	--vu-well: rgba(255, 176, 102, 0.34);
	--vu-ink: #0b0c0a;
	--vu-deep: #24281f;
	--vu-plate-a: rgba(18, 20, 16, 0.96);
	--vu-plate-b: rgba(74, 76, 58, 0.96);
	--vu-sweep-a: rgba(255, 176, 102, 0.26);
	--vu-sweep-b: rgba(185, 199, 180, 0.2);
	--vu-glow: rgba(255, 176, 102, 0.45);
	--vu-bar: #0a0b08;
	--vu-title-track: 0.24em;
	--vu-title-size: 36px;
	--vu-title-size-sm: 21px;
}

/* ---- Ibiriki: the bloodthirsty ----
   Iron, bone and blood. Red eyes over a red wash, and a card that drips: the
   curse is paid for by moving, so the backdrop is a wound that will not close. */
.vu-root[data-hero="ibiriki"] {
	--vu-accent: #ff4a3d;
	--vu-accent-2: #d9c9a8;
	--vu-line: rgba(217, 201, 168, 0.42);
	--vu-wash: rgba(60, 4, 6, 0.48);
	--vu-well: rgba(255, 50, 40, 0.36);
	--vu-ink: #100203;
	--vu-deep: #3a0a0c;
	--vu-plate-a: rgba(34, 8, 9, 0.96);
	--vu-plate-b: rgba(110, 18, 18, 0.96);
	--vu-sweep-a: rgba(217, 201, 168, 0.22);
	--vu-sweep-b: rgba(255, 74, 61, 0.3);
	--vu-glow: rgba(255, 60, 48, 0.5);
	--vu-bar: #120203;
	--vu-title-track: 0.1em;
	--vu-title-size: 42px;
	--vu-title-size-sm: 24px;
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
		radial-gradient(circle at 50% 48%, var(--vu-wash) 0%, rgba(2, 0, 8, 0.9) 65%);
	opacity: 0;
	animation: vu-fade var(--vu-ms) ease-out forwards;
}

/* ---- letterbox ----
   The oldest trick for "this is a cutscene now", and the cheapest. Bars slide
   in from both edges and hold; they are what makes the freeze read as
   deliberate rather than as a dropped frame. The hairline on the inner edge
   takes the hero's accent, so even the bars belong to somebody. */
.vu-bar {
	position: absolute;
	left: 0;
	right: 0;
	height: 11%;
	background: linear-gradient(180deg, var(--vu-bar), #000);
	box-shadow: 0 0 24px rgba(0, 0, 0, 0.9);
}
.vu-bar::after {
	content: "";
	position: absolute;
	left: 0;
	right: 0;
	height: 1px;
	background: var(--vu-accent);
	opacity: 0.22;
}
.vu-bar.top { top: 0; animation: vu-bar-down 240ms cubic-bezier(0.2, 0.9, 0.2, 1) both; }
.vu-bar.bottom { bottom: 0; animation: vu-bar-up 240ms cubic-bezier(0.2, 0.9, 0.2, 1) both; }
.vu-bar.top::after { bottom: 0; }
.vu-bar.bottom::after { top: 0; }

/* ---- the motifs ----
   Full-screen backdrops, drawn in CSS so a hero arrives with art and not with
   an asset request. Each one is the ultimate in one shape: a collapsing star,
   a dash line, a six-petal blast, a bleeding wound. They sit *behind* the
   letterbox bars, which is what makes Ibiriki's drips read as leaking out from
   under the top bar rather than painted on top of it. */
.vu-motif {
	position: absolute;
	pointer-events: none;
	opacity: 0;
	animation: vu-fade 260ms ease-out 70ms forwards;
}
/* The rotating layer. Spins live here, never on the clipped outer element:
   rotating the clip with the art turns the viewport edge into a visible turning
   rectangle, which is exactly the bug this wrapper exists to kill. */
.vu-motif-inner {
	position: absolute;
	inset: 0;
}

/* Lia: three counter-rotating rings closing on a dark core. The same idea as
   the in-world accretion disk, restated at UI scale. */
.vu-motif-rings {
	left: 50%;
	top: 50%;
	width: min(78vh, 78vw);
	height: min(78vh, 78vw);
	translate: -50% -50%;
}
.vu-motif-rings i {
	position: absolute;
	inset: 0;
	border-radius: 50%;
	border: 1px solid var(--vu-line);
}
.vu-motif-rings i:nth-child(1) { border-top-color: var(--vu-accent-2); animation: vu-spin 3.4s linear infinite; }
.vu-motif-rings i:nth-child(2) { inset: 9%; border-left-color: #fff; animation: vu-spin 2.1s linear infinite reverse; }
.vu-motif-rings i:nth-child(3) { inset: 19%; border-bottom-color: var(--vu-accent); animation: vu-spin 5s linear infinite; }
.vu-motif-rings i:nth-child(4) {
	inset: 33%;
	border: 0;
	background: radial-gradient(circle, #000 55%, var(--vu-well) 78%, transparent 100%);
	box-shadow: 0 0 60px var(--vu-glow) inset;
}

/* Anands: three streaks crossing the screen on the diagonal, over and over,
   like the ride she is about to take. Repeating rather than one-shot: the
   freeze is 1100ms and one pass would leave a dead backdrop. */
.vu-motif-streaks { inset: 0; overflow: hidden; }
.vu-motif-streaks::before {
	content: "";
	position: absolute;
	inset: -10%;
	background: radial-gradient(ellipse at 50% 62%, var(--vu-well), transparent 62%);
}
/* A still bed of speed lines, so the backdrop is a dash even between passes.
   The animated streaks are the punctuation; this is the sentence. */
.vu-motif-streaks::after {
	content: "";
	position: absolute;
	inset: -20%;
	background: repeating-linear-gradient(
		112deg,
		transparent 0 74px,
		rgba(86, 240, 221, 0.13) 74px 76px
	);
	mask-image: radial-gradient(ellipse at 50% 50%, #000 28%, transparent 68%);
}
.vu-motif-streaks i {
	position: absolute;
	top: -30%;
	bottom: -30%;
	width: 3px;
	border-radius: 2px;
	background: linear-gradient(180deg, transparent, var(--vu-accent), var(--vu-accent-2), transparent);
	box-shadow: 0 0 18px var(--vu-accent);
	opacity: 0;
	animation: vu-streak 1050ms cubic-bezier(0.1, 0.8, 0.2, 1) infinite;
}
.vu-motif-streaks i:nth-child(1) { left: 26%; }
.vu-motif-streaks i:nth-child(2) { left: 50%; width: 5px; animation-delay: 120ms; }
.vu-motif-streaks i:nth-child(3) { left: 70%; animation-delay: 240ms; }

/* ---- Jeffs: the death blossom as a spinner ----
   A flower of six ellipse petals, one per pellet — ember and smoke alternating
   — whipped around inside a clipped frame, with a soft conic smear behind it so
   the colour reads as spinning even between petal passes. */
.vu-motif-spinner { inset: 0; overflow: hidden; }
.vu-motif-spinner::before {
	content: "";
	position: absolute;
	inset: -20%;
	background:
		radial-gradient(ellipse at 26% 62%, rgba(185, 199, 180, 0.14), transparent 60%),
		radial-gradient(ellipse at 74% 34%, rgba(255, 176, 102, 0.16), transparent 58%);
	animation: vu-smoke 4s ease-in-out infinite alternate;
}
.vu-motif-spinner .vu-motif-inner {
	filter: blur(0.4px);
	animation: vu-turn 1.8s linear infinite;
}
/* The smear of the turn already taken: alternating ember and smoke wedges,
   blurred into a disc and masked away from both the centre and the corners. */
.vu-motif-spinner .vu-motif-inner::before {
	content: "";
	position: absolute;
	left: 50%;
	top: 50%;
	width: min(66vh, 66vw);
	aspect-ratio: 1;
	translate: -50% -50%;
	border-radius: 50%;
	background: conic-gradient(
		from 0deg,
		rgba(255, 176, 102, 0.3) 0deg 26deg,
		transparent 26deg 60deg,
		rgba(185, 199, 180, 0.2) 60deg 86deg,
		transparent 86deg 120deg,
		rgba(255, 176, 102, 0.3) 120deg 146deg,
		transparent 146deg 180deg,
		rgba(185, 199, 180, 0.2) 180deg 206deg,
		transparent 206deg 240deg,
		rgba(255, 176, 102, 0.3) 240deg 266deg,
		transparent 266deg 300deg,
		rgba(185, 199, 180, 0.2) 300deg 326deg,
		transparent 326deg 360deg
	);
	filter: blur(7px);
	mask-image: radial-gradient(circle, #000 18%, rgba(0, 0, 0, 0.55) 52%, transparent 76%);
}
.vu-motif-spinner .vu-motif-inner::after {
	content: "";
	position: absolute;
	left: 50%;
	top: 50%;
	width: 16vh;
	aspect-ratio: 1;
	translate: -50% -50%;
	border-radius: 50%;
	background: radial-gradient(circle, rgba(255, 230, 190, 0.9), rgba(255, 176, 102, 0.45) 45%, transparent 72%);
	filter: blur(4px);
}
.vu-motif-spinner i {
	position: absolute;
	left: 50%;
	top: calc(50% - 44vh);
	width: 92px;
	height: 44vh;
	margin-left: -46px;
	border-radius: 50%;
	transform-origin: 50% 100%;
	background: radial-gradient(
		ellipse at 50% 20%,
		rgba(255, 214, 160, 0.95) 0%,
		rgba(255, 176, 102, 0.44) 42%,
		transparent 74%
	);
	filter: blur(0.5px);
	mix-blend-mode: screen;
	opacity: 0;
	animation: vu-petal 650ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
.vu-motif-spinner i:nth-child(even) {
	background: radial-gradient(
		ellipse at 50% 20%,
		rgba(232, 240, 228, 0.85) 0%,
		rgba(185, 199, 180, 0.3) 42%,
		transparent 74%
	);
}
.vu-motif-spinner i:nth-child(1) { rotate: 0deg; animation-delay: 0ms; }
.vu-motif-spinner i:nth-child(2) { rotate: 60deg; animation-delay: 30ms; }
.vu-motif-spinner i:nth-child(3) { rotate: 120deg; animation-delay: 60ms; }
.vu-motif-spinner i:nth-child(4) { rotate: 180deg; animation-delay: 90ms; }
.vu-motif-spinner i:nth-child(5) { rotate: 240deg; animation-delay: 120ms; }
.vu-motif-spinner i:nth-child(6) { rotate: 300deg; animation-delay: 150ms; }

/* Ibiriki: a wound that pulses and five drips leaking from under the top bar.
   The drips are the curse made visible — it is paid for by moving, and the
   card is already bleeding before anybody takes a step. */
.vu-motif-wound { inset: 0; overflow: hidden; }
.vu-motif-wound::before {
	content: "";
	position: absolute;
	left: 50%;
	top: 50%;
	width: min(70vh, 70vw);
	aspect-ratio: 1;
	translate: -50% -50%;
	border-radius: 50%;
	background: radial-gradient(circle, var(--vu-well) 0%, rgba(120, 0, 0, 0.16) 42%, transparent 68%);
	animation: vu-pulse 900ms ease-in-out infinite alternate;
}
.vu-motif-wound i {
	position: absolute;
	top: 0;
	width: 4px;
	border-radius: 0 0 3px 3px;
	background: linear-gradient(180deg, rgba(120, 0, 0, 0.95), var(--vu-accent));
	transform-origin: top center;
	opacity: 0;
	animation: vu-drip 620ms cubic-bezier(0.4, 0, 0.9, 0.5) both;
}
.vu-motif-wound i:nth-child(1) { left: 12%; height: 20vh; animation-delay: 0ms; }
.vu-motif-wound i:nth-child(2) { left: 30%; height: 34vh; animation-delay: 90ms; }
.vu-motif-wound i:nth-child(3) { left: 52%; height: 14vh; animation-delay: 40ms; }
.vu-motif-wound i:nth-child(4) { left: 71%; height: 28vh; animation-delay: 140ms; }
.vu-motif-wound i:nth-child(5) { left: 88%; height: 17vh; animation-delay: 200ms; }

/* ---- the card ----
   Portrait, nameplate, title. Slides up and settles; nothing here moves after
   the first 300ms, because a player is trying to read a name off it. The entry
   is per hero: Lia rises, Anands dashes in, Jeffs condenses out of smoke,
   Ibiriki slams down. */
.vu-card {
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 10px;
	animation: vu-card-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
.vu-root[data-hero="anands"] .vu-card { animation: vu-card-dash 250ms cubic-bezier(0.12, 0.9, 0.2, 1) both; }
.vu-root[data-hero="jeffs"] .vu-card { animation: vu-card-smoke 440ms cubic-bezier(0.16, 1, 0.3, 1) both; }
.vu-root[data-hero="ibiriki"] .vu-card { animation: vu-card-slam 300ms cubic-bezier(0.5, 0, 0.9, 0.2) both; }

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
	background: linear-gradient(160deg, var(--vu-accent), var(--vu-deep) 45%, var(--vu-accent));
	filter: drop-shadow(0 0 22px var(--vu-glow));
}
.vu-root[data-hero="anands"] .vu-frame {
	background: linear-gradient(120deg, var(--vu-accent), var(--vu-accent-2) 30%, var(--vu-deep) 62%, var(--vu-accent));
}
.vu-root[data-hero="jeffs"] .vu-frame {
	background: linear-gradient(160deg, var(--vu-accent), var(--vu-deep) 55%, var(--vu-accent-2));
}
.vu-root[data-hero="ibiriki"] .vu-frame {
	background: linear-gradient(160deg, var(--vu-accent-2), var(--vu-deep) 40%, var(--vu-accent));
}
.vu-well {
	position: relative;
	width: 100%;
	height: 100%;
	clip-path: polygon(20% 0, 80% 0, 100% 13%, 100% 88%, 88% 100%, 12% 100%, 0 88%, 0 13%);
	background:
		radial-gradient(circle at 50% 32%, var(--vu-well), var(--vu-ink) 70%),
		var(--vu-ink);
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
		var(--vu-sweep-a) 30deg,
		transparent 70deg,
		transparent 180deg,
		var(--vu-sweep-b) 215deg,
		transparent 260deg
	);
	animation: vu-spin 6s linear infinite;
}

/* ---- the character ----
   The hero's own portrait, made from the same source as their sprites (the
   Blender model, or Anands' boards). Using the real character rather than
   separate artwork is the honest choice: it is unmistakably this fighter and
   it can never fall out of sync with what is on the field. No hue rotation:
   the hero's own colours are the identity now, and two of the same hero are
   told apart by the nameplate, which is what it is for. */
.vu-sprite {
	position: relative;
	/* 4x, and the whole figure fits: 32x48 becomes 128x192 inside a 210x232
	   frame, which leaves the head clear of the top bevel and the feet standing on
	   the flat bottom. 6x overflowed the frame in both directions. */
	width: 128px;
	height: 192px;
	margin-bottom: 14px;
	/* Every hero ships a whole-card portrait (see the per-hero rules below). */
	background-repeat: no-repeat;
	background-size: 128px 192px;
	background-position: 0 0;
	image-rendering: pixelated;
	filter:
		drop-shadow(0 3px 10px rgba(0, 0, 0, 0.7))
		drop-shadow(0 0 16px var(--vu-glow))
		contrast(1.06)
		saturate(1.08);
	animation: vu-sprite-in 380ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
/* Anands' portrait, rendered from art/anands/anands.blend at 4x the sprite
   density by scripts/make-hero-art.py like the others — the same whole-card
   crop. */
.vu-sprite-anands {
	background-image: url("assets/anands-portrait.png");
	background-size: 128px 192px;
	background-position: 0 0;
}
/* Lia's and Jeffs' portraits, rendered from their Blender sources at 4x the
   sprite density by scripts/make-hero-art.py — the same whole-card crop. */
.vu-sprite-lia {
	background-image: url("assets/lia-portrait.png");
	background-size: 128px 192px;
	background-position: 0 0;
	image-rendering: auto;
}
.vu-sprite-jeffs {
	background-image: url("assets/jeffs-portrait.png");
	image-rendering: auto;
}
.vu-sprite-ibiriki {
	background-image: url("assets/ibiriki-portrait.png");
	image-rendering: auto;
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
	background: radial-gradient(ellipse, var(--vu-line), transparent 70%);
}

/* ---- the nameplate ----
   Under the portrait, angled to match the frame's shoulders. This is the piece
   that has to survive a glance: sixteen fighters means the question the
   cutscene answers is "who". */
.vu-plate {
	position: relative;
	min-width: 220px;
	max-width: 360px;
	padding: 7px 30px;
	clip-path: polygon(14px 0, 100% 0, calc(100% - 14px) 100%, 0 100%);
	background: linear-gradient(90deg, var(--vu-plate-a), var(--vu-plate-b), var(--vu-plate-a));
	border-top: 1px solid var(--vu-line);
	border-bottom: 1px solid var(--vu-line);
	text-align: center;
	animation: vu-card-in 380ms 60ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
.vu-name {
	font-size: 21px;
	font-weight: 700;
	letter-spacing: 0.16em;
	text-transform: uppercase;
	color: #fff;
	text-shadow: 0 0 12px var(--vu-accent);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 18ch;
}
.vu-you {
	display: block;
	margin-top: 2px;
	font-size: 9px;
	letter-spacing: 0.42em;
	color: #ffd08a;
}

/* ---- the ability ----
   The card reads like a fighting-game super: who they are, the flavor line in
   their voice, then the name shouted as the biggest thing on screen. The name's
   letterspacing animates open, which is the one bit of motion after the card
   has landed: it reads as the words arriving rather than being pasted. */
.vu-ability {
	margin-top: 6px;
	text-align: center;
	animation: vu-card-in 420ms 120ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
.vu-role {
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.42em;
	text-indent: 0.42em;
	text-transform: uppercase;
	color: var(--vu-accent);
	margin-bottom: 8px;
	text-shadow: 0 0 12px var(--vu-glow);
}
.vu-flavor {
	max-width: 440px;
	margin: 0 auto 2px;
	font-size: 19px;
	font-weight: 700;
	font-style: italic;
	line-height: 1.25;
	color: #fff;
	text-align: center;
	text-shadow:
		0 1px 4px rgba(0, 0, 0, 0.9),
		0 0 22px var(--vu-glow);
	animation: vu-card-in 420ms 100ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
.vu-ability-name {
	font-size: var(--vu-title-size, 42px);
	font-weight: 900;
	line-height: 1.05;
	color: #fff;
	text-transform: uppercase;
	text-shadow:
		0 0 10px var(--vu-accent),
		0 0 34px var(--vu-glow);
	animation: vu-track 520ms 120ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
.vu-root[data-hero="anands"] .vu-ability-name {
	font-style: italic;
	color: #eafffb;
	text-shadow:
		0 0 12px var(--vu-accent),
		0 0 40px var(--vu-accent-2);
}
.vu-root[data-hero="jeffs"] .vu-ability-name {
	color: #fff3e2;
	text-shadow:
		0 0 10px var(--vu-accent),
		0 0 38px rgba(255, 120, 40, 0.55);
}
.vu-root[data-hero="ibiriki"] .vu-ability-name {
	color: #ffe9e4;
	transform: rotate(-1.4deg);
	text-shadow:
		0 2px 0 var(--vu-deep),
		0 0 20px rgba(255, 60, 48, 0.85);
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
	background: linear-gradient(90deg, var(--vu-accent), var(--vu-accent-2));
	transform-origin: left center;
	animation: vu-drain var(--vu-ms) linear forwards;
}

@keyframes vu-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes vu-bar-down { from { transform: translateY(-100%); } to { transform: none; } }
@keyframes vu-bar-up { from { transform: translateY(100%); } to { transform: none; } }
@keyframes vu-spin { to { transform: rotate(360deg); } }
@keyframes vu-card-in {
	from { opacity: 0; transform: translateY(26px); }
	to { opacity: 1; transform: none; }
}
@keyframes vu-card-dash {
	from { opacity: 0; transform: translateX(-72px) skewX(-7deg); }
	to { opacity: 1; transform: none; }
}
@keyframes vu-card-smoke {
	from { opacity: 0; transform: scale(1.06); filter: blur(12px); }
	to { opacity: 1; transform: none; filter: none; }
}
@keyframes vu-card-slam {
	0% { opacity: 0; transform: translateY(-54px) scale(1.12); }
	62% { opacity: 1; transform: translateY(6px) scale(0.99); }
	82% { transform: translateY(-2px); }
	100% { opacity: 1; transform: none; }
}
@keyframes vu-sprite-in {
	from { opacity: 0; transform: translateY(20px) scale(0.9); }
	to { opacity: 1; transform: none; }
}
@keyframes vu-track {
	from { letter-spacing: 0.02em; opacity: 0; }
	to { letter-spacing: var(--vu-title-track); opacity: 1; }
}
@keyframes vu-drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
@keyframes vu-streak {
	0% { opacity: 0; transform: rotate(22deg) translateX(-70vw); }
	25% { opacity: 1; }
	100% { opacity: 0; transform: rotate(22deg) translateX(70vw); }
}
@keyframes vu-petal {
	from { opacity: 0; transform: scaleY(0.12); }
	to { opacity: 1; transform: scaleY(1); }
}
@keyframes vu-smoke {
	from { transform: translate3d(-2%, 1%, 0) scale(1); }
	to { transform: translate3d(2%, -1%, 0) scale(1.08); }
}
@keyframes vu-turn { to { rotate: 360deg; } }
@keyframes vu-drip {
	from { opacity: 0; transform: scaleY(0.05); }
	30% { opacity: 1; }
	to { opacity: 1; transform: scaleY(1); }
}
@keyframes vu-pulse {
	from { opacity: 0.55; transform: scale(0.96); }
	to { opacity: 1; transform: scale(1.04); }
}

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
	.vu-sprite { width: 88px; height: 132px; margin-bottom: 10px; background-size: 88px 132px; background-position: 0 0; }
	.vu-sprite::after { width: 80px; height: 16px; bottom: -8px; }
	.vu-ability-name { font-size: var(--vu-title-size-sm, 24px); --vu-title-track: 0.1em; }
	.vu-name { font-size: 15px; }
	.vu-role { font-size: 9px; letter-spacing: 0.34em; text-indent: 0.34em; margin-bottom: 5px; }
	.vu-flavor { font-size: 13px; max-width: 270px; }
	.vu-timer { width: 190px; }
	.vu-motif-spinner i { top: calc(50% - 34vh); height: 34vh; width: 64px; margin-left: -32px; }
	.vu-motif-wound i:nth-child(2) { height: 24vh; }
	.vu-motif-wound i:nth-child(4) { height: 20vh; }
}
`;

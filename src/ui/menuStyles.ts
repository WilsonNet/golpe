/**
 * The root menu's own CSS, on top of the shared `HUD_CSS` tokens.
 *
 * The menu is a page, not an overlay on a fight — there is no game underneath
 * it — so where the overlays use a translucent veil, this one owns the whole
 * screen: a deep-teal gradient of the arena's sky with the gold codex card
 * centred on it. Everything else reuses the `gd-` language (card, title, chips,
 * buttons, inputs) so the menu, the name prompt and the Esc menu read as one
 * system no matter where they appear.
 *
 * The home view is three sections in strict hierarchy, because seven equal
 * buttons in a row made every choice look like every other choice:
 *
 * - **Play** — starting a fight is the primary job, so it is first: the gold
 *   Quick match, then Host/Join as siblings, then Practice.
 * - **Your fighter** — who you bring. The hero picker lives here, on the home
 *   screen, with the fighter's own sprite and the name field, because a hero
 *   shooter should show its heroes and the choice rides every match you start.
 * - **Learn & settings** — the detours, smallest and quietest.
 */

import { HERO_SPRITE_CSS } from "./HeroSelect";

export const MENU_CSS = `
.gd-menu-page {
	position: fixed;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 50;
	font-family: monospace;
	color: rgba(255, 255, 255, 0.92);
	background:
		radial-gradient(1200px 700px at 50% -10%, rgba(38, 84, 96, 0.55), rgba(0, 0, 0, 0) 60%),
		linear-gradient(180deg, #101b24 0%, #0b0b0e 70%, #050507 100%);
	/* A phone in portrait is shorter than the menu; margin:auto on the card
	   centres it when it fits and lets the page scroll when it does not — the
	   flexbox trick that keeps the top of a too-tall card reachable, which plain
	   align-items:center clips off. */
	overflow-y: auto;
}
/* The menu card is the page's furniture, so it earns a slightly larger box and
   a golden codex border — the interruption tier, exactly like the podium. A
   touch wider than the overlay cards so the two-column rows breathe. */
.gd-menu-page .gd-card {
	margin: auto;
	min-width: 440px;
	/* An explicit width, not a shrink-to-fit flex item: without it the card
	   resolves to its content's max-content, and block children inside a
	   shrink-to-fit box never stretch to the clamped size. With a full-width
	   capped by max-width the used width is definite, so the buttons below
	   really do fill it. */
	width: 100%;
	max-width: 620px;
	box-sizing: border-box;
	/* A page deserves more padding than an overlay: 26px of air around every
	   side of the content, or the card's own furniture reads as shoved into
	   the frame. */
	padding: 26px 32px;
	border-color: rgba(255, 209, 102, 0.4);
	box-shadow: 0 24px 80px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 209, 102, 0.08);
}
.gd-menu-page .gd-title {
	color: #ffd166;
	font-size: 26px;
	letter-spacing: 0.14em;
	margin-bottom: 8px;
}
.gd-menu-page .gd-sub {
	font-size: 12px;
	margin-bottom: 18px;
}

/* ---- sections ----
   A section head is a word and a hairline. The rule under the word is what
   makes the grouping read as grouping rather than as three lists with
   captions. The vertical rhythm here is the whole polish story: 24px between
   one block and the next section's head, then a uniform 10px between the head
   and its content and between every control inside the section. Without the
   inner gap the Quick match button, the Host/Join row and Practice met edge to
   edge, which read as one big block. */
.gd-section {
	display: flex;
	flex-direction: column;
	gap: 10px;
}
.gd-section + .gd-section {
	margin-top: 24px;
}
.gd-section-head {
	display: flex;
	align-items: center;
	gap: 10px;
	margin: 0;
	font-size: 10px;
	letter-spacing: 0.2em;
	text-transform: uppercase;
	color: rgba(255, 209, 102, 0.6);
}
.gd-section-head::after {
	content: "";
	flex: 1;
	height: 1px;
	background: rgba(255, 209, 102, 0.18);
}

/* ---- the play list ----
   Each entry is a title and one short line of what it does. A player deciding
   what to click next should be able to read the answer off the button itself —
   nothing here depends on having read the docs. The section's flex gap spaces
   the stacked buttons; this file's old .gd-menu-list was dead the moment the
   home screen became sections. */
.gd-play-item {
	display: flex;
	flex-direction: column;
	/* The title and its one-line description need more than 3px between them —
	   that close reads as a label with a footnote, not a button with a caption. */
	gap: 4px;
	text-align: left;
	/* Buttons keep the form-control shrink-to-fit sizing in Chromium even when
	   display becomes flex — a <button> with width:auto hugs its text. The
	   explicit width is what makes every play item stretch across its section. */
	width: 100%;
	box-sizing: border-box;
	padding: 13px 16px;
	border: 1px solid rgba(255, 255, 255, 0.22);
	border-radius: 8px;
	background: #000;
	color: inherit;
	font: inherit;
	cursor: pointer;
	transition: border-color 0.2s, color 0.2s, transform 0.15s, box-shadow 0.2s;
}
.gd-play-item:hover {
	border-color: #0ec3c9;
}
.gd-play-item:focus-visible {
	outline: 2px solid #0ec3c9;
	outline-offset: 2px;
}
.gd-play-item strong {
	font-size: 15px;
	letter-spacing: 0.06em;
}
.gd-play-item span {
	font-size: 12px;
	opacity: 0.55;
	line-height: 1.45;
}
/* The one action a stranger should find first is the only filled button on the
   page: gold, dark text, lifted. Everything else is an outline, so the eye
   lands here before it reads anything else. */
.gd-play-item-primary {
	background: linear-gradient(180deg, #ffd76b 0%, #f0b34a 100%);
	border-color: #ffd166;
	color: #1b1406;
	padding: 17px 18px;
	box-shadow: 0 4px 20px rgba(255, 209, 102, 0.22);
}
.gd-play-item-primary strong {
	color: #1b1406;
	font-size: 17px;
}
.gd-play-item-primary span {
	color: rgba(27, 20, 6, 0.78);
	opacity: 1;
}
.gd-play-item-primary:hover {
	border-color: #ffe6a8;
	transform: translateY(-1px);
	box-shadow: 0 8px 26px rgba(255, 209, 102, 0.32);
}

/* The tutorial is the page's first item, and it is deliberately *not* gold.
   Quick match stays the one filled button — the primary action of a game is
   playing it — so the course wears the aim beam's cyan instead: unmissable at
   the top of the page, clearly a different kind of door, and never competing
   with the button beneath it for "the one thing to press". */
.gd-play-item-tutorial {
	border-color: rgba(14, 195, 201, 0.65);
	background: linear-gradient(180deg, rgba(14, 195, 201, 0.16), rgba(0, 0, 0, 0.9));
	padding: 16px 18px;
	box-shadow: 0 4px 20px rgba(14, 195, 201, 0.14);
}
.gd-play-item-tutorial strong {
	color: #7ff0f4;
	font-size: 16px;
}
.gd-play-item-tutorial span {
	opacity: 0.75;
}
.gd-play-item-tutorial:hover {
	border-color: #7ff0f4;
	transform: translateY(-1px);
	box-shadow: 0 8px 26px rgba(14, 195, 201, 0.26);
}
/* "4/16" beside the title: progress is remembered, and saying so is what makes
   a half-finished course feel resumable rather than restarted. */
.gd-badge {
	display: inline-block;
	margin-left: 8px;
	padding: 1px 7px;
	border-radius: 999px;
	background: rgba(127, 240, 244, 0.16);
	border: 1px solid rgba(127, 240, 244, 0.4);
	font-size: 11px;
	font-variant-numeric: tabular-nums;
	letter-spacing: 0.04em;
	color: #7ff0f4;
	vertical-align: middle;
}

/* Host and Join answer different questions and neither is a step toward the
   other, so they sit side by side as siblings rather than one above the
   other. The row collapses to a column on a phone. */
.gd-two {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 10px;
}

/* ---- your fighter ----
   The hero picker lives on the home screen: the fighter's own sprite, their
   name and kit, and the name field all in one panel. Picking rides every match
   started here, exactly as the old buried Heroes page did — this just shows
   the choice instead of hiding it a click away. */
.gd-hero-pick {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 10px;
}
.gd-hero-chip {
	display: flex;
	align-items: center;
	gap: 12px;
	background: #000;
	border: 1px solid rgba(255, 255, 255, 0.22);
	border-radius: 8px;
	padding: 10px 12px 10px 10px;
	color: inherit;
	font: inherit;
	cursor: pointer;
	text-align: left;
	transition: border-color 0.15s, box-shadow 0.15s;
}
.gd-hero-chip:hover {
	border-color: #0ec3c9;
}
.gd-hero-chip:focus-visible {
	outline: 2px solid #0ec3c9;
	outline-offset: 2px;
}
.gd-hero-chip-on,
.gd-hero-chip-on:hover {
	border-color: #ffd166;
	box-shadow: 0 0 12px rgba(255, 209, 102, 0.3);
}
/* The sprite is the hero's own sheet frame — what you pick is what you fight
   as — sitting left of the name instead of centred above it, because this is
   a compact picker, not the card grid of the Esc menu. Sized at 48x72 (the
   same as the phone) so the whole card fits a 778px window with the footer
   visible — the Esc menu's full-size cards stay the place for the big art. */
.gd-hero-chip .hp-sprite {
	margin: 0;
	flex: 0 0 auto;
	width: 48px;
	height: 72px;
	background-size: 432px 72px;
	background-position: -192px 0;
}
/* Anands' chip draws her own portrait, not a cell of the shared nine-cell
   strip — her sheets are hand-drawn with their own geometry. */
.gd-hero-chip .hp-sprite-anands {
	background-size: 48px 72px;
	background-position: 0 0;
}
.gd-hero-chip-meta {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}
.gd-hero-chip-name {
	font-size: 14px;
	letter-spacing: 0.06em;
}
.gd-hero-chip-on .gd-hero-chip-name {
	color: #ffd166;
}
.gd-hero-chip-kit {
	font-size: 10px;
	letter-spacing: 0.05em;
	opacity: 0.55;
	white-space: nowrap;
}
.gd-hero-blurb {
	font-size: 12px;
	opacity: 0.6;
	line-height: 1.5;
	/* The section's flex gap is the air between the name field and the
	   description beneath it — they met at zero pixels and read as one
	   control. */
	margin: 0;
}

/* ---- the name row ----
   The name the menu writes is the name the match reads, so a player who
   answers here never sees the in-game prompt — and the in-game prompt's share
   link is untouched, because it is the link that matters, not the name. */
.gd-name-row {
	display: flex;
	gap: 10px;
	align-items: center;
	margin-bottom: 0;
}
.gd-name-row label {
	font-size: 11px;
	opacity: 0.6;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	white-space: nowrap;
}
.gd-name-row input {
	flex: 1;
	font-size: 15px;
	padding: 9px 12px;
}

/* ---- the host form ---- */
/* The sub-views' primary action (Create match, Join) gets the same filled-gold
   treatment as Quick match on the home screen, so the one button that commits
   never reads as equal to Back. */
.gd-btn-primary {
	border-color: #ffd166;
	color: #1b1406;
	background: linear-gradient(180deg, #ffd76b 0%, #f0b34a 100%);
	font-weight: 700;
}
.gd-btn-primary:hover:not(:disabled) {
	border-color: #ffe6a8;
	color: #1b1406;
}
.gd-field {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 14px;
	margin-bottom: 10px;
	font-size: 13px;
}
.gd-field-label {
	opacity: 0.75;
}
.gd-field input[type="number"] {
	width: 74px;
	box-sizing: border-box;
	background: #000;
	color: inherit;
	font: inherit;
	font-size: 14px;
	padding: 7px 8px;
	border: 1px solid rgba(255, 255, 255, 0.3);
	border-radius: 6px;
	text-align: center;
}
.gd-field input[type="number"]:focus {
	outline: none;
	border-color: #0ec3c9;
}
.gd-field-note {
	font-size: 11px;
	opacity: 0.5;
	line-height: 1.5;
	margin: -4px 0 10px;
	text-align: right;
}
/* The advanced block hides behind a disclosure: the fields in it are for
   measuring and for hosts who already know what they are for, and showing them
   all makes the vanilla options harder to see. */
.gd-advanced {
	border-top: 1px dashed rgba(255, 255, 255, 0.16);
	margin-top: 8px;
	padding-top: 10px;
}
.gd-advanced-toggle {
	background: none;
	border: none;
	color: #7ff0f4;
	font: inherit;
	font-size: 11px;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	cursor: pointer;
	padding: 0;
}
.gd-advanced-toggle:hover {
	color: #ffd166;
}
/* The summary line is the gulf of evaluation closed: before committing, a host
   sees exactly the match the button is about to create. */
.gd-summary {
	font-size: 12px;
	color: #ffd166;
	line-height: 1.5;
	margin: 12px 0 0;
	min-height: 1.4em;
}

/* ---- join ---- */
.gd-join-hint {
	font-size: 12px;
	opacity: 0.55;
	line-height: 1.6;
	margin: 0 0 14px;
}
.gd-join-example {
	opacity: 0.75;
	word-break: break-all;
}

/* ---- server browser ----
   The listing is the same GET /rooms quick match uses, but presented
   for choosing rather than for being chosen for. Filters sit above the
   table; the table itself is a list of rows rather than a table so it
   collapses naturally on a phone. */
.gd-server-browser {
	margin-top: 18px;
	padding-top: 14px;
	border-top: 1px dashed rgba(255, 255, 255, 0.16);
}
.gd-browser-filters {
	display: flex;
	flex-direction: column;
	gap: 10px;
	margin-bottom: 14px;
}
.gd-browser-filters .gd-input {
	width: 100%;
	box-sizing: border-box;
}
.gd-browser-sorts {
	display: flex;
	gap: 8px;
	align-items: center;
	flex-wrap: wrap;
}
.gd-browser-list {
	display: flex;
	flex-direction: column;
	gap: 8px;
	max-height: 280px;
	overflow-y: auto;
	padding-right: 4px;
}
.gd-browser-row {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 12px;
	padding: 10px 12px;
	border: 1px solid rgba(255, 255, 255, 0.14);
	border-radius: 8px;
	background: rgba(0, 0, 0, 0.55);
}
.gd-browser-main {
	display: flex;
	flex-direction: column;
	gap: 3px;
	min-width: 0;
}
.gd-browser-id {
	font-size: 12px;
	letter-spacing: 0.06em;
	color: #ffd166;
	word-break: break-all;
}
.gd-browser-meta {
	font-size: 11px;
	opacity: 0.6;
	line-height: 1.4;
}
.gd-browser-side {
	display: flex;
	align-items: center;
	gap: 10px;
	flex: 0 0 auto;
}
.gd-browser-ping {
	font-size: 11px;
	opacity: 0.65;
	min-width: 48px;
	text-align: right;
	font-variant-numeric: tabular-nums;
}

/* ---- how to play ----
   Rows sit inside .gd-section groups, so their rhythm (10px inside a section,
   24px between groups) comes from the section gap — a row-level margin would
   stack on it and read as doubled air between rows. The section heads are the
   same ones the home screen uses, so this sub-view reads as one system. */
.gd-how-row {
	display: flex;
	gap: 8px;
	align-items: baseline;
	margin-bottom: 0;
	font-size: 13px;
	line-height: 1.5;
}
.gd-key {
	display: inline-block;
	min-width: 7ch;
	background: rgba(255, 255, 255, 0.08);
	border: 1px solid rgba(255, 255, 255, 0.22);
	border-radius: 4px;
	padding: 1px 6px;
	font-size: 12px;
	text-align: center;
	white-space: nowrap;
}
.gd-how-note {
	font-size: 12px;
	opacity: 0.6;
	line-height: 1.6;
	margin: 20px 0 0;
	border-top: 1px dashed rgba(255, 255, 255, 0.16);
	padding-top: 12px;
}
.gd-how-note strong {
	color: #ffd166;
	opacity: 1;
}
.gd-how-actions {
	margin-top: 24px;
}

/* ---- server status ----
   Feedback for the most common failure: a page that loads fine with no game
   server behind it. Saying so here turns "Connecting..." forever inside the
   match into a sentence on the menu. */
.gd-server {
	margin-top: 22px;
	padding-top: 12px;
	border-top: 1px solid rgba(255, 255, 255, 0.14);
	display: flex;
	gap: 8px;
	align-items: center;
	font-size: 12px;
	opacity: 0.65;
}
.gd-server .gd-room {
	margin-left: auto;
}
.gd-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	display: inline-block;
	flex: 0 0 auto;
}
.gd-dot-on {
	background: #7ddf8a;
	box-shadow: 0 0 6px rgba(125, 223, 138, 0.8);
}
.gd-dot-off {
	background: #ff8f6b;
	box-shadow: 0 0 6px rgba(255, 143, 107, 0.8);
}
.gd-dot-wait {
	background: #ffd166;
	animation: gd-blink 1s steps(2) infinite;
}
@keyframes gd-blink {
	50% {
		opacity: 0.3;
	}
}

/* ---- the phone ----
   This block lives last so nothing later can override it: an earlier @media
   here was silently beaten by the base rules that followed it, and the
   two-column rows stayed cramped side by side with the card overhanging the
   screen. */
@media (max-width: 520px) {
	.gd-menu-page .gd-card {
		min-width: 0;
		width: calc(100% - 24px);
	}
	/* Two-column rows become one column so every button is a thumb-sized
	   full-width target — a phone is the discoverability story too. */
	.gd-two,
	.gd-hero-pick {
		grid-template-columns: 1fr;
	}
}

${HERO_SPRITE_CSS}
`;

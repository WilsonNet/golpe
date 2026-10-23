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
 * The home view is a short list, and that is the design. Hick's law: decision
 * time grows with the number of things on offer, so the front page carries only
 * the choices a player actually makes — play, host, join, build — plus who they
 * are. Everything else lives behind one disclosure, one click away, instead of
 * competing for the same glance.
 *
 * - **Play** — starting a fight is the primary job, so the left column is it:
 *   the gold Quick match, then Host/Join as quiet siblings, then the Map maker.
 * - **Your fighter** — the right column: the name field, the four hero chips,
 *   the selected hero's blurb, and the *Play &lt;hero&gt; Tutorial* entry.
 * - **More** — practice and every settings page, behind one labelled
 *   disclosure at the bottom of the page.
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
	max-width: 600px;
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
   inner gap the Quick match button, Host and Join met edge to edge, which read
   as one big block. */
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
/* The map maker is a different page, so its item is a link styled as a play item. */
a.gd-play-item { color: inherit; text-decoration: none; }

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

/* ---- the home layout ----
   Two columns read as two decisions: how to play on the left, who to play as
   on the right. Inside each, everything is stacked and full-width — there is
   no side-by-side pair anywhere, because two buttons sharing a row read as
   equal choices of equal weight, which is how the old screen became heavy.
   On a narrow screen the two columns stack in the same order. */
.gd-home {
	display: flex;
	flex-direction: column;
	gap: 10px;
	margin-top: 4px;
}
.gd-home-main,
.gd-home-fighter {
	display: flex;
	flex-direction: column;
	gap: 10px;
	min-width: 0;
}

/* ---- the secondary entries ----
   Host, Join and everything in the disclosure: the same play item one size
   down. A smaller title and a single quieter line is the whole hierarchy
   signal — the gold Quick match and the cyan Tutorial are the two things the
   eye must find first. */
.gd-play-item-compact {
	padding: 10px 14px;
}
.gd-play-item-compact strong {
	font-size: 13px;
	letter-spacing: 0.05em;
}
.gd-play-item-compact span {
	font-size: 11px;
}

/* ---- the disclosure ----
   One labelled door to everything that is not "start a fight": practice, the
   map maker, how to play and the three settings pages. The label names what is
   inside so it is not a mystery-meat "More", and the arrow is the state.
   Disclosure is capped at this one level — a menu of submenus of submenus is
   burying complexity, not organising it. */
.gd-more {
	margin-top: 2px;
	padding-top: 12px;
	border-top: 1px dashed rgba(255, 255, 255, 0.14);
	/* In the two-column home it sits under both columns, never inside one —
	   otherwise opening it leaves the other column blank and lopsided. */
	grid-column: 1 / -1;
}
.gd-more-toggle {
	width: 100%;
	background: none;
	border: none;
	color: #7ff0f4;
	font: inherit;
	font-size: 11px;
	letter-spacing: 0.09em;
	text-transform: uppercase;
	text-align: left;
	cursor: pointer;
	padding: 4px 2px;
}
.gd-more-toggle:hover {
	color: #ffd166;
}
.gd-more-toggle:focus-visible {
	outline: 2px solid #0ec3c9;
	outline-offset: 2px;
}
.gd-more-body {
	display: flex;
	flex-direction: column;
	gap: 18px;
	padding-top: 12px;
}
/* Inside the disclosure the sections are spaced by the body's gap, not by the
   page-level 24px rhythm — the drawer is one block, not three. */
.gd-more-body .gd-section + .gd-section {
	margin-top: 0;
}

/* ---- the first-time card ----
   One question, asked once, over a dimmed menu. The tutorial is the biggest
   target in the card — larger than Skip, in the cyan it wears everywhere —
   because the player who needs it is exactly the one who would never go
   looking for it. Skip is a quiet full-width button directly beneath, so
   declining is still one click; *Don't show this again* is a text link, so it
   is findable without competing with the two answers. */
.gd-prompt-backdrop {
	position: fixed;
	inset: 0;
	z-index: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 20px;
	background: rgba(3, 6, 8, 0.72);
	backdrop-filter: blur(2px);
}
.gd-prompt {
	width: 100%;
	max-width: 420px;
	box-sizing: border-box;
	padding: 22px 24px 18px;
	border: 1px solid rgba(255, 209, 102, 0.45);
	border-radius: 12px;
	background: linear-gradient(180deg, #10161a 0%, #08080b 100%);
	box-shadow: 0 24px 70px rgba(0, 0, 0, 0.75);
}
.gd-prompt-title {
	margin: 0 0 8px;
	color: #ffd166;
	font-size: 20px;
	letter-spacing: 0.12em;
	text-transform: uppercase;
}
.gd-prompt-body {
	margin: 0 0 18px;
	font-size: 13px;
	line-height: 1.6;
	opacity: 0.75;
}
.gd-prompt-actions {
	display: flex;
	flex-direction: column;
	gap: 10px;
}
/* The course is the card's biggest target — taller than Skip, larger type,
   the cyan door — because the player who needs it is the one who would never
   go looking. Skip stays one click below, quieter but a full-width target. */
.gd-prompt-play {
	padding: 16px 18px;
}
.gd-prompt-play strong {
	font-size: 16px;
}
.gd-prompt-skip {
	width: 100%;
	padding: 9px 14px;
	font-size: 12px;
	color: rgba(255, 255, 255, 0.72);
}
.gd-prompt-never {
	margin-top: 14px;
	padding: 0;
	background: none;
	border: none;
	color: #7ff0f4;
	font: inherit;
	font-size: 11px;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	cursor: pointer;
}
.gd-prompt-never:hover,
.gd-prompt-never:focus-visible {
	color: #ffd166;
}

/* ---- your fighter ----
   A row of four portrait tiles: the sprite above the name, centred. Four
   equal tiles read as one control — "pick a fighter" — instead of four wide
   rows with a name floating in the middle of each. On a phone the grid
   becomes two columns, which is still one glance and half the height of four
   stacked rows. */
.gd-hero-pick {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 8px;
}
.gd-hero-chip {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 6px;
	/* A grid item's default min-width is its content's, and a long name used
	   to grow the track past the card's padding edge instead of fitting it. */
	min-width: 0;
	background: #000;
	border: 1px solid rgba(255, 255, 255, 0.22);
	border-radius: 8px;
	padding: 8px 6px 10px;
	color: inherit;
	font: inherit;
	cursor: pointer;
	text-align: center;
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
   as. 44x66 keeps four tiles inside the right column and the whole card inside
   a 1280x800 window; the Esc menu's full-size cards stay the place for the
   big art. */
.gd-hero-chip .hp-sprite {
	margin: 0;
	flex: 0 0 auto;
	width: 44px;
	height: 66px;
	background-size: 44px 66px;
	background-position: 0 0;
}
.gd-hero-chip-meta {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
	min-width: 0;
	max-width: 100%;
}
.gd-hero-chip-name {
	font-size: 12px;
	letter-spacing: 0.04em;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 100%;
}
.gd-hero-chip-on .gd-hero-chip-name {
	color: #ffd166;
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
/* ---- the password field ----
   The host form is label-left / control-right rows, so the password sits in
   the right corner with the number boxes — never stretched across the middle
   of the card. The box is wider than a number box (a password needs the
   room), with space inside for the show/hide toggle. */
.gd-field-stack {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin-bottom: 10px;
}
.gd-password-row {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 14px;
	font-size: 13px;
}
.gd-field-stack .gd-field-label {
	opacity: 0.75;
	font-size: 13px;
	cursor: pointer;
}
.gd-field-optional {
	opacity: 0.5;
	font-size: 12px;
}
.gd-password-wrap {
	position: relative;
	display: flex;
	align-items: center;
	flex: 0 1 240px;
	min-width: 0;
}
.gd-password-wrap .gd-input {
	width: 100%;
	box-sizing: border-box;
	font-size: 14px;
	padding: 7px 60px 7px 10px;
}
.gd-password-wrap .gd-input::placeholder {
	color: rgba(255, 255, 255, 0.35);
	opacity: 1;
}
.gd-password-wrap .gd-input:focus-visible {
	outline: 2px solid #0ec3c9;
	outline-offset: 2px;
}
.gd-password-toggle {
	position: absolute;
	right: 6px;
	flex: 0 0 auto;
	background: rgba(255, 255, 255, 0.06);
	border: 1px solid rgba(255, 255, 255, 0.22);
	border-radius: 6px;
	color: rgba(255, 255, 255, 0.75);
	font: inherit;
	font-size: 12px;
	padding: 6px 10px;
	cursor: pointer;
	transition: border-color 0.15s, color 0.15s;
}
.gd-password-toggle:hover {
	border-color: #0ec3c9;
	color: #0ec3c9;
}
.gd-password-toggle:focus-visible {
	outline: 2px solid #0ec3c9;
	outline-offset: 2px;
}
/* A phone is too narrow for label-left / box-right: the row stacks, label
   above and full-width box below, rather than squeezing the password into
   a sliver. */
@media (max-width: 520px) {
	.gd-password-row {
		flex-direction: column;
		align-items: stretch;
		gap: 8px;
	}
	.gd-password-wrap {
		flex-basis: auto;
	}
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

/* ---- the header: the name, the line, and the repository ----
   The game is open source, and this is the one page every player sees, so the
   repository sits in the header beside the title rather than in a footer. It is
   a quiet pill — the gold is for playing — with the star count as its badge. */
.gd-menu-head {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 16px;
}
.gd-repo {
	flex: none;
	display: inline-flex;
	align-items: center;
	gap: 8px;
	margin-top: 4px;
	padding: 7px 10px 7px 12px;
	border: 1px solid rgba(255, 255, 255, 0.22);
	border-radius: 999px;
	background: #000;
	color: rgba(255, 255, 255, 0.88);
	font-size: 12px;
	text-decoration: none;
	white-space: nowrap;
	transition: border-color 120ms, background 120ms;
}
.gd-repo:hover,
.gd-repo:focus-visible {
	border-color: rgba(255, 209, 102, 0.7);
	background: rgba(255, 209, 102, 0.06);
	outline: none;
}
.gd-repo-mark {
	flex: none;
}
.gd-repo-star {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding-left: 8px;
	border-left: 1px solid rgba(255, 255, 255, 0.18);
	color: #ffd166;
}
.gd-repo-count {
	padding: 1px 7px;
	border-radius: 999px;
	background: rgba(255, 209, 102, 0.14);
	color: #ffd166;
	font-weight: bold;
}


/* ---- the big screen ----
   From 980px the home view becomes the two columns it was designed as. The card
   stays narrow on purpose: past 1800×1000 it is zoomed (1.2×, 1.5×) rather than
   stretched, because a longer line of text is harder to read, not easier. The
   other views (host form, join, how to play…) keep the single column — a form
   is a column. */
@media (min-width: 980px) {
	.gd-menu-page .gd-card.gd-card-home {
		max-width: 940px;
		padding: 26px 36px;
	}
	.gd-home {
		display: grid;
		grid-template-columns: 1.1fr 1fr;
		column-gap: 36px;
		row-gap: 20px;
		align-items: stretch;
	}
	/* The rule is what makes the right column a column and not a stray block
	   under the buttons: who you are is a separate decision. It runs the full
	   height of the row, so a taller left column never leaves it hanging. */
	.gd-home-fighter {
		border-left: 1px solid rgba(255, 255, 255, 0.1);
		padding-left: 36px;
	}
	/* The disclosure spans the page, and its three groups sit side by side:
	   opening it costs one short band, not a second screen. */
	.gd-more-body {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 24px;
		align-items: start;
	}
}
/* A 1280x800 laptop: the two columns fit, the padding is what spills. */
@media (min-width: 980px) and (max-height: 860px) {
	.gd-menu-page .gd-card.gd-card-home {
		padding: 18px 36px;
	}
}
@media (min-width: 1800px) and (min-height: 1000px) {
	.gd-menu-page .gd-card {
		zoom: 1.2;
	}
}
@media (min-width: 2400px) and (min-height: 1300px) {
	.gd-menu-page .gd-card {
		zoom: 1.5;
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
	/* Two portrait tiles per row so the picker is one glance down the card,
	   not four full-width rows between the player and the game. */
	.gd-hero-pick {
		grid-template-columns: repeat(2, 1fr);
	}
	/* The pill drops under the title rather than squeezing it. */
	.gd-menu-head {
		flex-direction: column;
		gap: 0;
	}
	.gd-repo {
		margin: 0 0 16px;
	}
}

${HERO_SPRITE_CSS}
`;

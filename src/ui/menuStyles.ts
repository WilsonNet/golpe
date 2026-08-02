/**
 * The root menu's own CSS, on top of the shared `HUD_CSS` tokens.
 *
 * The menu is a page, not an overlay on a fight — there is no game underneath
 * it — so where the overlays use a translucent veil, this one owns the whole
 * screen: a deep-teal gradient of the arena's sky with the gold codex card
 * centred on it. Everything else reuses the `vd-` language (card, title, chips,
 * buttons, inputs) so the menu, the name prompt and the Esc menu read as one
 * system no matter where they appear.
 */

export const MENU_CSS = `
.vd-menu-page {
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
   a golden codex border — the interruption tier, exactly like the podium. */
.vd-menu-page .vd-card {
	margin: auto;
	min-width: 440px;
	max-width: 560px;
	border-color: rgba(255, 209, 102, 0.4);
	box-shadow: 0 24px 80px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 209, 102, 0.08);
}
.vd-menu-page .vd-title {
	color: #ffd166;
	font-size: 26px;
	letter-spacing: 0.14em;
}
@media (max-width: 520px) {
	.vd-menu-page .vd-card {
		min-width: 0;
		width: calc(100% - 24px);
	}
}

/* ---- the home list ----
   Each entry is a title and one line of what it does. A player deciding what
   to click next should be able to read the answer off the button itself —
   nothing here depends on having read the docs. */
.vd-menu-list {
	display: flex;
	flex-direction: column;
	gap: 9px;
	margin-top: 4px;
}
.vd-play-item {
	display: flex;
	flex-direction: column;
	gap: 3px;
	text-align: left;
	padding: 12px 14px;
	border: 1px solid rgba(255, 255, 255, 0.22);
	border-radius: 8px;
	background: #000;
	color: inherit;
	font: inherit;
	cursor: pointer;
	transition: border-color 0.2s, color 0.2s;
}
.vd-play-item:hover {
	border-color: #0ec3c9;
}
.vd-play-item strong {
	font-size: 15px;
	letter-spacing: 0.06em;
}
.vd-play-item span {
	font-size: 12px;
	opacity: 0.55;
	line-height: 1.45;
}
/* The one action a stranger should find first gets the game's gold. */
.vd-play-item-primary {
	border-color: rgba(255, 209, 102, 0.55);
}
.vd-play-item-primary strong {
	color: #ffd166;
}
.vd-play-item-primary:hover {
	border-color: #ffd166;
}

/* ---- the name row ----
   The name the menu writes is the name the match reads, so a player who
   answers here never sees the in-game prompt — and the in-game prompt's share
   link is untouched, because it is the link that matters, not the name. */
.vd-name-row {
	display: flex;
	gap: 10px;
	align-items: center;
	margin-bottom: 16px;
}
.vd-name-row label {
	font-size: 11px;
	opacity: 0.6;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	white-space: nowrap;
}
.vd-name-row input {
	flex: 1;
	font-size: 15px;
	padding: 9px 12px;
}

/* ---- the host form ---- */
.vd-field {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 14px;
	margin-bottom: 10px;
	font-size: 13px;
}
.vd-field-label {
	opacity: 0.75;
}
.vd-field input[type="number"] {
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
.vd-field input[type="number"]:focus {
	outline: none;
	border-color: #0ec3c9;
}
.vd-field-note {
	font-size: 11px;
	opacity: 0.5;
	line-height: 1.5;
	margin: -4px 0 10px;
	text-align: right;
}
/* The advanced block hides behind a disclosure: the fields in it are for
   measuring and for hosts who already know what they are for, and showing them
   all makes the vanilla options harder to see. */
.vd-advanced {
	border-top: 1px dashed rgba(255, 255, 255, 0.16);
	margin-top: 8px;
	padding-top: 10px;
}
.vd-advanced-toggle {
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
.vd-advanced-toggle:hover {
	color: #ffd166;
}
/* The summary line is the gulf of evaluation closed: before committing, a host
   sees exactly the match the button is about to create. */
.vd-summary {
	font-size: 12px;
	color: #ffd166;
	line-height: 1.5;
	margin: 12px 0 0;
	min-height: 1.4em;
}

/* ---- join ---- */
.vd-join-hint {
	font-size: 12px;
	opacity: 0.55;
	line-height: 1.6;
	margin: 0 0 14px;
}
.vd-join-example {
	opacity: 0.75;
	word-break: break-all;
}

/* ---- how to play ---- */
.vd-how-row {
	display: flex;
	gap: 8px;
	align-items: baseline;
	margin-bottom: 8px;
	font-size: 13px;
	line-height: 1.5;
}
.vd-key {
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
.vd-how-note {
	font-size: 12px;
	opacity: 0.6;
	line-height: 1.6;
	margin: 10px 0 0;
	border-top: 1px dashed rgba(255, 255, 255, 0.16);
	padding-top: 10px;
}

/* ---- server status ----
   Feedback for the most common failure: a page that loads fine with no game
   server behind it. Saying so here turns "Connecting..." forever inside the
   match into a sentence on the menu. */
.vd-server {
	margin-top: 16px;
	padding-top: 12px;
	border-top: 1px solid rgba(255, 255, 255, 0.14);
	display: flex;
	gap: 8px;
	align-items: center;
	font-size: 12px;
	opacity: 0.65;
}
.vd-server .vd-room {
	margin-left: auto;
}
.vd-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	display: inline-block;
	flex: 0 0 auto;
}
.vd-dot-on {
	background: #7ddf8a;
	box-shadow: 0 0 6px rgba(125, 223, 138, 0.8);
}
.vd-dot-off {
	background: #ff8f6b;
	box-shadow: 0 0 6px rgba(255, 143, 107, 0.8);
}
.vd-dot-wait {
	background: #ffd166;
	animation: vd-blink 1s steps(2) infinite;
}
@keyframes vd-blink {
	50% {
		opacity: 0.3;
	}
}
`;

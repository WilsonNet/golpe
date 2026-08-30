/**
 * The tutorial overlay's styling.
 *
 * Authored in **container units against the canvas box**, exactly like the
 * fight HUD — 1cqw = 8 logical px, 1cqh = 6 logical px at every display size —
 * so the coach card sits in the same optical world as the fighter panels
 * instead of being a browser dialog parked on top of a game.
 *
 * The card claims the **left edge below the self panel**: the fighter panels
 * own the top corners, the kill feed the upper right, ammo and the ultimate
 * meter the lower right. The left flank from ~9cqh down is the one region of
 * a 4:3 arena that nothing else draws in, and a fight staged 60px from spawn
 * happens in the middle of the screen.
 *
 * Two registers, borrowed from the HUD's own tiers:
 *
 * - the **coach card** is gameplay tier — translucent, hairline-edged, meant
 *   to be read out of the corner of an eye while playing;
 * - the **chapter card**, the **cleared stamp** and the **course complete**
 *   screen are interrupt tier — they take the screen, because at those moments
 *   nothing is being played.
 */

export const TUTORIAL_CSS = `
.tut-root {
	position: absolute;
	inset: 0;
	container-type: size;
	pointer-events: none;
	font-family: "Trebuchet MS", "Segoe UI", system-ui, sans-serif;
	color: #d9f4f6;
	/* Above the fight HUD's 10. The coach is the reason this screen exists, and
	   an interrupt-tier chapter card that let the fighter panels shine through
	   read as a bug rather than as a curtain. */
	z-index: 11;
}
.tut-root * { box-sizing: border-box; }

/* ---- the coach card ---- */
.tut-card {
	position: absolute;
	left: 1.4cqw;
	/* Below the self panel, which owns the top-left corner and is a little
	   taller than it looks — the frags row sits under the HP bar. */
	top: 13cqh;
	width: 30cqw;
	max-height: 74cqh;
	display: flex;
	flex-direction: column;
	gap: 0.9cqh;
	padding: 1.4cqh 1.4cqw;
	pointer-events: auto;
	background: linear-gradient(180deg, rgba(6, 18, 30, 0.86), rgba(6, 18, 30, 0.72));
	border: 1px solid rgba(127, 240, 244, 0.22);
	border-left: 2px solid rgba(255, 209, 102, 0.75);
	border-radius: 2px;
	box-shadow: 0 0.6cqh 2.4cqh rgba(0, 0, 0, 0.45);
	transition: border-left-color 220ms ease-out, background 220ms ease-out;
}
.tut-card.tut-cleared {
	border-left-color: #6fcf6f;
	background: linear-gradient(180deg, rgba(14, 34, 22, 0.9), rgba(6, 18, 30, 0.76));
}

.tut-eyebrow {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.8cqw;
	font-size: 1.05cqw;
	letter-spacing: 0.18em;
	text-transform: uppercase;
	color: rgba(217, 244, 246, 0.6);
}
.tut-eyebrow b {
	color: #ffd166;
	font-weight: bold;
}
.tut-title {
	font-size: 2.1cqw;
	line-height: 1.1;
	font-weight: bold;
	color: #ffd166;
	text-shadow: 0 0.3cqh 0 rgba(0, 0, 0, 0.7);
}
.tut-brief {
	font-size: 1.25cqw;
	line-height: 1.5;
	color: rgba(217, 244, 246, 0.88);
	/* A long brief scrolls rather than pushing the objectives off the card:
	   the objectives are the part a player has to be able to see. */
	overflow-y: auto;
	max-height: 26cqh;
	padding-right: 0.4cqw;
}

/* ---- objectives ---- */
.tut-objectives {
	display: flex;
	flex-direction: column;
	gap: 0.7cqh;
	margin-top: 0.2cqh;
}
.tut-obj {
	display: flex;
	flex-direction: column;
	gap: 0.35cqh;
	padding: 0.7cqh 0.8cqw;
	background: rgba(127, 240, 244, 0.05);
	border: 1px solid rgba(127, 240, 244, 0.12);
	border-radius: 2px;
	transition: border-color 200ms ease-out, background 200ms ease-out;
}
.tut-obj.tut-obj-done {
	border-color: rgba(111, 207, 111, 0.55);
	background: rgba(111, 207, 111, 0.1);
}
.tut-obj-line {
	display: flex;
	align-items: baseline;
	gap: 0.6cqw;
	font-size: 1.25cqw;
	line-height: 1.35;
}
.tut-tick {
	flex: 0 0 auto;
	width: 1.5cqw;
	font-size: 1.3cqw;
	color: rgba(217, 244, 246, 0.35);
}
.tut-obj-done .tut-tick { color: #6fcf6f; }
.tut-obj-text { flex: 1 1 auto; }
.tut-obj-count {
	flex: 0 0 auto;
	font-variant-numeric: tabular-nums;
	font-size: 1.15cqw;
	color: #ffd166;
}
.tut-obj-done .tut-obj-count { color: #6fcf6f; }
.tut-bar {
	height: 0.5cqh;
	background: rgba(0, 0, 0, 0.45);
	border-radius: 1px;
	overflow: hidden;
}
.tut-bar-fill {
	height: 100%;
	background: linear-gradient(90deg, #7ff0f4, #ffd166);
	transition: width 200ms ease-out;
}
.tut-obj-done .tut-bar-fill { background: #6fcf6f; }
.tut-hint {
	font-size: 1.05cqw;
	color: rgba(217, 244, 246, 0.55);
	font-style: italic;
}

/* ---- keycaps, the same idea as the move list's chips ---- */
.tut-keys {
	display: inline-flex;
	gap: 0.35cqw;
	margin-left: 0.3cqw;
	vertical-align: baseline;
}
.tut-key {
	display: inline-block;
	min-width: 2cqw;
	padding: 0.15cqh 0.45cqw;
	font-size: 1cqw;
	font-weight: bold;
	letter-spacing: 0.05em;
	text-align: center;
	color: #0b1a24;
	background: linear-gradient(180deg, #ffe3a3, #e0ac4a);
	border-radius: 2px;
	box-shadow: 0 0.2cqh 0 rgba(0, 0, 0, 0.55);
}

/* ---- the card's footer ---- */
.tut-foot {
	display: flex;
	align-items: center;
	gap: 0.6cqw;
	margin-top: 0.2cqh;
}
.tut-progress {
	flex: 1 1 auto;
	height: 0.45cqh;
	background: rgba(0, 0, 0, 0.5);
	border-radius: 1px;
	overflow: hidden;
}
.tut-progress-fill {
	height: 100%;
	background: #ffd166;
	transition: width 300ms ease-out;
}
.tut-btn {
	flex: 0 0 auto;
	padding: 0.5cqh 0.8cqw;
	font: inherit;
	font-size: 1.05cqw;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: rgba(217, 244, 246, 0.8);
	background: rgba(127, 240, 244, 0.08);
	border: 1px solid rgba(127, 240, 244, 0.28);
	border-radius: 2px;
	cursor: pointer;
}
.tut-btn:hover { background: rgba(127, 240, 244, 0.18); color: #fff; }
.tut-btn-primary {
	color: #0b1a24;
	background: linear-gradient(180deg, #ffe3a3, #e0ac4a);
	border-color: rgba(255, 209, 102, 0.8);
	font-weight: bold;
}
.tut-btn-primary:hover { background: #ffe3a3; color: #0b1a24; }

/* ---- the cleared stamp ---- */
.tut-stamp {
	position: absolute;
	left: 50%;
	top: 32cqh;
	transform: translateX(-50%);
	text-align: center;
	pointer-events: none;
	animation: tut-stamp-in 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
.tut-stamp-word {
	font-size: 5.4cqw;
	font-weight: bold;
	letter-spacing: 0.22em;
	color: #6fcf6f;
	text-shadow: 0 0.5cqh 0 rgba(0, 0, 0, 0.75);
}
.tut-stamp-sub {
	margin-top: 0.6cqh;
	max-width: 56cqw;
	font-size: 1.5cqw;
	line-height: 1.45;
	color: rgba(217, 244, 246, 0.9);
	text-shadow: 0 0.3cqh 0 rgba(0, 0, 0, 0.8);
}
@keyframes tut-stamp-in {
	from { opacity: 0; transform: translateX(-50%) scale(1.35); }
	to { opacity: 1; transform: translateX(-50%) scale(1); }
}

/* ---- interrupt tier: the chapter card and the finale ---- */
.tut-curtain {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 1.2cqh;
	text-align: center;
	background: radial-gradient(circle at 50% 45%, rgba(6, 18, 30, 0.82), rgba(2, 6, 12, 0.94));
	pointer-events: auto;
	animation: tut-fade-in 320ms ease-out both;
}
@keyframes tut-fade-in { from { opacity: 0; } to { opacity: 1; } }
.tut-curtain-eyebrow {
	font-size: 1.2cqw;
	letter-spacing: 0.32em;
	text-transform: uppercase;
	color: rgba(127, 240, 244, 0.75);
}
.tut-curtain-title {
	font-size: 5cqw;
	font-weight: bold;
	letter-spacing: 0.06em;
	color: #ffd166;
	text-shadow: 0 0.6cqh 0 rgba(0, 0, 0, 0.8);
}
.tut-curtain-sub {
	max-width: 62cqw;
	font-size: 1.6cqw;
	line-height: 1.5;
	color: rgba(217, 244, 246, 0.85);
}
.tut-curtain-actions {
	display: flex;
	gap: 1cqw;
	margin-top: 1.4cqh;
}
.tut-curtain-actions .tut-btn { font-size: 1.3cqw; padding: 0.9cqh 1.6cqw; }

/* ---- the "connecting" line, before the first lesson can be staged ---- */
.tut-wait {
	position: absolute;
	left: 50%;
	top: 50%;
	transform: translate(-50%, -50%);
	font-size: 1.6cqw;
	letter-spacing: 0.2em;
	text-transform: uppercase;
	color: rgba(217, 244, 246, 0.6);
}
`;

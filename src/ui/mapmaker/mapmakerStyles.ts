/**
 * The map maker's stylesheet, injected by `MapMaker` the way the menu and the
 * sprite workshop inject theirs.
 *
 * The game's UI tokens — gold #ffd166 for the primary action, teal #0ec3c9 for
 * focus and selection, monospace, small-caps heads — on a workbench layout:
 * a full-bleed dark frame whose only bright thing is the map. Two buttons are
 * louder than everything else on purpose: **Test vs bots** (green, the
 * Mario Maker play button) and **Publish** (gold, the end of the journey).
 *
 * Under 900px the side panel folds under the canvas and the tool rail becomes
 * a row, so the editor still works on a tablet held either way.
 *
 * **Type is a five-step scale, and 12px is the floor.** Every size below is a
 * `--mm-fs-*` token: xs 12 (key hints, badges, captions), sm 13 (labels,
 * status, secondary text), md 15 (body, buttons, inputs, the checks), lg 17
 * (the map's name) and xl 20 (dialog titles). The first version sized a
 * workbench like a HUD — tool keys at 8px, labels at 10–11px — and more than
 * half its text was under 13px; `monospace` reads small for its size, so the
 * body sits a step above the usual 14px.
 */

export const MAPMAKER_CSS = `
.mm-root {
	--mm-fs-xs: 12px;
	--mm-fs-sm: 13px;
	--mm-fs-md: 15px;
	--mm-fs-lg: 17px;
	--mm-fs-xl: 20px;
	position: fixed;
	inset: 0;
	z-index: 50;
	display: flex;
	flex-direction: column;
	font-family: monospace;
	font-size: var(--mm-fs-md);
	line-height: 1.4;
	color: rgba(255, 255, 255, 0.92);
	background: linear-gradient(180deg, #121a22 0%, #0b0d11 100%);
	user-select: none;
	-webkit-user-select: none;
}
.mm-root input, .mm-root select, .mm-root textarea, .mm-root pre { user-select: text; -webkit-user-select: text; }
.mm-root button { font: inherit; color: inherit; }
.mm-root kbd {
	display: inline-block;
	min-width: 18px;
	padding: 0 5px;
	border: 1px solid rgba(255, 255, 255, 0.25);
	border-bottom-width: 2px;
	border-radius: 4px;
	font-size: var(--mm-fs-xs);
	line-height: 18px;
	text-align: center;
	color: rgba(255, 255, 255, 0.7);
}
.mm-muted { color: rgba(255, 255, 255, 0.55); }
.mm-muted.small, .mm-root .small { font-size: var(--mm-fs-sm); line-height: 1.5; }
.mm-spacer { flex: 1 1 auto; }

/* ── buttons ─────────────────────────────────────────────────────────── */
.mm-btn {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 8px 14px;
	border: 1px solid rgba(255, 255, 255, 0.18);
	border-radius: 7px;
	background: rgba(255, 255, 255, 0.06);
	cursor: pointer;
	white-space: nowrap;
	transition: background 0.12s, border-color 0.12s, transform 0.06s;
}
.mm-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.12); border-color: rgba(14, 195, 201, 0.7); }
.mm-btn:active:not(:disabled) { transform: translateY(1px); }
.mm-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.mm-btn:focus-visible, .mm-tool:focus-visible, .mm-swatch:focus-visible, .mm-icon:focus-visible { outline: 2px solid #0ec3c9; outline-offset: 2px; }
.mm-btn-primary { background: #ffd166; border-color: #ffd166; color: #1b1405 !important; font-weight: bold; }
.mm-btn-primary:hover:not(:disabled) { background: #ffe08f; border-color: #ffe08f; }
.mm-play { background: #2fbf71; border-color: #2fbf71; color: #04140b !important; font-weight: bold; }
.mm-play:hover:not(:disabled) { background: #49d98a; border-color: #49d98a; }
.mm-danger:hover:not(:disabled) { border-color: #ff5d5d; background: rgba(255, 93, 93, 0.15); }
.mm-icon {
	width: 34px;
	height: 34px;
	border: 1px solid rgba(255, 255, 255, 0.16);
	border-radius: 7px;
	background: rgba(255, 255, 255, 0.05);
	cursor: pointer;
	font-size: var(--mm-fs-lg);
}
.mm-icon:disabled { opacity: 0.35; cursor: not-allowed; }
.mm-link {
	border: 0;
	background: none;
	padding: 0;
	color: #0ec3c9 !important;
	text-decoration: underline;
	text-underline-offset: 2px;
	cursor: pointer;
}
.mm-link.danger { color: #ff8a8a !important; }
.mm-x {
	position: absolute;
	top: 10px;
	right: 10px;
	width: 34px;
	height: 34px;
	border: 0;
	border-radius: 7px;
	background: transparent;
	font-size: var(--mm-fs-lg);
	cursor: pointer;
	color: rgba(255, 255, 255, 0.6) !important;
}
.mm-x:hover { background: rgba(255, 255, 255, 0.1); }

/* ── top bar ─────────────────────────────────────────────────────────── */
.mm-bar {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 8px 12px;
	border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	background: rgba(0, 0, 0, 0.35);
	flex: 0 0 auto;
	flex-wrap: wrap;
}
.mm-logo {
	color: #ffd166;
	text-decoration: none;
	letter-spacing: 0.16em;
	text-transform: uppercase;
	font-size: var(--mm-fs-lg);
	white-space: nowrap;
}
.mm-logo span { margin-left: 4px; }
.mm-name {
	width: 220px;
	padding: 7px 10px;
	border: 1px solid transparent;
	border-radius: 6px;
	background: rgba(255, 255, 255, 0.04);
	color: #fff;
	font: inherit;
	font-size: var(--mm-fs-lg);
	font-weight: bold;
}
.mm-name:hover { border-color: rgba(255, 255, 255, 0.15); }
.mm-name:focus { outline: none; border-color: #0ec3c9; background: rgba(0, 0, 0, 0.3); }
.mm-group { display: flex; align-items: center; gap: 4px; margin: 0; padding: 0; border: 0; min-width: 0; }
.mm-width span { min-width: 74px; text-align: center; }
.mm-swatch {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
	padding: 3px;
	border: 2px solid transparent;
	border-radius: 7px;
	background: none;
	cursor: pointer;
	font-size: var(--mm-fs-xs);
	color: rgba(255, 255, 255, 0.6) !important;
}
.mm-swatch canvas { width: 54px; height: 36px; border-radius: 4px; image-rendering: pixelated; display: block; }
.mm-swatch.on { border-color: #ffd166; color: #ffd166 !important; }
.mm-swatch:hover:not(.on) { border-color: rgba(255, 255, 255, 0.25); }

.mm-tips {
	position: relative;
	display: flex;
	align-items: center;
	gap: 22px;
	padding: 7px 44px 7px 16px;
	background: rgba(255, 209, 102, 0.1);
	border-bottom: 1px solid rgba(255, 209, 102, 0.25);
	flex-wrap: wrap;
}
.mm-tips b {
	display: inline-grid;
	place-items: center;
	width: 22px;
	height: 22px;
	margin-right: 8px;
	border-radius: 50%;
	background: #ffd166;
	color: #1b1405;
	font-size: var(--mm-fs-sm);
}
.mm-tips .mm-x { top: 4px; }

/* ── body ────────────────────────────────────────────────────────────── */
.mm-body { flex: 1 1 auto; display: flex; min-height: 0; }
.mm-rail {
	flex: 0 0 92px;
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 8px 6px;
	border-right: 1px solid rgba(255, 255, 255, 0.08);
	background: rgba(0, 0, 0, 0.25);
	overflow-y: auto;
}
.mm-tool {
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
	padding: 7px 2px 6px;
	border: 1px solid transparent;
	border-radius: 8px;
	background: none;
	cursor: pointer;
}
.mm-tool:hover { background: rgba(255, 255, 255, 0.06); }
.mm-tool.on { background: rgba(14, 195, 201, 0.16); border-color: rgba(14, 195, 201, 0.7); }
.mm-tool-icon { font-size: 22px; line-height: 26px; }
.mm-tool-label { font-size: var(--mm-fs-sm); }
.mm-tool kbd { position: absolute; top: 3px; right: 3px; min-width: 16px; line-height: 16px; padding: 0 3px; opacity: 0.75; }
.mm-tool.small { padding: 5px 2px; }
.mm-tool.small .mm-tool-icon { font-size: 18px; line-height: 22px; }
.mm-rail-sep { height: 1px; margin: 6px 4px; background: rgba(255, 255, 255, 0.1); }

.mm-stage { position: relative; flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.mm-canvas-wrap { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; }
.mm-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; image-rendering: pixelated; }
.mm-palette {
	position: absolute;
	top: 10px;
	left: 50%;
	transform: translateX(-50%);
	z-index: 2;
	display: flex;
	gap: 4px;
	padding: 5px;
	border: 1px solid rgba(255, 255, 255, 0.15);
	border-radius: 9px;
	background: rgba(10, 12, 16, 0.85);
	backdrop-filter: blur(6px);
}
.mm-prop {
	width: 48px;
	height: 48px;
	display: grid;
	place-items: center;
	border: 1px solid transparent;
	border-radius: 6px;
	background: rgba(255, 255, 255, 0.05);
	cursor: pointer;
}
.mm-prop canvas { width: 40px; height: 40px; image-rendering: pixelated; }
.mm-prop.on { border-color: #ffd166; background: rgba(255, 209, 102, 0.15); }
.mm-status {
	display: flex;
	gap: 14px;
	align-items: center;
	padding: 7px 14px;
	font-size: var(--mm-fs-sm);
	color: rgba(255, 255, 255, 0.65);
	border-top: 1px solid rgba(255, 255, 255, 0.08);
	background: rgba(0, 0, 0, 0.3);
}
.mm-minimap {
	display: block;
	width: auto;
	max-width: calc(100% - 16px);
	height: 56px;
	object-fit: contain;
	margin: 4px auto;
	border-radius: 4px;
	image-rendering: pixelated;
	cursor: pointer;
	outline: 1px solid rgba(255, 255, 255, 0.12);
}

.mm-side {
	flex: 0 0 340px;
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 10px;
	border-left: 1px solid rgba(255, 255, 255, 0.08);
	background: rgba(0, 0, 0, 0.25);
	overflow-y: auto;
}
.mm-panel h3, .mm-step h3, .mm-subhead {
	display: flex;
	align-items: center;
	gap: 8px;
	margin: 0 0 10px;
	font-size: var(--mm-fs-sm);
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: #ffd166;
}
.mm-panel p { margin: 0 0 8px; }
.mm-mapinfo { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.mm-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }
.mm-fields label, .mm-form label { display: flex; flex-direction: column; gap: 4px; font-size: var(--mm-fs-sm); color: rgba(255, 255, 255, 0.7); }
.mm-fields input, .mm-form input, .mm-form select, .mm-token input {
	padding: 6px 8px;
	border: 1px solid rgba(255, 255, 255, 0.18);
	border-radius: 6px;
	background: rgba(0, 0, 0, 0.35);
	color: #fff;
	font: inherit;
	font-size: var(--mm-fs-md);
}
.mm-fields input:focus, .mm-form input:focus, .mm-form select:focus, .mm-token input:focus { outline: none; border-color: #0ec3c9; }
.mm-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.mm-row.end { justify-content: flex-end; margin-top: 14px; }
.mm-badge { margin-left: auto; padding: 2px 9px; border-radius: 10px; font-size: var(--mm-fs-xs); letter-spacing: 0.02em; text-transform: none; }
.mm-badge.ok { background: rgba(47, 191, 113, 0.2); color: #6fe3a3; }
.mm-badge.warn { background: rgba(255, 181, 71, 0.18); color: #ffc46e; }
.mm-badge.bad { background: rgba(255, 93, 93, 0.2); color: #ff8a8a; }
.mm-checks ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.mm-issue button {
	display: flex;
	gap: 7px;
	width: 100%;
	padding: 6px 7px;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 6px;
	background: rgba(255, 255, 255, 0.03);
	text-align: left;
	line-height: 1.45;
	font-size: var(--mm-fs-sm);
	cursor: pointer;
}
.mm-issue button:disabled { cursor: default; }
.mm-issue button:hover:not(:disabled) { border-color: rgba(14, 195, 201, 0.6); }
.mm-issue-icon { flex: 0 0 auto; }
.mm-issue.error .mm-issue-icon { color: #ff5d5d; }
.mm-issue.warning .mm-issue-icon { color: #ffb547; }
.mm-issue.info .mm-issue-icon { color: #7cc4ec; }

/* ── sheets (dialogs) ────────────────────────────────────────────────── */
.mm-sheet-veil {
	position: fixed;
	inset: 0;
	z-index: 60;
	display: grid;
	place-items: center;
	padding: 16px;
	background: rgba(4, 6, 10, 0.7);
	backdrop-filter: blur(3px);
}
.mm-sheet {
	position: relative;
	width: min(580px, 100%);
	max-height: calc(100vh - 32px);
	overflow-y: auto;
	padding: 18px 20px 20px;
	border: 1px solid rgba(255, 209, 102, 0.35);
	border-radius: 12px;
	background: linear-gradient(180deg, #1a222c 0%, #12161d 100%);
	box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}
.mm-sheet.wide, .mm-publish { width: min(940px, 100%); }
.mm-sheet-head { margin-bottom: 14px; padding-right: 30px; }
.mm-sheet-head h2 { margin: 0 0 6px; font-size: var(--mm-fs-xl); letter-spacing: 0.04em; color: #ffd166; }
.mm-sheet-head p { margin: 0; line-height: 1.5; }
.mm-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.mm-form .mm-wide { grid-column: 1 / -1; }
.mm-check { flex-direction: row !important; align-items: center; gap: 10px !important; font-size: var(--mm-fs-md) !important; color: #fff !important; }
.mm-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-bottom: 14px; }
.mm-card b { font-size: var(--mm-fs-md); }
.mm-card {
	display: flex;
	flex-direction: column;
	gap: 5px;
	padding: 8px;
	border: 1px solid rgba(255, 255, 255, 0.14);
	border-radius: 9px;
	background: rgba(255, 255, 255, 0.04);
	text-align: left;
	cursor: pointer;
	font-size: var(--mm-fs-sm);
	line-height: 1.45;
}
.mm-card:hover { border-color: rgba(14, 195, 201, 0.7); }
.mm-card.on { border-color: #ffd166; background: rgba(255, 209, 102, 0.08); }
.mm-card-preview { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 5px; image-rendering: pixelated; background: #000; }
.mm-list { list-style: none; margin: 0 0 14px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.mm-list li { display: flex; align-items: center; gap: 12px; padding: 4px 8px; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 7px; }
.mm-list li.on { border-color: rgba(255, 209, 102, 0.5); }
.mm-list-main { flex: 1; display: flex; flex-direction: column; gap: 2px; padding: 4px 0; border: 0; background: none; text-align: left; cursor: pointer; }
.mm-keys td { padding: 3px 12px 3px 0; }

/* ── publish ─────────────────────────────────────────────────────────── */
.mm-step { padding: 12px 14px; margin-bottom: 10px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; }
.mm-step.ok { border-color: rgba(47, 191, 113, 0.5); }
.mm-step-n {
	display: inline-grid;
	place-items: center;
	width: 24px;
	height: 24px;
	border-radius: 50%;
	background: rgba(255, 209, 102, 0.2);
	color: #ffd166;
	letter-spacing: 0;
}
.mm-step.ok .mm-step-n { background: #2fbf71; color: #04140b; }
.mm-checklist { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.mm-checklist li::before { display: inline-block; width: 20px; }
.mm-checklist li.ok::before { content: "✓"; color: #6fe3a3; }
.mm-checklist li.bad::before { content: "○"; color: #ffc46e; }
.mm-media { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.mm-media-item { margin: 0; width: 200px; border: 2px solid rgba(255, 255, 255, 0.1); border-radius: 8px; overflow: hidden; background: #000; }
.mm-media-item.picked { border-color: #2fbf71; }
.mm-media-item img, .mm-media-item video { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; image-rendering: pixelated; }
.mm-media-item.fixed img { object-fit: contain; background: #0c0f14; }
.mm-media-item figcaption { display: flex; justify-content: space-between; gap: 8px; padding: 7px 8px; font-size: var(--mm-fs-sm); background: rgba(0, 0, 0, 0.6); }
.mm-media-item figcaption button:first-child { border: 0; background: none; cursor: pointer; padding: 0; color: #fff; }
.mm-send { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.mm-token { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.mm-token input { flex: 1 1 260px; }
.mm-token p { flex-basis: 100%; margin: 0; }
.mm-device { text-align: center; }
.mm-code { display: inline-block; margin: 6px 0; padding: 8px 18px; border: 1px dashed #ffd166; border-radius: 8px; font-size: 26px; letter-spacing: 0.2em; color: #ffd166; user-select: all; }
.mm-success { color: #6fe3a3; line-height: 1.5; }
.mm-success a { color: #6fe3a3; }
.mm-success pre, .mm-preview pre {
	padding: 10px;
	border-radius: 7px;
	background: rgba(0, 0, 0, 0.4);
	color: #e8e8e8;
	white-space: pre-wrap;
	word-break: break-word;
	font-size: var(--mm-fs-sm);
}
.mm-error { color: #ff8a8a; line-height: 1.5; }
.mm-working { color: #ffd166; }
.mm-preview summary { cursor: pointer; color: rgba(255, 255, 255, 0.7); }

/* ── play-test ───────────────────────────────────────────────────────── */
.mm-playtest { position: fixed; inset: 0; display: flex; flex-direction: column; background: #000; }
.mm-playtest-bar {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 7px 12px;
	background: #10151c;
	border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	flex-wrap: wrap;
}
.mm-playtest-title { font-size: var(--mm-fs-sm); color: rgba(255, 255, 255, 0.8); }
.mm-playtest-frame { flex: 1 1 auto; width: 100%; border: 0; background: #000; }
.mm-rec.on { border-color: #ff5d5d; color: #ff8a8a !important; animation: mm-pulse 1.2s ease-in-out infinite; }
@keyframes mm-pulse { 50% { background: rgba(255, 93, 93, 0.2); } }
.mm-toast {
	position: fixed;
	bottom: 24px;
	left: 50%;
	transform: translateX(-50%);
	padding: 9px 16px;
	border-radius: 8px;
	background: rgba(10, 12, 16, 0.92);
	border: 1px solid rgba(255, 209, 102, 0.4);
	color: #ffd166;
	pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
	.mm-rec.on { animation: none; }
}

/* ── narrow screens ──────────────────────────────────────────────────── */
@media (max-width: 1500px) {
	.mm-swatch span { display: none; }
	.mm-swatch canvas { width: 46px; height: 31px; }
	.mm-name { width: 180px; }
	.mm-bar { gap: 8px; }
}
@media (max-width: 900px) {
	.mm-body { flex-direction: column; }
	.mm-rail { flex: 0 0 auto; flex-direction: row; border-right: 0; border-bottom: 1px solid rgba(255, 255, 255, 0.08); overflow-x: auto; }
	.mm-tool { flex: 0 0 76px; }
	.mm-rail-sep { width: 1px; height: auto; margin: 4px; }
	.mm-stage { min-height: 55vh; }
	.mm-side { flex: 0 0 auto; max-height: 40vh; border-left: 0; border-top: 1px solid rgba(255, 255, 255, 0.08); }
	.mm-name { width: 140px; }
	.mm-swatch span { display: none; }
}
`;

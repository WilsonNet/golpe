/**
 * The sprite workshop's stylesheet, injected by `SpriteSlicer` the way the
 * menu and the deck inject theirs.
 *
 * Same tokens as the rest of the game's UI — the gold #ffd166, the teal
 * #0ec3c9 hover, monospace, small-caps section heads — but this is a
 * workbench, not a menu: full-bleed, two panes, no veil. The canvas is the
 * star; the sidebar is a stack of narrow panels.
 */

export const SLICER_CSS = `
.vsw-root {
	position: fixed;
	inset: 0;
	z-index: 50;
	display: flex;
	flex-direction: column;
	font-family: monospace;
	font-size: 13px;
	color: rgba(255, 255, 255, 0.92);
	background:
		radial-gradient(1000px 600px at 70% -10%, rgba(38, 84, 96, 0.4), rgba(0, 0, 0, 0) 60%),
		linear-gradient(180deg, #101b24 0%, #0b0b0e 70%, #050507 100%);
}

.vsw-bar {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 8px 14px;
	border-bottom: 1px solid rgba(255, 255, 255, 0.12);
	background: rgba(0, 0, 0, 0.35);
	flex: 0 0 auto;
}

.vsw-logo {
	font-size: 15px;
	letter-spacing: 0.18em;
	text-transform: uppercase;
	color: #ffd166;
	margin-right: 8px;
}

.vsw-board-label {
	font-size: 11px;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	opacity: 0.55;
}

.vsw-select {
	background: #000;
	color: inherit;
	font: inherit;
	font-size: 13px;
	padding: 7px 10px;
	border: 1px solid rgba(255, 255, 255, 0.3);
	border-radius: 6px;
	max-width: 280px;
}

.vsw-btn {
	flex: 0 0 auto;
	font-size: 13px;
	padding: 7px 14px;
}

.vsw-back {
	text-decoration: none;
}

.vsw-status {
	flex: 1;
	text-align: right;
	font-size: 12px;
	opacity: 0.7;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.vsw-body {
	flex: 1;
	min-height: 0;
	display: grid;
	grid-template-columns: minmax(0, 1fr) 356px;
	/* The single row must be bounded, or the sidebar's own scroll never
	   engages and the whole page scrolls instead. */
	grid-template-rows: minmax(0, 1fr);
	gap: 12px;
	padding: 12px;
}

.vsw-workspace {
	min-height: 0;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.vsw-viewport {
	flex: 1;
	min-height: 0;
	border: 1px solid rgba(255, 255, 255, 0.14);
	border-radius: 8px;
	background: #0a0a0d;
	overflow: hidden;
	touch-action: none;
}

.vsw-sheet {
	display: block;
	width: 100%;
	height: 100%;
}

.vsw-readout {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	min-height: 28px;
	font-size: 12px;
	opacity: 0.85;
}

.vsw-zoom {
	display: flex;
	align-items: center;
	gap: 6px;
}

.vsw-mini {
	flex: 0 0 auto;
	font-size: 12px;
	padding: 4px 9px;
}

.vsw-zoom-num {
	min-width: 44px;
	text-align: right;
	font-variant-numeric: tabular-nums;
}

/* The strip is a canvas at its natural size — stretching it with width:100%
   would upscale the pixels with smoothing. The wrapper scrolls; the canvas
   centres itself. */
.vsw-film-wrap {
	overflow-x: auto;
	border: 1px solid rgba(255, 255, 255, 0.14);
	border-radius: 8px;
	background: #0a0a0d;
}

.vsw-film {
	display: block;
	margin: 0 auto;
	cursor: pointer;
}

.vsw-side {
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.vsw-panel {
	border: 1px solid rgba(255, 255, 255, 0.14);
	border-radius: 8px;
	background: rgba(0, 0, 0, 0.3);
	padding: 12px 14px;
}

.vsw-head {
	margin: 0 0 10px;
	font-size: 12px;
	font-weight: normal;
	letter-spacing: 0.16em;
	text-transform: uppercase;
	color: #ffd166;
}

.vsw-chips {
	margin-bottom: 10px;
	flex-wrap: wrap;
}

.vsw-grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 6px 10px;
	margin: 4px 0 6px;
}

.vsw-num,
.vsw-inline-num {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 11px;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	opacity: 0.75;
}

.vsw-num input,
.vsw-inline-num input {
	width: 72px;
	background: #000;
	color: inherit;
	font: inherit;
	font-size: 12px;
	padding: 5px 7px;
	border: 1px solid rgba(255, 255, 255, 0.25);
	border-radius: 5px;
}

.vsw-num input:focus,
.vsw-inline-num input:focus,
.vsw-label input:focus {
	outline: none;
	border-color: #0ec3c9;
}

.vsw-inline-num input {
	width: 58px;
}

.vsw-row {
	display: flex;
	align-items: center;
	gap: 10px;
	flex-wrap: wrap;
	margin-bottom: 8px;
}

.vsw-check {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 12px;
	opacity: 0.85;
	cursor: pointer;
}

.vsw-swatch {
	width: 18px;
	height: 18px;
	border-radius: 4px;
	border: 1px solid rgba(255, 255, 255, 0.4);
}

.vsw-hint {
	margin: 4px 0 8px;
	font-size: 11px;
	line-height: 1.55;
	opacity: 0.55;
}

.vsw-hint code {
	color: #7ff0f4;
}

.vsw-rects .vsw-hint {
	margin-bottom: 6px;
}

.vsw-rect-list {
	list-style: none;
	margin: 0 0 8px;
	padding: 0;
	max-height: 150px;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.vsw-rect-list li {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 4px 8px;
	border: 1px solid rgba(255, 255, 255, 0.1);
	border-radius: 5px;
	font-size: 11px;
	cursor: pointer;
	font-variant-numeric: tabular-nums;
}

.vsw-rect-list li:hover {
	border-color: rgba(255, 209, 102, 0.5);
}

.vsw-rect-on,
.vsw-rect-on:hover {
	border-color: #ffd166;
	background: rgba(255, 209, 102, 0.1);
}

.vsw-del {
	color: #ff8f6b;
	border-color: rgba(255, 143, 107, 0.4);
}

.vsw-detail {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-top: 2px;
}

.vsw-detail canvas {
	width: 132px;
	height: 132px;
	border: 1px solid rgba(255, 255, 255, 0.14);
	border-radius: 6px;
	background: #17171c;
}

.vsw-detail-note {
	font-size: 11px;
	opacity: 0.55;
}

.vsw-clip-edit {
	margin-top: 8px;
}

.vsw-label {
	display: flex;
	flex-direction: column;
	gap: 4px;
	font-size: 11px;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	opacity: 0.75;
	margin-bottom: 8px;
}

.vsw-label input {
	width: 100%;
	box-sizing: border-box;
	background: #000;
	color: inherit;
	font: inherit;
	font-size: 13px;
	padding: 6px 8px;
	border: 1px solid rgba(255, 255, 255, 0.25);
	border-radius: 5px;
	text-transform: none;
	letter-spacing: 0;
}

.vsw-name {
	flex: 1;
}

.vsw-err {
	margin: -4px 0 6px;
	font-size: 11px;
	color: #ff8f6b;
	min-height: 1em;
}

.vsw-stage-wrap {
	margin-top: 10px;
}

.vsw-stage {
	display: block;
	width: 100%;
	aspect-ratio: 4 / 3;
	border: 1px solid rgba(255, 255, 255, 0.14);
	border-radius: 6px;
	background: #9fd8ea;
}

.vsw-stage-zoom {
	margin: 6px 0 0;
}

.vsw-json {
	box-sizing: border-box;
	width: 100%;
	max-height: 220px;
	overflow: auto;
	margin: 6px 0 0;
	padding: 8px 10px;
	background: #000;
	border: 1px solid rgba(255, 255, 255, 0.12);
	border-radius: 6px;
	font-size: 10px;
	line-height: 1.5;
	color: rgba(255, 255, 255, 0.7);
}

@media (max-width: 900px) {
	.vsw-body {
		grid-template-columns: minmax(0, 1fr);
		overflow-y: auto;
	}
	.vsw-viewport {
		min-height: 420px;
	}
	.vsw-side {
		overflow-y: visible;
	}
}
`;

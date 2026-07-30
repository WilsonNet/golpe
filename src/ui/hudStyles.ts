/**
 * Shared CSS for the deathmatch overlay.
 *
 * Injected as a `<style>` element by each component that needs it, the way the
 * training panel does — the game ships one global stylesheet for the page shell
 * and nothing else, and an overlay that only exists in one mode should carry its
 * own appearance rather than growing that file.
 *
 * Every class is prefixed `vd-` (vento deathmatch) so it cannot collide with the
 * training panel's `vt-` rules.
 */

export const HUD_CSS = `
.vd-veil {
	position: fixed;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.72);
	z-index: 40;
	font-family: monospace;
	color: rgba(255, 255, 255, 0.92);
}
.vd-card {
	background: #0b0b0e;
	border: 1px solid rgba(255, 255, 255, 0.25);
	border-radius: 10px;
	padding: 28px 32px;
	min-width: 340px;
	box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6);
}
.vd-title {
	font-size: 22px;
	letter-spacing: 0.08em;
	margin: 0 0 6px;
	text-transform: uppercase;
}
.vd-sub {
	font-size: 13px;
	opacity: 0.6;
	margin: 0 0 20px;
	line-height: 1.5;
}
.vd-input {
	width: 100%;
	box-sizing: border-box;
	background: #000;
	color: inherit;
	font: inherit;
	font-size: 20px;
	padding: 12px 14px;
	border: 1px solid rgba(255, 255, 255, 0.35);
	border-radius: 6px;
}
.vd-input:focus {
	outline: none;
	border-color: #0ec3c9;
}
.vd-row-actions {
	display: flex;
	gap: 10px;
	align-items: center;
	margin-top: 18px;
}
.vd-btn {
	flex: 1;
	background: #000;
	color: inherit;
	font: inherit;
	font-size: 16px;
	padding: 12px;
	border: 1px solid rgba(255, 255, 255, 0.4);
	border-radius: 6px;
	cursor: pointer;
	transition: border-color 0.2s, color 0.2s;
}
.vd-btn:hover:not(:disabled) {
	border-color: #0ec3c9;
	color: #0ec3c9;
}
.vd-btn:disabled {
	cursor: not-allowed;
	opacity: 0.4;
}
.vd-error {
	color: #ff8f6b;
	font-size: 13px;
	margin-top: 10px;
	min-height: 1em;
}

/* ---- the invitation ----
   Rooms are addressed by id rather than matchmade, so this link is the only way
   one player reaches another. It is part of the prompt, not a detail under it. */
.vd-share {
	margin-top: 20px;
	padding-top: 16px;
	border-top: 1px solid rgba(255, 255, 255, 0.14);
}
.vd-share-label {
	font-size: 11px;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	opacity: 0.5;
	margin-bottom: 8px;
}
.vd-share-row {
	display: flex;
	gap: 8px;
}
.vd-share-link {
	font-size: 12px;
	padding: 9px 10px;
	opacity: 0.85;
}
.vd-copy {
	flex: 0 0 auto;
	font-size: 13px;
	padding: 9px 16px;
}
.vd-share-note {
	font-size: 12px;
	color: #7ff0f4;
	min-height: 1.2em;
	margin-top: 8px;
}
.vd-room {
	opacity: 0.45;
	text-transform: none;
	letter-spacing: 0;
}

/* ---- scoreboard ---- */
.vd-board {
	position: fixed;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	pointer-events: none;
	z-index: 30;
	font-family: monospace;
	color: rgba(255, 255, 255, 0.92);
}
.vd-board-card {
	background: rgba(8, 8, 12, 0.93);
	border: 1px solid rgba(255, 255, 255, 0.2);
	border-radius: 10px;
	padding: 20px 24px;
	min-width: 460px;
	max-height: 88vh;
	overflow-y: auto;
}
.vd-board-head {
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	margin-bottom: 14px;
	font-size: 13px;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	opacity: 0.65;
}
.vd-table {
	width: 100%;
	border-collapse: collapse;
	font-size: 14px;
}
.vd-table th {
	text-align: left;
	font-weight: normal;
	font-size: 11px;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	opacity: 0.45;
	padding: 0 8px 8px;
	border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
.vd-table td {
	padding: 5px 8px;
	border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.vd-num {
	text-align: right;
	font-variant-numeric: tabular-nums;
}
.vd-me {
	background: rgba(14, 195, 201, 0.14);
	color: #7ff0f4;
}
.vd-tag {
	font-size: 10px;
	opacity: 0.5;
	margin-left: 6px;
}
.vd-dead {
	opacity: 0.45;
}

/* ---- podium ----
   The winner's name is the thing a player remembers, and second and third are
   the places people actually argue about — so those three names are set well
   above the rest of the field rather than being three more table rows. */
.vd-podium {
	display: flex;
	align-items: flex-end;
	justify-content: center;
	gap: 14px;
	margin: 4px 0 26px;
}
.vd-place {
	flex: 1;
	text-align: center;
	border: 1px solid rgba(255, 255, 255, 0.16);
	border-radius: 8px;
	padding: 14px 10px 12px;
	background: rgba(255, 255, 255, 0.03);
}
.vd-place-rank {
	font-size: 11px;
	letter-spacing: 0.16em;
	opacity: 0.55;
	margin-bottom: 6px;
}
.vd-place-name {
	font-weight: bold;
	line-height: 1.15;
	word-break: break-word;
}
.vd-place-frags {
	font-size: 12px;
	opacity: 0.6;
	margin-top: 6px;
	font-variant-numeric: tabular-nums;
}
.vd-place-1 {
	/* Taller and wider than the other two: the winner should read first. */
	flex: 1.25;
	padding-top: 22px;
	border-color: rgba(255, 209, 102, 0.75);
	background: rgba(255, 209, 102, 0.09);
}
.vd-place-1 .vd-place-name {
	/* Overridden per name by MatchOver when the name is too long to fit. */
	font-size: 28px;
	color: #ffd166;
}
.vd-place-2 .vd-place-name {
	font-size: 24px;
	color: #dfe6ee;
}
.vd-place-3 .vd-place-name {
	font-size: 24px;
	color: #e2b184;
}
.vd-rest-head {
	font-size: 11px;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	opacity: 0.45;
	margin: 0 0 6px;
}
.vd-next {
	margin-top: 18px;
	font-size: 12px;
	opacity: 0.55;
	text-align: center;
}
.vd-hint {
	position: fixed;
	bottom: 10px;
	left: 50%;
	transform: translateX(-50%);
	font-family: monospace;
	font-size: 12px;
	color: rgba(255, 255, 255, 0.45);
	pointer-events: none;
	z-index: 20;
}
`;

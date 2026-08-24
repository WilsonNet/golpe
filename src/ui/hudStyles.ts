/**
 * Shared CSS for the deathmatch overlay.
 *
 * Injected as a `<style>` element by each component that needs it, the way the
 * training panel does — the game ships one global stylesheet for the page shell
 * and nothing else, and an overlay that only exists in one mode should carry its
 * own appearance rather than growing that file.
 *
 * Every class is prefixed `gd-` (golpe deathmatch) so it cannot collide with the
 * training panel's `gt-` rules.
 */

export const HUD_CSS = `
.gd-veil {
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
.gd-card {
	background: #0b0b0e;
	border: 1px solid rgba(255, 255, 255, 0.25);
	border-radius: 10px;
	padding: 28px 32px;
	min-width: 340px;
	box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6);
}
.gd-title {
	font-size: 22px;
	letter-spacing: 0.08em;
	margin: 0 0 6px;
	text-transform: uppercase;
}
.gd-sub {
	font-size: 13px;
	opacity: 0.6;
	margin: 0 0 20px;
	line-height: 1.5;
}
.gd-input {
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
.gd-input:focus {
	outline: none;
	border-color: #0ec3c9;
}
.gd-row-actions {
	display: flex;
	gap: 10px;
	align-items: center;
	margin-top: 18px;
}
.gd-btn {
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
.gd-btn:hover:not(:disabled) {
	border-color: #0ec3c9;
	color: #0ec3c9;
}
.gd-btn:disabled {
	cursor: not-allowed;
	opacity: 0.4;
}
.gd-error {
	color: #ff8f6b;
	font-size: 13px;
	margin-top: 10px;
	min-height: 1em;
}

/* ---- the invitation ----
   Rooms are addressed by id rather than matchmade, so this link is the only way
   one player reaches another. It is part of the prompt, not a detail under it. */
.gd-share {
	margin-top: 20px;
	padding-top: 16px;
	border-top: 1px solid rgba(255, 255, 255, 0.14);
}
.gd-share-label {
	font-size: 11px;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	opacity: 0.5;
	margin-bottom: 8px;
}
.gd-share-row {
	display: flex;
	gap: 8px;
}
.gd-share-link {
	font-size: 12px;
	padding: 9px 10px;
	opacity: 0.85;
}
.gd-copy {
	flex: 0 0 auto;
	font-size: 13px;
	padding: 9px 16px;
}
.gd-share-note {
	font-size: 12px;
	color: #7ff0f4;
	min-height: 1.2em;
	margin-top: 8px;
}
.gd-room {
	opacity: 0.45;
	text-transform: none;
	letter-spacing: 0;
}

/* ---- scoreboard ---- */
.gd-board {
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
.gd-board-card {
	background: rgba(8, 8, 12, 0.93);
	border: 1px solid rgba(255, 255, 255, 0.2);
	border-radius: 10px;
	padding: 20px 24px;
	/* Six columns now (frags, deaths, damage, denies, blocked) — the four
	   original ones fit 460px, the stat rows want a hair more. */
	min-width: 580px;
	max-height: 88vh;
	overflow-y: auto;
}
.gd-board-head {
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	/* The team header is half again as long as the deathmatch one, and without a
	   gap the clock butted straight up against the room id. */
	gap: 18px;
	margin-bottom: 14px;
	font-size: 13px;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	opacity: 0.65;
}
.gd-table {
	width: 100%;
	border-collapse: collapse;
	font-size: 14px;
}
.gd-table th {
	text-align: left;
	font-weight: normal;
	font-size: 11px;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	opacity: 0.45;
	padding: 0 8px 8px;
	border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
.gd-table td {
	padding: 5px 8px;
	border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.gd-num {
	text-align: right;
	font-variant-numeric: tabular-nums;
}
.gd-me {
	background: rgba(14, 195, 201, 0.14);
	color: #7ff0f4;
}
.gd-tag {
	font-size: 10px;
	opacity: 0.5;
	margin-left: 6px;
}
.gd-dead {
	opacity: 0.45;
}

/* ---- team blocks on the scoreboard and the podium ----
   A team match is two scoreboards, not one with a colour column: the question
   "are we winning" is about a side, and answering it should not require reading
   sixteen rows and adding them up. The rounds are the headline; the individual
   rows underneath are the same ranking a free-for-all shows. */
.gd-team-block {
	margin-bottom: 14px;
}
.gd-team-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 10px;
	margin-bottom: 6px;
	padding: 4px 8px;
	border-left: 3px solid currentColor;
	background: rgba(255, 255, 255, 0.04);
	font-size: 13px;
	letter-spacing: 0.12em;
	text-transform: uppercase;
}
.gd-team-rounds {
	font-size: 18px;
	font-weight: bold;
	font-variant-numeric: tabular-nums;
}
.gd-team-alive {
	font-size: 11px;
	letter-spacing: 0.08em;
	opacity: 0.7;
}
/* The winning side's banner on the podium, above the individual places. The
   match was won by a team; the MVP is the footnote, not the headline. */
.gd-team-banner {
	text-align: center;
	font-size: 26px;
	font-weight: bold;
	letter-spacing: 0.14em;
	margin-bottom: 4px;
}
.gd-team-final {
	text-align: center;
	font-size: 15px;
	font-variant-numeric: tabular-nums;
	opacity: 0.8;
	margin-bottom: 18px;
}

/* ---- podium ----
   The winner's name is the thing a player remembers, and second and third are
   the places people actually argue about — so those three names are set well
   above the rest of the field rather than being three more table rows. */
.gd-podium {
	display: flex;
	align-items: flex-end;
	justify-content: center;
	gap: 14px;
	margin: 4px 0 26px;
}
.gd-place {
	flex: 1;
	text-align: center;
	border: 1px solid rgba(255, 255, 255, 0.16);
	border-radius: 8px;
	padding: 14px 10px 12px;
	background: rgba(255, 255, 255, 0.03);
}
.gd-place-rank {
	font-size: 11px;
	letter-spacing: 0.16em;
	opacity: 0.55;
	margin-bottom: 6px;
}
.gd-place-name {
	font-weight: bold;
	line-height: 1.15;
	word-break: break-word;
}
.gd-place-frags {
	font-size: 12px;
	opacity: 0.6;
	margin-top: 6px;
	font-variant-numeric: tabular-nums;
}
.gd-place-1 {
	/* Taller and wider than the other two: the winner should read first. */
	flex: 1.25;
	padding-top: 22px;
	border-color: rgba(255, 209, 102, 0.75);
	background: rgba(255, 209, 102, 0.09);
}
.gd-place-1 .gd-place-name {
	/* Overridden per name by MatchOver when the name is too long to fit. */
	font-size: 28px;
	color: #ffd166;
}
.gd-place-2 .gd-place-name {
	font-size: 24px;
	color: #dfe6ee;
}
.gd-place-3 .gd-place-name {
	font-size: 24px;
	color: #e2b184;
}
.gd-rest-head {
	font-size: 11px;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	opacity: 0.45;
	margin: 0 0 6px;
}
.gd-next {
	margin-top: 18px;
	font-size: 12px;
	opacity: 0.55;
	text-align: center;
}
/* ---- esc menu and the controls dialog ----
   Darker veil than the name prompt's: this one goes over a live fight, and the
   fight staying visible behind it was reading as "the game is still taking my
   input", which is exactly what it is not doing. */
.gd-menu-veil {
	background: rgba(0, 0, 0, 0.82);
	z-index: 45;
}
.gd-menu-card {
	min-width: 420px;
	/* Capped, or the binding table's full-width rule lets the card fill the whole
	   veil and strands each action's label a screen away from its own slots. */
	max-width: 620px;
	/* Eleven actions, three slots each and two settings above them do not fit on
	   a phone in portrait. The card scrolls; the veil does not. */
	max-height: 88vh;
	max-height: 88dvh;
	overflow-y: auto;
	box-sizing: border-box;
}
/* On a narrow screen the card is the screen, and a min-width wider than it is
   what makes a dialog scroll sideways. */
@media (max-width: 520px) {
	.gd-card {
		min-width: 0;
		padding: 18px 16px;
	}
	.gd-menu-card {
		min-width: 0;
		width: 100%;
	}
	/* Three slots and a label do not fit on one line at 390px. The row becomes a
	   block — label above, its three slots in a grid below — rather than a table
	   the player has to scroll sideways to reach the gamepad column of. */
	.gd-bind-table,
	.gd-bind-table tbody {
		display: block;
	}
	.gd-bind-table tr {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 6px;
		margin-bottom: 12px;
	}
	.gd-bind-table th {
		display: block;
		grid-column: 1 / -1;
		padding: 0 0 2px;
		white-space: normal;
	}
	.gd-bind-table td {
		display: block;
		width: auto;
		padding: 0;
	}
	.gd-setting-head {
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
	}
}
.gd-menu-list {
	display: flex;
	flex-direction: column;
	gap: 10px;
}
/* Exiting a match is the one destructive choice in the Esc menu — the fighter
   leaves the room. The confirm says what that means in the same sentence it
   asks in, and the red is the only red button in the whole UI. */
.gd-exit-note {
	margin: 2px 0 -2px;
}
.gd-exit-yes {
	border-color: rgba(255, 143, 107, 0.6);
	color: #ff8f6b;
}
.gd-exit-yes:hover:not(:disabled) {
	border-color: #ff8f6b;
	color: #ff8f6b;
}
/* ---- a setting with a small set of answers ----
   Chips rather than a <select>, because both of these are things a player flips
   back and forth while working out which they prefer, and a dropdown hides the
   alternative behind a click. */
.gd-setting {
	margin: 0 0 14px;
	padding-bottom: 12px;
	border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.gd-setting-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	font-size: 13px;
}
.gd-choice {
	display: flex;
	gap: 6px;
}
.gd-chip {
	background: #000;
	color: inherit;
	font: inherit;
	font-size: 12px;
	padding: 6px 12px;
	border: 1px solid rgba(255, 255, 255, 0.3);
	border-radius: 999px;
	cursor: pointer;
	white-space: nowrap;
}
.gd-chip:hover {
	border-color: #0ec3c9;
	color: #0ec3c9;
}
.gd-chip-on,
.gd-chip-on:hover {
	border-color: #ffd166;
	color: #ffd166;
	background: rgba(255, 209, 102, 0.12);
}
.gd-setting-hint {
	font-size: 12px;
	opacity: 0.55;
	line-height: 1.5;
	margin: 8px 0 0;
}

.gd-bind-table {
	width: 100%;
	border-collapse: collapse;
	font-size: 13px;
}
.gd-bind-table th {
	text-align: left;
	font-weight: normal;
	opacity: 0.75;
	padding: 4px 12px 4px 0;
	white-space: nowrap;
}
.gd-bind-table td {
	padding: 4px 0 4px 8px;
	width: 8em;
}
.gd-slot {
	width: 100%;
	background: #000;
	color: inherit;
	font: inherit;
	font-size: 13px;
	padding: 7px 8px;
	border: 1px solid rgba(255, 255, 255, 0.3);
	border-radius: 5px;
	cursor: pointer;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.gd-slot:hover {
	border-color: #0ec3c9;
	color: #0ec3c9;
}
.gd-slot-empty {
	opacity: 0.4;
}
/* Listening. The colour is the whole feedback: nothing else on screen changes
   while the next button press is being waited for — and the hover rule has to be
   restated, because a pseudo-class beats a bare class on specificity and the
   cursor is by definition sitting on the slot that was just clicked. */
.gd-slot-live,
.gd-slot-live:hover {
	border-color: #ffd166;
	color: #ffd166;
}
.gd-note {
	font-size: 12px;
	color: #7ff0f4;
	min-height: 1.2em;
	margin-top: 12px;
}
/* ---- the sound mixer ----
   Shared by the Esc menu's Sound item and the root menu's Sound button: one
   component, one store, one look. Sliders are tiny, thumbed and gold — the
   input that matters gets the colour everything else on the menu wears. */
.gd-sound {
	display: flex;
	flex-direction: column;
	gap: 12px;
	min-width: 380px;
}
.gd-sound-row {
	display: grid;
	grid-template-columns: 110px 1fr 44px 46px;
	gap: 14px;
	align-items: center;
}
.gd-sound-row-label {
	font-size: 13px;
	opacity: 0.78;
}
.gd-sound-slider {
	-webkit-appearance: none;
	appearance: none;
	width: 100%;
	height: 4px;
	border-radius: 2px;
	background: rgba(255, 255, 255, 0.25);
	outline: none;
	cursor: pointer;
}
.gd-sound-slider:focus-visible {
	outline: 2px solid #0ec3c9;
	outline-offset: 2px;
}
.gd-sound-slider::-webkit-slider-thumb {
	-webkit-appearance: none;
	appearance: none;
	width: 14px;
	height: 14px;
	border-radius: 50%;
	background: #ffd166;
	border: 1px solid rgba(0, 0, 0, 0.4);
}
.gd-sound-slider::-moz-range-thumb {
	width: 14px;
	height: 14px;
	border-radius: 50%;
	background: #ffd166;
	border: 1px solid rgba(0, 0, 0, 0.4);
}
.gd-sound-val {
	font-size: 12px;
	text-align: right;
	opacity: 0.7;
	font-variant-numeric: tabular-nums;
}
.gd-sound-btn {
	background: #000;
	color: inherit;
	font: inherit;
	font-size: 11px;
	padding: 4px 8px;
	border: 1px solid rgba(255, 255, 255, 0.3);
	border-radius: 6px;
	cursor: pointer;
	white-space: nowrap;
}
.gd-sound-btn:hover {
	border-color: #0ec3c9;
	color: #0ec3c9;
}
.gd-sound-btn-on,
.gd-sound-btn-on:hover {
	border-color: #ffd166;
	color: #ffd166;
}
.gd-sound-foot {
	display: flex;
	gap: 10px;
}
`;

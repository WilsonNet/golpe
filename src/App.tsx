import { useState } from "react";
import { GameCanvas } from "./GameCanvas";
import { MatchOver } from "./ui/MatchOver";
import { NamePrompt } from "./ui/NamePrompt";
import { PauseMenu } from "./ui/PauseMenu";
import { Scoreboard } from "./ui/Scoreboard";
import { TouchControls } from "./ui/TouchControls";
import { TrainingPanel } from "./ui/TrainingPanel";
import { UltimateCinematic } from "./ui/UltimateCinematic";

/**
 * Both spellings of the flag, matched exactly as `Match` matches them.
 *
 * Read from the URL rather than asked of the game: the overlay mounts before
 * the Pixi application has finished its async boot, so asking the match would
 * mean rendering nothing on the first frame and flashing the panel in after it.
 */
function isTrainingMode(): boolean {
	const params = new URLSearchParams(window.location.search);
	return (
		params.get("training") === "true" || params.get("training-room") === "true"
	);
}

/**
 * The DOM overlay.
 *
 * Everything here is UI the canvas is the wrong tool for — a text field, a
 * sixteen-row table, a podium. The canvas HUD keeps only the two numbers a
 * player reads without looking away from the fight. See the `pixi-text-and-ui`
 * skill for the split.
 *
 * The deathmatch overlays render in every mode, including training: they draw
 * nothing until the game emits a match status, and a training room never does.
 */
function App() {
	const [training] = useState(isTrainingMode);

	return (
		<div id="app">
			<GameCanvas />
			{/* Directly after the canvas, because it is part of the *page* rather
			    than an overlay on it: the deck's presence is what turns a centred
			    canvas into a handheld, screen above and controls below. It draws
			    nothing at all unless this player is aiming like a controller. */}
			<TouchControls />
			{training ? <TrainingPanel /> : null}
			<Scoreboard />
			{/* Over the scoreboard, under the podium and the menu: a cutscene beats
			    a stat table, and nothing beats being able to leave. It is
			    `pointer-events: none` throughout, so it never takes a click from
			    anything it covers. */}
			<UltimateCinematic />
			<MatchOver />
			<NamePrompt />
			{/* Last, so it draws over the podium: a player who wants to rebind
			    something at the end of a match should not have to wait for the next
			    one to start. */}
			<PauseMenu />
		</div>
	);
}

export default App;

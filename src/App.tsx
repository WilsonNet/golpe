import { useState } from "react";
import { GameCanvas } from "./GameCanvas";
import { MatchOver } from "./ui/MatchOver";
import { NamePrompt } from "./ui/NamePrompt";
import { Scoreboard } from "./ui/Scoreboard";
import { TrainingPanel } from "./ui/TrainingPanel";

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
			{training ? <TrainingPanel /> : null}
			<Scoreboard />
			<MatchOver />
			<NamePrompt />
		</div>
	);
}

export default App;

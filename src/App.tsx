import { useEffect, useState } from "react";
import { GameCanvas } from "./GameCanvas";
import {
	isMenuShape,
	type LaunchParams,
	serializeLaunchParams,
} from "./game/online/launch";
import { installUiSounds, sound } from "./game/sound/facade";
import { FightHud } from "./ui/FightHud";
import { MainMenu } from "./ui/MainMenu";
import { MatchOver } from "./ui/MatchOver";
import { NamePrompt } from "./ui/NamePrompt";
import { PauseMenu } from "./ui/PauseMenu";
import { PlayOfTheGame } from "./ui/PlayOfTheGame";
import { Scoreboard } from "./ui/Scoreboard";
import { SpriteSlicer } from "./ui/SpriteSlicer";
import { TouchControls } from "./ui/TouchControls";
import { TrainingPanel } from "./ui/TrainingPanel";
import { UltimateCinematic } from "./ui/UltimateCinematic";
import { VictoryCard } from "./ui/VictoryCard";

/**
 * Both spellings of the flag, matched exactly as `Match` matches them.
 *
 * Read from the URL rather than asked of the game: the overlay mounts before
 * the Pixi application has finished its async boot, so asking the match would
 * mean rendering nothing on the first frame and flashing the panel in after it.
 * By the time `started` flips, the address bar already carries the committed
 * launch request, so reading here is reading the match the user asked for.
 */
function isTrainingMode(): boolean {
	const params = new URLSearchParams(window.location.search);
	return (
		params.get("training") === "true" || params.get("training-room") === "true"
	);
}

/**
 * The sprite workshop: a dev tool, not a match. `?slicer=true` shows it
 * instead of the game — no Pixi, no server, just raw boards, a grid, clips
 * and exports. See `docs/sprite-slicer.md`.
 */
function isSlicerMode(): boolean {
	const params = new URLSearchParams(window.location.search);
	return params.get("slicer") === "true";
}

/**
 * The DOM overlay.
 *
 * Everything here is UI the canvas is the wrong tool for — a text field, a
 * sixteen-row table, a podium, and the fight HUD itself: ornate frames, text
 * that stays crisp at any DPR, CSS transitions for bars and pulses. The world
 * (nameplates, aim beam) stays in Pixi; the *screen* UI is all DOM. See the
 * `hud-design` skill for the split.
 *
 * The deathmatch overlays render in every mode, including training: they draw
 * nothing until the game emits a match status, and a training room never does.
 *
 * **The root is a menu, not a match.** A URL with no launch request shows the
 * menu; committing a choice writes the URL first and then boots the game, so
 * the address bar is always the truth (see `online/launch.ts`). A URL that
 * already asks for a match boots straight into it — no menu, no ceremony —
 * which is how shared links and every automated probe behave.
 */
function App() {
	const [started, setStarted] = useState(
		() => !isMenuShape(window.location.search),
	);

	// The soundtrack follows the page: the root menu is the title theme; a
	// match hands the music to the local fighter's theme (Match re-points it).
	useEffect(() => {
		installUiSounds();
		sound.setMusic("title");
	}, []);

	/** Commit a menu choice: make the URL the launch request, then boot. */
	const launch = (params: LaunchParams) => {
		const url = new URL(window.location.href);
		url.search = serializeLaunchParams(params);
		window.history.replaceState(null, "", url.toString());
		setStarted(true);
	};

	/** Back to the menu: drop the launch request from the URL, stop the game. */
	const exitToMenu = () => {
		window.history.replaceState(null, "", window.location.pathname);
		setStarted(false);
	};

	if (isSlicerMode()) {
		return (
			<div id="app">
				<SpriteSlicer />
			</div>
		);
	}

	if (!started) {
		return (
			<div id="app">
				<MainMenu onLaunch={launch} />
			</div>
		);
	}

	const training = isTrainingMode();

	return (
		<div id="app">
			{/* The HUD lives inside the canvas's own box, so it scales with the
			    arena instead of drifting off it. */}
			<GameCanvas>
				<FightHud training={training} />
				{/* Inside the canvas box, like the HUD: the ceremony's letterbox frames
				    the *arena*, not the browser window, and a 4:3 game in a wide window
				    would otherwise get bars across the whole page. The victory card
				    sits under the Play of the Game overlay — the curtain closing is its
				    exit — so the two share the box and the z-order. */}
				<VictoryCard />
				<PlayOfTheGame />
			</GameCanvas>
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
			<PauseMenu onExitToMenu={exitToMenu} />
		</div>
	);
}

export default App;

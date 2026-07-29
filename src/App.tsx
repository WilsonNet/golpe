import { useEffect, useState } from "react";
import { GameCanvas } from "./GameCanvas";
import { EventBus } from "./game/EventBus";
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

function App() {
	const [bulletCount, setBulletCount] = useState(0);
	const [training] = useState(isTrainingMode);

	// Subscribed in an effect, not in the render body. Subscribing during render
	// added a fresh listener on every state change, so each shot was counted once
	// more than the one before it.
	useEffect(
		() => EventBus.on("bullet-fired", () => setBulletCount((c) => c + 1)),
		[],
	);

	return (
		<div id="app">
			<GameCanvas />
			{training ? <TrainingPanel /> : null}
			<div
				style={{
					position: "absolute",
					top: 0,
					right: 0,
					padding: "8px 16px",
					background: "rgba(0,0,0,0.7)",
					color: "#fff",
					fontFamily: "monospace",
					fontSize: "18px",
					borderRadius: "0 0 0 8px",
				}}
			>
				Bullets fired: {bulletCount}
			</div>
		</div>
	);
}

export default App;

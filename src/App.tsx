import { useEffect, useState } from "react";
import { GameCanvas } from "./GameCanvas";
import { EventBus } from "./game/EventBus";

function App() {
	const [bulletCount, setBulletCount] = useState(0);

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

import { useEffect, useRef } from "react";
import { type GameHandle, startGame } from "./game/app";

/**
 * Boot requests, run strictly one at a time.
 *
 * Startup is asynchronous — Pixi v8 requires `await app.init()` — and React
 * StrictMode mounts, unmounts and remounts in development. Left concurrent, two
 * `Match` instances get built and both install the `window.__physicsDiagnostic`
 * and `window.__gameState` hooks; whichever finishes last wins the hooks, which
 * is not necessarily the one that survives. The diagnostic then reads a match
 * that was already destroyed, and reports a fight frozen at 100 HP with no
 * opponent.
 *
 * Serialising means the first boot sees `disposed` before it does any work, so
 * exactly one application is ever created.
 */
let bootChain: Promise<void> = Promise.resolve();

export function GameCanvas() {
	const hostRef = useRef<HTMLDivElement>(null);
	const gameRef = useRef<GameHandle | null>(null);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		let disposed = false;

		bootChain = bootChain.then(async () => {
			if (disposed) return;
			const handle = await startGame(host);
			if (disposed) {
				handle.destroy();
				return;
			}
			gameRef.current = handle;
		});

		return () => {
			disposed = true;
			bootChain = bootChain.then(() => {
				gameRef.current?.destroy();
				gameRef.current = null;
			});
		};
	}, []);

	return <div id="game-container" ref={hostRef} />;
}

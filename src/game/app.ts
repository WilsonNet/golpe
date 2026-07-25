/**
 * Bootstrap: create the renderer, load what the game draws with, and run the
 * loop.
 *
 * Pixi has no scene manager, which is the point — there is exactly one screen
 * here and Phaser's Boot/Preloader/Game split existed only to satisfy the
 * framework's lifecycle. Initialisation is now a straight line: init, load,
 * build, tick.
 */

import { Application } from "pixi.js";
import { Match } from "./Match";
import { createFxTextures, loadAssets } from "./render/assets";
import { Stage } from "./render/Stage";

export const GAME_WIDTH = 800;
export const GAME_HEIGHT = 600;

export interface GameHandle {
	app: Application;
	match: Match;
	destroy: () => void;
}

export async function startGame(parent: HTMLElement): Promise<GameHandle> {
	const app = new Application();

	// v8 initialises asynchronously, and nothing — not even texture creation —
	// is valid before this resolves.
	await app.init({
		width: GAME_WIDTH,
		height: GAME_HEIGHT,
		background: 0x1d1f2a,
		antialias: false,
		// Crisp pixels matter more than a smooth upscale for 32x48 sprites.
		roundPixels: true,
		resolution: window.devicePixelRatio || 1,
		autoDensity: true,
	});

	parent.appendChild(app.canvas);
	app.canvas.style.width = "100%";
	app.canvas.style.height = "auto";
	app.canvas.style.display = "block";
	app.canvas.style.touchAction = "none";

	await loadAssets();
	createFxTextures(app.renderer);

	const stage = new Stage(app.stage);
	const match = new Match(stage, app.canvas);

	// The ticker hands over a Ticker, not a delta — `deltaMS` is real elapsed
	// milliseconds, which is what the fixed-timestep accumulator needs. Using
	// `deltaTime` (a 60fps-relative multiplier) would make the simulation run at
	// a different rate on every display.
	const tick = () => match.update(app.ticker.deltaMS);
	app.ticker.add(tick);

	return {
		app,
		match,
		destroy: () => {
			app.ticker.remove(tick);
			match.destroy();
			app.destroy(true, { children: true });
		},
	};
}

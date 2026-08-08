import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { defineConfig } from "vite";

export default defineConfig({
	base: "./",
	plugins: [
		react(),
		/**
		 * The React Compiler auto-memoises every component and hook, which
		 * makes the hand-written useCallback/useMemo in src/ui/ redundant —
		 * and lets new components skip them entirely. It runs through
		 * @rolldown/plugin-babel in both dev and prod (the preset pins
		 * `applyToEnvironmentHook` to the client consumer, so the server
		 * build never sees it), and its rolldown filter only touches files
		 * that look like components — the exact same `babel-plugin-react-compiler`
		 * version the optional peer of @vitejs/plugin-react demands.
		 */
		babel({ presets: [reactCompilerPreset()] }),
	],
	server: {
		port: 8084,
		/**
		 * Bind every interface, not just loopback.
		 *
		 * Vite's default is localhost, which makes the game unreachable from any
		 * other machine — so a LAN game failed at the first step, before any netcode
		 * was involved, with nothing but a browser timeout to explain it. The game
		 * server already binds `*:9208`; this is the half that did not.
		 *
		 * It does mean the dev server is exposed to the local network while it runs.
		 * That is the entire point of a LAN party, and it is a dev server: do not run
		 * it on a network you would not hand a shell to.
		 */
		host: true,
	},
	// Three libraries here keep global state and break outright if the dev
	// optimiser gives them two module instances:
	//   - pixi.js registers renderers and environment adapters in a global
	//     extension registry at import time; a second copy dies on boot with
	//     "Extension type environment already has a handler".
	//   - react/react-dom keep the hook dispatcher in module scope; a second copy
	//     fails with "Invalid hook call" and a null `useState`.
	// Both failures look like application bugs and are neither.
	optimizeDeps: {
		include: ["pixi.js", "react", "react-dom", "react-dom/client"],
	},
	resolve: {
		dedupe: ["pixi.js", "react", "react-dom"],
	},
});

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	base: "./",
	plugins: [react()],
	server: {
		port: 8080,
	},
	// Pixi registers its renderer and environment adapters through a global
	// extension registry at import time, so it must exist exactly once. Left to
	// itself the dev optimiser split pixi.js across two dep chunks, both of which
	// ran that registration — and the app died on boot with "Extension type
	// environment already has a handler". Pre-bundling it as one unit and
	// deduping the resolution keeps a single instance.
	optimizeDeps: {
		include: ["pixi.js"],
	},
	resolve: {
		dedupe: ["pixi.js"],
	},
});

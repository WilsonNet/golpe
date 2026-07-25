import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	base: "./",
	plugins: [react()],
	server: {
		port: 8080,
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

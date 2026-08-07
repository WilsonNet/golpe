import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	base: "./",
	plugins: [react()],
	logLevel: "warn",
	resolve: {
		// Global module state: Pixi's extension registry and React's hook
		// dispatcher both require exactly one instance.
		dedupe: ["pixi.js", "react", "react-dom"],
	},
	build: {
		// Vite 8 (rolldown) removed the object form of `manualChunks`; the
		// replacement is `codeSplitting.groups`. Pixi keeps its own chunk so
		// the big library ships once and browsers cache it between deploys.
		rolldownOptions: {
			output: {
				codeSplitting: {
					groups: [
						{
							name: "pixi",
							test: /node_modules[\\/]pixi\.js[\\/]/,
						},
					],
				},
			},
		},
		// esbuild minifies ~5-20x faster than terser for a couple of percent more
		// bytes — the extra passes were shaving kilobytes off a bundle nobody
		// reads on the wire. Fast rebuilds are the feedback loop.
		minify: "esbuild",
	},
});

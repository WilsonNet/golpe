import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	base: "./",
	plugins: [react()],
	logLevel: "warning",
	resolve: {
		// Pixi's extension registry is global and must have exactly one instance.
		dedupe: ["pixi.js"],
	},
	build: {
		rollupOptions: {
			output: {
				manualChunks: {
					pixi: ["pixi.js"],
				},
			},
		},
		minify: "terser",
		terserOptions: {
			compress: { passes: 2 },
			mangle: true,
			format: { comments: false },
		},
	},
});

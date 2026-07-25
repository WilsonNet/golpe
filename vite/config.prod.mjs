import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	base: "./",
	plugins: [react()],
	logLevel: "warning",
	resolve: {
		// Global module state: Pixi's extension registry and React's hook
		// dispatcher both require exactly one instance.
		dedupe: ["pixi.js", "react", "react-dom"],
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

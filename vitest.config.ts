import { defineConfig } from "vitest/config";

/**
 * Unit tests only: `src/`, `server/` and the LAN shell.
 *
 * The LAN pack stages a compiled copy of the tree under `build/`, tests
 * included, and Vitest's default glob would run those copies against paths that
 * no longer exist. The pack is measured by `scripts/lan-probe.ts`, not by
 * re-running the unit suite out of a staged folder.
 */
export default defineConfig({
	test: {
		include: [
			"src/**/*.test.{ts,tsx}",
			"server/**/*.test.ts",
			"lan/**/*.test.ts",
		],
		exclude: ["node_modules/**", "build/**", "dist/**", ".venv/**"],
	},
});

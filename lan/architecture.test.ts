/**
 * The LAN pack's architecture gate.
 *
 * A distribution that quietly grows its own copy of the game is the drift this
 * whole exercise exists to prevent. The pack may serve files, advertise mDNS
 * and print a URL; it may not tick a fighter, own a room, or read a tuning
 * constant. These checks are deliberately textual and boring: a dependency
 * cruiser would describe the same edges with more ceremony and no more truth.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist") continue;
			out.push(...walk(full));
		} else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
			out.push(full);
		}
	}
	return out;
}

function source(path: string): string {
	return readFileSync(path, "utf8");
}

const LAN_FILES = walk(join(ROOT, "lan")).filter(
	(path) => !path.endsWith(".test.ts"),
);

describe("the LAN pack is a distribution, not a fork", () => {
	it("uses the one game-server factory, not the production entry's side effects", () => {
		const main = source(join(ROOT, "lan", "main.ts"));
		expect(main).toContain('from "../server/GameServer.js"');
		expect(main).toContain("createGameServer(");
		expect(main).not.toContain('from "../server/index.js"');
	});

	it("contains no simulation, no room and no tuning constant", () => {
		for (const file of LAN_FILES) {
			const text = source(file);
			expect(text, file).not.toMatch(/\btickPlayer\s*\(/);
			expect(text, file).not.toMatch(/\bnew GameRoom\b/);
			expect(text, file).not.toMatch(/from\s+["'][^"']*\/tweakables\//);
			expect(text, file).not.toMatch(/from\s+["']pixi\.js/);
			expect(text, file).not.toMatch(/from\s+["']react(?:-dom)?["']/);
			expect(text, file).not.toMatch(/from\s+["'][^"']*\/src\/game\/render\//);
			expect(text, file).not.toMatch(/from\s+["'][^"']*\/src\/ui\//);
		}
	});

	it("never lets the server import the pack", () => {
		for (const file of walk(join(ROOT, "server"))) {
			expect(source(file), file).not.toMatch(/from\s+["'][^"']*\/lan\//);
		}
	});

	it("never lets the client depend on the pack", () => {
		for (const file of walk(join(ROOT, "src"))) {
			expect(source(file), file).not.toMatch(/from\s+["'][^"']*\/lan\//);
		}
	});
});

/**
 * The wire-bump gate.
 *
 * `PROTOCOL_VERSION` is the LAN handshake's other half. A change to the packed
 * snapshot or to the message shapes without a bump would let two "same
 * protocol" builds trade packets that mean different things — the exact silent
 * desync the build gate exists to stop. The build id catches differing builds,
 * but a protocol bump is what makes the difference *deliberate* and reviewable.
 *
 * Usage: `tsx scripts/check-protocol-bump.ts [--base origin/main]`
 *
 * On a pull request GitHub supplies `GITHUB_BASE_REF`; fetch the base with
 * full history first (`fetch-depth: 0`), or the diff is empty and this gate
 * cannot see what changed.
 */

import { execFileSync } from "node:child_process";

const WIRE_FILES = [
	"src/game/online/wire.ts",
	"src/game/online/types.ts",
	"src/game/online/protocol.ts",
];

function git(args: string[]): string {
	return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function env(name: string): string | undefined {
	return process.env[name];
}

function baseRef(): string {
	const arg = process.argv.indexOf("--base");
	if (arg !== -1) return process.argv[arg + 1] ?? "origin/main";
	const fromEnv = env("GITHUB_BASE_REF");
	if (fromEnv !== undefined && fromEnv.length > 0) {
		return `origin/${fromEnv}`;
	}
	return "origin/main";
}

function main(): void {
	const base = baseRef();
	let changed: string[];
	try {
		changed = git(["diff", "--name-only", `${base}...HEAD`]).split("\n");
	} catch {
		console.error(
			`[protocol] cannot diff against ${base} — fetch the base with full history`,
		);
		process.exitCode = 1;
		return;
	}

	const touched = changed.filter((file) => WIRE_FILES.includes(file));
	if (touched.length === 0) {
		console.log("[protocol] wire files untouched");
		return;
	}
	if (touched.includes("src/game/online/protocol.ts")) {
		console.log("[protocol] wire changed and protocol.ts was bumped");
		return;
	}
	console.error(
		`[protocol] wire files changed without a PROTOCOL_VERSION bump:\n  ${touched.join("\n  ")}`,
	);
	console.error(
		"[protocol] bump src/game/online/protocol.ts, then rebuild the LAN pack",
	);
	process.exitCode = 1;
}

main();

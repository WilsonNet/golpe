/**
 * Stage a LAN pack.
 *
 * The pack is a *distribution* of the one game server, not a second build of
 * it: the same Vite `dist`, the same `server/GameServer.ts`, the same
 * `src/game/simulation`. This script only copies, compiles and installs the
 * runtime dependencies — it never runs a LAN-specific transform over gameplay
 * code.
 *
 * Layout:
 *
 *   golpe-lan/
 *     golpe-lan(.bat)      launcher
 *     node(.exe)           the runtime the pack was built with
 *     dist/                the client
 *     server/              tsc output for `lan/` + `server/` + shared `src/`
 *     node_modules/        server runtime dependencies only
 *     build.json           commit + protocol identity
 *     SOURCE.txt           GPL source offer
 */

import { execFileSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { PROTOCOL_VERSION } from "../src/game/online/protocol";

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_OUT = join(ROOT, "build", "golpe-lan");
// A separate client output keeps the pack from overwriting the dev server's
// `dist`: `pnpm dev` says "dev", and a release build id in `dist` would make its
// own room fail the LAN gate. The pack has its own world.
const LAN_DIST = join(ROOT, "build", "lan-dist");
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function arg(name: string, fallback: string): string {
	const index = process.argv.indexOf(`--${name}`);
	if (index === -1) return fallback;
	return process.argv[index + 1] ?? fallback;
}

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

function run(command: string, args: string[], cwd = ROOT, env = process.env) {
	execFileSync(command, args, { cwd, stdio: "inherit", env });
}

function gitSha(): string {
	try {
		return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
			cwd: ROOT,
			encoding: "utf8",
		}).trim();
	} catch {
		return "dev";
	}
}

function cleanGit(): boolean {
	try {
		return (
			execFileSync("git", ["status", "--porcelain"], {
				cwd: ROOT,
				encoding: "utf8",
			}).trim().length === 0
		);
	} catch {
		return false;
	}
}

function directorySize(path: string): number {
	let total = 0;
	for (const entry of readdirSync(path, { withFileTypes: true })) {
		const full = join(path, entry.name);
		total += entry.isDirectory() ? directorySize(full) : statSync(full).size;
	}
	return total;
}

function humanSize(bytes: number): string {
	const mb = bytes / (1024 * 1024);
	return `${mb.toFixed(1)} MB`;
}

function writeLaunchers(out: string): void {
	const posix = join(out, "golpe-lan");
	writeFileSync(
		posix,
		`#!/bin/sh
# golpe LAN host — starts the pack, serves the client and opens the URL.
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$DIR/node" "$DIR/server/lan/main.js" "$@"
`,
	);
	chmodSync(posix, 0o755);

	if (process.platform === "win32") {
		writeFileSync(
			join(out, "golpe-lan.bat"),
			`@echo off\r\n"%~dp0node.exe" "%~dp0server\\lan\\main.js" %*\r\n`,
		);
	}
	if (process.platform === "darwin") {
		const command = join(out, "golpe-lan.command");
		cpSync(posix, command);
		chmodSync(command, 0o755);
	}
}

function writeManifest(out: string, build: string): void {
	const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
		version?: string;
	};
	writeFileSync(
		join(out, "build.json"),
		`${JSON.stringify(
			{
				build,
				protocol: PROTOCOL_VERSION,
				version: pkg.version ?? "0.0.0",
				builtAt: new Date().toISOString(),
				platform: process.platform,
				arch: process.arch,
				node: process.version,
			},
			null,
			2,
		)}\n`,
	);
	writeFileSync(
		join(out, "SOURCE.txt"),
		`golpe is GPL-3.0-only.

Source for this build:
  https://github.com/WilsonNet/golpe/tree/${build}

The pack is a distribution of that source, not a fork. The client in dist/ is
the same Vite build the hosted site serves; the server in server/ is the same
GameServer the hosted game runs.
`,
	);
	writeFileSync(
		join(out, "README.txt"),
		`golpe LAN host

1. Run golpe-lan (or golpe-lan.bat on Windows).
2. It prints a LAN URL and opens it here.
3. Host a match. Share that URL with everybody on the same network.

The URL is the invitation. Guests install nothing. Port 9208 (TCP and UDP) must
be allowed through the host's firewall; the first run may ask.

Build ${build}, protocol ${PROTOCOL_VERSION}. See SOURCE.txt for the source.
`,
	);
	if (existsSync(join(ROOT, "LICENSE"))) {
		cpSync(join(ROOT, "LICENSE"), join(out, "LICENSE"));
	}
}

function stageDependencies(out: string): void {
	writeFileSync(
		join(out, "package.json"),
		`${JSON.stringify(
			{
				name: "golpe-lan",
				private: true,
				type: "module",
				dependencies: {
					// Exact versions: a release artifact names the runtime it was
					// tested with, not a range that can move under it.
					"@geckos.io/server": "3.1.0",
					"bonjour-service": "1.4.4",
					sirv: "3.0.2",
					"unique-names-generator": "4.7.1",
				},
			},
			null,
			2,
		)}\n`,
	);
	// pnpm 11 blocks lifecycle scripts unless the workspace allows them, and the
	// native WebRTC addon needs its prebuild installed.
	writeFileSync(
		join(out, "pnpm-workspace.yaml"),
		// Hoisted, not pnpm's default symlink farm: a released pack must survive
		// a zip extractor that does not understand symlinks (Windows), and a
		// package's own dependencies have to sit beside it, not in the store.
		"nodeLinker: hoisted\nallowBuilds:\n  node-datachannel: true\n",
	);
	run(PNPM, ["install", "--prod"], out);
	// Runtime only from here on; the lockfile and workspace file were staging.
	rmSync(join(out, "pnpm-lock.yaml"), { force: true });
	rmSync(join(out, "pnpm-workspace.yaml"), { force: true });
}

function archive(out: string, archivePath: string): void {
	if (process.platform === "win32") {
		run("powershell.exe", [
			"-NoProfile",
			"-Command",
			`Compress-Archive -Path '${out}' -DestinationPath '${archivePath}' -Force`,
		]);
		return;
	}
	const parent = resolve(out, "..");
	const folder = out.split(/[\\/]/).pop() ?? "golpe-lan";
	run("tar", ["-czf", archivePath, "-C", parent, folder]);
}

async function main(): Promise<void> {
	const out = resolve(arg("out", DEFAULT_OUT));
	const build = arg("build", gitSha());
	const release = hasFlag("release");
	if (release && !cleanGit()) {
		throw new Error(
			"--release needs a clean checkout: the pack must be the commit it names",
		);
	}

	console.log(`[lan-package] staging ${out} (build ${build})`);
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });

	if (!hasFlag("skip-build")) {
		rmSync(LAN_DIST, { recursive: true, force: true });
		run(
			PNPM,
			[
				"exec",
				"vite",
				"build",
				"--config",
				"vite/config.prod.ts",
				"--outDir",
				"build/lan-dist",
			],
			ROOT,
			{ ...process.env, GOLPE_BUILD: build },
		);
	}
	if (!existsSync(join(LAN_DIST, "index.html"))) {
		throw new Error(
			"build/lan-dist/index.html is missing — run without --skip-build",
		);
	}
	cpSync(LAN_DIST, join(out, "dist"), { recursive: true });

	run(PNPM, [
		"exec",
		"tsc",
		"-p",
		"tsconfig.lan.json",
		"--noEmit",
		"false",
		"--outDir",
		join(out, "server"),
		"--rootDir",
		".",
	]);

	writeManifest(out, build);
	stageDependencies(out);

	// The runtime is copied, not assumed: a guest's host machine need not have
	// Node installed, and the pack's Node version is the one it was tested with.
	const nodeName = process.platform === "win32" ? "node.exe" : "node";
	cpSync(process.execPath, join(out, nodeName));
	if (process.platform !== "win32") chmodSync(join(out, nodeName), 0o755);
	writeLaunchers(out);

	if (!hasFlag("no-archive")) {
		const platform = `${process.platform}-${process.arch}`;
		const archivePath = join(
			resolve(out, ".."),
			`golpe-lan-${build}-${platform}.${process.platform === "win32" ? "zip" : "tar.gz"}`,
		);
		archive(out, archivePath);
		console.log(`[lan-package] archive ${archivePath}`);
	}

	console.log(`[lan-package] ready: ${out} (${humanSize(directorySize(out))})`);
}

await main();

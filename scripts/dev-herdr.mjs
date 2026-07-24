#!/usr/bin/env node
/**
 * Run the dev servers inside a herdr workspace instead of detached in the
 * background.
 *
 * Backgrounded servers are invisible: you cannot see Vite recompiling, you
 * cannot see the game server's [MATCH] lines, and a server that died silently
 * still looks "running" to a naive process check — which is exactly how a dead
 * server once produced a passing physics diagnostic. Herdr keeps both processes
 * in named panes you can watch, and `logs` can read them back non-interactively.
 *
 *   node scripts/dev-herdr.mjs up       # create the dev tab and start both
 *   node scripts/dev-herdr.mjs status   # panes + port health
 *   node scripts/dev-herdr.mjs logs vite [--lines=80]
 *   node scripts/dev-herdr.mjs down     # stop both and close the tab
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = resolve(REPO, ".herdr");
const STATE_FILE = resolve(STATE_DIR, "dev.json");

const WORKSPACE_LABEL = "vento-aureo";
const TAB_LABEL = "dev";

/** The processes the tab supervises. Order defines the pane layout, top to bottom. */
const SERVICES = [
	{
		name: "vite",
		label: "vite :8080",
		command: ["npm", "run", "dev-nolog"],
		port: 8080,
		ready: /Local:\s+http/,
	},
	{
		name: "server",
		label: "geckos :9208",
		command: ["npm", "run", "dev:server"],
		port: 9208,
		ready: /listening on port 9208/,
	},
];

/** Run a herdr CLI command and parse its JSON envelope. */
function herdr(args) {
	const out = execFileSync("herdr", args, { encoding: "utf8" });
	const trimmed = out.trim();
	if (!trimmed.startsWith("{")) return trimmed;
	const parsed = JSON.parse(trimmed);
	if (parsed.error) {
		throw new Error(`herdr ${args.join(" ")}: ${JSON.stringify(parsed.error)}`);
	}
	return parsed.result;
}

/** Raw text output (pane read uses text, not JSON). */
function herdrText(args) {
	return execFileSync("herdr", args, { encoding: "utf8" });
}

function assertServer() {
	let status;
	try {
		status = execFileSync("herdr", ["status", "server"], { encoding: "utf8" });
	} catch {
		throw new Error("herdr is not installed or not on PATH");
	}
	if (!/status:\s*running/.test(status)) {
		throw new Error(
			"no herdr server running — start one by launching `herdr` in a terminal",
		);
	}
}

function readState() {
	if (!existsSync(STATE_FILE)) return null;
	try {
		return JSON.parse(readFileSync(STATE_FILE, "utf8"));
	} catch {
		return null;
	}
}

function writeState(state) {
	mkdirSync(STATE_DIR, { recursive: true });
	writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function findWorkspace(label) {
	const { workspaces } = herdr(["workspace", "list"]);
	return workspaces.find((w) => w.label === label) ?? null;
}

function findTab(workspaceId, label) {
	const { tabs } = herdr(["tab", "list", "--workspace", workspaceId]);
	return tabs.find((t) => t.label === label) ?? null;
}

/** Is something already listening on the port? */
async function portOpen(port) {
	const url =
		port === 9208
			? "http://localhost:9208/.wrtc/v2/connections"
			: `http://localhost:${port}/`;
	const res = await fetch(url, { method: port === 9208 ? "POST" : "GET" }).catch(
		() => null,
	);
	return Boolean(res);
}

async function up() {
	assertServer();

	// Reuse the project workspace if it exists so the dev tab lands next to the
	// agents already working in it.
	let workspace = findWorkspace(WORKSPACE_LABEL);
	if (!workspace) {
		const created = herdr([
			"workspace",
			"create",
			"--cwd",
			REPO,
			"--label",
			WORKSPACE_LABEL,
			"--no-focus",
		]);
		workspace = created.workspace ?? created;
		console.log(`created workspace ${workspace.workspace_id} (${WORKSPACE_LABEL})`);
	}
	const workspaceId = workspace.workspace_id;

	// Idempotent: tear down a previous dev tab rather than stacking duplicates.
	const existing = findTab(workspaceId, TAB_LABEL);
	if (existing) {
		console.log(`closing previous ${TAB_LABEL} tab (${existing.tab_id})`);
		herdr(["tab", "close", existing.tab_id]);
	}

	const tab = herdr([
		"tab",
		"create",
		"--workspace",
		workspaceId,
		"--cwd",
		REPO,
		"--label",
		TAB_LABEL,
		"--no-focus",
	]);
	const tabId = tab.tab.tab_id;

	// First service takes the tab's root pane; each later one splits downward.
	const panes = [];
	let previous = tab.root_pane.pane_id;
	for (const [i, service] of SERVICES.entries()) {
		let paneId = previous;
		if (i > 0) {
			const split = herdr([
				"pane",
				"split",
				previous,
				"--direction",
				"down",
				"--ratio",
				String(1 / (SERVICES.length - i + 1)),
				"--cwd",
				REPO,
			]);
			paneId = split.pane.pane_id;
		}
		herdr(["pane", "rename", paneId, service.label]);
		herdr(["pane", "run", paneId, ...service.command]);
		panes.push({ name: service.name, paneId, label: service.label });
		previous = paneId;
	}

	writeState({ workspaceId, tabId, panes, startedAt: new Date().toISOString() });

	console.log(`\ndev tab ready: workspace ${workspaceId}, tab ${tabId}`);
	for (const p of panes) console.log(`  ${p.name.padEnd(7)} ${p.paneId}  ${p.label}`);

	// Report real readiness rather than assuming the spawn worked.
	console.log("\nwaiting for ports...");
	for (const service of SERVICES) {
		const ok = await waitForPort(service.port, 25000);
		console.log(`  ${ok ? "ready  " : "TIMEOUT"} :${service.port} (${service.name})`);
		if (!ok) {
			const pane = panes.find((p) => p.name === service.name);
			console.log(tailPane(pane.paneId, 15));
		}
	}
}

async function waitForPort(port, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await portOpen(port)) return true;
		await new Promise((r) => setTimeout(r, 500));
	}
	return false;
}

/**
 * Last `lines` of a pane's output.
 *
 * `--source visible` is the reliable one: the default `recent` source returns
 * nothing for a long-running process that is just sitting there logging.
 */
function tailPane(paneId, lines) {
	try {
		const text = herdrText([
			"pane",
			"read",
			paneId,
			"--source",
			"visible",
			"--format",
			"text",
		]);
		return text.split("\n").slice(-lines).join("\n").trimEnd();
	} catch (err) {
		return `(could not read pane ${paneId}: ${err.message})`;
	}
}

function logs(which, lines) {
	const state = readState();
	if (!state) throw new Error("no dev tab recorded — run `up` first");
	const wanted = which
		? state.panes.filter((p) => p.name === which)
		: state.panes;
	if (wanted.length === 0) {
		throw new Error(
			`unknown service "${which}" — try: ${state.panes.map((p) => p.name).join(", ")}`,
		);
	}
	for (const pane of wanted) {
		console.log(`\n===== ${pane.name} (${pane.paneId}) =====`);
		console.log(tailPane(pane.paneId, lines));
	}
}

async function status() {
	const state = readState();
	if (!state) {
		console.log("no dev tab recorded — run `up` first");
	} else {
		console.log(`workspace ${state.workspaceId}  tab ${state.tabId}`);
		const live = herdr(["pane", "list"]).panes.map((p) => p.pane_id);
		for (const p of state.panes) {
			console.log(
				`  ${p.name.padEnd(7)} ${p.paneId}  ${live.includes(p.paneId) ? "pane alive" : "pane GONE"}`,
			);
		}
	}
	for (const service of SERVICES) {
		console.log(
			`  :${service.port} ${(await portOpen(service.port)) ? "responding" : "down"} (${service.name})`,
		);
	}
}

function down() {
	const state = readState();
	if (!state) {
		console.log("nothing recorded to tear down");
		return;
	}
	// Ctrl-C each pane so the dev servers exit cleanly, then drop the tab.
	for (const pane of state.panes) {
		try {
			herdr(["pane", "send-keys", pane.paneId, "ctrl+c"]);
		} catch {
			/* pane may already be gone */
		}
	}
	try {
		herdr(["tab", "close", state.tabId]);
	} catch {
		/* already closed */
	}
	rmSync(STATE_FILE, { force: true });
	console.log("dev tab closed");
}

const [command = "up", ...rest] = process.argv.slice(2);
const lineArg = rest.find((a) => a.startsWith("--lines="));
const lines = lineArg ? Number(lineArg.split("=")[1]) : 40;
const positional = rest.filter((a) => !a.startsWith("--"));

try {
	if (command === "up") await up();
	else if (command === "down") down();
	else if (command === "status") await status();
	else if (command === "logs") logs(positional[0], lines);
	else {
		console.error(`unknown command "${command}" — use up | down | status | logs`);
		process.exit(1);
	}
} catch (err) {
	console.error(`error: ${err.message}`);
	process.exit(1);
}

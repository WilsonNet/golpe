/**
 * The art probe: does a rendered hero's sheet actually get drawn?
 *
 *     tsx scripts/art-probe.ts [--hero=lia|jeffs] [--seconds=30]
 *
 * Two online AI clients play the hero against itself (plus two bots for
 * traffic) and the first one reports `window.__animStats()` — every clip the
 * animation system drew for the hero, and every frame it fell back to a
 * generated placeholder pose. The sheet is generated from
 * `art/<hero>/<hero>.blend`, and a
 * re-render that dropped or misnamed a clip still draws *something*: only
 * this count says it was the wrong thing. The scale contract itself is
 * measured where the pixels are made (`scripts/make-hero-art.py`) and checked
 * on the shipped atlas by `heroAtlas.test.ts`.
 */
import { chromium } from "playwright";

const seconds = Number(
	process.argv.find((a) => a.startsWith("--seconds="))?.split("=")[1] ?? 30,
);
const hero =
	process.argv.find((a) => a.startsWith("--hero="))?.split("=")[1] ?? "lia";
const BASE = "http://localhost:8084";
const room = `art-${Date.now().toString(36)}`;

/** Clips an AI sword-and-gun hero reliably reaches in half a minute of fighting. */
const MUST_DRAW: string[][] = [
	["right", "left"],
	["right-idle", "left-idle"],
	["jump", "jump-left", "fall", "fall-left"],
	["slash", "slash-left", "slash2", "slash2-left", "slash3", "slash3-left"],
	[
		"gun-hold",
		"gun-hold-left",
		"gun-run",
		"gun-run-left",
		"gun-fire",
		"gun-fire-left",
	],
	[
		"disabled",
		"disabled-left",
		"launched",
		"launched-left",
		"downed",
		"downed-left",
	],
];

const browser = await chromium.launch();
const ctx = await browser.newContext();
const errors: string[] = [];
const a = await ctx.newPage();
a.on("pageerror", (e) => errors.push(e.message));
await a.goto(
	`${BASE}/?online=true&ai=true&hero=${hero}&room=${room}&bots=2&mute=1`,
);
const b = await ctx.newPage();
await b.goto(`${BASE}/?online=true&ai=true&hero=${hero}&room=${room}&mute=1`);
await a.waitForTimeout(seconds * 1000);

const stats = (await a.evaluate(() => window.__animStats?.())) ?? {};
await browser.close();

const drawn = stats[hero] ?? {
	clips: {},
	fallbacks: {},
	aimBands: { local: {}, remote: {} },
};
const rows = Object.entries(drawn.clips).sort((x, y) => y[1] - x[1]);
console.log(`${hero} drew ${rows.length} distinct clips over ${seconds}s:`);
for (const [name, n] of rows) {
	const fb = drawn.fallbacks[name] ?? 0;
	console.log(
		`  ${name.padEnd(18)} ${String(n).padStart(6)}${fb ? `  FALLBACK x${fb}` : ""}`,
	);
}

let failed = false;
const check = (ok: boolean, label: string, detail = "") => {
	console.log(`${ok ? "OK  " : "FAIL"} ${label.padEnd(44)} ${detail}`);
	if (!ok) failed = true;
};
const fallbacks = Object.values(drawn.fallbacks).reduce((s, n) => s + n, 0);
check(
	fallbacks === 0,
	`no placeholder poses drawn over ${hero}'s art`,
	`fallbacks=${fallbacks}`,
);
for (const group of MUST_DRAW) {
	const hit = group.filter((c) => (drawn.clips[c] ?? 0) > 0);
	check(hit.length > 0, `drew one of ${group[0]}…`, hit.join(",") || "none");
}
// The rifle follows the aim — for the fighter on the other side of the wire
// too. Before the snapshot carried aim, every remote rifle was drawn level.
const localBands = Object.keys(drawn.aimBands.local).length;
const remoteBands = Object.keys(drawn.aimBands.remote).length;
console.log(
	`aim bands drawn: local ${JSON.stringify(drawn.aimBands.local)} remote ${JSON.stringify(drawn.aimBands.remote)}`,
);
check(localBands >= 3, "the local rifle tracks the aim", `bands=${localBands}`);
check(
	remoteBands >= 3,
	"a remote rifle tracks its aim",
	`bands=${remoteBands}`,
);
check(errors.length === 0, "no page errors", errors.slice(0, 3).join(" | "));
console.log(failed ? "ART PROBE FAIL" : "ART PROBE PASS");
process.exit(failed ? 1 : 0);

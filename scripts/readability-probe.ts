/**
 * The readability probe: can a player find the fighter against the world?
 *
 *     tsx scripts/readability-probe.ts
 *
 * The method is the one the game-art literature has used for years, turned
 * into numbers:
 *
 * - **Value structure.** Squint at a grayscale screenshot; actors should sit in
 *   a different lightness band from the background. Game Developer's value
 *   analysis and the DOTA 2 example are the canonical statement.
 * - **Silhouette.** The edge is what the eye finds first. We measure the
 *   outside-edge ΔE and how much of the outline clears ΔE 20.
 * - **Detail budget.** The combat band should be the quietest part of the
 *   background; we measure the local lightness spread and high-gradient
 *   density around the body.
 *
 * The game supplies a with/without-fighters pair of renders of the same frame;
 * the difference is the body mask, and the without-frame is the background the
 * body covers. That is why this is not a guessed box or a palette comparison.
 *
 * The flat `?sky=off` gradient is the control. It is the look the game shipped
 * before the parallax backdrop, and its numbers are the floor the new art has
 * to meet.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = "http://localhost:8084";
const SHOTS = ".playwright-mcp/readability";
const VARIANTS = ["off", "hand"] as const;

interface Metrics {
	pixels: number;
	bounds: { x: number; y: number; w: number; h: number };
	contrastRatio: number;
	valueContrast: number;
	foregroundL: number;
	backgroundL: number;
	foregroundChroma: number;
	backgroundChroma: number;
	chromaContrast: number;
	interiorContrast: number;
	interiorP25: number;
	silhouetteContrast: number;
	silhouetteCoverage: number;
	silhouetteCoreContrast: number;
	silhouetteCoreCoverage: number;
	backgroundLumaStd: number;
	backgroundDetail: number;
}

interface Snapshot {
	cameraX: number;
	variant: string;
	metrics: Metrics | null;
	withFighters: string;
	background: string;
	combatants: { id: string; x: number; y: number; w: number; h: number }[];
}

/**
 * The floor is the shipped flat `?sky=off` gradient, measured in the same run.
 * The new art must not regress from it by more than the noise in the sprite
 * outline: the old sky is the look the game already proved playable, and
 * absolute ΔE thresholds invented on one display would fail that control at
 * another resolution. The numbers are still printed, so a human can see the
 * margin rather than trusting the pass.
 */
const TOLERANCE = {
	signedValue: 3,
	minimumValue: 6,
	silhouetteContrast: 4,
	silhouetteCoverage: 0.05,
	backgroundDetail: 0.1,
	minimumRatio: 0.95,
} as const;

let failed = false;
const check = (ok: boolean, label: string, detail = "") => {
	console.log(`${ok ? "OK  " : "FAIL"} ${label.padEnd(46)} ${detail}`);
	if (!ok) failed = true;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
	viewport: { width: 1200, height: 900 },
	deviceScaleFactor: 1,
});
await mkdir(SHOTS, { recursive: true });
interface Stat {
	variant: string;
	captures: { label: string; x: number; metrics: Metrics }[];
	mean: (f: (m: Metrics) => number) => number;
	min: (f: (m: Metrics) => number) => number;
	max: (f: (m: Metrics) => number) => number;
}

const summary: Stat[] = [];

for (const variant of VARIANTS) {
	const errors: string[] = [];
	const page = await ctx.newPage();
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("console", (m) => {
		if (m.type() === "error") errors.push(m.text());
	});
	const room = `readability-${variant}-${Date.now().toString(36)}`;
	await page.goto(
		`${BASE}/?online=true&screen=1&mute=1&sky=${variant}&room=${room}`,
	);
	await page.waitForFunction(
		() => window.__readabilitySnapshot !== undefined,
		undefined,
		{ timeout: 20_000 },
	);
	await page.evaluate(() => window.__setPlayerName?.("Readability"));
	await page
		.waitForFunction(
			() => window.__matchState?.().phase === "live",
			undefined,
			{ timeout: 20_000 },
		)
		.catch(() => {});
	await page.waitForTimeout(1200);
	await page.bringToFront();

	const captures: { label: string; x: number; metrics: Metrics }[] = [];
	const take = async (label: string): Promise<Snapshot | null> => {
		const snap = (await page.evaluate(() =>
			window.__readabilitySnapshot?.(),
		)) as Snapshot | null;
		if (!snap?.metrics) {
			check(false, `${variant}/${label}: a body was captured`);
			return null;
		}
		const x = snap.combatants.find((c) => c.id === "local")?.x ?? 0;
		console.log(
			`     ${variant}/${label.padEnd(8)} x=${String(x).padStart(3)} ` +
				`L*fg=${snap.metrics.foregroundL.toFixed(1)} ` +
				`L*bg=${snap.metrics.backgroundL.toFixed(1)} ` +
				`ΔL*=${snap.metrics.valueContrast.toFixed(1)} ` +
				`C*fg=${snap.metrics.foregroundChroma.toFixed(1)} ` +
				`C*bg=${snap.metrics.backgroundChroma.toFixed(1)} ` +
				`sil=${snap.metrics.silhouetteContrast.toFixed(1)} ` +
				`core=${snap.metrics.silhouetteCoreContrast.toFixed(1)} ` +
				`cov=${(snap.metrics.silhouetteCoreCoverage * 100).toFixed(0)}% ` +
				`detail=${snap.metrics.backgroundDetail.toFixed(2)} ` +
				`ratio=${snap.metrics.contrastRatio.toFixed(2)}`,
		);
		captures.push({ label, x, metrics: snap.metrics });
		await writeFile(
			`${SHOTS}/${variant}-${label}-with.png`,
			Buffer.from(snap.withFighters.split(",")[1] ?? "", "base64"),
		);
		await writeFile(
			`${SHOTS}/${variant}-${label}-bg.png`,
			Buffer.from(snap.background.split(",")[1] ?? "", "base64"),
		);
		return snap;
	};

	const spawn = await take("spawn");
	if (spawn) {
		check(
			spawn.variant === variant,
			`${variant}: the URL chose the candidate`,
			spawn.variant,
		);
	}

	// Walk right to put the body against a different background, jumping the
	// first pillar. The spawn is the hardest case (a dark near-layer corner);
	// the walk checks that the fix is not a one-spot accident.
	await page.keyboard.down("KeyD");
	for (let i = 0; i < 6; i++) {
		await page.keyboard.down("Space");
		await page.waitForTimeout(120);
		await page.keyboard.up("Space");
		await page.waitForTimeout(500);
	}
	await page.keyboard.up("KeyD");
	await page.waitForTimeout(200);
	await take("moved");

	const metrics = captures.map((c) => c.metrics);
	const mean = (f: (m: Metrics) => number) =>
		metrics.reduce((s, m) => s + f(m), 0) / Math.max(1, metrics.length);
	const min = (f: (m: Metrics) => number) => Math.min(...metrics.map(f));
	const max = (f: (m: Metrics) => number) => Math.max(...metrics.map(f));

	check(
		captures.length >= 2,
		`${variant}: at least two background positions`,
		`captures=${captures.length}`,
	);
	check(
		errors.length === 0,
		`${variant}: no page errors`,
		errors.slice(0, 2).join(" | "),
	);
	summary.push({ variant, captures, mean, min, max });
	await page.close();
}

// Compare the Waterfront with the flat sky measured in the same run.
// Absolute thresholds are display-dependent: the sprite's sheet outline is
// crisp at DPR 2 and soft at DPR 1, so a fixed silhouette ΔE fails the very
// control the game shipped with. The control is the invariant.
const baseline = summary.find((s) => s.variant === "off");
check(!!baseline, "the flat-sky control was measured");
if (baseline) {
	for (const s of summary) {
		if (s.variant === "off") continue;
		check(
			s.min((m) => m.valueContrast) >= TOLERANCE.minimumValue,
			`${s.variant}: value separation does not collapse`,
			`min ΔL* ${s.min((m) => m.valueContrast).toFixed(1)}`,
		);
		check(
			s.mean((m) => m.foregroundL - m.backgroundL) >=
				baseline.mean((m) => m.foregroundL - m.backgroundL) -
					TOLERANCE.signedValue,
			`${s.variant}: the body is not darker than the old sky`,
			`L*fg-L*bg ${s.mean((m) => m.foregroundL - m.backgroundL).toFixed(1)} vs ${baseline.mean((m) => m.foregroundL - m.backgroundL).toFixed(1)}`,
		);
		check(
			s.mean((m) => m.chromaContrast) > 0,
			`${s.variant}: the body stays more vivid than its own background`,
			`C* +${s.mean((m) => m.chromaContrast).toFixed(1)}`,
		);
		check(
			s.mean((m) => m.silhouetteCoreContrast) >=
				baseline.mean((m) => m.silhouetteCoreContrast) -
					TOLERANCE.silhouetteContrast,
			`${s.variant}: silhouette holds against the flat sky`,
			`core ΔE ${s.mean((m) => m.silhouetteCoreContrast).toFixed(1)} vs ${baseline.mean((m) => m.silhouetteCoreContrast).toFixed(1)}`,
		);
		check(
			s.min((m) => m.silhouetteCoreCoverage) >=
				baseline.min((m) => m.silhouetteCoreCoverage) -
					TOLERANCE.silhouetteCoverage,
			`${s.variant}: outline coverage holds`,
			`${(s.min((m) => m.silhouetteCoreCoverage) * 100).toFixed(0)}% vs ${(baseline.min((m) => m.silhouetteCoreCoverage) * 100).toFixed(0)}%`,
		);
		check(
			s.mean((m) => m.backgroundDetail) <=
				baseline.mean((m) => m.backgroundDetail) + TOLERANCE.backgroundDetail,
			`${s.variant}: background detail stays in budget`,
			`${s.mean((m) => m.backgroundDetail).toFixed(2)} vs ${baseline.mean((m) => m.backgroundDetail).toFixed(2)}`,
		);
		check(
			s.mean((m) => m.contrastRatio) >= TOLERANCE.minimumRatio,
			`${s.variant}: the body is not lost in the background`,
			`ratio ${s.mean((m) => m.contrastRatio).toFixed(2)}`,
		);
	}
}

await browser.close();
await writeFile(
	`${SHOTS}/summary.json`,
	`${JSON.stringify(summary, null, 2)}\n`,
);
console.log(`screenshots + summary: ${SHOTS}/`);
console.log(failed ? "READABILITY PROBE FAIL" : "READABILITY PROBE PASS");
process.exit(failed ? 1 : 0);

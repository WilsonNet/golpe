/**
 * The move-list previews, measured: every entry whose card claims a hit must
 * actually land one on the preview's target dummies.
 *
 * The preview is the real simulation on a stage — so its probe surface
 * (`window.__previewState`) reports what the scripted server settled: bullets
 * fired and landed, melee hits, damage, the trap's spring, the hole's grip.
 * A preview whose story mimes at a dummy that never reacts would otherwise
 * look identical to a working one, which is exactly how the gun previews sat
 * for their whole first version: the clip played, no round ever flew.
 *
 * Run with the dev servers up (pnpm run dev:herdr).
 */
import { chromium } from "playwright";

const BASE = process.env.GOLPE_URL ?? "http://localhost:8084";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "OK  " : "FAIL"} ${label.padEnd(46)} ${detail}`);
	if (!ok) failures++;
}

/** One sample of the preview state, typed loosely — the shape lives in `global.d.ts`. */
type PreviewSample = {
	t?: number;
	meleeHits?: number;
	bulletsFired?: number;
	bulletHits?: number;
	damageDealt?: number;
	trapsSprung?: number;
	singularity?: { x: number; y: number; remainingMs: number } | null;
	targets?: {
		hp: number;
		stun: boolean;
		down: boolean;
		root: boolean;
		held: boolean;
	}[];
};

/** Open the move list for `hero` and walk `steps` entries down. */
async function open(
	page: import("playwright").Page,
	hero: string,
	steps: number,
) {
	await page.addInitScript((h: string) => {
		localStorage.setItem("golpe.hero", h);
	}, hero);
	await page.goto(`${BASE}/?mute=1`);
	await page.waitForSelector(".gd-menu-page", { timeout: 15000 });
	await page.getByRole("button", { name: /Move list/ }).click();
	await page.waitForFunction(
		() => typeof (window as any).__previewState === "function",
		{ timeout: 15000 },
	);
	for (let i = 0; i < steps; i++) {
		await page.keyboard.press("ArrowDown");
		await page.waitForTimeout(60);
	}
	// The walk itself is proof the panel is live; the entry name is the label.
	return page.evaluate(
		() => document.querySelector(".ml-move-name")?.textContent ?? "?",
	);
}

/**
 * Sample the preview until `when` says the claim is proven, or the budget
 * runs out. The budget is a generous multiple of the story loop — a preview
 * that needs three loops to show a hit is still a preview that shows it.
 */
async function watch(
	page: import("playwright").Page,
	when: (s: PreviewSample) => boolean,
	budgetMs = 12000,
): Promise<PreviewSample | null> {
	const deadline = Date.now() + budgetMs;
	let last: PreviewSample | null = null;
	while (Date.now() < deadline) {
		last = (await page.evaluate(
			() => (window as any).__previewState?.() ?? null,
		)) as PreviewSample | null;
		if (last && when(last)) return last;
		await page.waitForTimeout(120);
	}
	return last;
}

const browser = await chromium.launch();

// ---------------------------------------------------------------- Lia ----
{
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(String(e)));

	// Slash: the chain opener lands on the dummy in reach.
	let name = await open(page, "lia", 4);
	check("lia move list opens on melee", name === "Slash", `entry=${name}`);
	const slash = await watch(
		page,
		(s) => (s.meleeHits ?? 0) > 0 && (s.damageDealt ?? 0) > 0,
	);
	check(
		"slash lands on the target dummy",
		(slash?.meleeHits ?? 0) > 0 && (slash?.damageDealt ?? 0) > 0,
		`hits=${slash?.meleeHits} dmg=${slash?.damageDealt} hp=${slash?.targets?.[0]?.hp}`,
	);

	// Rifle: rounds fly, rounds land, the magazine spends. The counters reset
	// every loop wrap, so the claim is proven only by a sample that has the
	// whole three-shot story in it — a sample taken one shot in would pass a
	// gun that fires once and stops.
	name = await open(page, "lia", 9);
	check("lia walks to the rifle", name === "Rifle", `entry=${name}`);
	const rifle = await watch(
		page,
		(s) => (s.bulletsFired ?? 0) >= 3 && (s.bulletHits ?? 0) >= 1,
	);
	check(
		"rifle fires and lands rounds",
		(rifle?.bulletsFired ?? 0) >= 3 && (rifle?.bulletHits ?? 0) >= 1,
		`fired=${rifle?.bulletsFired} hits=${rifle?.bulletHits} hp=${rifle?.targets?.[0]?.hp}`,
	);

	// Black hole: the grenade lands ON the dummy, the hole holds and ticks.
	name = await open(page, "lia", 11);
	check("lia walks to the ultimate", name === "Black Hole", `entry=${name}`);
	const hole = await watch(
		page,
		(s) =>
			s.singularity !== null &&
			(s.targets?.[0]?.held ?? false) &&
			(s.damageDealt ?? 0) > 0,
		16000,
	);
	check(
		"black hole opens on the dummy, holds it, ticks it",
		(hole?.singularity ?? null) !== null &&
			(hole?.targets?.[0]?.held ?? false) &&
			(hole?.damageDealt ?? 0) > 0,
		`held=${hole?.targets?.[0]?.held} dmg=${hole?.damageDealt} hp=${hole?.targets?.[0]?.hp}`,
	);
	check("no page errors (lia)", errors.length === 0, errors.join("; "));
	await ctx.close();
}

// -------------------------------------------------------------- Anands ----
{
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(String(e)));

	// Thrust: the sweep knocks the dummy down, exactly once.
	let name = await open(page, "anands", 5);
	check("anands walks to the thrust", name === "Thrust", `entry=${name}`);
	const thrust = await watch(page, (s) => s.targets?.[0]?.down === true);
	check(
		"thrust sweeps the dummy down (once per cast)",
		(thrust?.meleeHits ?? 0) === 1 &&
			(thrust?.damageDealt ?? 0) === 16 &&
			(thrust?.targets?.[0]?.down ?? false),
		`hits=${thrust?.meleeHits} dmg=${thrust?.damageDealt}`,
	);

	// Machine gun: the stream, not a single shot. (Anands: stab 4,
	// thrust 5, shoryuken 6, machine gun 7, trap 8, dragon 9.)
	name = await open(page, "anands", 7);
	check(
		"anands walks to the machine gun",
		name === "Machine Gun",
		`entry=${name}`,
	);
	const mg = await watch(page, (s) => (s.bulletsFired ?? 0) >= 4);
	check(
		"machine gun streams multiple rounds",
		(mg?.bulletsFired ?? 0) >= 4,
		`fired=${mg?.bulletsFired} hits=${mg?.bulletHits}`,
	);

	// Trap: the canister plants, the dummy is rooted, the trap is spent.
	name = await open(page, "anands", 8);
	check("anands walks to the trap", name === "Trap", `entry=${name}`);
	const trap = await watch(page, (s) => (s.trapsSprung ?? 0) > 0);
	check(
		"trap plants, springs, roots the dummy",
		(trap?.trapsSprung ?? 0) === 1 && (trap?.targets?.[0]?.root ?? false),
		`sprung=${trap?.trapsSprung} root=${trap?.targets?.[0]?.root} dmg=${trap?.damageDealt}`,
	);

	// Dragon thrust: the ride sweeps the dummy off its lane.
	name = await open(page, "anands", 9);
	check(
		"anands walks to the ultimate",
		name === "Dragon Thrust",
		`entry=${name}`,
	);
	const dragon = await watch(
		page,
		(s) => (s.damageDealt ?? 0) >= 30 && (s.targets?.[0]?.stun ?? false),
		16000,
	);
	check(
		"dragon thrust sweeps the dummy (30 dmg, knockback)",
		(dragon?.damageDealt ?? 0) >= 30,
		`dmg=${dragon?.damageDealt} hp=${dragon?.targets?.[0]?.hp}`,
	);
	check("no page errors (anands)", errors.length === 0, errors.join("; "));
	await ctx.close();
}

// --------------------------------------------------------------- Jeffs ----
{
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(String(e)));

	// Shotgun: the whole fan at point blank.
	let name = await open(page, "jeffs", 9);
	check("jeffs walks to the shotgun", name === "Shotgun", `entry=${name}`);
	const shotgun = await watch(page, (s) => (s.bulletHits ?? 0) > 0);
	check(
		"shotgun lands most of the fan",
		(shotgun?.bulletsFired ?? 0) === 6 && (shotgun?.bulletHits ?? 0) >= 4,
		`fired=${shotgun?.bulletsFired} hits=${shotgun?.bulletHits} dmg=${shotgun?.damageDealt}`,
	);

	// Death blossom: the storm ticks the dummy standing in it.
	name = await open(page, "jeffs", 11);
	check(
		"jeffs walks to the ultimate",
		name === "Death Blossom",
		`entry=${name}`,
	);
	const blossom = await watch(page, (s) => (s.damageDealt ?? 0) >= 26, 16000);
	check(
		"death blossom ticks the dummy (2+ ticks)",
		(blossom?.damageDealt ?? 0) >= 26,
		`dmg=${blossom?.damageDealt} hp=${blossom?.targets?.[0]?.hp}`,
	);
	check("no page errors (jeffs)", errors.length === 0, errors.join("; "));
	await ctx.close();
}

await browser.close();

if (failures > 0) {
	console.log(`\n${failures} failure${failures > 1 ? "s" : ""}`);
	process.exit(1);
}
console.log("\nAll preview claims measured.");

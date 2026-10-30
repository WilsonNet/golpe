import { launchBrowser } from "./browser";

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
		maxHp?: number;
		stun: boolean;
		down: boolean;
		root: boolean;
		held: boolean;
	}[];
};

/**
 * Open the move list for `hero` and walk down to the entry called `target`.
 *
 * Navigating by *name*, not by a fixed number of ArrowDowns: the list gains
 * entries (the guard did), and a probe that counts presses reports every card
 * after the insertion against the wrong move. The walk also proves the panel
 * is live — the entry name is the label.
 */
async function open(
	page: import("playwright").Page,
	hero: string,
	target: string,
) {
	await page.addInitScript((h: string) => {
		localStorage.setItem("golpe.hero", h);
		// A first-time browser gets the tutorial card over the menu; the probe
		// is not a newcomer and must not fight a backdrop for the disclosure.
		localStorage.setItem("golpe.tutorialPromptDismissed", "1");
	}, hero);
	await page.goto(`${BASE}/?mute=1`);
	await page.waitForSelector(".gd-menu-page", { timeout: 15000 });
	// The list lives behind the menu's one disclosure, beside the other
	// learn/settings items — a newcomer's home page stays four choices long.
	await page.click(".gd-more-toggle");
	await page.waitForSelector(".gd-more-body", { timeout: 5000 });
	await page.getByRole("button", { name: /Move list/ }).click();
	await page.waitForFunction(
		() => typeof (window as any).__previewState === "function",
		{ timeout: 15000 },
	);
	const name = () =>
		page.evaluate(
			() => document.querySelector(".ml-move-name")?.textContent?.trim() ?? "?",
		);
	for (let i = 0; i < 40; i++) {
		if ((await name()) === target) break;
		await page.keyboard.press("ArrowDown");
		await page.waitForTimeout(40);
	}
	return name();
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

const browser = await launchBrowser();

// ---------------------------------------------------------------- Lia ----
{
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(String(e)));

	// Slash: the chain opener lands on the dummy in reach.
	let name = await open(page, "lia", "Slash");
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
	name = await open(page, "lia", "Rifle");
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
	name = await open(page, "lia", "Black Hole");
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
	// The dummy dies before the hole closes; damage must stop at its HP and the
	// corpse must not keep counting. The old hurt() added the full tick even
	// after zero, so the probe read 105 damage against a 100 HP dummy.
	const dead = await watch(page, (s) => (s.targets?.[0]?.hp ?? 1) === 0, 14000);
	check(
		"damage is capped at the target's HP",
		(dead?.targets?.[0]?.hp ?? 1) === 0 &&
			(dead?.damageDealt ?? 0) <= (dead?.targets?.[0]?.maxHp ?? 100),
		`dmg=${dead?.damageDealt} hp=${dead?.targets?.[0]?.hp} max=${dead?.targets?.[0]?.maxHp}`,
	);

	// The Massive's timeline must wait for the release, not the first press:
	// its charge is 1.6s of standing still, and the old timeline ran to 100%
	// and read RECOVERY through all of it.
	name = await open(page, "lia", "Massive Strike");
	check("lia walks to the massive", name === "Massive Strike", `entry=${name}`);
	await page.waitForTimeout(800);
	const charging = await page.evaluate(() => ({
		phase: document.querySelector(".mp-phase")?.textContent ?? "",
		action: (window as any).__previewState?.().meleeAction ?? "",
	}));
	check(
		"massive timeline waits while the charge is held",
		charging.phase === "READY" && charging.action !== "massive",
		`phase=${charging.phase} action=${charging.action}`,
	);
	await page.waitForFunction(
		() => (window as any).__previewState?.().meleeAction === "massive",
		{ timeout: 8000 },
	);
	const released = await page.evaluate(() => ({
		phase: document.querySelector(".mp-phase")?.textContent ?? "",
		left: Number.parseFloat(
			(document.querySelector(".mp-tl-cursor") as HTMLElement | null)?.style
				.left ?? "100",
		),
	}));
	check(
		"massive timeline starts on the release",
		(released.phase === "STARTUP" || released.phase === "ACTIVE") &&
			released.left < 35,
		`phase=${released.phase} cursor=${released.left}%`,
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
	let name = await open(page, "anands", "Thrust");
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
	name = await open(page, "anands", "Machine Gun");
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
	name = await open(page, "anands", "Trap");
	check("anands walks to the trap", name === "Trap", `entry=${name}`);
	const trap = await watch(page, (s) => (s.trapsSprung ?? 0) > 0);
	check(
		"trap plants, springs, roots the dummy",
		(trap?.trapsSprung ?? 0) === 1 && (trap?.targets?.[0]?.root ?? false),
		`sprung=${trap?.trapsSprung} root=${trap?.targets?.[0]?.root} dmg=${trap?.damageDealt}`,
	);

	// Dragon thrust: the ride sweeps the dummy off its lane.
	name = await open(page, "anands", "Dragon Thrust");
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
	let name = await open(page, "jeffs", "Shotgun");
	check("jeffs walks to the shotgun", name === "Shotgun", `entry=${name}`);
	const shotgun = await watch(page, (s) => (s.bulletHits ?? 0) > 0);
	check(
		"shotgun lands most of the fan",
		(shotgun?.bulletsFired ?? 0) === 6 && (shotgun?.bulletHits ?? 0) >= 4,
		`fired=${shotgun?.bulletsFired} hits=${shotgun?.bulletHits} dmg=${shotgun?.damageDealt}`,
	);

	// Death blossom: the storm ticks the dummy standing in it.
	name = await open(page, "jeffs", "Death Blossom");
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

// ------------------------------------------------------------- Ibiriki ----
{
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(String(e)));

	// The hew: a heavier cut than the slash.
	let name = await open(page, "ibiriki", "Hew");
	check("ibiriki walks to the hew", name === "Hew", `entry=${name}`);
	const hew = await watch(page, (s) => (s.damageDealt ?? 0) > 0);
	check(
		"hew lands its 10",
		(hew?.damageDealt ?? 0) === 10,
		`dmg=${hew?.damageDealt}`,
	);

	// The Sunder: the full charge comes down for 28.
	name = await open(page, "ibiriki", "Sunder");
	check("ibiriki walks to the sunder", name === "Sunder", `entry=${name}`);
	// The press opens with a hew (10) before the hold arms the Sunder (28).
	const sunder = await watch(page, (s) => (s.damageDealt ?? 0) >= 28, 8000);
	check(
		"sunder lands its 28",
		(sunder?.damageDealt ?? 0) >= 28,
		`dmg=${sunder?.damageDealt}`,
	);

	// The frenzy: a bleeding dummy fills the bloodlust, so the press is a rend.
	name = await open(page, "ibiriki", "Frenzy (sword)");
	check(
		"ibiriki walks to the frenzy",
		name === "Frenzy (sword)",
		`entry=${name}`,
	);
	const rend = await watch(page, (s) => (s.damageDealt ?? 0) > 0);
	check(
		"a berserk press is the frenzy (8, not a hew's 10)",
		(rend?.damageDealt ?? 0) === 8,
		`dmg=${rend?.damageDealt}`,
	);

	// The axe: a full charge flies flat and lands almost a whole bar.
	name = await open(page, "ibiriki", "Throwing Axe");
	check("ibiriki walks to the axe", name === "Throwing Axe", `entry=${name}`);
	const axe = await watch(page, (s) => (s.bulletHits ?? 0) > 0, 8000);
	check(
		"a full-charge axe lands its 85",
		(axe?.damageDealt ?? 0) >= 80,
		`fired=${axe?.bulletsFired} hits=${axe?.bulletHits} dmg=${axe?.damageDealt}`,
	);

	// Rupture: the cast cuts, and a dummy knocked across the floor bleeds.
	name = await open(page, "ibiriki", "Rupture");
	check("ibiriki walks to the ultimate", name === "Rupture", `entry=${name}`);
	// 5 on the cast + the uppercut's 11 = 16; past 22 the launch arc bled (~8).
	const rupture = await watch(page, (s) => (s.damageDealt ?? 0) >= 22, 12000);
	check(
		"rupture cuts on the cast and bleeds the launched dummy",
		(rupture?.damageDealt ?? 0) >= 22,
		`dmg=${rupture?.damageDealt}`,
	);
	check("no page errors (ibiriki)", errors.length === 0, errors.join("; "));
	await ctx.close();
}

// ------------------------------------------------------- layout / Esc hero ----
{
	// A phone: the panel must scroll rather than clip, and the nav must be
	// thumb-sized. The old fixed root cut the card and put the whole preview
	// below an unreachable fold.
	const ctx = await browser.newContext({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
	});
	const page = await ctx.newPage();
	await open(page, "lia", "Slash");
	const layout = await page.evaluate(() => {
		const root = document.querySelector(".ml-root") as HTMLElement | null;
		const body = document.querySelector(".ml-body") as HTMLElement | null;
		const nav = document.querySelector(".ml-nav-btn") as HTMLElement | null;
		return {
			rootH: root?.clientHeight ?? 0,
			viewH: window.innerHeight,
			overflow: body ? getComputedStyle(body).overflowY : "",
			bodyClient: body?.clientHeight ?? 0,
			bodyScroll: body?.scrollHeight ?? 0,
			navW: nav?.getBoundingClientRect().width ?? 0,
			navH: nav?.getBoundingClientRect().height ?? 0,
		};
	});
	check(
		"the move list fills the phone viewport",
		layout.rootH === layout.viewH,
		`root=${layout.rootH} view=${layout.viewH}`,
	);
	check(
		"the body scrolls instead of clipping",
		layout.overflow === "auto" && layout.bodyScroll > layout.bodyClient,
		`overflow=${layout.overflow} scroll=${layout.bodyScroll} client=${layout.bodyClient}`,
	);
	check(
		"the touch nav is thumb-sized",
		layout.navW >= 44 && layout.navH >= 44,
		`${layout.navW}×${layout.navH}`,
	);
	const previewReachable = await page.evaluate(() => {
		const body = document.querySelector(".ml-body") as HTMLElement | null;
		if (!body) return false;
		body.scrollTop = body.scrollHeight;
		const stage = document.querySelector(".mp-stage") as HTMLElement | null;
		return stage !== null && stage.getBoundingClientRect().bottom <= innerHeight + 1;
	});
	check("the preview is reachable by scrolling", previewReachable);
	await ctx.close();
}

{
	// The Esc menu asks the *live* match which kit it is, not localStorage: an
	// invite can carry `?hero=` and the joiner's preference differs.
	const ctx = await browser.newContext();
	await ctx.addInitScript(() => {
		localStorage.setItem("golpe.hero", "lia");
		localStorage.setItem("golpe.tutorialPromptDismissed", "1");
	});
	const page = await ctx.newPage();
	await page.goto(`${BASE}/?offline=true&hero=ibiriki&mute=1`);
	await page.waitForFunction(() => typeof (window as any).__gameState === "function", {
		timeout: 20000,
	});
	await page.keyboard.press("Escape");
	await page.waitForSelector(".gd-menu-card", { timeout: 5000 });
	await page.getByRole("button", { name: "Moves" }).click();
	await page.waitForSelector(".ml-root", { timeout: 10000 });
	const shown = await page.textContent(".ml-hero-name");
	check(
		"the Esc menu's list shows the live hero",
		shown?.trim() === "Ibiriki",
		`hero=${shown?.trim()}`,
	);
	await ctx.close();
}

await browser.close();

if (failures > 0) {
	console.log(`\n${failures} failure${failures > 1 ? "s" : ""}`);
	process.exit(1);
}
console.log("\nAll preview claims measured.");

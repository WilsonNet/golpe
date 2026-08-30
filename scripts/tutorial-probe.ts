#!/usr/bin/env node
/**
 * The tutorial, measured.
 *
 * A course is a pile of content, and content fails silently: a lesson whose
 * stage the server quietly refuses looks exactly like a lesson whose stage
 * worked, right up until a player sits in front of an idle dummy waiting to
 * block a swing that will never come. Nothing else in the repo can see that —
 * every other probe stops reading at the frame the menu hands over.
 *
 * So this proves four things, in the order they can break:
 *
 *   1. **The menu's top item boots the course.** The tutorial is the first
 *      thing on the root page; a click has to produce a `?tutorial=true` URL
 *      and a director behind it.
 *   2. **Every lesson of every hero stages.** Walked one at a time, asking the
 *      *server's* echoed dummy config whether the enemy is really doing what
 *      the lesson says it is doing. This is the row that catches a typo in a
 *      behaviour name, which TypeScript cannot: the field is a union the
 *      content satisfies and the server still has to honour.
 *   3. **Objectives actually tick.** The first lesson is played, for real,
 *      through the same input override the training room drives — and the
 *      course has to advance on its own when they are all met.
 *   4. **Progress survives a reload**, because it is the difference between a
 *      course you can come back to and one you have to redo.
 *
 * And then `--play`, which is the row that actually answers the question the
 * tutorial exists for: **can every lesson be finished?** It drives each drill
 * end to end and reports the ones that never clear. An unreachable objective is
 * the one tutorial bug with no symptom — the lesson stages perfectly, the enemy
 * does its thing, and the player simply never gets to leave. It is opt-in only
 * because it plays forty-odd drills at human speed.
 *
 * Run with the dev servers up (`pnpm run dev:herdr`).
 *
 *   tsx scripts/tutorial-probe.ts
 *   tsx scripts/tutorial-probe.ts --hero=anands   # one hero's course only
 *   tsx scripts/tutorial-probe.ts --play          # play every drill to the end
 *   tsx scripts/tutorial-probe.ts --keep-open
 */
import { chromium, type Page } from "playwright";
import { tutorialFor } from "../src/game/campaign/content/index";
import { lessonsOf } from "../src/game/campaign/types";
import { HERO_IDS, type HeroId } from "../src/game/simulation/Heroes";

const BASE_URL = process.env.GOLPE_URL ?? "http://localhost:8084";

function arg(name: string, fallback: string): string {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? (hit.split("=")[1] ?? fallback) : fallback;
}

const ONLY_HERO = arg("hero", "");
const KEEP_OPEN = process.argv.includes("--keep-open");
const PLAY_ALL = process.argv.includes("--play");

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "OK  " : "FAIL"} ${label.padEnd(52)} ${detail}`);
	if (!ok) failures++;
}

/**
 * Fail loudly if the game server is down.
 *
 * A tutorial with no server never seats a dummy, and every "the lesson staged"
 * row would hang rather than fail — the same preflight `training-probe.ts` and
 * `diagnose.ts` both grew, for the same reason.
 */
async function assertServerUp() {
	const res = await fetch("http://localhost:9208/.wrtc/v2/connections", {
		method: "POST",
	}).catch(() => null);
	if (!res) {
		throw new Error(
			"game server unreachable on :9208 — start it with `pnpm run dev:herdr`",
		);
	}
}

/** Wait until the director has settled on a phase that is not mid-staging. */
async function settled(page: Page, budgetMs = 15000) {
	await page.waitForFunction(
		() => {
			const phase = window.__tutorial?.state().phase;
			return phase === "playing" || phase === "chapter" || phase === "finished";
		},
		{ timeout: budgetMs },
	);
	// A chapter card is a legitimate resting place, but it is not the lesson —
	// press through it the way a player does.
	if ((await state(page)).phase === "chapter") {
		await page.evaluate(() => window.__tutorial?.next());
		await page.waitForFunction(
			() => window.__tutorial?.state().phase === "playing",
			{ timeout: budgetMs },
		);
	}
}

function state(page: Page) {
	return page.evaluate(() => window.__tutorial!.state());
}

/** What the *server* says the dummy is doing right now. */
function dummyBehaviour(page: Page) {
	return page.evaluate(() => window.__training!.state().config.behaviour);
}

/** Boot straight into a hero's course, seated and playing lesson one. */
async function openCourse(page: Page, hero: HeroId) {
	await page.goto(`${BASE_URL}/?tutorial=true&hero=${hero}&mute=1`);
	await page.waitForFunction(() => !!window.__tutorial && !!window.__training, {
		timeout: 25000,
	});
	const ready = await page.evaluate(() => window.__tutorial!.ready(25000));
	if (!ready) throw new Error(`the ${hero} course never reached a lesson`);
	await settled(page);
}

// ---------------------------------------------------------------------------
// 1. the menu
// ---------------------------------------------------------------------------

async function checkMenu(page: Page) {
	await page.goto(`${BASE_URL}/?mute=1`);
	await page.waitForSelector(".gd-menu-page", { timeout: 20000 });

	// The course is the page's first item. Asserted structurally rather than by
	// eye: "toppest thing" is a layout promise, and a later section heading
	// inserted above it would silently demote it.
	const firstItem = await page.evaluate(() => {
		const el = document.querySelector(".gd-play-item");
		return {
			tutorial: el?.classList.contains("gd-play-item-tutorial") ?? false,
			label: el?.querySelector("strong")?.textContent ?? "",
		};
	});
	check(
		"the tutorial is the first item on the root menu",
		firstItem.tutorial,
		firstItem.label,
	);

	await page.getByRole("button", { name: /Tutorial/ }).click();
	await page.waitForFunction(() => !!window.__tutorial, { timeout: 25000 });
	const url = page.url();
	check(
		"clicking it writes a tutorial launch URL",
		url.includes("tutorial=true"),
		url.replace(BASE_URL, ""),
	);

	const ready = await page.evaluate(() => window.__tutorial!.ready(25000));
	check("the course reaches its first lesson", ready);
	await settled(page);
	const first = await state(page);
	check(
		"the first lesson has objectives and none are pre-satisfied",
		first.objectives.length > 0 && first.objectives.every((o) => !o.done),
		`${first.lessonId} · ${first.objectives.length} objectives`,
	);
	// The coach card is the whole feature. A director that reports a lesson the
	// overlay never draws is a tutorial nobody can read.
	const card = await page.locator(".tut-card").count();
	check("the coach card is on screen", card === 1);
}

// ---------------------------------------------------------------------------
// 2. every lesson stages
// ---------------------------------------------------------------------------

async function checkCourse(page: Page, hero: HeroId) {
	await openCourse(page, hero);
	const lessons = lessonsOf(tutorialFor(hero));
	const wrong: string[] = [];

	for (const [index, lesson] of lessons.entries()) {
		await page.evaluate((i: number) => window.__tutorial!.goto(i), index);
		await settled(page);
		const live = await state(page);
		if (live.lessonId !== lesson.id) {
			wrong.push(`${index}: staged ${live.lessonId}, wanted ${lesson.id}`);
			continue;
		}
		if (live.objectives.length !== lesson.objectives.length) {
			wrong.push(`${lesson.id}: objectives did not survive the trip`);
			continue;
		}
		// The lesson's own claim about the enemy, checked against the server.
		const wanted = lesson.stage.behaviour ?? "idle";
		const actual = await dummyBehaviour(page);
		if (actual !== wanted) {
			wrong.push(
				`${lesson.id}: dummy is "${actual}", lesson asked "${wanted}"`,
			);
		}
	}

	check(
		`every ${hero} lesson stages its own enemy`,
		wrong.length === 0,
		wrong.length === 0 ? `${lessons.length} lessons` : wrong.join(" | "),
	);
}

// ---------------------------------------------------------------------------
// 3. objectives tick, and the course advances on its own
// ---------------------------------------------------------------------------

/** Where a lesson sits in its hero's course. */
function indexOf(hero: HeroId, lessonId: string): number {
	return lessonsOf(tutorialFor(hero)).findIndex((l) => l.id === lessonId);
}

/**
 * Stage one lesson, play it, and wait for the course to close it by itself.
 *
 * The drill is driven through `__training.input()` — the same override layer a
 * training scenario uses — because Playwright can press a key but cannot
 * express "hold attack for 80ms and let go on this frame", which is most of
 * what this game asks of a player.
 */
async function playLesson(
	page: Page,
	hero: HeroId,
	lessonId: string,
	drive: (page: Page) => Promise<void>,
	label: string,
) {
	const index = indexOf(hero, lessonId);
	await page.evaluate((i: number) => window.__tutorial!.goto(i), index);
	await settled(page);
	await drive(page);

	const cleared = await page
		.waitForFunction(
			(id: string) => {
				const s = window.__tutorial?.state();
				return s !== undefined && (s.phase === "cleared" || s.lessonId !== id);
			},
			lessonId,
			{ timeout: 25000 },
		)
		.then(() => true)
		.catch(() => false);
	const live = await state(page);
	check(
		label,
		cleared,
		live.lessonId === lessonId
			? live.objectives.map((o) => `${o.id} ${o.count}/${o.target}`).join(" · ")
			: `moved on to ${live.lessonId}`,
	);
	return lessonId;
}

/**
 * Play the opening lesson: walk, then jump twice.
 *
 * The one row that reads the objectives *while* the lesson is running, because
 * "the counters move at all" is a different failure from "the lesson closes".
 */
async function playFirstLesson(page: Page) {
	await page.evaluate(() => window.__tutorial!.goto(0));
	await settled(page);
	const before = await state(page);

	await page.evaluate(async () => {
		const t = window.__training!;
		// Four legs rather than two: the drill's ground is a corridor between
		// two pillars, so a single long hold walks into a wall and stops
		// counting. A player pacing back and forth covers it; so does this.
		for (let i = 0; i < 2; i++) {
			await t.input({ right: true }, 1200);
			await t.input({ left: true }, 1200);
		}
		await t.input({ up: true }, 120);
		await new Promise((r) => setTimeout(r, 400));
		await t.input({ up: true }, 120);
		await new Promise((r) => setTimeout(r, 400));
		await t.input({ up: true }, 120);
	});

	const during = await state(page);
	check(
		"the walk objective counts ground actually covered",
		(during.objectives.find((o) => o.id === "walk")?.count ?? 0) > 0,
		JSON.stringify(
			during.objectives.map((o) => `${o.id} ${o.count}/${o.target}`),
		),
	);
	check(
		"the jump objective counts jumps",
		(during.objectives.find((o) => o.id === "jump")?.count ?? 0) > 0,
	);

	// The course closes a lesson by itself once everything is met, and moves on.
	const advanced = await page
		.waitForFunction(
			(id: string) => {
				const s = window.__tutorial?.state();
				return s !== undefined && (s.phase === "cleared" || s.lessonId !== id);
			},
			before.lessonId,
			{ timeout: 25000 },
		)
		.then(() => true)
		.catch(() => false);
	check("a finished lesson clears itself", advanced, before.lessonId);

	return before.lessonId;
}

// ---------------------------------------------------------------------------
// 3b. --play: finish every drill in every course
// ---------------------------------------------------------------------------

/**
 * The drills, by shape rather than by lesson.
 *
 * Two heroes share the sword, so they share its drills; three heroes share the
 * feet. Keying on the shape is also the honest reading of what this proves —
 * "a player who does *this* clears the lesson" — and it keeps one bad drill
 * from looking like three broken lessons.
 */
type Drill =
	| "walk"
	| "air"
	| "dash"
	| "stance"
	| "swings"
	| "chain"
	| "guard"
	| "butterfly"
	| "uppercut"
	| "backstab"
	| "massive"
	| "plunge"
	| "gun"
	| "item"
	| "itemWait"
	| "itemDash"
	| "ultimate"
	| "thrust"
	| "shoryuken"
	| "mash";

/** Longest suffix wins, so `-basics-walk` beats `-walk` would-be matches. */
const DRILLS: [suffix: string, drill: Drill][] = [
	["-basics-walk", "walk"],
	["-basics-air", "air"],
	["-basics-dash", "dash"],
	["-basics-stance", "stance"],
	["-graduation-fight", "mash"],
	["-slash", "swings"],
	["-chain", "chain"],
	["-guard", "guard"],
	["-butterfly", "butterfly"],
	["-uppercut", "uppercut"],
	["-backstab", "backstab"],
	["-massive", "massive"],
	["-plunge", "plunge"],
	["-gun", "gun"],
	["-ultimate", "ultimate"],
	["-grenade", "item"],
	["-trap", "itemWait"],
	["-smoke", "itemDash"],
	["-stab", "swings"],
	["-thrust", "thrust"],
	["-shoryuken", "shoryuken"],
	["-pressure", "swings"],
];

function drillFor(lessonId: string): Drill | null {
	for (const [suffix, drill] of DRILLS)
		if (lessonId.endsWith(suffix)) return drill;
	return null;
}

/**
 * Play one drill, in the page.
 *
 * Everything goes through `__training.input()`, which holds a set of buttons
 * for an exact number of milliseconds and lets go — the one thing Playwright
 * cannot express, and the whole of moves like the Massive Strike.
 *
 * The plunge is the interesting one. A charge fires on *release*, so the dive
 * needs the button still held while the fighter is airborne — and every
 * `input()` call ends with a release. The answer is the training room's own
 * trick: a second `hold` replaces the first with no released frame in between,
 * so the first call is deliberately left un-awaited and the second one adds the
 * jump.
 */
async function drill(page: Page, kind: Drill) {
	await page.evaluate(async (k: string) => {
		const t = window.__training!;
		const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
		const gap = () => {
			const s = t.state();
			return s.dummy.x - s.local.x;
		};
		const aim = () => (gap() > 0 ? 0 : Math.PI);
		// Close to about a body-and-a-half and no closer. A backstab is refused
		// inside `BACKSTAB_MIN_SEPARATION_PX`, so a drill that walks right up to
		// the dummy turns every hit from behind into an ordinary one — which is
		// how the backstab drill failed while the move itself worked fine.
		const approach = async (target = 55) => {
			const g = gap();
			if (Math.abs(g) > target + 15)
				await t.input(
					g > 0 ? { right: true } : { left: true },
					Math.min(420, (Math.abs(g) - target) * 3),
				);
		};
		/** Inside the uppercut's 34px reach, which is barely past your own body. */
		const closeIn = () => approach(26);

		switch (k) {
			case "walk":
				for (let i = 0; i < 2; i++) {
					await t.input({ right: true }, 1200);
					await t.input({ left: true }, 1200);
				}
				for (let i = 0; i < 3; i++) {
					await t.input({ up: true }, 120);
					await sleep(700);
				}
				break;
			case "air":
				for (let i = 0; i < 3; i++) {
					await t.input({ up: true }, 110);
					await sleep(220);
					await t.input({ up: true }, 110);
					await sleep(900);
				}
				break;
			case "dash":
				for (let i = 0; i < 3; i++) {
					await t.input({ dash: 1 }, 120);
					await sleep(500);
				}
				for (let i = 0; i < 2; i++) {
					await t.input({ up: true }, 110);
					await sleep(160);
					await t.input({ dash: -1 }, 120);
					await sleep(900);
				}
				break;
			case "stance":
				await t.input({ swordStance: false }, 220);
				await sleep(250);
				await t.input({ swordStance: false, dash: 1 }, 160);
				await sleep(500);
				await t.input({ swordStance: false, dash: -1 }, 160);
				await sleep(500);
				await t.input({ swordStance: true }, 220);
				break;
			case "swings":
				for (let i = 0; i < 12; i++) {
					// The dagger's stab reaches 30px where the slash reaches 42, so
					// the shared drill closes to the shorter of the two.
					await approach(34);
					await t.input({ attack: true }, 80, aim());
					await sleep(340);
				}
				break;
			case "chain":
				for (let i = 0; i < 5; i++) {
					await approach();
					const angle = aim();
					await t.input({ attack: true }, 70, angle);
					await sleep(130);
					await t.input({ attack: true }, 70, angle);
					await sleep(130);
					await t.input({ attack: true }, 70, angle);
					await sleep(800);
				}
				break;
			case "guard":
				await t.input({ block: true }, 8000, aim());
				break;
			case "butterfly":
				for (let i = 0; i < 6; i++) {
					await approach();
					const angle = aim();
					await t.input({ attack: true }, 70, angle);
					await t.input({ block: true }, 450, angle);
					await sleep(300);
				}
				break;
			case "uppercut":
				for (let i = 0; i < 10; i++) {
					await closeIn();
					await t.input({ uppercut: true }, 80, aim());
					await sleep(520);
				}
				break;
			case "backstab":
				for (let i = 0; i < 8; i++) {
					await approach();
					await t.input({ attack: true }, 80, aim());
					await sleep(400);
				}
				break;
			case "massive":
				for (let i = 0; i < 3; i++) {
					await approach();
					await t.input({ attack: true }, 1800, aim());
					await sleep(1200);
				}
				break;
			case "plunge":
				for (let i = 0; i < 3; i++) {
					await approach();
					const angle = aim();
					const charge = t.input({ attack: true }, 3000, angle);
					await sleep(1800);
					// No aim angle on the second hold: an aimed `input()` leads with
					// a 50ms *empty* hold to turn the fighter first, and an empty
					// hold releases attack — which fires the charge as a ground slam
					// the instant before the jump.
					await t.input({ attack: true, up: true }, 420);
					await charge;
					await sleep(1600);
				}
				break;
			case "gun":
				await t.input({ swordStance: false }, 220);
				for (let i = 0; i < 12; i++) {
					await t.input({ swordStance: false, attack: true }, 260, aim());
					await sleep(220);
				}
				break;
			case "item":
				for (let i = 0; i < 2; i++) {
					await t.input({ item: true }, 80, aim());
					await sleep(2000);
				}
				break;
			case "itemWait":
				await t.input({ item: true }, 80, aim());
				await sleep(9000);
				break;
			case "itemDash":
				await t.input({ item: true }, 80, aim());
				await sleep(900);
				await t.input({ dash: 1 }, 120);
				await sleep(600);
				break;
			case "ultimate":
				await t.input({ ultimate: true }, 700, aim());
				await sleep(7000);
				break;
			case "thrust":
				for (let i = 0; i < 5; i++) {
					await approach();
					await t.input({ block: true }, 220, aim());
					await sleep(1000);
				}
				break;
			case "shoryuken":
				for (let i = 0; i < 12; i++) {
					await closeIn();
					await t.input({ uppercut: true }, 80, aim());
					await sleep(600);
				}
				break;
			case "mash":
				for (let i = 0; i < 30; i++) {
					const g = gap();
					if (Math.abs(g) > 52)
						await t.input(
							g > 0 ? { right: true } : { left: true },
							Math.min(400, Math.abs(g) * 3),
						);
					await t.input({ attack: true }, 80, g > 0 ? 0 : Math.PI);
					await sleep(320);
				}
				break;
		}
	}, kind);
}

/** Play every drill in one hero's course and report the ones that never end. */
async function playEveryLesson(page: Page, hero: HeroId) {
	await openCourse(page, hero);
	const lessons = lessonsOf(tutorialFor(hero));
	const stuck: string[] = [];

	for (const [index, lesson] of lessons.entries()) {
		const kind = drillFor(lesson.id);
		if (kind === null) {
			stuck.push(`${lesson.id}: no drill written for it`);
			continue;
		}
		await page.evaluate((i: number) => window.__tutorial!.goto(i), index);
		await settled(page);
		await drill(page, kind);

		const done = await page
			.waitForFunction(
				(id: string) => {
					const s = window.__tutorial?.state();
					return (
						s !== undefined && (s.phase === "cleared" || s.lessonId !== id)
					);
				},
				lesson.id,
				{ timeout: 4000 },
			)
			.then(() => true)
			.catch(() => false);
		if (!done) {
			const live = await state(page);
			stuck.push(
				`${lesson.id} [${live.objectives
					.filter((o) => !o.done)
					.map((o) => `${o.id} ${o.count}/${o.target}`)
					.join(", ")}]`,
			);
		}
	}

	check(
		`every ${hero} lesson can be finished`,
		stuck.length === 0,
		stuck.length === 0 ? `${lessons.length} drills` : stuck.join(" | "),
	);
}

// ---------------------------------------------------------------------------
// 4. progress survives
// ---------------------------------------------------------------------------

async function checkProgress(page: Page, lessonId: string) {
	const stored = await page.evaluate(
		() => window.localStorage.getItem("golpe.campaign") ?? "",
	);
	check(
		"a cleared lesson is written to progress",
		stored.includes(lessonId),
		stored.slice(0, 120),
	);

	await page.goto(`${BASE_URL}/?mute=1`);
	await page.waitForSelector(".gd-menu-page", { timeout: 20000 });
	const badge = await page.evaluate(
		() => document.querySelector(".gd-badge")?.textContent ?? "",
	);
	check("the menu shows how far the course got", badge !== "", badge);
}

// ---------------------------------------------------------------------------

async function main() {
	await assertServerUp();

	const browser = await chromium.launch();
	const ctx = await browser.newContext({
		viewport: { width: 900, height: 900 },
	});
	const page = await ctx.newPage();
	const pageErrors: string[] = [];
	page.on("pageerror", (e) => pageErrors.push(e.message));

	// tsx compiles this file with esbuild's `keep-names`, which wraps every
	// named function expression in a `__name(fn, "fn")` helper. Playwright
	// serialises an evaluated function's *source*, so the helper travels into
	// the page and is not defined there — every drill died with "__name is not
	// defined" until this shim went in. Identity is the correct implementation:
	// the helper only exists to re-attach a `.name`.
	await page.addInitScript(() => {
		(globalThis as unknown as { __name?: unknown }).__name ??= <T>(fn: T): T =>
			fn;
	});

	await checkMenu(page);

	const heroes = (
		ONLY_HERO ? [ONLY_HERO as HeroId] : [...HERO_IDS]
	) as HeroId[];
	for (const hero of heroes) await checkCourse(page, hero);

	await openCourse(page, "lia");
	const played = await playFirstLesson(page);

	// A server-judged objective: only the server knows a swing connected, so
	// this is the row that proves the melee outcomes reach the counters at all.
	await playLesson(
		page,
		"lia",
		"lia-slash",
		async (p) => {
			await p.evaluate(async () => {
				const t = window.__training!;
				for (let i = 0; i < 5; i++) {
					await t.input({ attack: true }, 80, 0);
					await new Promise((r) => setTimeout(r, 500));
				}
			});
		},
		"landing three slashes clears the sword lesson",
	);

	// And an objective that arrives over the event bus rather than the training
	// channel: the cast is announced, not counted.
	await playLesson(
		page,
		"lia",
		"lia-ultimate",
		async (p) => {
			await p.evaluate(async () => {
				const t = window.__training!;
				// Hold, then release — the cast is the release, and the room
				// freezes for the cinematic before the grenade ever flies.
				await t.input({ ultimate: true }, 700, 0);
				await new Promise((r) => setTimeout(r, 6000));
			});
		},
		"casting the ultimate clears the ultimate lesson",
	);

	// The last lesson is the only one whose dummy can die, and a course whose
	// final objective is unreachable ends by never ending.
	await playLesson(
		page,
		"lia",
		"lia-graduation-fight",
		async (p) => {
			await p.evaluate(async () => {
				const t = window.__training!;
				// Close the distance, *then* swing, and re-read the gap every
				// time. A hit knocks both fighters apart and a counter-attacking
				// dummy walks; a probe that mashes attack from a fixed spot lands
				// two slashes and then whiffs forever from 84px away, which is a
				// fact about the probe rather than about the lesson.
				for (let i = 0; i < 30; i++) {
					const live = t.state();
					const gap = live.dummy.x - live.local.x;
					if (Math.abs(gap) > 52) {
						await t.input(
							gap > 0 ? { right: true } : { left: true },
							Math.min(400, Math.abs(gap) * 3),
						);
					}
					await t.input({ attack: true }, 80, gap > 0 ? 0 : Math.PI);
					await new Promise((r) => setTimeout(r, 320));
				}
			});
		},
		"the graduation dummy can actually be put down",
	);

	await checkProgress(page, played);

	if (PLAY_ALL) for (const hero of heroes) await playEveryLesson(page, hero);

	if (pageErrors.length) {
		check("no page errors", false, pageErrors.join(" | "));
	}

	console.log(
		failures === 0
			? "\nTUTORIAL PROBE: PASS"
			: `\nTUTORIAL PROBE: ${failures} FAILED`,
	);
	if (!KEEP_OPEN) await browser.close();
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
	console.error(e);
	process.exit(1);
});

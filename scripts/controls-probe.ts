#!/usr/bin/env node
/**
 * Controls feedback-loop harness.
 *
 * Nothing else in the loop can see a binding. `diagnose.ts` runs AI vs AI and
 * the brains hand the simulation an intent directly — no key is ever pressed —
 * so "block is on Shift now" and "the Esc menu stops the keyboard reaching the
 * fighter" are both invisible to every existing probe, exactly the way aim was
 * before `aim-probe.ts`.
 *
 * It presses real keys at a real browser and reads the simulation state back:
 *
 *   1. the defaults do what they say — Shift blocks, Space and W jump, and
 *      right-click no longer blocks,
 *   2. the Esc menu takes the keyboard away from the fighter,
 *   3. a rebind made by *pressing a key at the dialog* reaches the simulation,
 *      survives a reload, and is undone by Reset to defaults.
 *
 *   tsx scripts/controls-probe.ts
 *   GOLPE_URL=http://localhost:8084 tsx scripts/controls-probe.ts
 */
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { chromium } from "playwright";

const BASE_URL = process.env.GOLPE_URL ?? "http://localhost:8084";

/** A jump has to clear this much to count as one. A full jump peaks at 136px. */
const JUMP_RISE_PX = 60;
/** Drift the suspended-input check tolerates: friction settling, not walking. */
const IDLE_DRIFT_PX = 2;

/**
 * An empty room, and a fresh one per run.
 *
 * Bots are opt-in and a bot here would be pure noise: a fighter that stuns this
 * one cannot block, and "blocking: false" would be reported as a broken binding.
 * Two runs sharing a room id would land in the same match, so the id is minted
 * per run.
 */
function gameUrl() {
	return `${BASE_URL}/?bots=0&room=${randomUUID()}`;
}

const state = (page: Page) => page.evaluate(() => window.__gameState!());

async function waitForGame(page: Page) {
	await page.waitForFunction(() => typeof window.__gameState === "function", {
		timeout: 20000,
	});
	// A human-controlled client is asked for a name before it connects, through a
	// DOM modal over the canvas. This is the event the modal fires, so it is the
	// path a player takes rather than a bypass nobody plays.
	await page.evaluate(() => window.__setPlayerName?.("KeyProbe"));
	await page.waitForFunction(
		() => window.__matchState?.()?.connected === true,
		{
			timeout: 20000,
		},
	);
	await settle(page);
}

/** Wait until the fighter is alive and standing still on the floor. */
async function settle(page: Page) {
	for (let i = 0; i < 80; i++) {
		const s = await state(page);
		if (s.playerHP > 0 && s.playerPhys.grounded) return s;
		await page.waitForTimeout(100);
	}
	return state(page);
}

/** Hold a key, sample while it is down, and release it. */
async function hold(page: Page, code: string, ms = 200) {
	await page.keyboard.down(code);
	await page.waitForTimeout(ms);
	const during = await state(page);
	await page.keyboard.up(code);
	await page.waitForTimeout(120);
	return { during, after: await state(page) };
}

/** Hold a key and report the highest the fighter got. Y grows downward. */
async function jumpRise(page: Page, code: string) {
	const before = await settle(page);
	await page.keyboard.down(code);
	let peak = before.playerPhys.y;
	for (let i = 0; i < 8; i++) {
		await page.waitForTimeout(60);
		const s = await state(page);
		peak = Math.min(peak, s.playerPhys.y);
	}
	await page.keyboard.up(code);
	await page.waitForTimeout(600);
	return Math.round(before.playerPhys.y - peak);
}

async function openControls(page: Page) {
	await page.keyboard.press("Escape");
	await page.locator(".gd-menu-card").waitFor({ timeout: 3000 });
	await page.getByRole("button", { name: "Controls" }).click();
	await page.locator(".gd-bind-table").waitFor({ timeout: 3000 });
}

/** The slot buttons for one action row, as a player sees them. */
function slots(page: Page, label: string) {
	return page
		.locator(".gd-bind-table tr")
		.filter({ has: page.locator("th", { hasText: new RegExp(`^${label}$`) }) })
		.locator(".gd-slot");
}

async function closeMenu(page: Page) {
	await page.keyboard.press("Escape");
	await page.locator(".gd-menu-card").waitFor({ state: "detached" });
	await page.waitForTimeout(120);
}

async function run() {
	const browser = await chromium.launch();
	const ctx = await browser.newContext({
		viewport: { width: 900, height: 900 },
	});
	const page = await ctx.newPage();
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));

	const url = gameUrl();
	await page.goto(url);
	await waitForGame(page);

	const checks: { name: string; ok: boolean; detail: string }[] = [];
	const check = (name: string, ok: boolean, detail: string) =>
		checks.push({ name, ok, detail });

	// ---- the defaults ----
	const shift = await hold(page, "ShiftLeft");
	check(
		"Shift blocks",
		shift.during.playerPhys.blocking === true,
		`blocking=${shift.during.playerPhys.blocking}`,
	);
	check(
		"releasing Shift drops the guard",
		shift.after.playerPhys.blocking === false,
		`blocking=${shift.after.playerPhys.blocking}`,
	);

	// Right-click used to be block. It is now unbound, and a binding that quietly
	// still works is the same bug as one that quietly does not.
	const canvas = await page.locator("canvas").boundingBox();
	if (!canvas) throw new Error("no canvas to aim at");
	await page.mouse.move(
		canvas.x + canvas.width / 2,
		canvas.y + canvas.height / 2,
	);
	await page.mouse.down({ button: "right" });
	await page.waitForTimeout(200);
	const rightHeld = await state(page);
	await page.mouse.up({ button: "right" });
	check(
		"right-click no longer blocks",
		rightHeld.playerPhys.blocking === false,
		`blocking=${rightHeld.playerPhys.blocking}`,
	);

	const spaceUppercut = await hold(page, "Space");
	check(
		"Space uppercuts",
		spaceUppercut.during.playerPhys.meleeAction === "uppercut",
		`action=${spaceUppercut.during.playerPhys.meleeAction}`,
	);
	const wRise = await jumpRise(page, "KeyW");
	check("W still jumps", wRise >= JUMP_RISE_PX, `rose ${wRise}px`);

	// The item took F when the uppercut moved to Space. Lia's item is the HE
	// grenade, and the observable is the server spending a charge: two uses in
	// the life, one left after a press. Held for a few frames — a sub-frame
	// tap can land between two intent polls and never reach the wire, which is
	// exactly the edge the server is supposed to own.
	const chargesBefore = (await state(page)).itemCharges;
	await page.keyboard.down("KeyF");
	await page.waitForTimeout(150);
	await page.keyboard.up("KeyF");
	await page.waitForTimeout(200);
	const chargesAfter = (await state(page)).itemCharges;
	check(
		"F uses the item and spends a charge",
		chargesAfter === chargesBefore - 1,
		`charges ${chargesBefore} -> ${chargesAfter}`,
	);

	// ---- the menu takes the keyboard ----
	await settle(page);
	await page.keyboard.press("Escape");
	await page.locator(".gd-menu-card").waitFor({ timeout: 3000 });
	const menuOpen = await state(page);
	await page.keyboard.down("KeyD");
	await page.waitForTimeout(500);
	const walked = await state(page);
	await page.keyboard.up("KeyD");
	const drift = Math.abs(walked.playerPhys.x - menuOpen.playerPhys.x);
	check(
		"the Esc menu stops keys reaching the fighter",
		drift <= IDLE_DRIFT_PX,
		`moved ${drift.toFixed(1)}px while the menu was open`,
	);
	await closeMenu(page);

	// ---- a rebind, made the way a player makes one ----
	await openControls(page);
	await slots(page, "Block").first().click();
	await page.waitForTimeout(80);
	await page.keyboard.press("KeyC");
	await page.waitForTimeout(80);
	const shown =
		(await slots(page, "Block").first().textContent())?.trim() ?? "";
	check("the dialog captures the key that was pressed", shown === "C", shown);
	await closeMenu(page);

	const rebound = await hold(page, "KeyC");
	check(
		"the rebound key reaches the simulation",
		rebound.during.playerPhys.blocking === true,
		`blocking=${rebound.during.playerPhys.blocking}`,
	);
	const oldKey = await hold(page, "ShiftLeft");
	check(
		"the displaced binding stops working",
		oldKey.during.playerPhys.blocking === false,
		`blocking=${oldKey.during.playerPhys.blocking}`,
	);

	// ---- it survives a reload ----
	await page.goto(url);
	await waitForGame(page);
	const afterReload = await hold(page, "KeyC");
	check(
		"the binding survives a reload",
		afterReload.during.playerPhys.blocking === true,
		`blocking=${afterReload.during.playerPhys.blocking}`,
	);

	// ---- reset ----
	await settle(page);
	await openControls(page);
	await page.getByRole("button", { name: "Reset to defaults" }).click();
	await page.waitForTimeout(120);
	const resetLabel =
		(await slots(page, "Block").first().textContent())?.trim() ?? "";
	check(
		"reset restores the default label",
		resetLabel === "Left Shift",
		resetLabel,
	);
	await closeMenu(page);
	const afterReset = await hold(page, "ShiftLeft");
	check(
		"reset restores the default binding",
		afterReset.during.playerPhys.blocking === true,
		`blocking=${afterReset.during.playerPhys.blocking}`,
	);
	const strayKey = await hold(page, "KeyC");
	check(
		"reset unbinds what was rebound",
		strayKey.during.playerPhys.blocking === false,
		`blocking=${strayKey.during.playerPhys.blocking}`,
	);

	if (errors.length) check("no page errors", false, errors.join(" | "));

	await ctx.close();
	await browser.close();

	const failures = checks.filter((c) => !c.ok);
	return {
		verdict: failures.length ? "FAIL" : "PASS",
		passed: checks.length - failures.length,
		of: checks.length,
		checks,
	};
}

run()
	.then((report) => {
		console.log("\n===== CONTROLS =====");
		console.log(JSON.stringify(report, null, 2));
		process.exit(report.verdict === "FAIL" ? 1 : 0);
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});

/** One-off: open two online AI clients and dump what the first one sees. */
import { chromium } from "playwright";

const browser = await chromium.launch();
const ctx = await browser.newContext();
// One `room` for both tabs. Without it each client makes its own room and the
// two never meet, which reads as a netcode failure and is a URL mistake.
const room = `probe-${Date.now().toString(36)}`;
const url = `http://localhost:8080/?online=true&ai=true&fill=2&room=${room}`;
const lines = [];

const a = await ctx.newPage();
a.on("console", (m) => lines.push(`A: ${m.text()}`));
a.on("pageerror", (e) => lines.push(`A-ERR: ${e.message}`));
await a.goto(url);

const b = await ctx.newPage();
b.on("pageerror", (e) => lines.push(`B-ERR: ${e.message}`));
await b.goto(url);

await a.waitForTimeout(6000);

console.log(lines.slice(0, 40).join("\n"));
console.log("--- __gameState() ---");
console.log(
	JSON.stringify(await a.evaluate(() => window.__gameState()), null, 2),
);

await browser.close();

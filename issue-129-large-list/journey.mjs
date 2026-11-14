import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
// Run from a garia checkout after `control-garia launch` and seeding 500 rows:
//   MAIN_JS=/path/to/main.js THROTTLE=6 node journey.mjs <evidence-dir>
// MAIN_JS replaces the served src/main.js so one live page can compare builds.
const require = createRequire(`${process.cwd()}/.agent/skills/verify-garia/helpers/package.json`);
const { chromium } = require("playwright");

const evidence = process.argv[2];
const throttle = Number(process.env.THROTTLE || 1);
const mainJs = process.env.MAIN_JS;
mkdirSync(evidence, { recursive: true });
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find((p) => p.url().includes("127.0.0.1:8765"));
await page.bringToFront();
await page.unrouteAll();
if (mainJs) {
  const body = readFileSync(mainJs, "utf8");
  await page.route(/\/main\.js(\?.*)?$/, (route) => route.fulfill({ body, contentType: "text/javascript" }));
}
const cdp = await page.context().newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
await page.reload();
const siblingWalk = await page.evaluate(async () =>
  (await (await fetch("main.js", { cache: "no-store" })).text()).includes('"nextElementSibling" : "previousElementSibling"'));
console.log("serving sibling walk:", siblingWalk, "throttle:", throttle);
await page.waitForFunction(() => document.querySelectorAll("#download-list .dl-item").length >= 500, null, { timeout: 20000 });
await page.waitForTimeout(2000);

const selection = () => page.evaluate(() => {
  const shown = [...document.querySelectorAll("#download-list .dl-item:not(.hidden)")];
  const gids = shown.map((r) => r.dataset.gid);
  const selected = shown.filter((r) => r.getAttribute("aria-selected") === "true").map((r) => gids.indexOf(r.dataset.gid));
  return { shown: shown.length, selected, focused: gids.indexOf(document.activeElement?.dataset?.gid) };
});
const settleFilter = (n) => page.waitForFunction((n) =>
  document.querySelectorAll("#download-list .dl-item:not(.hidden)").length === n
  && document.getElementById("view-count").textContent === `${n} items`, n, { timeout: 60000 });
const clickVisible = (i) => page.locator("#download-list .dl-item:not(.hidden) .dl-name").nth(i).click();
async function press(key, times = 1) {
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
  await page.waitForTimeout(300);
}

const checks = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ name, ok, actual, expected });
  console.log(ok ? "PASS" : "FAIL", name, JSON.stringify(actual));
}

const total = (await selection()).shown;
await clickVisible(0);
await press("ArrowDown", 30);
check("all: 30x ArrowDown from row 0 crosses section headers to row 30", (await selection()).selected, [30]);
await press("ArrowUp", 40);
check("all: ArrowUp past the top stays on row 0", (await selection()).selected, [0]);
await press("Shift+ArrowDown", 3);
check("all: Shift+ArrowDown x3 extends the range", (await selection()).selected, [0, 1, 2, 3]);
await press("Control+a");
check("all: Ctrl+A selects every visible row", (await selection()).selected.length, total);
await page.screenshot({ path: `${evidence}/1-all-ctrl-a.png` });

await page.keyboard.press("Control+f");
await page.keyboard.type("file-49", { delay: 30 });
await settleFilter(11);
await clickVisible(0);
await press("ArrowDown", 5);
check("search file-49: 5x ArrowDown skips hidden rows to match 5", (await selection()).selected, [5]);
await press("ArrowDown", 20);
check("search file-49: ArrowDown past the end stays on the last match", (await selection()).selected, [10]);
const focus = await selection();
check("search file-49: focus follows the selection", focus.focused, 10);
await page.screenshot({ path: `${evidence}/2-search-last-match.png` });
await page.locator("#name-filter").focus();
await page.keyboard.press("Escape");
await settleFilter(total);

// Handler cost: from the first keydown listener to the last bubbling one.
await clickVisible(0);
await page.evaluate(() => {
  window.__lat = [];
  window.addEventListener("keydown", () => { window.__t0 = performance.now(); }, { capture: true });
  window.addEventListener("keydown", () => { window.__lat.push(performance.now() - window.__t0); });
});
await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
const n = 200;
const t0 = Date.now();
for (let i = 0; i < n; i++) await page.keyboard.press("ArrowDown");
await page.waitForFunction((n) => document.querySelectorAll("#download-list .dl-item[aria-selected=true]").length === 1
  && [...document.querySelectorAll("#download-list .dl-item:not(.hidden)")].findIndex((r) => r.getAttribute("aria-selected") === "true") === n, n, { timeout: 120000 });
const burstMs = Date.now() - t0;
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
const lat = (await page.evaluate(() => window.__lat)).sort((a, b) => a - b);
const pct = (p) => Number(lat[Math.min(lat.length - 1, Math.floor(lat.length * p))].toFixed(2));
const timing = { presses: lat.length, medianMs: pct(0.5), p95Ms: pct(0.95), maxMs: Number(lat.at(-1).toFixed(2)), burstMs };
console.log("ArrowDown handler", JSON.stringify(timing));
check(`${n}x ArrowDown lands on row ${n}`, (await selection()).selected, [n]);
await page.screenshot({ path: `${evidence}/3-after-200-arrow-down.png` });

writeFileSync(`${evidence}/results.json`, JSON.stringify({
  mainJs: mainJs || "src/main.js", siblingWalk, cpuThrottle: throttle, totalRows: total, timing, checks,
}, null, 2) + "\n");
await page.unrouteAll();
process.exit(checks.every((c) => c.ok) ? 0 : 1);

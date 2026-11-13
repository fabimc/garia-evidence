import { createRequire } from "node:module";
// Run from a garia checkout after `control-garia launch` and seeding 500 paused rows:
//   THROTTLE=6 node journey.mjs <evidence-dir>
const require = createRequire(`${process.cwd()}/.agent/skills/verify-garia/helpers/package.json`);
const { chromium } = require("playwright");

const evidence = process.argv[2];
const throttle = Number(process.env.THROTTLE || 1);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find((p) => p.url().includes("127.0.0.1:8765"));
await page.bringToFront();
const cdp = await page.context().newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
await page.reload();
const hasFix = await page.evaluate(async () => (await (await fetch("main.js", { cache: "no-store" })).text()).includes("filterPending"));
console.log("serving fix:", hasFix, "throttle:", throttle);
await page.waitForFunction(() => document.querySelectorAll("#download-list .dl-item").length >= 500, null, { timeout: 20000 });
await page.waitForTimeout(2000);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });

const state = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll("#download-list .dl-item")];
  const shown = rows.filter((r) => !r.classList.contains("hidden"));
  const needle = document.getElementById("name-filter").value.toLowerCase();
  return {
    shown: shown.length,
    nonMatching: shown.filter((r) => needle && !r.dataset.name.toLowerCase().includes(needle)).length,
    header: document.getElementById("view-count").textContent,
  };
});

const results = [];

// Settled = the row set and header agree with the expected count for 3 straight seconds.
async function settle(step, label, expected, limitMs = 30000) {
  const t0 = Date.now();
  let okSince = 0;
  let s;
  let settledAfterS = null;
  while (Date.now() - t0 < limitMs) {
    s = await state();
    const ok = s.shown === expected && s.nonMatching === 0 && s.header === `${expected} items`;
    if (ok && !okSince) okSince = Date.now();
    if (!ok) okSince = 0;
    if (okSince && Date.now() - okSince >= 3000) {
      settledAfterS = Number(((okSince - t0) / 1000).toFixed(1));
      break;
    }
    await page.waitForTimeout(250);
  }
  const outcome = settledAfterS === null ? `STUCK after ${limitMs / 1000}s` : `settled after ${settledAfterS}s`;
  console.log(label.padEnd(20), outcome, JSON.stringify(s));
  results.push({ step, label, expected, settled: settledAfterS !== null, settledAfterS, final: s });
  if (evidence) await page.screenshot({ path: `${evidence}/${step}.png` });
}

const total = (await state()).shown;
const active = await page.evaluate(() => document.querySelectorAll('#download-list .dl-item[data-status="active"]').length);
await page.keyboard.press("Control+f");
await page.keyboard.type("file-49", { delay: 30 });
await settle("1-search-file-49", "search file-49", 11);
await page.keyboard.press("Escape");
await settle("2-clear-search", "clear search", total);
await page.locator("#filter-bar .nav-item", { hasText: "Active" }).first().click();
await settle("3-sidebar-active", "sidebar Active", active);
await page.locator("#filter-bar .nav-item", { hasText: "All Downloads" }).first().click();
await settle("4-sidebar-all", "sidebar All", total);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
if (evidence) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(`${evidence}/results.json`, JSON.stringify({ servingFix: hasFix, cpuThrottle: throttle, totalRows: total, steps: results }, null, 2) + "\n");
}
process.exit(0);

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
// Run from a garia checkout after `control-garia launch`:
//   node journey.mjs <ui-url> <evidence-dir>
const require = createRequire(`${process.cwd()}/.agent/skills/verify-garia/helpers/package.json`);
const { chromium } = require("playwright");

const [url, evidence] = process.argv.slice(2);
mkdirSync(evidence, { recursive: true });
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = await browser.contexts()[0].newPage();
await page.setViewportSize({ width: 1280, height: 800 });

const rpc = [];
page.on("request", (req) => {
  try {
    const body = req.postDataJSON();
    for (const call of Array.isArray(body) ? body : [body]) {
      if (call?.method && !/^aria2\.(tell|getGlobal|getVersion|getOption|getUris|getFiles|getPeers|getServers)|^system\.multicall$/.test(call.method)) {
        rpc.push(call.method);
      }
    }
  } catch {}
});

await page.goto(url);
await page.waitForFunction(() => document.getElementById("conn-text")?.textContent.includes("aria2 ·"), null, { timeout: 20000 });
await page.waitForSelector(".dl-item");

const state = () => page.evaluate(() => {
  const a = document.activeElement;
  const row = a?.closest?.(".dl-item");
  const menu = document.getElementById("row-menu");
  const open = !menu.classList.contains("hidden");
  const m = menu.getBoundingClientRect();
  const r = row?.getBoundingClientRect();
  return {
    focused: a?.closest?.("#row-menu") ? `menu › ${a.querySelector("span")?.textContent}` : a?.classList?.contains("dl-item") ? `row ${a.dataset.name}` : row ? `${row.dataset.name} › ${a.dataset?.action || a.tagName.toLowerCase()}` : a?.id ? `#${a.id}` : a?.tagName?.toLowerCase(),
    menuOpen: open,
    menuItems: open ? [...menu.querySelectorAll("button > span:first-child")].map((s) => s.textContent) : [],
    menuAt: open ? { left: Math.round(m.left), top: Math.round(m.top) } : null,
    focusedRowBox: r ? { left: Math.round(r.left), bottom: Math.round(r.bottom) } : null,
    selection: [...document.querySelectorAll('.dl-item[aria-selected="true"]')].map((s) => `${s.dataset.name} (${s.dataset.status})`),
  };
});

const results = [];
async function record(step, label, extra = {}) {
  await page.waitForTimeout(600);
  const s = { step, label, ...(await state()), rpcSinceLastStep: rpc.splice(0), ...extra };
  console.log(JSON.stringify(s));
  results.push(s);
  await page.screenshot({ path: `${evidence}/${step}.png` });
  return s;
}
async function settleFocus(locator) {
  await locator.focus();
  await page.waitForTimeout(400);
}
async function closeMenu() {
  if (await page.evaluate(() => !document.getElementById("row-menu").classList.contains("hidden"))) {
    await page.keyboard.press("Escape");
  }
}

// The issue's reproduction: a completed row, reached by Ctrl+F, Tab, Tab.
await page.click('#filter-bar .nav-item[data-filter="complete"]');
await page.waitForTimeout(400);
await page.keyboard.press("Control+f");
await page.keyboard.press("Tab");
await page.keyboard.press("Tab");
await page.waitForTimeout(400);
await record("1-focus-row", "Completed view, Ctrl+F, Tab, Tab");
await page.keyboard.press("Shift+F10");
await record("2-shift-f10", "Shift+F10");
await page.keyboard.press("ArrowDown");
await record("3-arrow-down", "ArrowDown in the menu");
await page.keyboard.press("Escape");
await record("4-escape", "Escape");
await page.keyboard.press("ContextMenu");
await record("5-menu-key", "Menu key (ContextMenu)");
await page.keyboard.press("Tab");
await record("6-tab-out", "Tab in the menu");
await closeMenu();
await page.keyboard.press("F10");
await record("7-plain-f10", "Plain F10 with the row focused");
await closeMenu();

// Opening the menu on a row that is already part of a multi-selection keeps it.
const done = page.locator(".dl-item:not(.hidden)");
await done.nth(0).locator(".dl-status-cell").click();
await done.nth(1).locator(".dl-status-cell").click({ modifiers: ["Shift"] });
await settleFocus(done.nth(1));
await page.keyboard.press("Shift+F10");
await record("8-multi-select", "Two rows selected, focus the second, Shift+F10");
await closeMenu();

// Running an item from the keyboard leaves focus on the row.
await page.click('#filter-bar .nav-item[data-filter="all"]');
await page.waitForTimeout(400);
const ubuntu = page.locator('.dl-item[data-gid="aaaa1111"]');
await ubuntu.locator(".dl-status-cell").click();
await settleFocus(ubuntu);
rpc.splice(0);
await page.keyboard.press("Shift+F10");
await record("9-menu-on-active-row", "Active Ubuntu row, Shift+F10");
await page.keyboard.press("Enter");
await page.waitForTimeout(900);
await record("10-enter-pause", "Enter on Pause");
await closeMenu();

// Right-click still opens at the pointer and selects the row under it.
await page.click('#filter-bar .nav-item[data-filter="complete"]');
await page.waitForTimeout(400);
await done.nth(0).locator(".dl-status-cell").click();
const box = await done.nth(1).boundingBox();
await page.mouse.click(box.x + 500, box.y + box.height / 2, { button: "right" });
await record("11-right-click", "Right-click the unselected second row", { pointer: { x: Math.round(box.x + 500), y: Math.round(box.y + box.height / 2) } });
await closeMenu();

writeFileSync(`${evidence}/results.json`, JSON.stringify({ url, steps: results }, null, 2) + "\n");
await page.close();
process.exit(0);

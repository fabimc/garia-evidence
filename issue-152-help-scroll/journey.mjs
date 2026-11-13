import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
// Run from a garia checkout after `control-garia launch`:
//   node journey.mjs <ui-url> <evidence-dir>
const require = createRequire(`${process.cwd()}/.agent/skills/verify-garia/helpers/package.json`);
const { chromium } = require("playwright");

const [url, evidence] = process.argv.slice(2);
const viewport = { width: 1256, height: 670 };
mkdirSync(evidence, { recursive: true });
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = await browser.contexts()[0].newPage();
await page.setViewportSize(viewport);
await page.goto(url);
await page.waitForFunction(() => document.getElementById("conn-text")?.textContent.includes("aria2 ·"), null, { timeout: 20000 });
// The Tauri webview sets this class at boot; browser-dev has no __TAURI__, so apply it directly.
await page.evaluate(() => document.documentElement.classList.add("in-app"));
const servingFix = await page.evaluate(() => document.querySelector("#help-overlay .help-body").hasAttribute("tabindex"));
console.log(url, "serving fix:", servingFix);

const visible = (rect, clip) =>
  rect.bottom > clip.top && rect.top < clip.bottom && rect.right > clip.left && rect.left < clip.right;

const state = () => page.evaluate(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
  const overlay = document.getElementById("help-overlay");
  const body = overlay.querySelector(".help-body");
  const active = document.activeElement;
  return {
    open: !overlay.classList.contains("hidden"),
    windowHeight: innerHeight,
    sheet: r(overlay.querySelector(".modal")),
    body: r(body),
    bodyScrollHeight: body.scrollHeight,
    bodyClientHeight: body.clientHeight,
    bodyScrollTop: Math.round(body.scrollTop),
    done: r(document.getElementById("help-done")),
    setupAgain: r(document.getElementById("help-setup")),
    focused: active === body ? ".help-body" : active.id ? `#${active.id}` : `${active.tagName.toLowerCase()}:${active.textContent.trim().slice(0, 40)}`,
    focusedRect: r(active),
    focusedInBody: body.contains(active) && active !== body,
  };
});

const win = { top: 0, bottom: viewport.height, left: 0, right: viewport.width };
const onScreen = (s, rect, inBody) => visible(rect, win) && (!inBody || visible(rect, s.body));
const results = [];
async function record(step, label) {
  const s = await state();
  const summary = {
    step,
    label,
    sheetBottom: s.sheet.bottom,
    doneVisible: onScreen(s, s.done, false),
    setupAgainVisible: onScreen(s, s.setupAgain, true),
    bodyScrollTop: s.bodyScrollTop,
    focused: s.focused,
  };
  console.log(JSON.stringify(summary));
  results.push({ ...summary, raw: s });
  await page.screenshot({ path: `${evidence}/${step}.png` });
  return s;
}

await page.keyboard.press("Control+Shift+Slash");
await page.waitForTimeout(400);
await record("1-open", "Ctrl+Shift+/ opens Help");
await page.keyboard.press("PageDown");
await page.waitForTimeout(400);
await record("2-page-down", "Page Down");
await page.keyboard.press("End");
await page.waitForTimeout(400);
await record("3-end", "End");

await page.keyboard.press("Home");
await page.locator("#help-close").focus();
const tabs = [];
for (let i = 1; i <= 20; i++) {
  await page.keyboard.press("Tab");
  await page.waitForTimeout(150);
  const s = await state();
  tabs.push({ press: i, focused: s.focused, onScreen: onScreen(s, s.focusedRect, s.focusedInBody) });
  if (s.focused === "#help-done") break;
}
console.log("tab walk:", JSON.stringify(tabs));
await record("4-tab-to-done", "Tab from close button until Done");

await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const closedOnEscape = !(await state()).open;
console.log("escape closes:", closedOnEscape);

writeFileSync(`${evidence}/results.json`, JSON.stringify({ url, servingFix, viewport, inApp: true, steps: results, tabWalk: tabs, closedOnEscape }, null, 2) + "\n");
await page.close();
process.exit(0);

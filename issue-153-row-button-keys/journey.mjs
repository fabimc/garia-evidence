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
await page.waitForSelector('.dl-item[data-gid="cccc4444"]');

const SELECTED = "aaaa1111";
const state = () => page.evaluate((selectedGid) => {
  const a = document.activeElement;
  const row = a?.closest?.(".dl-item");
  const notice = document.getElementById("notice-banner");
  return {
    focused: a?.dataset?.action ? `${row?.dataset.name} › ${a.dataset.action}` : a?.classList?.contains("dl-name") ? `${row?.dataset.name} › name` : a?.classList?.contains("dl-item") ? `row ${a.dataset.name}` : a?.id ? `#${a.id}` : a?.tagName?.toLowerCase(),
    detailOpen: !document.getElementById("detail-pane").classList.contains("hidden"),
    selectedRow: { gid: selectedGid, status: document.querySelector(`.dl-item[data-gid="${selectedGid}"]`)?.dataset.status },
    selection: [...document.querySelectorAll('.dl-item[aria-selected="true"]')].map((r) => r.dataset.name),
    notice: notice && !notice.classList.contains("hidden") ? notice.textContent.trim().replace(/\s+/g, " ") : null,
  };
}, SELECTED);

const results = [];
async function record(step, label, extra = {}) {
  await page.waitForTimeout(600);
  const s = { step, label, ...(await state()), rpcSinceLastStep: rpc.splice(0), ...extra };
  console.log(JSON.stringify(s));
  results.push(s);
  await page.screenshot({ path: `${evidence}/${step}.png` });
  return s;
}

async function tabTo(gid, action) {
  const sel = `.dl-item[data-gid="${gid}"] [data-action="${action}"]`;
  for (let i = 1; i <= 200; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate((s) => document.activeElement?.matches(s), sel)) return i;
  }
  throw new Error(`Tab never reached ${sel}`);
}

// Select the active Ubuntu row so the list shortcuts have a target to act on.
await page.locator(`.dl-item[data-gid="${SELECTED}"] .dl-status-cell`).click();
rpc.splice(0);

await page.keyboard.press("Control+f");
let presses = await tabTo("cccc4444", "retry");
await record("1-focus-retry", "Ctrl+F, then Tab to broken-mirror.tar.xz › Retry", { tabPresses: presses });
await page.keyboard.press("Enter");
await record("2-enter-on-retry", "Enter on Retry");

await page.keyboard.press("Control+f");
presses = await tabTo("cccc5555", "retry");
await page.keyboard.press("Space");
await record("3-space-on-retry", "Ctrl+F, Tab to half-written.iso › Retry, Space", { tabPresses: presses });

await page.keyboard.press("Control+f");
presses = await tabTo("cccc2222", "reveal");
await page.keyboard.press("Enter");
await record("4-enter-on-show-in-folder", "Ctrl+F, Tab to annual-report.pdf › Show in folder, Enter", { tabPresses: presses });

// List shortcuts must still work when the row itself has focus.
await page.keyboard.press("Escape");
await page.locator(`.dl-item[data-gid="${SELECTED}"] .dl-status-cell`).click();
await page.locator(`.dl-item[data-gid="${SELECTED}"]`).focus();
rpc.splice(0);
await page.keyboard.press("Space");
await record("5-space-on-row", "Space with the Ubuntu row focused");
await page.locator(`.dl-item[data-gid="${SELECTED}"]`).focus();
await page.keyboard.press("Enter");
await record("6-enter-on-row", "Enter with the Ubuntu row focused");

writeFileSync(`${evidence}/results.json`, JSON.stringify({ url, steps: results }, null, 2) + "\n");
await page.close();
process.exit(0);

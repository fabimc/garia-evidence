import { createRequire } from "module";
const require = createRequire("/home/user/garia/.agent/skills/verify-garia/helpers/");
const { chromium } = require("playwright");
import fs from "fs";
const label = process.argv[2]; const base = process.argv[3]; const out = `/home/user/garia-evidence/pr-175-help-scroll/${label}`;
fs.mkdirSync(out, { recursive: true });
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = b.contexts()[0].pages()[0];
const cdp = await page.context().newCDPSession(page);
const results = {};
for (const mode of ["browser", "in-app"]) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 520, deviceScaleFactor: 2, mobile: false });
  await page.goto(`${base}/?platform=linux`);
  await page.waitForFunction(() => document.querySelector("#conn-text")?.textContent.includes("aria2 ·"));
  if (mode === "in-app") await page.evaluate(() => document.documentElement.classList.add("in-app"));
  await page.locator("#download-list").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press("Control+Shift+/");
  await page.waitForSelector("#help-overlay:not(.hidden)");
  await page.waitForTimeout(200);
  const m = () => page.evaluate(() => {
    const body = document.querySelector("#help-overlay .help-body");
    const modal = document.querySelector("#help-overlay .modal");
    const done = document.getElementById("help-done").getBoundingClientRect();
    const kb = [...body.querySelectorAll("dt")].find((d) => /Keyboard-only/i.test(d.textContent));
    const kr = kb?.getBoundingClientRect(); const br = body.getBoundingClientRect();
    return { focused: document.activeElement === body, scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
      modalBottom: Math.round(modal.getBoundingClientRect().bottom), viewport: innerHeight, doneVisible: done.bottom <= innerHeight && done.top >= 0,
      keyboardOnlyInView: !!kr && kr.top >= br.top && kr.bottom <= br.bottom, maxHeight: getComputedStyle(modal).maxHeight };
  });
  const before = await m();
  await page.screenshot({ path: `${out}/help-scroll-${mode}-open.png` });
  let after, presses = 0;
  for (; presses < 10; presses++) { after = await m(); if (after.keyboardOnlyInView) break; await page.keyboard.press("PageDown"); await page.waitForTimeout(250); }
  await page.screenshot({ path: `${out}/help-scroll-${mode}-keyboard-only.png` });
  await page.keyboard.press("End"); await page.waitForTimeout(300);
  const end = await m();
  results[mode] = { before, pageDownPresses: presses, afterPageDown: after, end };
  await page.keyboard.press("Escape");
}
await cdp.send("Emulation.clearDeviceMetricsOverride");
fs.writeFileSync(`${out}/help-scroll.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await b.close().catch(()=>{});

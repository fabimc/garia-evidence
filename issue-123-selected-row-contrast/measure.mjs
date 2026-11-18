import { createRequire } from "module";
const require = createRequire(process.cwd() + "/helpers/package.json");
const { chromium } = require("playwright");
const out = process.argv[2];
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages()[0];
await page.setViewportSize({ width: 1280, height: 800 });
const results = [];
for (const scheme of ["light", "dark"]) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForTimeout(300);
  for (const status of ["active", "waiting", "paused", "complete", "error"]) {
    const row = page.locator(`#download-list [role=option][data-status="${status}"]`).first();
    if (!(await row.count())) { results.push({ scheme, status, missing: true }); continue; }
    await row.locator(".dl-status-text").click();
    await page.waitForTimeout(150);
    for (const hover of [true, false]) {
      if (hover) await row.hover(); else await page.mouse.move(5, 790);
      await page.waitForTimeout(200);
      const m = await row.evaluate((li) => {
        const t = li.querySelector(".dl-status-text");
        const parse = (c) => { const n = c.match(/[\d.]+/g).map(Number); return c.startsWith("color(") ? n.slice(0, 3).map((v) => v * 255) : n.slice(0, 3); };
        const lum = (rgb) => { const x = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return x[0] * 0.2126 + x[1] * 0.7152 + x[2] * 0.0722; };
        const fg = getComputedStyle(t).color, bg = getComputedStyle(li).backgroundColor;
        const [a, b] = [lum(parse(fg)), lum(parse(bg))].sort((p, q) => q - p);
        return { selected: li.classList.contains("is-selected"), text: t.textContent.trim().slice(0, 30), cls: t.className, fg, bg, ratio: +((a + 0.05) / (b + 0.05)).toFixed(2) };
      });
      results.push({ scheme, status, hover, ...m });
    }
    await row.screenshot({ path: `${out}/${scheme}-${status}-selected.png` });
  }
  await page.screenshot({ path: `${out}/${scheme}-list-selected.png` });
}
console.log(JSON.stringify(results, null, 1));
await browser.close();

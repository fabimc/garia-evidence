const { chromium } = require('playwright');
const [,, url, label, out, gid, mode] = process.argv;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 820 } });
  p.setDefaultTimeout(8000);
  await p.goto(url);
  await p.waitForFunction(() => (document.getElementById('conn-text')?.textContent || '').includes('aria2 ·'));
  await p.waitForSelector(`#download-list [data-gid="${gid}"]`);
  const read = () => p.evaluate((g) => {
    const row = document.querySelector(`#download-list li[data-gid="${g}"]`);
    return {
      status: row?.dataset.status,
      speedCell: row?.querySelector('[data-col="speed"]')?.textContent.trim(),
      rowText: row?.innerText.replace(/\s+/g, ' ').trim(),
      inspectorSpeed: document.querySelector('#detail-pane [data-fact="speed"] dd')?.textContent.trim(),
    };
  }, gid);
  if (mode === 'inspector') await p.evaluate((g) => document.querySelector(`#download-list li[data-gid="${g}"] .dl-name`).click(), gid);
  await p.waitForTimeout(1500);
  const before = await read();
  const clicked = await p.evaluate((g) => {
    const btn = document.querySelector(`#download-list li[data-gid="${g}"] [data-action="stop"]`) || document.querySelector(`[data-gid="${g}"][data-action="stop"]`);
    btn?.click(); return Boolean(btn);
  }, gid);
  await p.waitForTimeout(3500);
  const after = await read();
  await p.screenshot({ path: out });
  console.log(JSON.stringify({ label, mode, gid, clicked, before, after }, null, 2));
  await b.close();
})().catch(e => { console.error(String(e)); process.exit(1); });

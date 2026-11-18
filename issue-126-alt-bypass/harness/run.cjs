const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path'); const os=require('os');
const [extDir, outDir, label] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.setHeader('content-type','text/html'); return res.end(`<!doctype html><title>Files</title><body style="font:16px sans-serif;padding:24px">
  <h1>Test files</h1><p><a id="direct" href="/files/archive.zip">archive.zip</a></p>
  <p><a id="redir" href="/get?id=42">mirror (redirects to report.zip)</a></p>
  <p><a id="ctrl" href="/files/photos.zip">photos.zip</a></p></body>`); }
  if (req.url.startsWith('/get')) { res.statusCode = 302; res.setHeader('location','/files/report.zip'); return res.end(); }
  if (req.url.startsWith('/files/')) { res.setHeader('content-type','application/zip'); res.setHeader('content-disposition','attachment'); return res.end(Buffer.alloc(2048)); }
  res.statusCode=404; res.end();
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'prof-')), {
    headless: false, acceptDownloads: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--headless=new', '--no-sandbox'],
    viewport: { width: 900, height: 500 },
  });
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const page = await ctx.newPage();
  await page.goto(base + '/'); await page.waitForTimeout(500);
  const result = {};
  const tabsBefore = () => ctx.pages().length;
  async function step(name, fn) {
    const before = ctx.pages().map(p=>p);
    await fn(); await page.waitForTimeout(1500);
    const newTabs = ctx.pages().filter(p => !before.includes(p));
    const dl = await sw.evaluate(() => new Promise(r => chrome.downloads.search({}, r)));
    result[name] = { newTabs: newTabs.map(p => p.url().replace(/^chrome-extension:\/\/[^/]+/, 'ext:').slice(0,90)),
      downloads: dl.map(d => ({ url: d.url.replace(base,''), finalUrl: d.finalUrl.replace(base,''), state: d.state, error: d.error || '' })) };
    for (const t of newTabs) { if (t.url().includes('handoff.html')) { await t.screenshot({ path: `${outDir}/${label}-${name}-handoff.png` }); } await t.close(); }
    await sw.evaluate(() => new Promise(r => chrome.downloads.erase({}, r)));
    await page.bringToFront();
  }
  await step('alt-click', () => page.click('#direct', { modifiers: ['Alt'] }));
  await step('alt-click-redirect', () => page.click('#redir', { modifiers: ['Alt'] }));
  await step('ctrl-click', () => page.click('#ctrl', { modifiers: ['Control'] }));
  await step('plain-click', () => page.click('#direct'));
  await page.screenshot({ path: `${outDir}/${label}-page.png` });
  fs.writeFileSync(`${outDir}/${label}-results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await ctx.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });

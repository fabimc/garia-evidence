import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Run from a garia checkout, against a real aria2c (not the mock):
//   node journey.mjs <aria2c> <src-dir> <evidence-dir>
const require = createRequire(`${process.cwd()}/.agent/skills/verify-garia/helpers/package.json`);
const { chromium } = require("playwright");

const [aria2c, srcDir, evidence] = process.argv.slice(2);
mkdirSync(evidence, { recursive: true });
const RPC = "http://127.0.0.1:6800/jsonrpc";
const UI = "http://127.0.0.1:8765/index.html";
const URL = "https://proof.ovh.net/files/1Mb.dat";

const work = mkdtempSync(join(tmpdir(), "garia-155-"));
const engine = spawn(aria2c, [
  "--no-conf", "--enable-rpc", "--rpc-listen-port=6800", "--rpc-allow-origin-all",
  `--dir=${work}`, "--quiet",
], { stdio: "ignore" });
const ui = spawn("python3", ["-m", "http.server", "8765", "--bind", "127.0.0.1", "--directory", srcDir], { stdio: "ignore" });
const stop = () => { engine.kill(); ui.kill(); };
process.on("exit", stop);

let id = 0;
async function call(method, params = []) {
  const res = await fetch(RPC, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  return res.json();
}
async function waitFor(fn) {
  for (let i = 0; i < 100; i++) {
    try { if (await fn()) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out");
}
const engineState = async () => ({
  active: (await call("aria2.tellActive", [["gid", "status"]])).result,
  waiting: (await call("aria2.tellWaiting", [0, 100, ["gid", "status"]])).result,
  stopped: (await call("aria2.tellStopped", [0, 100, ["gid", "status"]])).result,
});

await waitFor(async () => (await call("aria2.getVersion")).result);
await waitFor(async () => (await fetch(UI)).ok);
const version = (await call("aria2.getVersion")).result.version;

// What aria2 itself answers for this case, without Garia in the way.
const probeGid = (await call("aria2.addUri", [[URL], { pause: "true" }])).result;
const probe = {
  gid: probeGid,
  statusAfterAdd: (await call("aria2.tellStatus", [probeGid, ["status"]])).result?.status,
  remove: await call("aria2.remove", [probeGid]),
  removeDownloadResult: await call("aria2.removeDownloadResult", [probeGid]),
  after: await engineState(),
};
writeFileSync(`${evidence}/aria2-probe.json`, JSON.stringify({ aria2: version, ...probe }, null, 2) + "\n");

const browser = await chromium.launch({ executablePath: process.env.GARIA_CHROME || "/usr/bin/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const rpc = [];
page.on("request", (req) => {
  try {
    const body = req.postDataJSON();
    const calls = body?.method === "system.multicall"
      ? body.params[0].map((c) => ({ method: c.methodName, params: c.params }))
      : [body];
    for (const c of calls) {
      if (c?.method && !/^aria2\.(tell|getGlobal|getVersion|getOption|getUris|getFiles|getPeers|getServers)/.test(c.method)) {
        rpc.push(`${c.method}(${JSON.stringify(c.params)})`);
      }
    }
  } catch {}
});

const state = () => page.evaluate(() => {
  const a = document.activeElement;
  const notice = document.getElementById("notice-banner");
  return {
    focused: a?.id ? `#${a.id}` : a?.classList?.contains("dl-item") ? `row ${a.dataset.name}` : a?.tagName?.toLowerCase(),
    rows: [...document.querySelectorAll("#download-list .dl-item")].map((r) => ({ gid: r.dataset.gid, name: r.dataset.name, status: r.dataset.status })),
    notice: notice && !notice.classList.contains("hidden") ? notice.textContent.trim().replace(/\s+/g, " ") : null,
  };
});
const results = [];
async function record(step, label, wait = 600) {
  await page.waitForTimeout(wait);
  const s = { step, label, ...(await state()), rpcSinceLastStep: rpc.splice(0), aria2: await engineState() };
  console.log(JSON.stringify(s));
  results.push(s);
  await page.screenshot({ path: `${evidence}/${step}.png` });
}

await page.goto(UI);
await page.waitForFunction(() => document.getElementById("conn-text")?.textContent.includes("aria2 ·"), null, { timeout: 20000 });

await page.click("#open-modal-btn");
await page.fill("#modal-url-input", URL);
await page.check('input[name="add-when"][value="queue"]');
await record("1-add-to-queue", "Add download: URL entered, Add to queue selected");
await page.click("#modal-ok");
await page.waitForSelector("#download-list .dl-item", { timeout: 10000 });
await record("2-queued-row", "Queued row after Add to queue", 1500);

const row = page.locator("#download-list .dl-item").first();
await row.locator(".dl-status-cell").click();
await row.focus();
await page.keyboard.press("Control+Delete");
await record("3-confirm-sheet", "Row selected, Ctrl+Delete");
await page.keyboard.press("Tab");
const onDelete = await page.evaluate(() => document.activeElement?.id);
await page.keyboard.press("Enter");
await record("4-after-delete", `Tab (focus on #${onDelete}), Enter`, 2000);

writeFileSync(`${evidence}/results.json`, JSON.stringify({ aria2: version, src: srcDir, steps: results }, null, 2) + "\n");
await browser.close();
process.exit(0);

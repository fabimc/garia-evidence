import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
// Run from a garia checkout, against the mock RPC:
//   node journey.mjs <checkout-dir> <evidence-dir>
const require = createRequire(`${process.cwd()}/.agent/skills/verify-garia/helpers/package.json`);
const { chromium } = require("playwright");

const [checkout, evidence] = process.argv.slice(2);
mkdirSync(evidence, { recursive: true });
const RPC = "http://127.0.0.1:6800/jsonrpc";
const UI = "http://127.0.0.1:8765/index.html";

const mock = spawn("node", ["mock-rpc.js"], { cwd: checkout, stdio: "ignore" });
const ui = spawn("python3", ["-m", "http.server", "8765", "--bind", "127.0.0.1", "--directory", `${checkout}/src`], { stdio: "ignore" });
const stop = () => { mock.kill(); ui.kill(); };
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
const stoppedOf = async (status) =>
  (await call("aria2.tellStopped", [0, 1000, ["gid", "status"]])).result.filter((d) => d.status === status).map((d) => d.gid);

await waitFor(async () => (await call("aria2.getVersion")).result);
await waitFor(async () => (await fetch(UI)).ok);

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
  const overlay = document.getElementById("confirm-overlay");
  const open = overlay && !overlay.classList.contains("hidden");
  return {
    view: document.getElementById("view-title")?.textContent.trim(),
    dialog: open ? {
      title: document.getElementById("confirm-title").textContent.trim(),
      text: overlay.querySelector(".modal-body").innerText.trim().replace(/[ \t]+/g, " "),
      button: document.getElementById("confirm-delete").textContent.trim(),
      trashOption: !document.getElementById("confirm-file-row").classList.contains("hidden"),
    } : null,
    rows: [...document.querySelectorAll("#download-list .dl-item")].filter((r) => r.getClientRects().length).map((r) => ({ name: r.dataset.name, status: r.dataset.status })),
  };
});
const results = [];
async function record(step, label, wait = 600) {
  await page.waitForTimeout(wait);
  const s = { step, label, ...(await state()), rpcSinceLastStep: rpc.splice(0) };
  console.log(JSON.stringify({ step, dialog: s.dialog, rows: s.rows.length }));
  results.push(s);
  await page.screenshot({ path: `${evidence}/${step}.png` });
}
async function filter(name) {
  await page.click(`#filter-bar .nav-item[data-filter="${name}"]`);
  await page.waitForFunction((status) => [...document.querySelectorAll("#download-list .dl-item")]
    .filter((r) => r.getClientRects().length)
    .every((r) => status === "all" || r.dataset.status === status), name, { timeout: 10000 });
  await page.waitForTimeout(500);
}
async function keepOnly(status) {
  for (const gid of (await stoppedOf(status)).slice(1)) await call("aria2.removeDownloadResult", [gid]);
  await page.waitForTimeout(2500);
  rpc.splice(0);
}

await page.goto(UI);
await page.waitForFunction(() => document.getElementById("conn-text")?.textContent.includes("aria2 ·"), null, { timeout: 20000 });

await filter("complete");
await page.click("#clear-completed");
await record("1-clear-completed-many", "Completed view, Clear completed with several finished downloads");
await page.click("#confirm-cancel");

await keepOnly("complete");
await page.click("#clear-completed");
await record("2-clear-completed-one", "Completed view, Clear completed with one finished download");
await page.click("#confirm-delete");
await record("3-clear-completed-removed", "Remove", 2500);

await filter("error");
await page.click("#clear-failed");
await record("4-clear-failed-many", "Failed view, Clear failed with several failed downloads");
await page.click("#confirm-cancel");

await keepOnly("error");
await page.click("#clear-failed");
await record("5-clear-failed-one", "Failed view, Clear failed with one failed download");
await page.click("#confirm-cancel");

await filter("all");
const row = page.locator('#download-list .dl-item[data-status="active"]').first();
await row.hover();
await row.locator('.dl-actions [data-action="remove"]').click();
await record("6-ordinary-delete", "All Downloads, row Delete action on an active download");
await page.click("#confirm-cancel");

writeFileSync(`${evidence}/results.json`, JSON.stringify({ checkout, steps: results }, null, 2) + "\n");
await browser.close();
process.exit(0);

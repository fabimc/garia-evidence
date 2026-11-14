import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
// Run from a garia checkout while the invoke bridge is up
// (`cargo test --lib live_bridge -- --ignored`, see README):
//   node journey.mjs <src-dir> <evidence-dir> <bridge-port> <bridge-dir> <payload-file>
const require = createRequire(`${process.cwd()}/.agent/skills/verify-garia/helpers/package.json`);
const { chromium } = require("playwright");

const [srcDir, evidence, bridgePort, bridgeDir, payload] = process.argv.slice(2);
mkdirSync(evidence, { recursive: true });
const BRIDGE = `http://127.0.0.1:${bridgePort}/invoke`;
const UI = "http://127.0.0.1:8766/index.html";
const FILE_URL = "http://127.0.0.1:8781/scheduled-161.bin";
const START_IN = 40;

// The file server logs every request, so "nothing reached the server before
// the start time" is a measurement rather than a reading of the UI.
const requests = [];
const files = createServer((req, res) => {
  requests.push({ at: Math.floor(Date.now() / 1000), method: req.method, url: req.url, range: req.headers.range || null });
  const size = statSync(payload).size;
  res.writeHead(200, { "Content-Length": size, "Accept-Ranges": "none" });
  if (req.method === "HEAD") return res.end();
  createReadStream(payload).pipe(res);
}).listen(8781, "127.0.0.1");
const ui = spawn("python3", ["-m", "http.server", "8766", "--bind", "127.0.0.1", "--directory", srcDir], { stdio: "ignore" });
process.on("exit", () => ui.kill());

async function waitFor(fn, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try { if (await fn()) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out");
}
async function invoke(cmd, args = {}) {
  const j = await (await fetch(BRIDGE, { method: "POST", body: JSON.stringify({ cmd, args }) })).json();
  if ("err" in j) throw new Error(j.err);
  return j.ok;
}
const engine = async () => ({
  active: await invoke("aria2_rpc", { method: "aria2.tellActive", params: [["gid", "status", "completedLength"]] }),
  waiting: await invoke("aria2_rpc", { method: "aria2.tellWaiting", params: [0, 100, ["gid", "status", "completedLength"]] }),
  stopped: await invoke("aria2_rpc", { method: "aria2.tellStopped", params: [0, 100, ["gid", "status", "completedLength"]] }),
});
const scheduleFile = () => { try { return JSON.parse(readFileSync(`${bridgeDir}/schedule.json`, "utf8")); } catch { return null; } };

await waitFor(async () => (await fetch(UI)).ok);
await waitFor(async () => (await invoke("aria2_rpc", { method: "aria2.getVersion", params: [] })).result);
const version = (await invoke("aria2_rpc", { method: "aria2.getVersion", params: [] })).result.version;

const browser = await chromium.launch({ executablePath: process.env.GARIA_CHROME || "/usr/bin/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript((bridge) => {
  window.__TAURI__ = {
    core: {
      invoke: async (cmd, args = {}) => {
        const j = await (await fetch(bridge, { method: "POST", body: JSON.stringify({ cmd, args }) })).json();
        if ("err" in j) throw j.err;
        return j.ok;
      },
    },
    event: { listen: async () => () => {} },
  };
}, BRIDGE);

const state = () => page.evaluate(() => ({
  rows: [...document.querySelectorAll("#download-list .dl-item")].map((r) => ({
    gid: r.dataset.gid, name: r.dataset.name, status: r.dataset.status,
    text: r.innerText.replace(/\s+/g, " ").trim(),
  })),
  statusBar: ["conn-text", "stat-counts", "stat-held", "stat-queue"].map((id) => {
    const el = document.getElementById(id);
    return el && !el.classList.contains("hidden") ? el.textContent.trim() : null;
  }).filter(Boolean),
}));
const results = [];
async function record(step, label, wait = 1500) {
  await page.waitForTimeout(wait);
  const s = {
    step, label, now: Math.floor(Date.now() / 1000), ...(await state()),
    scheduleJson: scheduleFile(), fileServerRequests: [...requests], aria2: await engine(),
  };
  console.log(JSON.stringify(s));
  results.push(s);
  await page.screenshot({ path: `${evidence}/${step}.png` });
}

await page.goto(UI);
await page.waitForFunction(() => document.getElementById("conn-text")?.textContent.includes("aria2"), null, { timeout: 20000 });

await page.click("#open-modal-btn");
await page.fill("#modal-url-input", FILE_URL);
await page.waitForSelector("#add-options:not(.hidden)");
await page.click("#add-options > summary");
await page.check("#add-start-on");
const startAt = Math.floor(Date.now() / 1000) + START_IN;
await page.evaluate((at) => {
  const d = new Date(at * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const input = document.getElementById("add-start-at");
  input.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, startAt);
await record("1-add-dialog", `Add download: URL entered, Options → Start at a time ticked, set to ${new Date(startAt * 1000).toLocaleTimeString()} (${START_IN}s ahead)`, 300);

await page.click("#modal-ok");
await page.waitForSelector("#download-list .dl-item", { timeout: 10000 });
await record("2-after-add", "Row right after Download", 2500);

await waitFor(() => Date.now() / 1000 >= startAt - 5, 600);
await record("3-just-before-start", "About 5 s before the start time", 0);

await waitFor(() => Date.now() / 1000 >= startAt + 8, 300);
await record("4-after-start", "About 8 s after the start time", 0);

writeFileSync(`${evidence}/results.json`, JSON.stringify({ aria2: version, src: srcDir, startAt, steps: results }, null, 2) + "\n");
await browser.close();
files.close();
process.exit(0);

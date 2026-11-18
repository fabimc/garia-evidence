import { chromium } from "<repo>/.agent/skills/verify-garia/helpers/node_modules/playwright/index.mjs";
const [url, out] = process.argv.slice(2);
const ERR = "The desktop notification service is unavailable. Check your notification daemon and session bus: Failed to connect to address `unix:path=/run/user/1000/bus`: No such file or directory (os error 2)";
const browser = await chromium.launch({ executablePath: "<chromium>" , args:["--no-sandbox"]});
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });
const log = [];
page.on("pageerror", (e) => log.push("pageerror " + e.message));
await page.addInitScript((ERR) => {
  window.__daemon = false; window.__calls = []; window.__saved = [];
  window.__TAURI__ = {
    notification: { isPermissionGranted: async () => true, requestPermission: async () => "granted" },
    core: { invoke: async (cmd, args) => {
      window.__calls.push(cmd);
      if (cmd === "check_notification_service") { if (!window.__daemon) throw ERR; return null; }
      if (cmd === "get_settings") return { notifyOnComplete: false, downloadDir: "/home/omarchy/Downloads" };
      if (cmd === "save_settings") { window.__saved.push(args); return args.settings ?? args; }
      if (cmd === "autostart_enabled") return false;
      if (cmd === "get_logins") return [];
      if (cmd === "sidecar_tools") return [];
      return null;
    } },
    event: { listen: async () => () => {}, emit: async () => {} },
  };
}, ERR);
await page.goto(url + "settings.html");
await page.waitForTimeout(800);
const state = async (label) => ({ label, checked: await page.isChecked("#settings-notify"),
  error: await page.$eval("#settings-error", (e) => e.classList.contains("hidden") ? null : e.textContent),
  probes: await page.evaluate(() => window.__calls.filter((c) => c === "check_notification_service").length),
  saves: await page.evaluate(() => window.__saved.length) });
const res = [await state("loaded, notifications off")];
await page.locator("#settings-notify").scrollIntoViewIfNeeded();
await page.click("#settings-notify"); await page.waitForTimeout(400);
res.push(await state("enable with no daemon"));
await page.screenshot({ path: out + "/settings-no-daemon.png" });
await page.evaluate(() => { window.__daemon = true; });
await page.click("#settings-notify"); await page.waitForTimeout(400);
res.push(await state("enable with daemon running"));
await page.screenshot({ path: out + "/settings-daemon-ok.png" });
console.log(JSON.stringify({ res, log }, null, 1));
await browser.close();

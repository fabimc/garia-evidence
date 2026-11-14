import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const ART = process.env.VERIFY_ARTIFACTS;
if (!ART) throw new Error("VERIFY_ARTIFACTS is not set");
const env = Object.fromEntries(
  readFileSync("/tmp/expenses-verify-pr78-wt/.env", "utf8").split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);
const BASE = env.APP_URL;
const proof = [];
const check = (ok, what) => {
  const line = `${new Date().toISOString()} ${ok ? "PASS" : "FAIL"} ${what}`;
  proof.push(line);
  console.log(line);
  if (!ok) process.exitCode = 1;
};

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: "en-US" });
try {
  await page.goto(BASE);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(env.LOCAL_LOGIN_EMAIL);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(env.LOCAL_LOGIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("navigation", { name: "Primary navigation" }).waitFor();

  await page.goto(`${BASE}/settings`);
  const bank = page.getByRole("region", { name: "Accounts" }).getByRole("combobox", { name: "Bank" });
  await bank.locator("option", { hasText: "Davivienda" }).waitFor({ state: "attached" });
  const options = await bank.locator("option").allTextContents();
  check(
    JSON.stringify(options) === JSON.stringify(["None", "BAC Credomatic", "DAVIbank", "Davivienda"]),
    `Accounts Bank picker lists ${JSON.stringify(options)}`,
  );
  await page.getByRole("region", { name: "Accounts" }).screenshot({ path: `${ART}/settings-accounts-bank.png` });

  await page.goto(`${BASE}/transactions`);
  await page.getByRole("heading", { name: "Transactions" }).waitFor();
  const row = (re) => page.getByRole("row").filter({ hasText: re });
  await row(/Intereses Corrientes/i).first().waitFor();
  check(
    await row(/Intereses Corrientes/i).getByTitle("Confirmed by the bank statement").count() === 1,
    "interest fee row has the Confirmed badge",
  );
  check(
    await row(/Cafe Sintetico/i).getByTitle("The statement covering this card and date did not list it").count() === 1,
    "unlisted feed row has the Not on statement badge",
  );
  check(await row(/Intereses Corrientes/i).getByRole("button", { name: /Delete|Edit/ }).count() === 0, "statement-created fee row has no Edit/Delete");
} catch (error) {
  check(false, error.message.split("\n")[0]);
} finally {
  appendFileSync(`${ART}/proof.txt`, ["recheck (script locator fixes, same instance):", ...proof].join("\n") + "\n");
  await browser.close();
}

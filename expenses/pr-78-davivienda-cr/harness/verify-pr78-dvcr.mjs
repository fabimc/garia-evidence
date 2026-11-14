import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const ART = process.env.VERIFY_ARTIFACTS;
if (!ART) throw new Error("VERIFY_ARTIFACTS is not set");
const WT = "/tmp/expenses-verify-pr78-wt";
const env = Object.fromEntries(
  readFileSync(`${WT}/.env`, "utf8").split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);
const BASE = env.APP_URL;
const TAG = readFileSync(`${ART}/run-token.txt`, "utf8").trim();
const parsed = JSON.parse(readFileSync(`${ART}/statements-parsed.json`, "utf8"));
const [crcStatement, usdStatement] = parsed.statements;

const proof = [];
const log = (line) => {
  proof.push(`${new Date().toISOString()} ${line}`);
  console.log(line);
};
const check = (ok, what) => {
  log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) process.exitCode = 1;
};
const redact = (text) => text.replaceAll(env.LOCAL_LOGIN_EMAIL, "[verify account]");
const save = (name, value) => writeFileSync(`${ART}/${name}`, redact(JSON.stringify(value, null, 2)) + "\n");

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: "en-US" });
const snap = async (name, { fullPage = true } = {}) => {
  const aria = redact(await page.locator("main").ariaSnapshot());
  writeFileSync(`${ART}/${name}.aria.txt`, aria);
  await page.screenshot({ path: `${ART}/${name}.png`, fullPage });
  return aria;
};
const api = (path, init = {}) =>
  page.evaluate(async ([path, i]) => {
    const r = await fetch(path, { credentials: "include", ...i });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  }, [path, init]);
const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let apiKey = null;
let keyId = null;
const bot = async (path, body, idempotencyKey = crypto.randomUUID()) => {
  const r = await fetch(`${BASE}/api/feed/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
const feedRow = (id, amount, type, merchant, date) => ({
  id: `${TAG}-${id}`,
  bankSlug: "davivienda-cr",
  amount,
  currency: "CRC",
  type,
  transactionDate: date,
  occurredAt: `${date}T18:00:00.000Z`,
  rawMerchantText: merchant,
  cardLast4: "1234",
});
const davivienda = async () => {
  const r = await api("/api/transactions?limit=100&offset=0");
  return r.body.transactions.filter((t) => t.bankName === "Davivienda" || t.bankSlug === "davivienda-cr" || t.cardLast4 === "1234");
};

try {
  // Sign in: one wrong password, register-mode fields, then the verify account.
  await page.goto(BASE);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(env.LOCAL_LOGIN_EMAIL);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Invalid email or password" }).waitFor();
  check(true, "wrong password shows the Invalid email or password alert");
  await page.getByRole("radio", { name: "Create account" }).check({ force: true });
  await page.getByRole("textbox", { name: "Confirm password", exact: true }).waitFor();
  check(
    await page.getByRole("button", { name: "Create account", exact: true }).count() === 1 &&
      await page.getByRole("textbox", { name: "Name" }).count() === 1,
    "register mode shows Name, Confirm password and a Create account button",
  );
  await page.getByRole("radio", { name: "Sign in" }).check({ force: true });
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(env.LOCAL_LOGIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("navigation", { name: "Primary navigation" }).waitFor();
  const me = await api("/api/me");
  check(me.status === 200, `/api/me status ${me.status}`);
  check(me.body?.user?.email === env.LOCAL_LOGIN_EMAIL, "/api/me is the dedicated verify account");

  // Plan baseline.
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Plan" }).click();
  await page.getByRole("heading", { name: /^Plan — / }).waitFor();
  await page.getByText("How leftover is built").click();
  await page.getByText("Income", { exact: true }).first().waitFor();
  const planAria = await snap("plan");
  check(/Income/.test(planAria) && /Bills/.test(planAria), "Plan disclosure shows Income and Bills");
  check(/Bank statements/.test(planAria), "Plan footer has the Bank statements link");
  check(!/Statement review/.test(planAria), "no Statement review nudge before any statement");

  // Settings: Davivienda is a seeded bank in the Accounts Bank picker.
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  const bankOptions = await page.getByRole("region", { name: "Accounts" }).getByRole("combobox", { name: "Bank" })
    .locator("option").allTextContents();
  log(`Accounts Bank options: ${JSON.stringify(bankOptions)}`);
  check(bankOptions.includes("Davivienda") && bankOptions.includes("DAVIbank"), "Bank picker lists Davivienda next to DAVIbank");
  const banks = await api("/api/banks");
  save("banks.json", banks);
  check(
    banks.body.banks?.some((b) => b.slug === "davivienda-cr" && b.name === "Davivienda" && b.defaultCurrency === "CRC"),
    "GET /api/banks has davivienda-cr (Davivienda, CRC)",
  );

  // Feed key from the signed-in context; kept in memory only.
  const minted = await api("/api/feed/keys", json("POST", { name: `verify-${TAG}` }));
  check(minted.status === 201, `minted a feed key (${minted.status})`);
  apiKey = minted.body.key.apiKey;
  keyId = minted.body.key.id;
  await page.reload();
  const keysRegion = page.getByRole("region", { name: "Feed API keys" });
  await keysRegion.getByText(`verify-${TAG}`).waitFor();
  await snap("settings", { fullPage: false });

  // A few davivienda-cr CRC feed rows.
  const fed = await bot("transactions", {
    transactions: [
      feedRow("f1", "-12500.50", "purchase", `FARMACIA EJEMPLO ${TAG}`, "2026-10-04"),
      feedRow("f2", "-37499.50", "purchase", `TIENDA ONLINE ${TAG}`, "2026-10-15"),
      feedRow("f3", "101000.00", "payment", `ABONO A SU CUENTA ${TAG}`, "2026-10-21"),
      feedRow("f4", "-8000.00", "purchase", `CAFE SINTETICO ${TAG}`, "2026-10-20"),
    ],
  });
  save("feed-transactions.json", fed);
  check(fed.status === 200 && fed.body.created === 4 && fed.body.validationFailures === 0, `feed created ${fed.body.created} davivienda-cr CRC rows`);

  const unknown = await bot("statements", { ...crcStatement, externalId: `${TAG}:unknown`, bankSlug: "davivienda-co" });
  save("statement-unknown-slug.json", unknown);
  check(unknown.status === 400 && /No seeded bank with slug/.test(unknown.body.error?.message ?? ""), `unknown slug refused (${unknown.status})`);

  // Both statements from parseDaviviendaStatement.
  const crc = await bot("statements", crcStatement);
  save("statement-crc.json", crc);
  check(crc.status === 200 && crc.body.alreadyReceived === false, `CRC statement accepted (${crc.status})`);
  check(
    JSON.stringify(crc.body.counts) === JSON.stringify({ lines: 5, matched: 3, created: 2, needsReview: 0, missing: 1 }),
    `CRC counts ${JSON.stringify(crc.body.counts)}`,
  );
  check(crc.body.failures?.length === 0, "CRC statement has no line failures");
  const usd = await bot("statements", usdStatement);
  save("statement-usd.json", usd);
  check(usd.status === 200, `USD statement accepted (${usd.status})`);
  check(
    JSON.stringify(usd.body.counts) === JSON.stringify({ lines: 1, matched: 0, created: 1, needsReview: 0, missing: 0 }),
    `USD counts ${JSON.stringify(usd.body.counts)}`,
  );
  const again = await bot("statements", usdStatement);
  save("statement-usd-resend.json", again);
  check(again.status === 200 && again.body.alreadyReceived === true, "resending the USD statement returns alreadyReceived: true");

  // Ledger state from the API.
  const rows = await davivienda();
  save("ledger-davivienda.json", rows.map((t) => ({
    date: t.transactionDate ?? t.date,
    amount: t.amount,
    currency: t.currency,
    type: t.type,
    source: t.source,
    reconciliation: t.reconciliation,
    rawMerchantText: t.rawMerchantText,
    merchant: t.merchant?.name ?? t.merchantName,
    bankName: t.bankName,
    cardLast4: t.cardLast4,
  })));
  const by = (pred) => rows.filter(pred);
  const amt = (t) => String(t.amount);
  check(rows.length === 7, `7 Davivienda rows in the ledger (${rows.length})`);
  check(
    ["-12500.50", "-37499.50", "101000.00"].every((a) => by((t) => amt(t) === a && t.source === "feed" && t.reconciliation === "confirmed").length === 1),
    "the 3 matched feed rows (2 purchases, 1 payment) are confirmed",
  );
  check(by((t) => amt(t) === "-8000.00" && t.reconciliation === "not_on_statement").length === 1, "the unlisted feed row is not_on_statement");
  const fee = by((t) => t.source === "statement" && amt(t) === "-2345.67");
  check(fee.length === 1 && fee[0].reconciliation === "confirmed" && fee[0].type === "fee" && fee[0].currency === "CRC", "interest fee -2345.67 CRC created and confirmed");
  const promo = by((t) => t.source === "statement" && amt(t) === "-1234567.89");
  check(promo.length === 1 && promo[0].reconciliation === "confirmed" && promo[0].type === "purchase", "promotion purchase created and confirmed");
  const usdRow = by((t) => t.source === "statement" && t.currency === "USD");
  check(usdRow.length === 1 && amt(usdRow[0]) === "-20.00" && usdRow[0].reconciliation === "confirmed", "USD purchase -20.00 created and confirmed");
  check(by((t) => t.source === "statement" && t.type === "payment").length === 0, "the payment matched its feed row instead of being duplicated");

  // Ledger UI.
  await page.goto(`${BASE}/transactions`);
  await page.getByRole("heading", { name: "Transactions" }).waitFor();
  const row = (re) => page.getByRole("row").filter({ hasText: re });
  await row(/Intereses Corrientes/i).first().waitFor();
  const ledgerAria = await snap("ledger");
  check(/Davivienda · ••1234/.test(ledgerAria), "rows read Davivienda · ••1234");
  check(await row(/Intereses Corrientes/i).getByText("Confirmed", { exact: true }).count() === 1, "interest fee row has the Confirmed badge");
  check(await row(/Intereses Corrientes/i).getByText(/-₡2,345\.67/).count() === 1, "interest fee row shows -₡2,345.67");
  check(await row(/Cafe Sintetico/i).getByText("Not on statement", { exact: true }).count() === 1, "unlisted feed row has the Not on statement badge");
  check(await row(/Abono a Su Cuenta/i).getByText(/₡101,000\.00/).count() >= 1, "payment row shows ₡101,000.00");

  const statementFilter = page.getByRole("combobox", { name: "Statement", exact: true });
  await statementFilter.selectOption({ label: "Confirmed" });
  await page.waitForURL(/reconciliation=confirmed/);
  await row(/Cafe Sintetico/i).first().waitFor({ state: "detached" });
  const confirmedRows = await page.getByRole("row").filter({ hasText: "Davivienda" }).count();
  check(confirmedRows === 6, `Statement = Confirmed shows 6 Davivienda rows (${confirmedRows})`);
  await snap("ledger-confirmed");
  await statementFilter.selectOption({ label: "Not on statement" });
  await page.waitForURL(/reconciliation=not_on_statement/);
  await row(/Cafe Sintetico/i).first().waitFor();
  const missingRows = await page.getByRole("row").filter({ hasText: "Davivienda" }).count();
  check(missingRows === 1, `Statement = Not on statement shows 1 Davivienda row (${missingRows})`);
  await snap("ledger-not-on-statement");

  // Statements page.
  await page.goto(`${BASE}/statements`);
  await page.getByRole("heading", { name: "Statements" }).waitFor();
  await page.getByText("Nothing to review. Every statement line is matched or recorded.").waitFor();
  const received = page.getByRole("region", { name: "Received" });
  await received.getByText(/3 matched · 2 added · 1 not on statement/).waitFor();
  await snap("statements");
  const receivedText = await received.innerText();
  writeFileSync(`${ART}/statements-received.txt`, redact(receivedText) + "\n");
  check(/Davivienda · ••1234 · CRC[\s\S]*3 matched · 2 added · 1 not on statement/.test(receivedText), "Received CRC: 3 matched · 2 added · 1 not on statement");
  check(/Davivienda · ••1234 · USD[\s\S]*0 matched · 1 added/.test(receivedText), "Received USD: 0 matched · 1 added");

  // Undo the USD statement and check its created row is gone.
  const usdItem = received.getByRole("listitem").filter({ hasText: "0 matched · 1 added" });
  await usdItem.getByRole("button", { name: "Undo…" }).click();
  await usdItem.getByText("Remove the 1 added rows and clear every label?").waitFor();
  await usdItem.getByRole("button", { name: "Undo statement" }).click();
  await received.getByText("0 matched · 1 added").waitFor({ state: "detached" });
  const afterUndo = await davivienda();
  check(afterUndo.filter((t) => t.currency === "USD").length === 0, "undoing the USD statement removed its created row");
  await snap("statements-after-usd-undo");
} catch (error) {
  log(`FAIL ${error.message.split("\n")[0]}`);
  await page.screenshot({ path: `${ART}/failure.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (keyId) {
    const revoked = await api(`/api/feed/keys/${keyId}`, { method: "DELETE" });
    check(revoked.status === 200, `feed key revoked (${revoked.status})`);
  }
  writeFileSync(
    `${ART}/proof.txt`,
    [
      `run token ${TAG}; app ${BASE} (isolated: API :8001, Vite :5174, Postgres :55433, proxy :4445)`,
      "routes: / (sign-in, Plan), /settings, /transactions (Ledger), /statements;",
      "API: /api/me, /api/banks, /api/feed/keys, /api/feed/v1/transactions, /api/feed/v1/statements",
      ...proof,
      "persistent state: disposable local Docker DB only. 1 feed key (revoked), 4 davivienda-cr CRC feed rows,",
      "2 statements from the synthetic fixture (USD one undone at the end). No password change, shared DB,",
      "or human account touched. All data synthetic.",
    ].join("\n") + "\n",
  );
  await browser.close();
}

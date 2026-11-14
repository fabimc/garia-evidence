import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const ART = process.env.VERIFY_ARTIFACTS;
if (!ART) throw new Error("VERIFY_ARTIFACTS is not set");
const env = Object.fromEntries(
  readFileSync("/tmp/expenses-verify-wt/.env", "utf8").split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);
const BASE = "http://localhost:5173";
const TAG = Math.random().toString(36).slice(2, 7).toUpperCase();
const LEONOR = {
  email: `leonor-${TAG.toLowerCase()}@example.test`,
  password: crypto.randomUUID(),
  name: "Leonor Verify",
};
const M = {
  matched: `CHATGPT ${TAG}`,
  tipped: `RESTAURANTE SILVESTRE ${TAG}`,
  unlisted: `UBER TRIP ${TAG}`,
  leonorFee: `COMISION LEONOR ${TAG}`,
  ownerFee: `COMISION OWNER ${TAG}`,
};
const proof = [];
const log = (line) => {
  proof.push(`${new Date().toISOString()} ${line}`);
  console.log(line);
};
const check = (ok, what) => {
  log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) process.exitCode = 1;
};
const redact = (text) =>
  text.replaceAll(env.LOCAL_LOGIN_EMAIL, "[verify account]").replaceAll(LEONOR.email, "[leonor account]");

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const snap = async (name) => {
  const aria = redact(await page.locator("main").ariaSnapshot());
  writeFileSync(`${ART}/${name}.aria.txt`, aria);
  await page.screenshot({ path: `${ART}/${name}.png`, fullPage: true });
  return aria;
};
const apiIn = (p) => (path, init = {}) =>
  p.evaluate(async ([path, i]) => {
    const r = await fetch(path, { credentials: "include", ...i });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  }, [path, init]);
const api = apiIn(page);
const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

let apiKey = null;
let keyId = null;
const bot = async (path, body) => {
  const r = await fetch(`${BASE}/api/feed/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
const feedRow = (id, amount, merchant, date) => ({
  id: `${TAG}-${id}`,
  bankSlug: "bac-cr",
  amount,
  currency: "USD",
  type: "purchase",
  transactionDate: date,
  occurredAt: `${date}T18:00:00.000Z`,
  rawMerchantText: merchant,
  cardLast4: "9911",
});
const OCTOBER = {
  bankSlug: "bac-cr",
  currency: "USD",
  cardLast4s: ["9911"],
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
};
const fixtureRows = async () => {
  const r = await api("/api/transactions?limit=100&offset=0");
  return r.body.transactions.filter((t) => (t.rawMerchantText ?? "").includes(TAG));
};
const whoOf = (rows, merchant) =>
  rows.filter((t) => t.rawMerchantText === merchant).map((t) => t.recordedBy?.userId ?? null);

try {
  // Owner signs in.
  await page.goto(BASE);
  await page.getByRole("textbox", { name: "Email" }).fill(env.LOCAL_LOGIN_EMAIL);
  await page.getByRole("textbox", { name: "Password" }).fill(env.LOCAL_LOGIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("navigation", { name: "Primary navigation" }).waitFor();
  const me = await api("/api/me");
  check(me.status === 200, `/api/me status ${me.status}`);
  check(JSON.stringify(me.body).includes(env.LOCAL_LOGIN_EMAIL), "/api/me is the verify account");
  const ownerId = me.body.user?.id ?? me.body.id;
  check(typeof ownerId === "string", "owner user id read from /api/me");

  // Baseline Plan proof.
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Plan" }).click();
  await page.getByRole("heading", { name: /^Plan — / }).waitFor();
  await page.getByText("How leftover is built").click();
  const planAria = redact(await page.locator("main").ariaSnapshot());
  writeFileSync(`${ART}/plan.aria.txt`, planAria);
  check(/Income/.test(planAria) && /Bills/.test(planAria), "Plan disclosure shows Income and Bills rows");
  await page.screenshot({ path: `${ART}/plan.png`, fullPage: true });

  // A second member: Leonor registers and accepts the owner's invite.
  const invite = await api("/api/household/invites", json("POST", {}));
  check(invite.status === 201, `owner created an invite (${invite.status})`);
  const token = new URL(invite.body.url).pathname.split("/").pop();
  const leonorCtx = await browser.newContext();
  const leonorPage = await leonorCtx.newPage();
  await leonorPage.goto(BASE);
  const leonorApi = apiIn(leonorPage);
  const registered = await leonorApi("/api/auth/register", json("POST", LEONOR));
  check(registered.status === 201, `Leonor registered (${registered.status})`);
  const leonorId = registered.body.user.id;
  const accepted = await leonorApi("/api/household/invites/accept", json("POST", { token }));
  check(accepted.status === 200, `Leonor accepted the invite (${accepted.status})`);
  await leonorCtx.close();
  const household = await api("/api/household");
  check(
    household.body.members?.some((m) => m.userId === leonorId),
    "household now lists Leonor as a member",
  );

  // Owner mints the shared bot key; its default "Who" is the owner.
  const minted = await api("/api/feed/keys", json("POST", { name: `verify-${TAG}` }));
  check(minted.status === 201, `minted a feed key (${minted.status})`);
  apiKey = minted.body.key.apiKey;
  keyId = minted.body.key.id;

  const fed = await bot("transactions", {
    transactions: [
      feedRow("f1", "-20.00", M.matched, "2026-10-10"),
      feedRow("f2", "-40.00", M.tipped, "2026-10-10"),
      feedRow("f3", "-15.00", M.unlisted, "2026-10-15"),
    ],
  });
  check(fed.status === 200 && fed.body.created === 3, `feed created ${fed.body.created} rows`);
  const beforeRefusal = await fixtureRows();

  // A mailboxEmail outside the household is refused and writes nothing.
  const stranger = await bot("statements", {
    ...OCTOBER,
    externalId: `verify:${TAG}:stranger`,
    mailboxEmail: "stranger@example.test",
    lines: [{ transactionDate: "2026-10-20", amount: "-8.50", type: "fee", rawMerchantText: M.leonorFee }],
  });
  writeFileSync(`${ART}/stranger-statement.json`, JSON.stringify(stranger, null, 2));
  check(stranger.status === 400, `non-member mailboxEmail refused (${stranger.status})`);
  check(/not a member/.test(stranger.body.error?.message ?? ""), `refusal says not a member: ${stranger.body.error?.message}`);
  const afterRefusal = await fixtureRows();
  check(
    afterRefusal.length === beforeRefusal.length && afterRefusal.every((t) => t.reconciliation === "unreconciled"),
    "ledger untouched after refusal",
  );
  check((await api("/api/statements")).body.statements.length === 0, "no statement row written by the refusal");

  // Leonor's October statement, sent on the owner's key with her mailbox (mixed case).
  const leonorEmailMixed = LEONOR.email.replace(/^l/, "L").replace("example", "Example");
  const posted = await bot("statements", {
    ...OCTOBER,
    externalId: `verify:${TAG}:leonor-2026-10`,
    mailboxEmail: leonorEmailMixed,
    lines: [
      { transactionDate: "2026-10-12", amount: "-20.00", type: "purchase", rawMerchantText: `OPENAI *${M.matched}` },
      { transactionDate: "2026-10-12", amount: "-46.00", type: "purchase", rawMerchantText: M.tipped },
      { transactionDate: "2026-10-20", amount: "-8.50", type: "fee", rawMerchantText: M.leonorFee },
    ],
  });
  writeFileSync(`${ART}/leonor-statement.json`, JSON.stringify(posted, null, 2));
  check(posted.status === 200, `Leonor's statement accepted (${posted.status})`);
  check(
    JSON.stringify(posted.body.counts) ===
      JSON.stringify({ lines: 3, matched: 1, created: 1, needsReview: 1, missing: 1 }),
    `counts ${JSON.stringify(posted.body.counts)}`,
  );

  // A September statement without mailboxEmail falls back to the key's member.
  const ownerStatement = await bot("statements", {
    ...OCTOBER,
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    externalId: `verify:${TAG}:owner-2026-09`,
    lines: [{ transactionDate: "2026-09-20", amount: "-8.50", type: "fee", rawMerchantText: M.ownerFee }],
  });
  check(
    ownerStatement.status === 200 && ownerStatement.body.counts.created === 1,
    `statement without mailboxEmail accepted, 1 created (${ownerStatement.status})`,
  );

  let rows = await fixtureRows();
  check(JSON.stringify(whoOf(rows, M.leonorFee)) === JSON.stringify([leonorId]), "Leonor's created fee is credited to Leonor");
  check(JSON.stringify(whoOf(rows, M.ownerFee)) === JSON.stringify([ownerId]), "fee from a statement without mailboxEmail is credited to the key's member");
  check(JSON.stringify(whoOf(rows, M.matched)) === JSON.stringify([ownerId]), "matched feed row keeps its original recorder");

  // Statements page: the owner resolves the tip as a new row.
  await page.goto(`${BASE}/statements`);
  await page.getByRole("heading", { name: "Statements" }).waitFor();
  const review = page.getByRole("region", { name: "Needs review" });
  await review.getByText(M.tipped).first().waitFor();
  await snap("statements-review");
  await review.getByRole("button", { name: "None of these — add it" }).click();
  await review.getByText("Nothing to review. Every statement line is matched or recorded.").waitFor();
  check(true, "owner resolved the review line with None of these — add it");
  await snap("statements-resolved");

  rows = await fixtureRows();
  const tippedWho = whoOf(rows, M.tipped);
  log(`tipped rows recorders ${JSON.stringify(tippedWho.map((id) => id === leonorId ? "leonor" : id === ownerId ? "owner" : id))}`);
  check(
    tippedWho.length === 2 && tippedWho.filter((id) => id === leonorId).length === 1 &&
      tippedWho.filter((id) => id === ownerId).length === 1,
    "review-queue create is credited to Leonor (statement's person), not the reviewing owner; the feed row stays the owner's",
  );
  const createdTip = rows.find((t) => t.rawMerchantText === M.tipped && t.source === "statement");
  check(createdTip?.recordedBy?.userId === leonorId, "the statement-sourced tip row's recordedBy is Leonor");

  // Ledger: the Who column and the Recorded by filter.
  await page.goto(`${BASE}/transactions`);
  await page.getByRole("heading", { name: "Transactions" }).waitFor();
  await page.getByRole("searchbox", { name: "Search transactions" }).fill(TAG);
  const rowFor = (re) => page.getByRole("row").filter({ hasText: re });
  await rowFor(/Comision Leonor/i).first().waitFor();
  await rowFor(/Comision Owner/i).first().waitFor();
  check(await rowFor(/Comision Leonor/i).getByText("Leonor", { exact: true }).count() === 1, "Ledger Who shows Leonor on her statement's fee");
  check(await rowFor(/Comision Owner/i).getByText("Verify", { exact: true }).count() === 1, "Ledger Who shows the key's member on the fallback fee");
  await snap("ledger-who");

  const recordedBy = page.getByRole("combobox", { name: "Recorded by" });
  const filtered = page.waitForResponse((r) =>
    r.url().includes("/api/transactions") && r.url().includes(`recordedBy=${leonorId}`) && r.ok()
  );
  await recordedBy.selectOption({ label: LEONOR.name });
  await filtered;
  await rowFor(/Comision Owner/i).first().waitFor({ state: "detached" });
  const leonorRows = await rowFor(/Comision Leonor|Restaurante Silvestre/i).count();
  const otherRows = await rowFor(/ChatGPT|Uber|Comision Owner/i).count();
  check(leonorRows === 2 && otherRows === 0, `Recorded by Leonor shows only her 2 statement rows (${leonorRows}, others ${otherRows})`);
  await snap("ledger-recorded-by-leonor");
} catch (error) {
  log(`FAIL ${error.message.split("\n")[0]}`);
  await page.screenshot({ path: `${ART}/failure.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (keyId) {
    const revoked = await api(`/api/feed/keys/${keyId}`, { method: "DELETE" });
    check(revoked.status === 200 || revoked.status === 204, `feed key revoked (${revoked.status})`);
  }
  writeFileSync(
    `${ART}/proof.txt`,
    [
      `fixture tag ${TAG}`,
      "route: / (Plan), /statements, /transactions (Ledger); API /api/household/invites, /api/auth/register,",
      "/api/feed/keys, /api/feed/v1/{transactions,statements}",
      ...proof,
      "persistent state: disposable local Docker DB only. Created a second user (Leonor) joined by invite,",
      "1 feed key (revoked), 3 feed rows, 2 statements (one review line resolved as a new row); the refused",
      "statement wrote nothing. No password change, shared DB, or human account was touched.",
    ].join("\n") + "\n",
  );
  await browser.close();
}

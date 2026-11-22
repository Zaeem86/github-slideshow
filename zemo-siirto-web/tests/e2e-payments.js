// End-to-end test of real bank payments (Trustly) using the mock Trustly in
// tests/mocks/fake-trustly/server.js. See README → Tests.
//
//   node tests/e2e-payments.js <app-url> <fake-supabase-url> <mock-trustly-url>
const { chromium } = require("playwright");

const APP = (process.argv[2] || "http://localhost:3100").replace(/\/$/, "");
const SB = (process.argv[3] || "http://localhost:8790").replace(/\/$/, "");
const TR = (process.argv[4] || "http://localhost:8791").replace(/\/$/, "");
const PW = "password1";
let failures = 0;
const check = (cond, name) => { console.log((cond ? "PASS " : "FAIL ") + name); if (!cond) failures++; };
const trustlyLog = async () => (await fetch(`${TR}/test/log`)).json();

(async () => {
  const browser = await chromium.launch();
  const p = await (await browser.newContext({ viewport: { width: 400, height: 860 } })).newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(`${p.url()} ${e.message}`));
  p.on("dialog", d => d.accept());
  const go = async path => { await p.goto(APP + path); await p.waitForLoadState("networkidle"); };
  const text = async (sel = "body") => ((await p.textContent(sel)) || "").replace(/\s+/g, " ").trim();
  const notice = async kind => (await p.locator(`.notice.${kind}`).count()) ? text(`.notice.${kind}`) : "";
  async function signOut() { if (await p.locator("#signOut").count()) { await p.click("#signOut"); await p.waitForURL(/\/login/); } }
  async function register(name, email) {
    await go("/customer/login");
    await p.fill("#customerRegister [name=name]", name); await p.fill("#customerRegister [name=email]", email);
    await p.fill("#customerRegister [name=phone]", "+358401234567"); await p.fill("#customerRegister [name=password]", PW);
    await p.click("#customerRegister button"); await p.waitForURL(/create-order/); await p.waitForLoadState("networkidle");
  }

  // ---- admin account
  await register("Boss Admin", "boss@x.fi");
  await fetch(`${SB}/test/promote`, { method: "POST", body: JSON.stringify({ email: "boss@x.fi" }) });
  await signOut();

  // ---- customer orders and goes to the bank
  await register("Ali Zemo", "ali@x.fi");
  // Address fields with Google suggestions (mock): pick the first suggestion, then wait for the road route quote.
  for (const [id, q] of [["fromAddr", "Mannerheim"], ["toAddr", "Kauppurien"]]) { await p.fill(`#${id}`, q); await p.click(`#${id}-list li >> nth=0`); }
  await p.waitForFunction(() => document.querySelector("[name=quoteId]")?.value, null, { timeout: 15000 });
  await p.fill("[name=car]", "Volvo V60"); await p.fill("[name=plate]", "abc-123");
  await p.click("#orderForm button"); await p.waitForURL(/\/customer\/pay\//); await p.waitForLoadState("networkidle");
  const orderId = decodeURIComponent(p.url().split("/pay/")[1]);
  check(await p.locator("#trustlyForm").isVisible(), "pay page offers bank payment (Trustly)");

  await p.click("#trustlyForm button"); await p.waitForURL(u => u.href.startsWith(TR + "/checkout/"));
  check((await text("#amount")).includes("800.69 EUR"), "Trustly receives the order total 800.69 EUR (signed Deposit accepted)");

  // ---- 1st attempt: customer cancels at the bank
  await p.click("#cancel"); await p.waitForURL(/result=fail/); await p.waitForLoadState("networkidle");
  check((await notice("error")).includes("cancelled or did not go through"), "cancelled bank payment shows an error");
  check(await p.locator("#trustlyForm").isVisible(), "customer can try again");

  // ---- 2nd attempt: approved
  await p.click("#trustlyForm button"); await p.waitForURL(u => u.href.startsWith(TR + "/checkout/"));
  await p.click("#approve"); await p.waitForURL(/tracking/); await p.waitForLoadState("networkidle");
  check((await notice("ok")).includes("Payment received"), "customer returns to tracking: payment received");
  check((await text("main")).includes("Paid – finding driver"), `order ${orderId} is paid (by Trustly's credit notification)`);
  let log = await trustlyLog();
  const notes = log.filter(l => l.method);
  check(notes.filter(l => !l.forged).every(l => l.httpStatus === 200 && l.answerOk), "every notification answered with a correctly signed OK");
  check(notes.some(l => l.method === "pending") && notes.some(l => l.method === "credit") && notes.some(l => l.method === "cancel"), "pending, credit and cancel notifications delivered");

  // ---- attacks / retries
  const forged = await (await fetch(`${TR}/test/forge`, { method: "POST" })).json();
  check(forged.httpStatus === 403 && !forged.answerOk, "forged notification (bad signature) is rejected");
  const resent = await (await fetch(`${TR}/test/resend`, { method: "POST" })).json();
  check(resent.httpStatus === 200 && resent.answerOk, "repeated credit notification is answered OK (idempotent)");
  await go(`/customer/tracking?id=${orderId}`);
  check((await p.locator(".timeline li:has-text('Paid – finding driver')").count()) === 1, "order was marked paid exactly once");
  await go(`/invoice/${orderId}`);
  check((await text()).includes("Bank payment (Trustly)"), "invoice shows Trustly as payment method");

  // ---- cancel + refund through Trustly
  await go("/customer/dashboard");
  await p.click("button:has-text('Cancel')"); await p.waitForURL(/ok=/); await p.waitForLoadState("networkidle");
  check((await text("main")).includes("Cancelled"), "customer cancelled the paid order");
  await signOut();
  await go("/admin/login");
  await p.fill("#adminSignIn [name=email]", "boss@x.fi"); await p.fill("#adminSignIn [name=password]", PW);
  await p.click("#adminSignIn button"); await p.waitForURL(/admin\/dashboard/);
  await go("/admin/payments");
  check((await text("main")).includes("Refund due"), "admin sees the refund due");
  await p.click("button:has-text('Refund via Trustly')"); await p.waitForURL(/ok=|error=/); await p.waitForLoadState("networkidle");
  check((await notice("ok")) === "Refund sent via Trustly", "admin refunded through Trustly");
  check((await text("main")).includes("Refunded") && !(await text("main")).includes("Refund due"), "payment shows as refunded");
  log = await trustlyLog();
  check(log.some(l => l.api === "Refund" && l.amount === "800.69"), "Trustly received a signed Refund for 800.69");

  check(errors.length === 0, "no browser errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

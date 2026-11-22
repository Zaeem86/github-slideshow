// End-to-end test of the Next.js app in a real browser (Playwright), against the real SQL
// through tests/mocks/fake-supabase/server.js. See README → Tests.
//
//   node tests/e2e.js <app-url> <fake-supabase-url>
//
// Walks orders through every portal (customer → driver → admin) and checks the results.
const { chromium } = require("playwright");

const APP = (process.argv[2] || "http://localhost:3100").replace(/\/$/, "");
const SB = (process.argv[3] || "http://localhost:8790").replace(/\/$/, "");
const PW = "password1";
let failures = 0;
const check = (cond, name) => { console.log((cond ? "PASS " : "FAIL ") + name); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch();
  // The driver's trip needs GPS: allow location for the app and give a position in Turku.
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, permissions: ["geolocation"], geolocation: { latitude: 60.4518, longitude: 22.2666 } });
  await ctx.route("https://tile.openstreetmap.org/**", r => r.fulfill({ status: 204 }));
  const p = await ctx.newPage();
  const errors = [], posted = [];
  p.on("pageerror", e => errors.push(`${p.url()} ${e.message}`));
  p.on("console", m => { if (m.type() === "error" && !/openstreetmap|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  p.on("request", r => { if (r.method() === "POST") posted.push(r.postData() || ""); });
  p.on("dialog", d => d.accept());

  // A small JPEG for the inspection photos.
  const PHOTO = { name: "car.jpg", mimeType: "image/jpeg", buffer: Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwClRRRXUYBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAf/Z", "base64") };
  async function takePhotos() {
    for (const slot of ["odometer", "front", "right", "left", "rear"]) await p.setInputFiles(`[data-slot=${slot}] input`, PHOTO);
    await p.waitForFunction(() => document.querySelectorAll(".photo-slot.done").length === 5, null, { timeout: 20000 });
  }
  const go = async path => { await p.goto(APP + path); await p.waitForLoadState("networkidle"); };
  const text = async (sel = "main") => ((await p.textContent(sel)) || "").replace(/\s+/g, " ").trim();
  /** Click something that runs a Server Action and wait until it redirects with ?ok= / ?error= (or to `url`). */
  const act = async (sel, url) => {
    const before = p.url();
    await p.click(sel);
    await p.waitForURL(u => (url ? url.test(u.href) : /[?&](ok|error)=/.test(u.href)) && u.href !== before, { timeout: 20000 });
    await p.waitForLoadState("networkidle");
  };
  const notice = async kind => (await p.locator(`.notice.${kind}`).count()) ? text(`.notice.${kind}`) : "";
  async function signOut() {
    // The driver app has "Kirjaudu ulos" on the Profiili page.
    if (!(await p.locator("#signOut").count()) && new URL(p.url()).pathname.startsWith("/driver/") && !p.url().includes("/login")) await go("/driver/profile");
    if (await p.locator("#signOut").count()) { await p.click("#signOut"); await p.waitForURL(/\/login/); }
  }
  // Driver start screen: swipe (or Enter on the knob) opens the sign-in.
  async function passSwipe() {
    if (!(await p.locator("#swipeKnob").count())) return;
    await p.focus("#swipeKnob"); await p.keyboard.press("Enter");
    await p.locator("#driverSignIn").waitFor();
  }
  async function loginAs(portal, email) {
    await go(`/${portal}/login`);
    if (!p.url().includes("/login")) return;
    await passSwipe();
    const f = { customer: "#customerSignIn", driver: "#driverSignIn", admin: "#adminSignIn" }[portal];
    await p.fill(`${f} [name=email]`, email); await p.fill(`${f} [name=password]`, PW);
    await p.click(`${f} button`);
    await p.waitForURL(u => !u.pathname.endsWith("/login"), { timeout: 20000 });
    await p.waitForLoadState("networkidle");
  }
  async function registerCustomer(name, email) {
    await go("/customer/login");
    const r = "#customerRegister ";
    await p.fill(r + "[name=name]", name); await p.fill(r + "[name=email]", email); await p.fill(r + "[name=phone]", "+358401234567");
    await p.fill(r + "[name=password]", PW);
    await act(r + "button", /create-order/);
  }
  async function newOrder(to, contact) {
    await go("/customer/create-order");
    await p.fill("[name=fromAddr]", "Mannerheimintie 1"); await p.selectOption("[name=toCity]", to); await p.fill("[name=toAddr]", "Kauppurienkatu 2");
    if (contact) await p.fill("[name=toContact]", contact);
    await p.fill("[name=car]", "Volvo V60"); await p.fill("[name=plate]", "abc-123");
    await act("#orderForm button", /\/customer\/pay\//);
  }

  // ---- landing
  await go("/");
  await p.selectOption("#quickQuote [name=to]", "Turku"); await p.click("#quickQuote button[type=submit]");
  check((await text("#quickOut")).includes("173 km"), "landing: instant price Helsinki→Turku 173 km");

  // ---- guards
  await go("/admin/orders");
  check(p.url().endsWith("/admin/login"), "admin pages redirect to login when signed out");

  // ---- admin account (sign up, promote in SQL, sign in)
  await registerCustomer("Boss", "boss@x.fi");
  await fetch(`${SB}/test/promote`, { method: "POST", body: JSON.stringify({ email: "boss@x.fi" }) });
  await signOut();
  await loginAs("admin", "boss@x.fi");
  check(p.url().endsWith("/admin/dashboard"), "admin signed in");
  await signOut();

  // ---- customer: register, order, pay, track
  await registerCustomer("Ali Zemo", "ali@x.fi");
  check((await notice("ok")).includes("Account created"), "customer account created");
  await go("/admin/dashboard");
  check(p.url().endsWith("/admin/login"), "customer cannot open admin pages");
  await newOrder("Oulu", "Sara +358 50 999 8888");
  check((await text()).includes("620 km"), "order priced at 620 km (server-side)");
  const orderId = decodeURIComponent(p.url().split("/pay/")[1]);
  await p.fill("#cardNumber", "4242 4242 4242 4241"); await p.fill("#cardExp", "12/30"); await p.fill("#cardCvc", "123");
  await p.click("#payForm button[type=submit], #payForm button:not([type])");
  check((await notice("error")) === "Invalid card number", "bad card number rejected in the browser");
  await p.fill("#cardNumber", "4242424242424242");
  await act("#payForm button.btn-gold", /tracking/);
  check((await notice("ok")).includes("Booking confirmed"), `booking ${orderId} confirmed`);
  check(!posted.some(b => b.includes("4242424242424242")), "full card number never sent to the server");
  check((await text()).includes("Paid – finding driver"), "tracking shows paid status");

  // ---- driver: register, wait for approval
  await signOut();
  await go("/driver/login");
  check(await p.locator("#swipeKnob").isVisible(), "driver login starts with the swipe screen");
  await passSwipe();
  await p.click("#driverApply summary");
  const r = "#driverRegister ";
  await p.fill(r + "[name=name]", "Driver One"); await p.fill(r + "[name=email]", "d1@x.fi"); await p.fill(r + "[name=phone]", "+358 44 1");
  await p.fill(r + "[name=dob]", "1990-01-01"); await p.fill(r + "[name=licenseNo]", "L1"); await p.fill(r + "[name=licenseExpiry]", "2031-01-01");
  await p.fill(r + "[name=iban]", "FI21 1234 5600 0007 85"); await p.fill(r + "[name=password]", PW); await p.check(r + "[name=consent]");
  await act(r + "button.btn-gold", /driver\/profile/);
  await go("/driver/search");
  check(await p.locator("#driverGate").isVisible(), "pending driver cannot see jobs");

  await signOut();
  await loginAs("admin", "boss@x.fi");
  await go("/admin/drivers");
  await act("form:has(input[name=status][value=approved]) button");
  check((await text()).includes("Approved"), "admin approved the driver");

  // ---- driver: accept, start the trip with photos, GPS, map, hand over with photos
  await signOut();
  await loginAs("driver", "d1@x.fi");
  check(p.url().endsWith("/driver/home") && (await text("#newsCard")).startsWith("Uutiset ja päätökset"), "driver home with the news card");
  await go("/driver/search");
  check((await text()).includes(orderId), "approved driver sees the job");
  check(!(await text()).includes("Sara"), "open job hides the delivery contact");
  await act("button:has-text('Hyväksy tehtävä')", /my-jobs/);
  check((await text("#myJobsList")).includes("Odottaa lähtöä"), "job waits to start");
  await p.click("#myJobsList a:has-text('Aloita ajo')"); await p.waitForURL(/driver\/trip/); await p.waitForLoadState("networkidle");
  check((await text("#tripTitle")) === "Aloita ajo" && (await text("#tripCustomer")).includes("Ali Zemo") && (await text("#tripDetails")).includes("Sara"),
    "trip screen: trip details, customer and contacts");
  await p.fill("#odoInput", "50000");
  await p.click("#tripSubmit");
  check((await text("#toast")).includes("pakolliset kuvat"), "trip cannot start without the photos");
  await takePhotos();
  await p.fill("#odoInput", "50000");
  await p.click("#tripSubmit");
  await p.waitForSelector("#dlgTitle:has-text('Onko kaikki kunnossa?')");
  await p.click("#dlgOk");
  await p.waitForSelector("#dlgTitle:has-text('Ota GPS käyttöön')", { timeout: 20000 });
  check((await text("#dlgStatus")).includes("GPS pois"), "GPS step: GPS off until turned on");
  await p.click("#dlgOk");
  await p.waitForURL(/driver\/map/, { timeout: 20000 }); await p.waitForLoadState("networkidle");
  await p.waitForSelector("#gpsBadge.on");
  check((await text("#navTitle")) === "Ajo käynnissä" && (await text("#gpsBadge")) === "GPS päällä", "map opens with GPS on");
  await p.waitForTimeout(500);
  await p.click("#arriveBtn"); await p.waitForURL(/driver\/trip/); await p.waitForLoadState("networkidle");
  check((await text("#tripTitle")) === "Luovutus perillä" && (await p.locator("#pickupReport .log-photos img").count()) === 5, "arrival screen with the saved pickup photos");
  await takePhotos();
  await p.fill("#odoInput", "49000");
  await p.click("#tripSubmit"); await p.click("#dlgOk");
  await p.waitForSelector("#toast.error");
  check((await text("#toast")).includes("Odometer is lower than at pickup"), "odometer cannot go backwards (server rule)");
  await p.fill("#odoInput", "50620");
  await p.click("#tripSubmit"); await p.click("#dlgOk");
  await p.waitForURL(/driver\/my-jobs/, { timeout: 20000 }); await p.waitForLoadState("networkidle");
  check(!(await p.locator("#gpsBadge").count()), "GPS badge gone after the handover");
  await go("/driver/earnings");
  check((await text(".stat")).includes("414,70"), "earnings 414,70 € (65% of 638,00 €)");

  // ---- customer sees the report; second order cancelled
  await signOut();
  await loginAs("customer", "ali@x.fi");
  await go(`/customer/tracking?id=${orderId}`);
  check((await text()).includes("Driver One"), "customer sees the driver name");
  await go(`/invoice/${orderId}`);
  check((await text()).includes("INVOICE / LASKU") && (await text()).includes("638,00"), "invoice page");
  await newOrder("Turku");
  await p.selectOption("#payMethod", "mobilepay");
  await act("#payForm button.btn-gold", /tracking/);
  await go("/customer/dashboard");
  await act("button:has-text('Cancel')");
  check((await text()).includes("Cancelled"), "customer cancelled the paid order");

  // ---- admin: refund, payout, pricing
  await signOut();
  await loginAs("admin", "boss@x.fi");
  await go("/admin/payments");
  await act("button:has-text('Mark refunded')");
  check((await text()).includes("Refunded"), "admin marked the refund");
  await act("button:has-text('Mark paid out')");
  check((await p.locator("button:has-text('Mark paid out')").count()) === 0 && (await text()).includes("414,70"), "admin paid out the driver");
  await go("/admin/pricing");
  await p.fill("[name=baseFee]", "59");
  await act("#pricingForm button.btn-gold");
  check((await notice("ok")) === "Pricing saved", "pricing saved");
  await go("/");
  await p.selectOption("#quickQuote [name=to]", "Turku"); await p.click("#quickQuote button[type=submit]");
  check((await text("#quickOut")).includes("223,35"), "new pricing used on the landing page (59 + 0,95 × 173)");
  for (const path of ["/admin/dashboard", "/admin/drivers", "/admin/customers", "/admin/orders?status=delivered", `/admin/orders/${orderId}`, "/admin/pricing", "/admin/payments", "/admin/settings"]) {
    await go(path);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    check(!overflow && !p.url().includes("/login"), `${path} renders`);
  }

  await signOut();
  await loginAs("driver", "d1@x.fi");
  await go("/driver/earnings");
  check((await p.locator("td .pill.green").count()) === 1, "driver sees the payout as paid");
  for (const path of ["/driver/home", "/driver/my-jobs", "/driver/search", "/driver/help", "/driver/profile", "/driver/earnings"]) {
    await go(path);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    check(!overflow && (await p.locator("#driverNav a.active").count()) === 1, `${path} renders with the bottom navigation`);
  }
  await signOut();
  check(p.url().endsWith("/driver/login"), "sign out");

  check(errors.length === 0, "no browser errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// End-to-end test of the whole site in a real browser (Playwright).
//
//   node tests/e2e.js <base-url> <local|remote>
//
// local  – any static server on zemo-siirto/ with the default (empty) config.js
// remote – supabase/tests/fake-supabase/server.js on a Postgres with the migrations applied
//
// Walks one order through every portal: customer → driver → admin, and checks the results.
const { chromium } = require('playwright');

const BASE = (process.argv[2] || 'http://localhost:8765/').replace(/\/?$/, '/');
const MODE = process.argv[3] || 'local';
const PW = 'password1';
let failures = 0;
const check = (cond, name) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(p.url() + ' ' + e.message));
  p.on('dialog', d => d.accept());

  const g = async path => { await p.goto(BASE + path); await p.waitForLoadState('networkidle'); };
  const settle = () => p.waitForLoadState('networkidle');
  const text = async sel => ((await p.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
  const sawToast = msg => p.waitForSelector(`.toast:has-text(${JSON.stringify(msg)})`, { timeout: 5000 }).then(() => true, () => false);
  const submit = async (form, url) => { await p.click(`${form} button.primary, ${form} button:not([type=button])`); if (url) await p.waitForURL(url); await settle(); };
  async function loginAs(portal, email) {
    await g(`${portal}/login/`);
    if (!p.url().includes('/login')) return;
    const f = { customer: '#customerSignIn', driver: '#driverSignIn', admin: '#adminSignIn' }[portal];
    await p.fill(`${f} [name=email]`, email); await p.fill(`${f} [name=password]`, PW);
    await submit(f, u => !u.pathname.includes('/login'));
  }

  // ---- landing page
  await g('');
  await p.selectOption('#quickQuote [name=to]', 'Turku');
  check((await text('#quickOut')).includes('173 km'), 'landing: instant price Helsinki→Turku 173 km');

  // ---- admin account
  if (MODE === 'local') {
    await g('admin/orders/');
    check(p.url().includes('admin/login/?next=orders'), 'admin pages require login');
    await p.fill('[name=email]', 'boss@x.fi'); await p.fill('[name=password]', PW); await p.fill('[name=password2]', PW);
    await submit('#adminSetup', /admin\/dashboard/);
  } else {
    await g('customer/login/');
    const r = '#customerRegister ';
    await p.fill(r + '[name=name]', 'Boss'); await p.fill(r + '[name=email]', 'boss@x.fi'); await p.fill(r + '[name=phone]', '1');
    await p.fill(r + '[name=password]', PW); await submit('#customerRegister', /create-order/);
    await p.evaluate(base => fetch(base + 'test/promote', { method: 'POST', body: JSON.stringify({ email: 'boss@x.fi' }) }), BASE);
    await loginAs('admin', 'boss@x.fi');
  }
  check(p.url().includes('admin/dashboard'), 'admin signed in');

  // ---- customer: register, order, pay, track
  await g('customer/create-order/');
  if (p.url().includes('/login')) {
    const r = '#customerRegister ';
    await p.fill(r + '[name=name]', 'Ali Zemo'); await p.fill(r + '[name=email]', 'ali@x.fi'); await p.fill(r + '[name=phone]', '+358401234567');
    await p.fill(r + '[name=password]', PW); await submit('#customerRegister', /create-order/);
  }
  const order = async (to, toContact) => {
    await p.fill('[name=fromAddr]', 'Mannerheimintie 1'); await p.selectOption('[name=toCity]', to); await p.fill('[name=toAddr]', 'Kauppurienkatu 2');
    if (toContact) await p.fill('[name=toContact]', toContact);
    await p.fill('[name=car]', 'Volvo V60'); await p.fill('[name=plate]', 'abc-123');
    await submit('#orderForm'); await p.waitForSelector('#payForm');
  };
  await order('Oulu', 'Sara +358 50 999 8888');
  check((await text('#modal')).includes('620 km'), 'order priced at 620 km');
  await p.fill('[name=card]', '4242 4242 4242 4241'); await p.fill('[name=exp]', '12/30'); await p.fill('[name=cvc]', '123');
  await p.click('#payForm button[type=submit]');
  check(await sawToast('Invalid card number'), 'bad card number rejected');
  await p.fill('[name=card]', '4242424242424242'); await p.click('#payForm button[type=submit]'); await settle();
  await p.waitForSelector('#modal h2:has-text("Booking confirmed")');
  check(true, 'booking confirmed');
  const orderId = (await text('#modal b')).trim();
  await p.click('#modal a.btn.primary'); await p.waitForURL(/tracking/); await settle();
  check((await text('#app')).includes('Paid – finding driver'), `tracking shows ${orderId} paid`);

  // ---- driver: register, wait for approval
  await g('driver/login/');
  const r = '#driverRegister ';
  await p.fill(r + '[name=name]', 'Driver One'); await p.fill(r + '[name=email]', 'd1@x.fi'); await p.fill(r + '[name=phone]', '+358 44 1');
  await p.fill(r + '[name=dob]', '1990-01-01'); await p.fill(r + '[name=licenseNo]', 'L1'); await p.fill(r + '[name=licenseExpiry]', '2031-01-01');
  await p.fill(r + '[name=iban]', 'FI21 1234 5600 0007 85'); await p.fill(r + '[name=password]', PW); await p.check(r + '[name=consent]');
  await submit('#driverRegister', /driver\/profile/);
  await g('driver/available-jobs/');
  check((await text('#app h2')) === 'Not available yet', 'pending driver cannot see jobs');

  await loginAs('admin', 'boss@x.fi');
  await g('admin/drivers/');
  await p.click('[data-driver-status=approved]'); await p.waitForSelector('.toast'); await settle();
  check((await text('#app')).includes('Approved'), 'admin approved driver');

  // ---- driver: accept, inspect, navigate, deliver
  await loginAs('driver', 'd1@x.fi');
  await g('driver/available-jobs/');
  check((await text('#app')).includes(orderId), 'approved driver sees the job');
  check(!(await text('#app')).includes('Sara'), 'open job hides delivery contact');
  await p.click('[data-accept]'); await p.waitForURL(/my-jobs/); await settle();
  await p.click('a:has-text("Pickup inspection")'); await p.waitForURL(/inspection/); await settle();
  await p.fill('[name=odo]', '50000'); await p.selectOption('[name=area2]', 'Scratch'); await p.fill('[name=person]', 'Ali Zemo');
  await p.check('[name=docs]'); await p.check('#inspectionForm label.check:last-of-type input');
  await submit('#inspectionForm', /navigation/);
  check((await text('#app h2')).startsWith('Leg 2'), 'navigation: leg 2 after pickup');
  check((await text('#app')).includes('Sara'), 'assigned driver sees delivery contact');
  await p.click('[data-start-drive]'); await p.waitForSelector('a:has-text("delivery inspection")');
  await p.click('a:has-text("delivery inspection")'); await p.waitForURL(/inspection/); await settle();
  await p.fill('[name=odo]', '49000'); await p.selectOption('[name=area0]', 'Dent'); await p.fill('[name=person]', 'Sara');
  await p.check('#inspectionForm label.check input');
  await p.evaluate(() => document.querySelector('[name=odo]').removeAttribute('min')); // bypass browser check to hit the server rule
  await p.click('#inspectionForm button.primary');
  check(await sawToast('Odometer is lower than at pickup'), 'odometer cannot go backwards');
  await p.fill('[name=odo]', '50620'); await submit('#inspectionForm', /earnings/);
  check((await text('.stat')).includes('414,70'), 'earnings 414,70 € (65% of 638,00 €)');

  // ---- customer sees report
  await loginAs('customer', 'ali@x.fi');
  await g('customer/tracking/');
  check((await p.locator('.badge.bad:has-text("New damage")').count()) === 1, 'customer sees new-damage flag');
  check((await text('#app')).includes('Driver One'), 'customer sees driver name');

  // ---- second order: cancel + refund
  await g('customer/create-order/');
  await order('Turku');
  await p.selectOption('#payMethod', 'mobilepay'); await p.click('#payForm button[type=submit]');
  await p.waitForSelector('#modal h2:has-text("Booking confirmed")');
  await g('customer/dashboard/');
  await p.click('[data-cancel]'); await p.waitForSelector('.toast'); await settle();
  check((await text('#app')).includes('Cancelled'), 'customer cancelled paid order');

  // ---- admin: refund, payout, pricing
  await loginAs('admin', 'boss@x.fi');
  await g('admin/payments/');
  await p.click('[data-refund]'); await p.waitForSelector('.toast'); await settle();
  check((await text('#app')).includes('Refunded'), 'admin marked refund');
  await p.click('[data-payout]'); await sawToast('Payout recorded'); await settle();
  check((await p.locator('[data-payout]').count()) === 0 && (await text('#app')).includes('414,70'), 'admin paid out driver');
  await g('admin/pricing/');
  await p.fill('[name=baseFee]', '59'); await submit('#pricingForm'); await p.waitForSelector('.toast');
  await g('');
  await p.selectOption('#quickQuote [name=to]', 'Turku');
  check((await text('#quickOut')).includes('223,35'), 'new pricing used on landing page (59 + 0,95 × 173)');

  await loginAs('driver', 'd1@x.fi');
  await g('driver/earnings/');
  check((await p.locator('td .badge.ok').count()) === 1, 'driver sees payout as paid');

  // ---- every page renders without overflow / errors
  await loginAs('admin', 'boss@x.fi');
  for (const path of ['admin/dashboard/', 'admin/drivers/', 'admin/customers/', 'admin/orders/?status=delivered', 'admin/pricing/', 'admin/payments/', 'admin/settings/']) {
    await g(path);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    check(!overflow && !p.url().includes('/login'), `${path} renders`);
  }
  await g('admin/dashboard/'); await p.click('#signOut'); await p.waitForURL(/admin\/login/);
  check(true, 'sign out');

  check(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

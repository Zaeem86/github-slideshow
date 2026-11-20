/* ZEMO SIIRTO – car transfer platform.
 *
 * Site map (each page is its own folder with an index.html):
 *   /                      public landing page
 *   /customer/{login,dashboard,create-order,tracking}
 *   /driver/{login,available-jobs,my-jobs,inspection,navigation,earnings,profile}
 *   /admin/{login,dashboard,drivers,customers,orders,pricing,payments,settings}
 *
 * Every page loads this one script; <body data-portal data-page data-root> tells it what to render.
 *
 * Two backends with the same interface (see `Local` and `Remote` below):
 *  - Local demo (default): data lives in the browser's localStorage. No server needed.
 *  - Supabase: when config.js sets supabaseUrl + supabaseAnonKey, data and logins come from Supabase.
 *    The page loads everything the user may see with one call (get_app_state) and every change is a
 *    role-checked database function (see supabase/migrations/*_app_api.sql).
 */
(function () {
  'use strict';

  // ---------- Page context & URLs ----------
  const BODY = document.body;
  const PORTAL = BODY.dataset.portal || 'public';
  const PAGE = BODY.dataset.page || 'home';
  const ROOT = BODY.dataset.root || './';
  const params = new URLSearchParams(location.search);

  const CONFIG = window.ZEMO_CONFIG || {};
  const REMOTE = !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
  const SUPABASE_JS = CONFIG.supabaseJsUrl || 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
  let sb = null;

  function url(portal, page, query) {
    let u = ROOT + (portal ? portal + '/' : '') + (page ? page + '/' : '');
    if (location.protocol === 'file:') u += 'index.html';
    const q = query ? new URLSearchParams(query).toString() : '';
    return q ? u + '?' + q : u;
  }

  const NAV = {
    customer: [['dashboard', 'Dashboard'], ['create-order', 'New transfer'], ['tracking', 'Tracking']],
    driver: [['available-jobs', 'Available jobs'], ['my-jobs', 'My jobs'], ['inspection', 'Inspection'],
      ['navigation', 'Navigation'], ['earnings', 'Earnings'], ['profile', 'Profile']],
    admin: [['dashboard', 'Dashboard'], ['drivers', 'Drivers'], ['customers', 'Customers'], ['orders', 'Orders'],
      ['pricing', 'Pricing'], ['payments', 'Payments'], ['settings', 'Settings']]
  };
  const DEFAULT_PAGE = { customer: 'dashboard', driver: 'available-jobs', admin: 'dashboard' };
  const PORTAL_LABEL = { customer: 'Customer', driver: 'Driver', admin: 'Admin' };

  // ---------- Reference data (cities must match public.cities in the database) ----------
  const CITIES = {
    'Helsinki': [60.1699, 24.9384], 'Espoo': [60.2055, 24.6559], 'Vantaa': [60.2934, 25.0378],
    'Porvoo': [60.3923, 25.6651], 'Tampere': [61.4978, 23.7610], 'Turku': [60.4518, 22.2666],
    'Salo': [60.3831, 23.1286], 'Hämeenlinna': [60.9959, 24.4643], 'Lahti': [60.9827, 25.6612],
    'Kotka': [60.4664, 26.9458], 'Kouvola': [60.8681, 26.7042], 'Lappeenranta': [61.0587, 28.1887],
    'Mikkeli': [61.6886, 27.2723], 'Jyväskylä': [62.2426, 25.7473], 'Kuopio': [62.8924, 27.6770],
    'Joensuu': [62.6010, 29.7636], 'Pori': [61.4851, 21.7974], 'Rauma': [61.1272, 21.5113],
    'Vaasa': [63.0951, 21.6165], 'Seinäjoki': [62.7903, 22.8403], 'Kokkola': [63.8385, 23.1307],
    'Oulu': [65.0121, 25.4651], 'Kajaani': [64.2222, 27.7278], 'Rovaniemi': [66.5039, 25.7294]
  };

  const STATUSES = [
    ['pending_payment', 'Awaiting payment', 'warn'],
    ['open', 'Paid – finding driver', 'info'],
    ['assigned', 'Driver assigned', 'info'],
    ['picked_up', 'Car picked up', 'info'],
    ['in_transit', 'In transit', 'info'],
    ['delivered', 'Delivered', 'ok']
  ];
  const STATUS_LABEL = Object.fromEntries(STATUSES.map(s => [s[0], s[1]]));
  const STATUS_TONE = Object.fromEntries(STATUSES.map(s => [s[0], s[2]]));
  STATUS_LABEL.cancelled = 'Cancelled'; STATUS_TONE.cancelled = 'bad';
  const ACTIVE = ['assigned', 'picked_up', 'in_transit'];

  const AREAS = ['Front', 'Rear', 'Left side', 'Right side', 'Roof', 'Wheels & tyres', 'Windscreen & glass', 'Interior'];
  const CONDITIONS = ['OK', 'Scratch', 'Dent', 'Crack / chip', 'Other damage'];

  const DEFAULT_SETTINGS = {
    baseFee: 49, perKm: 0.95, minPrice: 79, vatRate: 25.5,
    driverShare: 65, roadFactor: 1.15, sameCityKm: 15
  };
  const DEFAULT_COMPANY = { name: 'ZEMO SIIRTO', businessId: '', email: 'info@zemosiirto.fi', phone: '', address: '', iban: '' };

  // ---------- State ----------
  // `db` is what the pages render. Local mode: the whole demo database, persisted in localStorage.
  // Supabase mode: the snapshot returned by get_app_state() (same shape), reloaded after every change.
  const KEY = 'zemo-siirto-v3';
  function fresh() {
    return { settings: { ...DEFAULT_SETTINGS }, company: { ...DEFAULT_COMPANY }, admin: null,
      customers: [], drivers: [], orders: [], seq: 1000, session: { customerId: '', driverId: '', admin: false } };
  }
  function load() {
    let d;
    try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) { d = null; }
    d = d || fresh();
    d.settings = { ...DEFAULT_SETTINGS, ...d.settings };
    d.company = { ...DEFAULT_COMPANY, ...d.company };
    d.session = { customerId: '', driverId: '', admin: false, ...d.session };
    return d;
  }
  let db = REMOTE ? fresh() : load();
  function save() {
    if (REMOTE) return;
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* storage unavailable */ }
  }

  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = n => new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR' }).format(n || 0);
  const dt = iso => iso ? new Date(iso).toLocaleString('fi-FI', { dateStyle: 'short', timeStyle: 'short' }) : '–';
  const now = () => new Date().toISOString();
  const badge = s => `<span class="badge ${STATUS_TONE[s] || ''}">${esc(STATUS_LABEL[s] || s)}</span>`;
  const formData = form => Object.fromEntries(new FormData(form).entries());
  const stat = (label, value) => `<div class="stat"><span class="muted">${esc(label)}</span><b>${value}</b></div>`;
  const empty = (msg, extra = '') => `<div class="card empty">${msg}${extra ? `<div class="mt">${extra}</div>` : ''}</div>`;
  const mask = s => esc(String(s || '').replace(/.(?=.{4})/g, '•'));
  const findOrder = id => db.orders.find(o => o.id === id);
  const findDriver = id => db.drivers.find(d => d.id === id);
  const findCustomer = id => db.customers.find(c => c.id === id);
  const uuidOf = id => { const o = findOrder(id); if (!o) throw new Error('Order not found'); return o.uuid; };
  // Today's date in Finland (the database checks pickup dates in Europe/Helsinki time).
  const todayISO = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' }).format(new Date());
  const yearsSince = iso => (Date.now() - new Date(iso)) / 31557600000;
  const validIban = s => /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(String(s).replace(/\s/g, '').toUpperCase());

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
  }
  function flash(msg) { try { sessionStorage.setItem('zemo-flash', msg); } catch (e) { /* ignore */ } }
  function showFlash() {
    try { const m = sessionStorage.getItem('zemo-flash'); if (m) { sessionStorage.removeItem('zemo-flash'); toast(m); } } catch (e) { /* ignore */ }
  }
  function go(portal, page, query, msg) { if (msg) flash(msg); location.href = url(portal, page, query); }

  const modal = $('#modal');
  function openModal(html) { modal.innerHTML = html; if (!modal.open) modal.showModal(); }
  modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) modal.close(); });

  // ---------- Passwords (local demo only – Supabase Auth handles them in Supabase mode) ----------
  function newSalt() {
    const a = new Uint8Array(12);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else a.forEach((_, i) => { a[i] = Math.random() * 256; });
    return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function hash(password, salt) {
    const data = new TextEncoder().encode(salt + ':' + password);
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', data);
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 2166136261; for (const b of data) { h ^= b; h = Math.imul(h, 16777619) >>> 0; }
    return 'fnv' + h.toString(16);
  }
  async function credentials(password) { const salt = newSalt(); return { salt, passHash: await hash(password, salt) }; }
  async function checkPassword(user, password) { return !!user && !!user.salt && await hash(password, user.salt) === user.passHash; }

  // ---------- Pricing (same formula as public._quote in the database) ----------
  function haversine(a, b) {
    const R = 6371, rad = x => x * Math.PI / 180;
    const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function estimateKm(from, to) {
    if (!CITIES[from] || !CITIES[to]) return null;
    if (from === to) return +db.settings.sameCityKm;
    return Math.round(haversine(CITIES[from], CITIES[to]) * db.settings.roadFactor);
  }
  function priceFor(km) {
    const s = db.settings;
    const netCents = Math.max(Math.round(s.minPrice * 100), Math.round(s.baseFee * 100) + Math.round(s.perKm * 100) * km);
    const vatCents = Math.round(netCents * s.vatRate / 100);
    return { km, net: netCents / 100, vat: vatCents / 100, total: (netCents + vatCents) / 100, vatRate: +s.vatRate, driverShare: +s.driverShare };
  }
  const driverPay = o => Math.round(o.price.net * (o.price.driverShare ?? db.settings.driverShare)) / 100;
  function quoteHtml(q) {
    if (!q) return '<span class="muted">Choose cities to see the price.</span>';
    return `<div class="row"><div>
        <div class="muted">Estimated road distance: <b>${q.km} km</b></div>
        <div class="muted">Excl. VAT ${eur(q.net)} + VAT ${q.vatRate}% ${eur(q.vat)}</div>
      </div><span class="spacer"></span><div class="total">${eur(q.total)}</div></div>`;
  }
  function cityOptions(selected) {
    return Object.keys(CITIES).sort((a, b) => a.localeCompare(b, 'fi'))
      .map(c => `<option ${c === selected ? 'selected' : ''}>${c}</option>`).join('');
  }

  // ---------- Shared renderers ----------
  function timeline(o) {
    if (o.status === 'cancelled') return `<p>${badge('cancelled')} <span class="muted">${dt((o.history.at(-1) || {}).at)}</span></p>`;
    const idx = STATUSES.findIndex(s => s[0] === o.status);
    return '<ul class="timeline">' + STATUSES.map((s, i) => {
      const h = [...o.history].reverse().find(x => x.status === s[0]);
      const cls = i < idx || o.status === 'delivered' ? 'done' : i === idx ? 'done current' : '';
      return `<li class="${cls}">${esc(s[1])}${h ? ` <span class="muted">· ${dt(h.at)}</span>` : ''}</li>`;
    }).join('') + '</ul>';
  }

  function orderSummary(o, opts = {}) {
    const d = findDriver(o.driverId);
    return `
      <div class="row"><h2 class="m0">${esc(o.id)}</h2>${badge(o.status)}<span class="spacer"></span>${opts.hidePrice ? '' : `<b>${eur(o.price.total)}</b>`}</div>
      <div class="grid mt">
        <div><div class="muted">Pickup</div>${esc(o.pickup.address)}, ${esc(o.pickup.city)}<br>${esc(o.pickup.date)} ${esc(o.pickup.time)}
          ${opts.contacts && o.pickup.contact ? `<br><span class="muted">Contact: ${esc(o.pickup.contact)}</span>` : ''}</div>
        <div><div class="muted">Delivery</div>${esc(o.dropoff.address)}, ${esc(o.dropoff.city)}
          ${opts.contacts && o.dropoff.contact ? `<br><span class="muted">Contact: ${esc(o.dropoff.contact)}</span>` : ''}</div>
        <div><div class="muted">Vehicle</div>${esc(o.car.model)} · ${esc(o.car.plate)}<br>${esc(o.car.gearbox)}, ${esc(o.car.fuel)}</div>
        ${opts.hideDriver ? '' : `<div><div class="muted">Driver</div>${d ? esc(d.name) + (opts.driverPhone && d.phone ? `<br><a href="tel:${esc(d.phone)}">${esc(d.phone)}</a>` : '') : '<span class="muted">Not yet assigned</span>'}</div>`}
      </div>
      ${o.notes && opts.notes !== false ? `<p class="notice">${esc(o.notes)}</p>` : ''}`;
  }

  function inspectionReport(o) {
    const ins = o.inspection || {};
    if (!ins.pickup && !ins.delivery) return '';
    const cond = v => !v ? '<span class="muted">–</span>' : v === 'OK' ? '<span class="badge ok">OK</span>' : `<span class="badge warn">${esc(v)}</span>`;
    const meta = (s, label, who) => s ? `<div><div class="muted">${label} · ${dt(s.at)}</div>
      ${esc(s.odo)} km · fuel ${esc(s.fuel)}${s.keys != null ? ` · ${esc(s.keys)} key(s)` : ''}${s.docs ? ' · documents ✓' : ''}
      <br>${who}: ${esc(s.person)}${s.photos && s.photos.length ? `<br>📷 ${s.photos.length} photo(s)` : ''}${s.notes ? `<br><i>${esc(s.notes)}</i>` : ''}</div>` : '';
    const rows = AREAS.map(a => {
      const p = ins.pickup && ins.pickup.areas[a], d = ins.delivery && ins.delivery.areas[a];
      const isNew = p === 'OK' && d && d !== 'OK';
      return `<tr><td>${esc(a)}</td><td>${cond(p)}</td><td>${cond(d)}${isNew ? ' <span class="badge bad">New damage</span>' : ''}</td></tr>`;
    }).join('');
    return `<h3>Inspection report</h3>
      <div class="grid">${meta(ins.pickup, 'Pickup', 'Handed over by')}${meta(ins.delivery, 'Delivery', 'Received by')}</div>
      <div class="table-scroll mt"><table><thead><tr><th>Area</th><th>Pickup</th><th>Delivery</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function paymentModal(id) {
    const o = findOrder(id);
    if (!o) return;
    openModal(`
      <h2>Payment – ${esc(o.id)}</h2>
      <p class="muted">${esc(o.pickup.city)} → ${esc(o.dropoff.city)} · ${o.price.km} km · ${esc(o.car.model)} (${esc(o.car.plate)})</p>
      <div class="price-box"><div class="row"><span>Total incl. VAT</span><span class="spacer"></span><span class="total">${eur(o.price.total)}</span></div></div>
      <form id="payForm" class="mt">
        <label>Payment method<select name="method" id="payMethod">
          <option value="card">Card</option><option value="mobilepay">MobilePay</option><option value="invoice">Company invoice (14 days)</option></select></label>
        <div id="cardFields" class="grid mt">
          <label>Card number<input name="card" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242"></label>
          <label>Expiry (MM/YY)<input name="exp" autocomplete="cc-exp" placeholder="12/28"></label>
          <label>CVC<input name="cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="123"></label>
        </div>
        <p class="notice">Demo mode: payment is simulated. Connect a real provider (e.g. Stripe, Paytrail) before going live.</p>
        <div class="row"><button type="button" class="btn" data-close>Pay later</button><span class="spacer"></span>
          <button class="btn primary" type="submit">Pay ${eur(o.price.total)}</button></div>
        <input type="hidden" name="id" value="${esc(o.id)}">
      </form>`);
    $('#payMethod').addEventListener('change', e => { $('#cardFields').style.display = e.target.value === 'card' ? '' : 'none'; });
  }

  function luhn(num) {
    let sum = 0, alt = false;
    for (let i = num.length - 1; i >= 0; i--) {
      let n = +num[i];
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return num.length >= 12 && sum % 10 === 0;
  }

  function invoiceModal(id) {
    const o = findOrder(id), co = db.company;
    const methods = { card: 'Card', mobilepay: 'MobilePay', invoice: 'Invoice, 14 days net' };
    openModal(`
      <div class="invoice">
        <div class="row"><div><b style="font-size:20px">${esc(co.name)}</b>
          <div class="muted">${[co.address, co.businessId && 'Y-tunnus ' + co.businessId, co.email, co.phone].filter(Boolean).map(esc).join('<br>')}</div></div>
          <span class="spacer"></span><div style="text-align:right"><b>INVOICE / LASKU</b><div class="muted">No. ${esc(o.id.replace('ZS-', 'INV-'))}</div><div class="muted">${dt(o.payment ? o.payment.paidAt : o.createdAt)}</div></div></div>
        <hr>
        <p><b>Bill to:</b> ${esc(o.customer.name)}${o.customer.company ? ', ' + esc(o.customer.company) : ''}<br><span class="muted">${esc(o.customer.email)} · ${esc(o.customer.phone)}</span></p>
        <table><thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead><tbody>
          <tr><td>Car transfer ${esc(o.pickup.city)} → ${esc(o.dropoff.city)} (${o.price.km} km)<br><span class="muted">${esc(o.car.model)}, ${esc(o.car.plate)} · ${esc(o.pickup.date)}</span></td><td style="text-align:right">${eur(o.price.net)}</td></tr>
          <tr><td>VAT ${o.price.vatRate}%</td><td style="text-align:right">${eur(o.price.vat)}</td></tr>
          <tr><td><b>Total</b></td><td style="text-align:right"><b>${eur(o.price.total)}</b></td></tr>
        </tbody></table>
        <p class="muted">Payment: ${esc(o.payment ? methods[o.payment.method] : 'Unpaid')}${o.payment && o.payment.last4 ? ' •••• ' + esc(o.payment.last4) : ''}
          ${o.payment && o.payment.method === 'invoice' && co.iban ? `<br>Pay to IBAN ${esc(co.iban)}, reference ${esc(o.id)}` : ''}
          ${o.status === 'cancelled' ? `<br>ORDER CANCELLED – ${o.refundedAt ? 'refunded ' + dt(o.refundedAt) : 'refund due'}` : ''}</p>
      </div>
      <div class="row mt"><button class="btn" onclick="window.print()">Print / Save PDF</button><span class="spacer"></span><button class="btn primary" data-close>Close</button></div>`);
  }

  // ================= PUBLIC LANDING =================
  const PUBLIC = {
    home() {
      return `
      <section class="hero big">
        <span class="badge ok">Auton siirto – Suomessa, luotettavasti.</span>
        <h1>Your car. Our driver.<br>Your destination.</h1>
        <p>A verified professional driver moves your car anywhere in Finland. Fixed price up front, live tracking and a full inspection report.</p>
        <div class="row mt"><a class="btn primary" href="${url('customer', 'login')}">Order a transfer</a><a class="btn" href="${url('driver', 'login')}">Drive with us</a></div>
      </section>
      <form class="card" id="quickQuote"><h2>Instant price</h2>
        <div class="grid"><label>From<select name="from">${cityOptions('Helsinki')}</select></label>
          <label>To<select name="to">${cityOptions('Tampere')}</select></label></div>
        <div class="price-box mt" id="quickOut"></div></form>
      <div class="grid">
        <div class="card"><h2>1. Book</h2><p class="muted">Enter the route and your car. The price is calculated automatically from the distance.</p></div>
        <div class="card"><h2>2. We drive</h2><p class="muted">A verified driver inspects the car at pickup and drives it to the destination.</p></div>
        <div class="card"><h2>3. Delivered</h2><p class="muted">Follow the status live and get the delivery inspection report and invoice.</p></div>
      </div>
      <p class="muted center"><a href="${url('admin', 'login')}">Admin</a></p>`;
    }
  };
  function updateQuickQuote() {
    const f = $('#quickQuote'); if (!f) return;
    const km = estimateKm(f.from.value, f.to.value);
    $('#quickOut').innerHTML = quoteHtml(km == null ? null : priceFor(km));
  }

  // ================= CUSTOMER PORTAL =================
  const CUSTOMER = {
    login() {
      return `<div class="grid2">
        <form class="card" id="customerSignIn"><h2>Sign in</h2>
          <label>Email<input name="email" type="email" required autocomplete="email"></label>
          <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
          <div class="row mt"><span class="spacer"></span><button class="btn primary">Sign in</button></div></form>
        <form class="card" id="customerRegister"><h2>Create account</h2>
          <label>Full name<input name="name" required autocomplete="name"></label>
          <label>Email<input name="email" type="email" required autocomplete="email"></label>
          <label>Phone<input name="phone" type="tel" required autocomplete="tel" placeholder="+358 40 123 4567"></label>
          <label>Company (optional)<input name="company" autocomplete="organization"></label>
          <label>Password (min. 8 characters)<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
          <div class="row mt"><span class="spacer"></span><button class="btn primary">Create account</button></div></form>
      </div>`;
    },

    dashboard(c) {
      const list = db.orders.filter(o => o.customerId === c.id).reverse();
      const active = list.filter(o => !['delivered', 'cancelled'].includes(o.status));
      const spent = list.filter(o => o.payment && o.status !== 'cancelled').reduce((t, o) => t + o.price.total, 0);
      return `
      <div class="card"><div class="row"><h2 class="m0">Hei, ${esc((c.name || '').split(' ')[0])}!</h2><span class="spacer"></span>
        <a class="btn primary" href="${url('customer', 'create-order')}">+ New transfer</a></div>
        <div class="grid mt">${stat('Active transfers', active.length)}${stat('Delivered', list.filter(o => o.status === 'delivered').length)}${stat('Total spent', eur(spent))}</div></div>
      <div class="card"><h2>My orders & invoices</h2>${!list.length ? '<div class="empty">No orders yet.</div>' : `
        <div class="table-scroll"><table><thead><tr><th>Order</th><th>Route</th><th>Date</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map(o => `<tr><td>${esc(o.id)}</td><td>${esc(o.pickup.city)} → ${esc(o.dropoff.city)}</td><td>${esc(o.pickup.date)}</td>
          <td>${eur(o.price.total)}</td><td>${badge(o.status)}</td>
          <td><div class="row"><a class="btn sm" href="${url('customer', 'tracking', { id: o.id })}">Track</a>
            ${o.payment ? `<button class="btn sm" data-invoice="${esc(o.id)}">Invoice</button>` : o.status !== 'cancelled' ? `<button class="btn sm primary" data-pay="${esc(o.id)}">Pay</button>` : ''}
            ${['pending_payment', 'open'].includes(o.status) ? `<button class="btn sm danger" data-cancel="${esc(o.id)}">Cancel</button>` : ''}
          </div></td></tr>`).join('')}
        </tbody></table></div>`}</div>
      <form class="card" id="customerProfile"><h2>Account</h2><div class="grid">
        <label>Full name<input name="name" required value="${esc(c.name)}"></label>
        <label>Phone<input name="phone" type="tel" required value="${esc(c.phone)}"></label>
        <label>Company<input name="company" value="${esc(c.company)}"></label>
        <label>Email<input value="${esc(c.email)}" disabled></label></div>
        <div class="row mt"><span class="spacer"></span><button class="btn">Save</button></div></form>`;
    },

    'create-order'(c) {
      return `
      <form class="card" id="orderForm">
        <h2>Create a car transfer request</h2>
        <p class="muted">Booking as ${esc(c.name)} · ${esc(c.email)} · ${esc(c.phone)}</p>
        <h3>Pickup</h3>
        <div class="grid">
          <label>City<select name="fromCity" required>${cityOptions('Helsinki')}</select></label>
          <label>Address<input name="fromAddr" required maxlength="200" placeholder="Street, postcode"></label>
          <label>Date<input name="date" type="date" min="${todayISO()}" value="${todayISO()}" required></label>
          <label>Time<input name="time" type="time" value="09:00" required></label>
          <label>Contact at pickup (optional)<input name="fromContact" maxlength="200" placeholder="Name, phone"></label>
        </div>
        <h3>Delivery</h3>
        <div class="grid">
          <label>City<select name="toCity" required>${cityOptions('Tampere')}</select></label>
          <label>Address<input name="toAddr" required maxlength="200" placeholder="Street, postcode"></label>
          <label>Contact at delivery (optional)<input name="toContact" maxlength="200" placeholder="Name, phone"></label>
        </div>
        <h3>Vehicle</h3>
        <div class="grid">
          <label>Make & model<input name="car" required maxlength="100" placeholder="e.g. Volvo V60"></label>
          <label>Registration plate<input name="plate" required maxlength="20" placeholder="ABC-123" class="upper"></label>
          <label>Gearbox<select name="gearbox"><option>Automatic</option><option>Manual</option></select></label>
          <label>Fuel / power<select name="fuel"><option>Petrol</option><option>Diesel</option><option>Hybrid</option><option>Electric</option></select></label>
        </div>
        <label>Notes for the driver<textarea name="notes" maxlength="2000" placeholder="Key handover, parking, special instructions…"></textarea></label>
        <h3>Price (calculated from the distance)</h3>
        <div class="price-box" id="quoteBox"></div>
        <div class="row mt"><span class="spacer"></span><button class="btn primary" type="submit">Continue to payment</button></div>
      </form>`;
    },

    tracking(c) {
      const mine = db.orders.filter(o => o.customerId === c.id).reverse();
      if (!mine.length) return empty('No orders to track yet.', `<a class="btn primary" href="${url('customer', 'create-order')}">Create your first transfer</a>`);
      const id = params.get('id') || (mine.find(o => !['delivered', 'cancelled'].includes(o.status)) || mine[0]).id;
      const o = mine.find(x => x.id === id);
      const picker = `<div class="card"><h2>Track your transfer</h2><select data-goto aria-label="Order">
        ${mine.map(x => `<option value="${esc(url('customer', 'tracking', { id: x.id }))}" ${x === o ? 'selected' : ''}>${esc(x.id)} · ${esc(x.pickup.city)} → ${esc(x.dropoff.city)} · ${esc(STATUS_LABEL[x.status])}</option>`).join('')}
        ${o ? '' : '<option value="" selected>Choose an order</option>'}</select></div>`;
      if (!o) return picker + empty('Order not found.');
      return picker + `<div class="card">${orderSummary(o, { driverPhone: ACTIVE.includes(o.status), contacts: true })}
        <h3>Status</h3>${timeline(o)}
        <div class="row">${o.status === 'pending_payment' ? `<button class="btn primary" data-pay="${esc(o.id)}">Pay now</button>` : ''}
          ${o.payment ? `<button class="btn" data-invoice="${esc(o.id)}">Invoice</button>` : ''}</div>
        ${inspectionReport(o)}</div>`;
    }
  };

  function refreshQuote() {
    const f = $('#orderForm'); if (!f) return;
    const km = estimateKm(f.fromCity.value, f.toCity.value);
    $('#quoteBox').innerHTML = quoteHtml(km == null ? null : priceFor(km));
  }

  function confirmEmailNotice(email) {
    openModal(`<h2>📧 Check your email</h2>
      <p>We sent a confirmation link to <b>${esc(email)}</b>. Open it, then sign in here.</p>
      <div class="row"><span class="spacer"></span><button class="btn primary" data-close>OK</button></div>`);
  }

  // ================= DRIVER PORTAL =================
  const DRIVER_STATUS = { pending: ['Pending verification', 'warn'], approved: ['Approved', 'ok'], rejected: ['Rejected', 'bad'], suspended: ['Suspended', 'bad'] };
  const driverBadge = d => { const [l, t] = DRIVER_STATUS[d.status] || [d.status, '']; return `<span class="badge ${t}">${esc(l)}</span>`; };
  function gate(d) {
    if (d.status === 'approved') return '';
    const msg = { pending: 'Your documents are being reviewed by ZEMO SIIRTO. You can take jobs once you are approved.',
      rejected: 'Your application was not approved. Please contact support.', suspended: 'Your account is suspended. Please contact support.' }[d.status];
    return `<div class="card"><div class="row"><h2 class="m0">Not available yet</h2>${driverBadge(d)}</div><p class="muted">${msg}</p></div>`;
  }
  const activeJobs = d => db.orders.filter(o => o.driverId === d.id && ACTIVE.includes(o.status));
  function jobPicker(jobs, current, page) {
    if (jobs.length < 2) return '';
    return `<select data-goto aria-label="Job" class="mb">${jobs.map(o => `<option value="${esc(url('driver', page, { order: o.id }))}" ${o === current ? 'selected' : ''}>${esc(o.id)} · ${esc(o.pickup.city)} → ${esc(o.dropoff.city)} · ${esc(STATUS_LABEL[o.status])}</option>`).join('')}</select>`;
  }
  function jobCard(o, actions, extra = '') {
    return `<div class="card">${orderSummary(o, { hidePrice: true, hideDriver: true, contacts: ACTIVE.includes(o.status) })}
      <div class="row mt"><span class="muted">${o.price.km} km · your pay</span><b>${eur(driverPay(o))}</b></div>
      ${extra}<div class="row mt">${actions}</div></div>`;
  }
  const passwordForm = id => `<form class="card" id="${id}"><h2>Change password</h2><div class="grid">
      <label>Current password<input name="current" type="password" required autocomplete="current-password"></label>
      <label>New password (min. 8)<input name="password" type="password" minlength="8" required autocomplete="new-password"></label></div>
      <div class="row mt"><span class="spacer"></span><button class="btn">Change password</button></div></form>`;

  const DRIVER = {
    login() {
      return `
      <form class="card" id="driverSignIn"><h2>Driver sign in</h2>
        <div class="grid"><label>Email<input name="email" type="email" required autocomplete="email"></label>
        <label>Password<input name="password" type="password" required autocomplete="current-password"></label></div>
        <div class="row mt"><span class="spacer"></span><button class="btn primary">Sign in</button></div></form>
      <form class="card" id="driverRegister">
        <h2>New driver? Register</h2>
        <div class="grid">
          <label>Full name<input name="name" required autocomplete="name"></label>
          <label>Email<input name="email" type="email" required autocomplete="email"></label>
          <label>Phone<input name="phone" type="tel" required autocomplete="tel"></label>
          <label>Home city<select name="city">${cityOptions('Helsinki')}</select></label>
          <label>Date of birth<input name="dob" type="date" required></label>
          <label>Driving licence number<input name="licenseNo" required></label>
          <label>Licence class<select name="licenseClass"><option>B</option><option>BE</option><option>C1</option><option>C</option></select></label>
          <label>Licence valid until<input name="licenseExpiry" type="date" required></label>
          <label>IBAN (for payouts)<input name="iban" required placeholder="FI.."></label>
          <label>Licence photo<input name="licensePhoto" type="file" accept="image/*,application/pdf"></label>
          <label>Password (min. 8 characters)<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
        </div>
        <label class="check"><input type="checkbox" name="consent" required> I confirm the details are correct and consent to a background / licence check.</label>
        <div class="row mt"><span class="spacer"></span><button class="btn primary">Submit for verification</button></div>
      </form>`;
    },

    'available-jobs'(d) {
      const g = gate(d); if (g) return g;
      const jobs = db.orders.filter(o => o.status === 'open' && !(o.rejectedBy || []).includes(d.id))
        .map(o => ({ o, away: estimateKm(d.city, o.pickup.city) })).sort((a, b) => (a.away ?? 1e9) - (b.away ?? 1e9));
      return `<div class="card"><h2>Available transfer jobs</h2><p class="muted m0">Paid orders waiting for a driver${d.city ? `, nearest to ${esc(d.city)} first` : ''}.</p></div>` +
        (jobs.length ? jobs.map(({ o, away }) => jobCard(o, `<button class="btn danger" data-reject="${esc(o.id)}">Reject</button>
          <span class="spacer"></span><button class="btn primary" data-accept="${esc(o.id)}">Accept job</button>`,
          away != null ? `<p class="muted m0">Pickup is ~${away} km from ${esc(d.city)}</p>` : '')).join('')
          : empty('No open jobs right now.'));
    },

    'my-jobs'(d) {
      const g = gate(d); if (g) return g;
      const active = activeJobs(d).reverse();
      const done = db.orders.filter(o => o.driverId === d.id && o.status === 'delivered').reverse();
      const actions = o => {
        const nav = `<a class="btn" href="${url('driver', 'navigation', { order: o.id })}">Navigation</a>`;
        const insp = label => `<a class="btn primary" href="${url('driver', 'inspection', { order: o.id })}">${label}</a>`;
        if (o.status === 'assigned') return `<button class="btn danger" data-release="${esc(o.id)}">Release</button><span class="spacer"></span>${nav}${insp('Pickup inspection')}`;
        if (o.status === 'picked_up') return `<span class="spacer"></span><button class="btn" data-start-drive="${esc(o.id)}">Start driving</button>${nav}`;
        return `<span class="spacer"></span>${nav}${insp('Delivery inspection')}`;
      };
      return `<div class="card"><h2 class="m0">Active jobs (${active.length})</h2></div>` +
        (active.length ? active.map(o => jobCard(o, actions(o), `<div class="mt">${badge(o.status)}</div>`)).join('')
          : empty('No active jobs.', `<a class="btn primary" href="${url('driver', 'available-jobs')}">Find jobs</a>`)) +
        (done.length ? `<div class="card"><h2>Completed</h2><div class="table-scroll"><table><thead><tr><th>Order</th><th>Route</th><th>Delivered</th><th>Pay</th></tr></thead><tbody>
          ${done.map(o => `<tr><td>${esc(o.id)}</td><td>${esc(o.pickup.city)} → ${esc(o.dropoff.city)}</td><td>${dt(o.history.at(-1).at)}</td><td>${eur(driverPay(o))}</td></tr>`).join('')}
          </tbody></table></div></div>` : '');
    },

    inspection(d) {
      const g = gate(d); if (g) return g;
      const jobs = activeJobs(d);
      const id = params.get('order');
      const o = id ? db.orders.find(x => x.id === id && x.driverId === d.id) : jobs[0];
      if (!o) return empty('No job needs an inspection right now.', `<a class="btn primary" href="${url('driver', 'my-jobs')}">My jobs</a>`);
      const stage = o.status === 'assigned' ? 'pickup' : ['picked_up', 'in_transit'].includes(o.status) ? 'delivery' : null;
      const head = `<div class="card">${jobPicker(jobs, o, 'inspection')}${orderSummary(o, { hidePrice: true, hideDriver: true, contacts: true })}</div>`;
      if (!stage) return head + `<div class="card">${inspectionReport(o) || '<div class="empty">No inspection recorded.</div>'}</div>`;
      const pickupOdo = o.inspection.pickup ? o.inspection.pickup.odo : 0;
      return head + `
      <form class="card" id="inspectionForm">
        <h2>${stage === 'pickup' ? 'Pickup inspection' : 'Delivery inspection'}</h2>
        <input type="hidden" name="id" value="${esc(o.id)}"><input type="hidden" name="stage" value="${stage}">
        <div class="grid">
          <label>Odometer (km)<input name="odo" type="number" min="${esc(pickupOdo)}" required></label>
          <label>Fuel / charge level<select name="fuel"><option>Full</option><option>3/4</option><option>1/2</option><option>1/4</option><option>Reserve</option></select></label>
          ${stage === 'pickup' ? '<label>Keys received<input name="keys" type="number" min="1" value="1" required></label>' : ''}
        </div>
        <h3>Condition check</h3>
        <div class="grid">${AREAS.map((a, i) => {
          const prev = stage === 'delivery' && o.inspection.pickup ? o.inspection.pickup.areas[a] : '';
          return `<label>${esc(a)}${prev ? ` <span class="muted">(pickup: ${esc(prev)})</span>` : ''}<select name="area${i}">${CONDITIONS.map(c => `<option ${c === (prev || 'OK') ? 'selected' : ''}>${c}</option>`).join('')}</select></label>`;
        }).join('')}</div>
        <label>Damage description / notes<textarea name="notes" maxlength="2000"></textarea></label>
        <label>Photos (all four sides + dashboard)<input name="photos" type="file" accept="image/*" capture="environment" multiple></label>
        <div class="grid">
          <label>${stage === 'pickup' ? 'Car handed over by' : 'Car received by'}<input name="person" required maxlength="200" placeholder="Full name"></label>
        </div>
        ${stage === 'pickup' ? '<label class="check"><input type="checkbox" name="docs"> Registration document in the car</label>' : ''}
        <label class="check"><input type="checkbox" required> ${stage === 'pickup' ? 'I have checked the car and the details above are correct' : 'The car was handed over and the receiver confirmed its condition'}</label>
        <div class="row mt"><span class="spacer"></span><button class="btn primary">${stage === 'pickup' ? 'Confirm pickup' : 'Confirm delivery'}</button></div>
      </form>
      ${stage === 'delivery' ? `<div class="card">${inspectionReport(o)}</div>` : ''}`;
    },

    navigation(d) {
      const g = gate(d); if (g) return g;
      const jobs = activeJobs(d);
      const id = params.get('order');
      const o = (id && jobs.find(x => x.id === id)) || jobs[0];
      if (!o) return empty('No active job to navigate.', `<a class="btn primary" href="${url('driver', 'available-jobs')}">Find jobs</a>`);
      const toPickup = o.status === 'assigned';
      const target = toPickup ? o.pickup : o.dropoff;
      const place = p => `${p.address}, ${p.city}, Finland`;
      const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place(target))}&travelmode=driving`;
      const route = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(place(o.pickup))}&destination=${encodeURIComponent(place(o.dropoff))}&travelmode=driving`;
      const a = CITIES[o.pickup.city], b = CITIES[o.dropoff.city], m = CITIES[target.city];
      const pad = 0.25;
      const bbox = [Math.min(a[1], b[1]) - pad, Math.min(a[0], b[0]) - pad / 2, Math.max(a[1], b[1]) + pad, Math.max(a[0], b[0]) + pad / 2].map(n => n.toFixed(4)).join('%2C');
      const map = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${m[0]}%2C${m[1]}`;
      const hrs = o.price.km / 75;
      const contact = target.contact || `${o.customer.name}, ${o.customer.phone}`;
      const phone = (contact.match(/\+?[\d\s-]{6,}/) || [o.customer.phone])[0].replace(/\s|-/g, '');
      let action = '';
      if (o.status === 'assigned') action = `<a class="btn primary" href="${url('driver', 'inspection', { order: o.id })}">Arrived – pickup inspection</a>`;
      if (o.status === 'picked_up') action = `<button class="btn primary" data-start-drive="${esc(o.id)}">Start driving</button>`;
      if (o.status === 'in_transit') action = `<a class="btn primary" href="${url('driver', 'inspection', { order: o.id })}">Arrived – delivery inspection</a>`;
      return `<div class="card">${jobPicker(jobs, o, 'navigation')}
        <div class="row"><h2 class="m0">${toPickup ? 'Leg 1 · Go to pickup' : 'Leg 2 · Deliver the car'}</h2>${badge(o.status)}</div>
        <p class="big-addr">${esc(target.address)}<br><span class="muted">${esc(target.city)}</span></p>
        <div class="row"><a class="btn primary" href="${gmaps}" target="_blank" rel="noopener">Open in Google Maps</a>
          <a class="btn" href="tel:${esc(phone)}">Call contact</a><span class="spacer"></span>${action}</div>
        <p class="muted">Contact: ${esc(contact)}</p></div>
      <div class="card"><iframe class="map" title="Route map" src="${map}" loading="lazy"></iframe>
        <div class="grid mt">${stat('Transfer distance', o.price.km + ' km')}${stat('Est. driving time', `${Math.floor(hrs)} h ${Math.round((hrs % 1) * 60)} min`)}${stat('Your pay', eur(driverPay(o)))}</div>
        <div class="row mt"><span class="muted">${esc(o.pickup.city)} → ${esc(o.dropoff.city)} · ${esc(o.car.model)} ${esc(o.car.plate)}</span><span class="spacer"></span>
          <a class="btn sm" href="${route}" target="_blank" rel="noopener">Full route</a></div>
        ${o.notes ? `<p class="notice">${esc(o.notes)}</p>` : ''}</div>`;
    },

    earnings(d) {
      const mine = db.orders.filter(o => o.driverId === d.id);
      const done = mine.filter(o => o.status === 'delivered');
      const active = mine.filter(o => ACTIVE.includes(o.status));
      const sum = arr => arr.reduce((t, o) => t + driverPay(o), 0);
      return `<div class="card"><h2>Earnings</h2>
        <div class="grid">${stat('Earned', eur(sum(done)))}${stat('Paid out', eur(sum(done.filter(o => o.driverPaidAt))))}
          ${stat('Awaiting payout', eur(sum(done.filter(o => !o.driverPaidAt))))}${stat('Pending (active jobs)', eur(sum(active)))}
          ${stat('Completed jobs', done.length)}${stat('Kilometres driven', done.reduce((t, o) => t + o.price.km, 0))}</div>
        <p class="muted">You earn ${db.settings.driverShare}% of the transfer price excl. VAT. Payouts go to ${mask(d.iban)}.</p>
        ${done.length ? `<div class="table-scroll"><table><thead><tr><th>Order</th><th>Route</th><th>Delivered</th><th>Pay</th><th>Payout</th></tr></thead><tbody>
          ${[...done].reverse().map(o => `<tr><td>${esc(o.id)}</td><td>${esc(o.pickup.city)} → ${esc(o.dropoff.city)}</td><td>${dt(o.history.at(-1).at)}</td><td>${eur(driverPay(o))}</td>
            <td>${o.driverPaidAt ? `<span class="badge ok">Paid ${dt(o.driverPaidAt)}</span>` : '<span class="badge warn">Pending</span>'}</td></tr>`).join('')}
        </tbody></table></div>` : ''}</div>`;
    },

    profile(d) {
      return `<div class="card"><div class="row"><h2 class="m0">${esc(d.name)}</h2>${driverBadge(d)}</div>
        <div class="grid mt">
          <div><div class="muted">Email</div>${esc(d.email)}</div>
          <div><div class="muted">Driving licence</div>${esc(d.licenseNo)} (class ${esc(d.licenseClass)}), valid until ${esc(d.licenseExpiry)}</div>
          <div><div class="muted">Registered</div>${dt(d.createdAt)}</div></div></div>
      <form class="card" id="driverProfile"><h2>Contact & payout details</h2><div class="grid">
        <label>Phone<input name="phone" type="tel" required value="${esc(d.phone)}"></label>
        <label>Home city<select name="city">${cityOptions(d.city)}</select></label>
        <label>IBAN<input name="iban" required value="${esc(d.iban)}"></label></div>
        <div class="row mt"><span class="spacer"></span><button class="btn">Save</button></div></form>
      ${passwordForm('driverPassword')}`;
    }
  };

  // ================= ADMIN PORTAL =================
  function revenueStats() {
    const paid = db.orders.filter(o => o.payment && o.status !== 'cancelled');
    return { revenue: paid.reduce((t, o) => t + o.price.net, 0), payouts: paid.reduce((t, o) => t + driverPay(o), 0) };
  }
  const refundsDue = () => db.orders.filter(o => o.status === 'cancelled' && o.payment && !o.refundedAt);
  const payoutsDue = () => db.orders.filter(o => o.status === 'delivered' && !o.driverPaidAt);

  function adminOrderRow(o, approved) {
    return `<tr><td>${esc(o.id)}<br><span class="muted">${esc(o.pickup.date)}</span></td>
      <td>${esc(o.customer.name)}<br><span class="muted">${esc(o.customer.phone)}</span></td>
      <td>${esc(o.pickup.city)} → ${esc(o.dropoff.city)}<br><span class="muted">${o.price.km} km</span></td>
      <td>${eur(o.price.total)}</td><td>${badge(o.status)}</td>
      <td>${o.status === 'open' && approved.length ? `<select data-assign="${esc(o.id)}" class="m0"><option value="">Assign…</option>
          ${approved.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select>` : esc((findDriver(o.driverId) || {}).name || '–')}</td>
      <td><div class="row"><button class="btn sm" data-detail="${esc(o.id)}">Details</button>
        ${!['delivered', 'cancelled'].includes(o.status) ? `<button class="btn sm danger" data-cancel="${esc(o.id)}">Cancel</button>` : ''}</div></td></tr>`;
  }
  function ordersTable(list) {
    const approved = db.drivers.filter(d => d.status === 'approved');
    return !list.length ? '<div class="empty">No orders.</div>' : `<div class="table-scroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Route</th><th>Total</th><th>Status</th><th>Driver</th><th></th></tr></thead>
      <tbody>${list.map(o => adminOrderRow(o, approved)).join('')}</tbody></table></div>`;
  }

  const ADMIN = {
    login() {
      const signIn = `<form class="card narrow" id="adminSignIn"><h2>Admin sign in</h2>
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
        <div class="row mt"><span class="spacer"></span><button class="btn primary">Sign in</button></div>
        ${REMOTE ? `<p class="notice">Admins are promoted in Supabase: create a customer account, then run<br><code>update public.profiles set role = 'admin' where email = '…';</code></p>` : ''}</form>`;
      if (REMOTE || db.admin) return signIn;
      return `<form class="card narrow" id="adminSetup"><h2>Create the admin account</h2>
        <p class="muted">No admin exists yet. The first account created here becomes the administrator.</p>
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        <label>Password (min. 8)<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
        <label>Repeat password<input name="password2" type="password" minlength="8" required autocomplete="new-password"></label>
        <div class="row mt"><span class="spacer"></span><button class="btn primary">Create admin</button></div></form>`;
    },

    dashboard() {
      const { revenue, payouts } = revenueStats();
      const count = s => db.orders.filter(o => o.status === s).length;
      const todo = [
        [db.drivers.filter(d => d.status === 'pending').length, 'driver(s) waiting for verification', url('admin', 'drivers')],
        [count('open'), 'paid order(s) without a driver', url('admin', 'orders', { status: 'open' })],
        [refundsDue().length, 'refund(s) due', url('admin', 'payments')],
        [payoutsDue().length, 'delivered job(s) awaiting driver payout', url('admin', 'payments')]
      ].filter(t => t[0]);
      return `<div class="card"><h2>Dashboard</h2><div class="grid">
        ${stat('Revenue (excl. VAT)', eur(revenue))}${stat('Driver payouts', eur(payouts))}${stat('Gross margin', eur(revenue - payouts))}
        ${stat('Orders', db.orders.length)}${stat('Active transfers', db.orders.filter(o => ACTIVE.includes(o.status)).length)}
        ${stat('Customers', db.customers.length)}${stat('Approved drivers', db.drivers.filter(d => d.status === 'approved').length)}</div></div>
      <div class="card"><h2>Needs attention</h2>${todo.length ? `<ul class="todo">${todo.map(([n, l, h]) => `<li><a href="${h}"><b>${n}</b> ${l} →</a></li>`).join('')}</ul>` : '<p class="muted m0">All clear 🎉</p>'}</div>
      <div class="card"><div class="row"><h2 class="m0">Latest orders</h2><span class="spacer"></span><a class="btn sm" href="${url('admin', 'orders')}">All orders</a></div>
        <div class="mt">${ordersTable([...db.orders].reverse().slice(0, 5))}</div></div>`;
    },

    drivers() {
      return `<div class="card"><h2>Drivers</h2>${!db.drivers.length ? '<div class="empty">No drivers registered.</div>' : `
        <div class="table-scroll"><table><thead><tr><th>Driver</th><th>Licence</th><th>City</th><th>Jobs</th><th>Status</th><th></th></tr></thead><tbody>
        ${db.drivers.map(d => {
          const expired = !d.licenseExpiry || new Date(d.licenseExpiry) < new Date();
          const jobs = db.orders.filter(o => o.driverId === d.id && o.status === 'delivered').length;
          const age = d.dob ? Math.floor(yearsSince(d.dob)) + ' y' : 'age unknown';
          return `<tr><td>${esc(d.name)}<br><span class="muted">${esc(d.email)} · ${esc(d.phone)} · ${age}</span></td>
          <td>${esc(d.licenseNo)} (${esc(d.licenseClass)})<br><span class="muted">valid until ${esc(d.licenseExpiry || '–')}${expired ? ' – EXPIRED' : ''}${d.licensePhoto ? ' · 📎 ' + esc(d.licensePhoto) : ''}</span></td>
          <td>${esc(d.city)}</td><td>${jobs}</td><td>${driverBadge(d)}</td>
          <td><div class="row">${d.status !== 'approved' ? `<button class="btn sm primary" data-driver-status="approved" data-id="${esc(d.id)}" ${expired ? 'disabled' : ''}>Approve</button>` : ''}
            ${d.status === 'pending' ? `<button class="btn sm danger" data-driver-status="rejected" data-id="${esc(d.id)}">Reject</button>` : ''}
            ${d.status === 'approved' ? `<button class="btn sm danger" data-driver-status="suspended" data-id="${esc(d.id)}">Suspend</button>` : ''}</div></td></tr>`;
        }).join('')}</tbody></table></div>`}</div>`;
    },

    customers() {
      return `<div class="card"><h2>Customers</h2>${!db.customers.length ? '<div class="empty">No customers yet.</div>' : `
        <div class="table-scroll"><table><thead><tr><th>Customer</th><th>Contact</th><th>Orders</th><th>Spent</th><th>Joined</th></tr></thead><tbody>
        ${db.customers.map(c => {
          const list = db.orders.filter(o => o.customerId === c.id);
          const spent = list.filter(o => o.payment && o.status !== 'cancelled').reduce((t, o) => t + o.price.total, 0);
          return `<tr><td>${esc(c.name)}${c.company ? `<br><span class="muted">${esc(c.company)}</span>` : ''}</td>
            <td>${esc(c.email)}<br><span class="muted">${esc(c.phone)}</span></td><td>${list.length}</td><td>${eur(spent)}</td><td>${dt(c.createdAt)}</td></tr>`;
        }).join('')}</tbody></table></div>`}</div>`;
    },

    orders() {
      const status = params.get('status') || '';
      const list = [...db.orders].reverse().filter(o => !status || o.status === status);
      const opt = (v, l) => `<option value="${esc(url('admin', 'orders', v ? { status: v } : null))}" ${v === status ? 'selected' : ''}>${esc(l)}</option>`;
      return `<div class="card"><div class="row"><h2 class="m0">Orders</h2><span class="spacer"></span>
        <select data-goto class="m0 auto" aria-label="Filter by status">${opt('', 'All statuses')}${Object.keys(STATUS_LABEL).map(s => opt(s, STATUS_LABEL[s])).join('')}</select></div>
        <div class="mt">${ordersTable(list)}</div></div>`;
    },

    pricing() {
      const s = db.settings;
      const f = (k, l, step = '0.01') => `<label>${l}<input name="${k}" type="number" step="${step}" min="0" value="${esc(s[k])}" required></label>`;
      const ex = [15, 50, 180, 400, 800].map(km => { const p = priceFor(km); return `<tr><td>${km} km</td><td>${eur(p.net)}</td><td>${eur(p.total)}</td><td>${eur(p.net * s.driverShare / 100)}</td></tr>`; }).join('');
      return `<form class="card" id="pricingForm"><h2>Pricing rules</h2>
        <div class="grid">${f('baseFee', 'Base fee € (excl. VAT)')}${f('perKm', 'Price per km €')}${f('minPrice', 'Minimum price €')}
          ${f('vatRate', 'VAT %', '0.1')}${f('driverShare', 'Driver share %', '1')}${f('roadFactor', 'Road factor (straight line → road)')}${f('sameCityKm', 'Same-city distance km', '1')}</div>
        <h3>Examples with the current rules</h3><div class="table-scroll"><table><thead><tr><th>Distance</th><th>Excl. VAT</th><th>Incl. VAT</th><th>Driver pay</th></tr></thead><tbody>${ex}</tbody></table></div>
        <p class="muted">New prices apply to new orders only.</p>
        <div class="row mt"><span class="spacer"></span><button class="btn primary">Save pricing</button></div></form>`;
    },

    payments() {
      const paid = db.orders.filter(o => o.payment).reverse();
      const received = paid.filter(o => !o.refundedAt).reduce((t, o) => t + o.price.total, 0);
      const methods = { card: 'Card', mobilepay: 'MobilePay', invoice: 'Invoice' };
      const rows = paid.map(o => {
        const state = o.status !== 'cancelled' ? '<span class="badge ok">Paid</span>' : o.refundedAt ? '<span class="badge">Refunded</span>' : '<span class="badge bad">Refund due</span>';
        return `<tr><td>${esc(o.id)}</td><td>${esc(o.customer.name)}</td><td>${esc(methods[o.payment.method])}${o.payment.last4 ? ' •••• ' + esc(o.payment.last4) : ''}</td>
          <td>${eur(o.price.total)}</td><td>${dt(o.payment.paidAt)}</td><td>${state}</td>
          <td><div class="row"><button class="btn sm" data-invoice="${esc(o.id)}">Invoice</button>${o.status === 'cancelled' && !o.refundedAt ? `<button class="btn sm primary" data-refund="${esc(o.id)}">Mark refunded</button>` : ''}</div></td></tr>`;
      }).join('');
      const payouts = db.drivers.map(d => {
        const due = payoutsDue().filter(o => o.driverId === d.id);
        const out = db.orders.filter(o => o.driverId === d.id && o.driverPaidAt).reduce((t, o) => t + driverPay(o), 0);
        if (!due.length && !out) return '';
        return `<tr><td>${esc(d.name)}</td><td>${mask(d.iban)}</td><td>${due.length}</td><td><b>${eur(due.reduce((t, o) => t + driverPay(o), 0))}</b></td><td>${eur(out)}</td>
          <td>${due.length ? `<button class="btn sm primary" data-payout="${esc(d.id)}">Mark paid out</button>` : ''}</td></tr>`;
      }).join('');
      return `<div class="card"><h2>Payments</h2><div class="grid">
          ${stat('Received', eur(received))}${stat('Refunds due', eur(refundsDue().reduce((t, o) => t + o.price.total, 0)))}
          ${stat('Driver payouts due', eur(payoutsDue().reduce((t, o) => t + driverPay(o), 0)))}</div></div>
        <div class="card"><h2>Customer payments</h2>${rows ? `<div class="table-scroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Method</th><th>Amount</th><th>Date</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No payments yet.</div>'}</div>
        <div class="card"><h2>Driver payouts</h2>${payouts ? `<div class="table-scroll"><table><thead><tr><th>Driver</th><th>IBAN</th><th>Jobs due</th><th>Amount due</th><th>Paid out</th><th></th></tr></thead><tbody>${payouts}</tbody></table></div>` : '<div class="empty">Nothing to pay out.</div>'}</div>`;
    },

    settings() {
      const co = db.company;
      const f = (k, l) => `<label>${l}<input name="${k}" value="${esc(co[k])}"></label>`;
      const data = REMOTE
        ? `<div class="card"><h2>Backend</h2><p class="muted m0">Connected to Supabase. ${db.settings.demoPayments
            ? '<span class="badge warn">Demo payments ON</span> – customers can mark orders paid without paying. Turn off before going live: <code>update public.app_settings set allow_demo_payments = false;</code>'
            : '<span class="badge ok">Demo payments off</span>'}</p></div>`
        : `<div class="card"><h2>Data</h2><p class="muted">Local demo mode – data is stored in this browser only. Demo accounts use the password <b>demo1234</b>: customer demo@example.com, driver mikko@example.com.</p>
            <div class="row"><button class="btn" id="seedDemo">Load demo data</button><button class="btn danger" id="resetAll">Delete all orders, customers & drivers</button></div></div>`;
      return `<form class="card" id="companyForm"><h2>Company details</h2><p class="muted">Shown on invoices.</p>
        <div class="grid">${f('name', 'Company name')}${f('businessId', 'Business ID (Y-tunnus)')}${f('email', 'Email')}${f('phone', 'Phone')}${f('address', 'Address')}${f('iban', 'IBAN for invoice payments')}</div>
        <div class="row mt"><span class="spacer"></span><button class="btn primary">Save</button></div></form>
      ${passwordForm('adminPassword')}${data}`;
    }
  };

  function orderDetail(id) {
    const o = findOrder(id);
    openModal(`${orderSummary(o, { driverPhone: true, contacts: true })}
      <p class="muted">Customer: ${esc(o.customer.name)} · ${esc(o.customer.email)} · ${esc(o.customer.phone)}</p>
      <h3>Status</h3>${timeline(o)}${inspectionReport(o)}
      <div class="row mt">${o.payment ? `<button class="btn" data-invoice="${esc(o.id)}">Invoice</button>` : ''}<span class="spacer"></span><button class="btn primary" data-close>Close</button></div>`);
  }

  // ======================================================================
  // BACKENDS – identical interface; the UI only ever calls act(name, args)
  // ======================================================================
  const fail = msg => { throw new Error(msg); };
  function setStatus(o, status, extra) {
    o.status = status;
    o.history.push({ status, at: now(), ...(extra || {}) });
  }
  const meDriver = () => findDriver(db.session.driverId);

  // ---------- Local demo backend (mirrors the rules of the SQL functions) ----------
  const Local = {
    async signIn({ portal, email, password }) {
      email = email.trim().toLowerCase();
      if (portal === 'admin') {
        if (!db.admin || email !== db.admin.email || !await checkPassword(db.admin, password)) fail('Wrong email or password');
        db.session.admin = true; return;
      }
      const list = portal === 'driver' ? db.drivers : db.customers;
      const user = list.find(x => x.email === email);
      if (!await checkPassword(user, password)) fail('Wrong email or password');
      db.session[portal === 'driver' ? 'driverId' : 'customerId'] = user.id;
    },
    async signUp({ role, email, password, data }) {
      email = email.trim().toLowerCase();
      const list = role === 'driver' ? db.drivers : db.customers;
      if (list.some(x => x.email === email)) fail('An account with this email already exists');
      const base = { createdAt: now(), name: data.full_name, email, phone: data.phone, ...await credentials(password) };
      if (role === 'customer') {
        const c = { id: 'CUS-' + (++db.seq), ...base, company: data.company || '' };
        db.customers.push(c); db.session.customerId = c.id;
      } else {
        const d = { id: 'DRV-' + (++db.seq), ...base, status: 'pending', city: data.home_city, dob: data.date_of_birth,
          licenseNo: data.license_number, licenseClass: data.license_class, licenseExpiry: data.license_expiry,
          iban: data.iban.replace(/\s/g, '').toUpperCase(), licensePhoto: data.license_photo_path || '' };
        db.drivers.push(d); db.session.driverId = d.id;
      }
    },
    async adminSetup({ email, password }) {
      if (db.admin) fail('Admin already exists');
      db.admin = { email: email.trim().toLowerCase(), ...await credentials(password) };
      db.session.admin = true;
    },
    signOut({ portal }) {
      if (portal === 'customer') db.session.customerId = '';
      if (portal === 'driver') db.session.driverId = '';
      if (portal === 'admin') db.session.admin = false;
    },
    async changePassword({ portal, current, password }) {
      const user = portal === 'admin' ? db.admin : portal === 'driver' ? meDriver() : findCustomer(db.session.customerId);
      if (!await checkPassword(user, current)) fail('Current password is wrong');
      Object.assign(user, await credentials(password));
    },
    updateMyProfile({ name, phone, company }) {
      Object.assign(findCustomer(db.session.customerId), { name, phone, company });
    },
    updateDriverProfile({ phone, city, iban }) {
      Object.assign(meDriver(), { phone, city, iban: iban.replace(/\s/g, '').toUpperCase() });
    },
    createOrder(p) {
      const c = findCustomer(db.session.customerId);
      if (!c) fail('Please sign in first');
      if (p.pickup_date < todayISO()) fail('Pickup date must be today or later');
      const o = {
        id: 'ZS-' + (++db.seq), createdAt: now(), customerId: c.id,
        customer: { name: c.name, email: c.email, phone: c.phone, company: c.company },
        pickup: { city: p.pickup_city, address: p.pickup_address, date: p.pickup_date, time: p.pickup_time, contact: p.pickup_contact },
        dropoff: { city: p.dropoff_city, address: p.dropoff_address, contact: p.dropoff_contact },
        car: { model: p.car_model, plate: p.car_plate.toUpperCase(), gearbox: p.gearbox, fuel: p.fuel },
        notes: p.notes, price: priceFor(estimateKm(p.pickup_city, p.dropoff_city)), status: 'pending_payment',
        history: [], driverId: '', rejectedBy: [], claimedBy: [], inspection: {}, payment: null
      };
      setStatus(o, 'pending_payment');
      db.orders.push(o);
      return { id: o.id };
    },
    payOrder({ id, method, last4 }) {
      const o = findOrder(id);
      if (!o || o.customerId !== db.session.customerId) fail('Order not found');
      if (o.status !== 'pending_payment') fail('This order is already paid');
      o.payment = { method, paidAt: now(), ...(method === 'card' ? { last4 } : {}) };
      setStatus(o, 'open');
    },
    cancelOrder({ id }) {
      const o = findOrder(id);
      if (PORTAL === 'admin') { if (['delivered', 'cancelled'].includes(o.status)) fail('This order can no longer be cancelled'); }
      else if (o.customerId !== db.session.customerId || !['pending_payment', 'open'].includes(o.status)) fail('A driver is already on the way – please contact us to cancel');
      setStatus(o, 'cancelled', { by: PORTAL });
    },
    acceptJob({ id }) {
      const d = meDriver(), o = findOrder(id);
      if (!d || d.status !== 'approved') fail('Driver is not approved or available');
      if (!o || o.status !== 'open') fail('Job is no longer available');
      o.claimedBy = o.claimedBy || [];
      if (o.claimedBy.includes(d.id)) fail('You have already claimed this job once');
      o.claimedBy.push(d.id); o.driverId = d.id; setStatus(o, 'assigned');
    },
    rejectJob({ id }) { const o = findOrder(id); if (!o.rejectedBy.includes(meDriver().id)) o.rejectedBy.push(meDriver().id); },
    releaseJob({ id }) {
      const d = meDriver(), o = findOrder(id);
      if (o.driverId !== d.id) fail('Not your job');
      if (o.status !== 'assigned') fail('The car is already picked up – contact support');
      o.rejectedBy.push(d.id); o.driverId = ''; setStatus(o, 'open');
    },
    startDriving({ id }) {
      const o = findOrder(id);
      if (o.driverId !== meDriver().id) fail('Not your job');
      if (o.status !== 'picked_up') fail('Record the pickup inspection first');
      setStatus(o, 'in_transit');
    },
    recordInspection({ id, stage, data }) {
      const d = meDriver(), o = findOrder(id);
      if (!o || o.driverId !== d.id) fail('Not your job');
      if (stage === 'pickup' && o.status !== 'assigned') fail('Pickup is already recorded');
      if (stage === 'delivery' && !['picked_up', 'in_transit'].includes(o.status)) fail('Record the pickup first');
      if (stage === 'delivery' && o.inspection.pickup && data.odometer_km < o.inspection.pickup.odo) fail('Odometer is lower than at pickup');
      o.inspection[stage] = { at: now(), odo: data.odometer_km, fuel: data.fuel_level, keys: data.keys_count ?? null,
        docs: !!data.documents_present, areas: data.areas, notes: data.notes, photos: data.photo_paths, person: data.person_name };
      setStatus(o, stage === 'pickup' ? 'picked_up' : 'delivered');
    },
    setDriverStatus({ id, status }) {
      const d = findDriver(id);
      if (status === 'approved') {
        if (!d.licenseExpiry || new Date(d.licenseExpiry) < new Date()) fail('Driving licence is missing or expired');
        if (!d.dob || yearsSince(d.dob) < 20) fail('Driver must be at least 20 years old');
      }
      d.status = status;
    },
    assignDriver({ id, driverId }) {
      const o = findOrder(id);
      if (o.status !== 'open') fail('Order is no longer waiting for a driver');
      o.claimedBy = o.claimedBy || [];
      if (o.claimedBy.includes(driverId)) fail('This driver already had this job once – choose another driver');
      o.claimedBy.push(driverId); o.driverId = driverId; setStatus(o, 'assigned', { by: 'admin' });
    },
    markRefunded({ id }) {
      const o = findOrder(id);
      if (o.status !== 'cancelled' || !o.payment || o.refundedAt) fail('Nothing to refund on this order');
      o.refundedAt = now();
    },
    payDriver({ driverId }) {
      const due = payoutsDue().filter(o => o.driverId === driverId);
      if (!due.length) fail('Nothing to pay out for this driver');
      due.forEach(o => { o.driverPaidAt = now(); });
    },
    updateSettings(s) { Object.assign(db.settings, s); },
    updateCompany(c) { Object.assign(db.company, c); },
    async seedDemo() {
      const pw = await credentials('demo1234');
      if (db.customers.some(c => c.email === 'demo@example.com')) fail('Demo data already loaded');
      const c = { id: 'CUS-' + (++db.seq), createdAt: now(), name: 'Demo Customer', email: 'demo@example.com', phone: '+358 50 111 2222', company: 'Demo Oy', ...pw };
      const mk = (name, mail, city, status) => ({ id: 'DRV-' + (++db.seq), createdAt: now(), status, name, email: mail, phone: '+358 40 000 0000',
        city, dob: '1990-01-01', licenseNo: 'FI' + db.seq, licenseClass: 'B', licenseExpiry: '2032-12-31', iban: 'FI2112345600000785', licensePhoto: '', ...pw });
      const d1 = mk('Mikko Virtanen', 'mikko@example.com', 'Helsinki', 'approved');
      db.customers.push(c);
      db.drivers.push(d1, mk('Aino Korhonen', 'aino@example.com', 'Tampere', 'pending'));
      const okAreas = Object.fromEntries(AREAS.map(a => [a, 'OK']));
      [['Helsinki', 'Tampere', 'Toyota Corolla', 'open'], ['Turku', 'Helsinki', 'Volvo XC60', 'delivered'], ['Espoo', 'Oulu', 'Tesla Model 3', 'in_transit']]
        .forEach(([a, b, car, st]) => {
          const o = { id: 'ZS-' + (++db.seq), createdAt: now(), customerId: c.id,
            customer: { name: c.name, email: c.email, phone: c.phone, company: c.company },
            pickup: { city: a, address: 'Esimerkkikatu 1', date: todayISO(), time: '10:00', contact: '' },
            dropoff: { city: b, address: 'Testitie 5', contact: '' },
            car: { model: car, plate: 'DEM-' + (db.seq % 1000), gearbox: 'Automatic', fuel: 'Hybrid' }, notes: '', price: priceFor(estimateKm(a, b)),
            status: 'pending_payment', history: [{ status: 'pending_payment', at: now() }], driverId: '', rejectedBy: [], claimedBy: [], inspection: {},
            payment: { method: 'card', last4: '4242', paidAt: now() } };
          db.orders.push(o);
          const flow = ['open', 'assigned', 'picked_up', 'in_transit', 'delivered'];
          for (const s of flow.slice(0, flow.indexOf(st) + 1)) {
            if (s === 'assigned') { o.driverId = d1.id; o.claimedBy.push(d1.id); }
            if (s === 'picked_up') o.inspection.pickup = { at: now(), odo: 42000, fuel: 'Full', keys: 2, docs: true, notes: '', person: c.name, areas: { ...okAreas }, photos: [] };
            if (s === 'delivered') o.inspection.delivery = { at: now(), odo: 42000 + o.price.km, fuel: '1/2', notes: 'All good', person: 'Reception', areas: { ...okAreas }, photos: [] };
            setStatus(o, s);
          }
        });
    },
    resetAll() {
      Object.assign(db, { orders: [], customers: [], drivers: [], session: { customerId: '', driverId: '', admin: true } });
    }
  };

  // ---------- Supabase backend ----------
  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args || {});
    if (error) throw new Error(error.message || 'Server error');
    return data;
  }
  async function refresh() {
    const state = await rpc('get_app_state');
    db = Object.assign(fresh(), state);
  }
  const loginUrl = portal => new URL(url(portal, 'login'), location.href).href;

  const Remote = {
    async signIn({ portal, email, password }) {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) fail(/confirm/i.test(error.message) ? 'Please confirm your email first (check your inbox)' : 'Wrong email or password');
      await refresh();
      if (!CURRENT[portal]()) {
        await sb.auth.signOut();
        fail(`This is not a ${PORTAL_LABEL[portal].toLowerCase()} account`);
      }
    },
    async signUp({ role, email, password, data }) {
      const { data: res, error } = await sb.auth.signUp({
        email: email.trim(), password, options: { data: { ...data, role }, emailRedirectTo: loginUrl(role) }
      });
      if (error) fail(error.message);
      if (!res.session) return { confirm: true };
    },
    adminSetup() { fail('Admins are created in Supabase'); },
    async signOut() { await sb.auth.signOut(); },
    async changePassword({ current, password }) {
      const { data: { user } } = await sb.auth.getUser();
      const check = await sb.auth.signInWithPassword({ email: user.email, password: current });
      if (check.error) fail('Current password is wrong');
      const { error } = await sb.auth.updateUser({ password });
      if (error) fail(error.message);
    },
    updateMyProfile: p => rpc('update_my_profile', { p }),
    updateDriverProfile: p => rpc('update_driver_profile', { p }),
    createOrder: p => rpc('create_order', { p }),
    payOrder: ({ id, method, last4 }) => rpc('demo_pay_order', { p_order: uuidOf(id), p_method: method, p_last4: method === 'card' ? last4 : null }),
    cancelOrder: ({ id }) => rpc('cancel_order', { p_order: uuidOf(id) }),
    async acceptJob({ id }) {
      const r = await rpc('accept_transfer', { p_order_id: uuidOf(id) });
      if (!r || !r.success) fail((r && r.message) || 'Could not accept the job');
    },
    rejectJob: ({ id }) => rpc('reject_transfer', { p_order: uuidOf(id) }),
    releaseJob: ({ id }) => rpc('release_transfer', { p_order: uuidOf(id) }),
    startDriving: ({ id }) => rpc('start_transfer', { p_order: uuidOf(id) }),
    recordInspection: ({ id, stage, data }) => rpc('record_inspection', { p_order: uuidOf(id), p_stage: stage, p: data }),
    setDriverStatus: ({ id, status }) => rpc('admin_set_driver_status', { p_driver: id, p_status: status }),
    assignDriver: ({ id, driverId }) => rpc('admin_assign_driver', { p_order: uuidOf(id), p_driver: driverId }),
    markRefunded: ({ id }) => rpc('admin_mark_refunded', { p_order: uuidOf(id) }),
    payDriver: ({ driverId }) => rpc('create_driver_payout', { p_driver: driverId, p_mark_paid: true }),
    updateSettings: p => rpc('admin_update_settings', { p }),
    updateCompany: p => rpc('admin_update_company', { p }),
    seedDemo() { fail('Demo data is only available in local demo mode'); },
    resetAll() { fail('Not available with Supabase'); }
  };

  async function act(name, args) {
    const result = await (REMOTE ? Remote : Local)[name](args || {});
    if (REMOTE) await refresh(); else save();
    return result;
  }

  // ================= Form handlers =================
  const FORMS = {
    async customerSignIn(f, d) {
      await act('signIn', { portal: 'customer', email: d.email, password: d.password });
      go('customer', nextPage('customer'));
    },
    async customerRegister(f, d) {
      const r = await act('signUp', { role: 'customer', email: d.email, password: d.password,
        data: { full_name: d.name.trim(), phone: d.phone.trim(), company: d.company.trim() } });
      if (r && r.confirm) { f.reset(); return confirmEmailNotice(d.email); }
      go('customer', 'create-order', null, 'Account created – welcome!');
    },
    async customerProfile(f, d) {
      await act('updateMyProfile', { name: d.name.trim(), phone: d.phone.trim(), company: d.company.trim() });
      toast('Saved'); render();
    },
    async orderForm(f, d) {
      const r = await act('createOrder', {
        pickup_city: d.fromCity, pickup_address: d.fromAddr.trim(), pickup_date: d.date, pickup_time: d.time, pickup_contact: d.fromContact.trim(),
        dropoff_city: d.toCity, dropoff_address: d.toAddr.trim(), dropoff_contact: d.toContact.trim(),
        car_model: d.car.trim(), car_plate: d.plate.trim().toUpperCase(), gearbox: d.gearbox, fuel: d.fuel, notes: d.notes.trim()
      });
      f.reset(); refreshQuote();
      paymentModal(r.id);
    },
    async payForm(f, d) {
      let last4 = null;
      if (d.method === 'card') {
        const num = (d.card || '').replace(/\D/g, '');
        const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(d.exp || '');
        if (!luhn(num)) return toast('Invalid card number');
        if (!m || +m[1] < 1 || +m[1] > 12 || new Date(2000 + +m[2], +m[1]) < new Date()) return toast('Invalid expiry date');
        if (!/^\d{3,4}$/.test(d.cvc || '')) return toast('Invalid CVC');
        last4 = num.slice(-4);
      }
      await act('payOrder', { id: d.id, method: d.method, last4 });
      const o = findOrder(d.id);
      render();
      openModal(`
        <h2>✅ Booking confirmed</h2>
        <p>Thank you, ${esc(o.customer.name)}. Your transfer <b>${esc(o.id)}</b> is booked and paid.</p>
        <p class="muted">Pickup ${esc(o.pickup.date)} at ${esc(o.pickup.time)} from ${esc(o.pickup.address)}, ${esc(o.pickup.city)}.
        We'll notify you when a driver is assigned.</p>
        <div class="row"><button class="btn" data-invoice="${esc(o.id)}">View invoice</button><span class="spacer"></span>
          <a class="btn primary" href="${url('customer', 'tracking', { id: o.id })}">Track order</a></div>`);
    },
    async driverSignIn(f, d) {
      await act('signIn', { portal: 'driver', email: d.email, password: d.password });
      go('driver', nextPage('driver'));
    },
    async driverRegister(f, d) {
      if (yearsSince(d.dob) < 20) return toast('Drivers must be at least 20 years old');
      if (new Date(d.licenseExpiry) < new Date()) return toast('Driving licence has expired');
      if (!validIban(d.iban)) return toast('Invalid IBAN');
      const r = await act('signUp', { role: 'driver', email: d.email, password: d.password, data: {
        full_name: d.name.trim(), phone: d.phone.trim(), home_city: d.city, date_of_birth: d.dob,
        license_number: d.licenseNo.trim(), license_class: d.licenseClass, license_expiry: d.licenseExpiry,
        iban: d.iban, license_photo_path: f.licensePhoto.files[0] ? f.licensePhoto.files[0].name : '' } });
      if (r && r.confirm) { f.reset(); return confirmEmailNotice(d.email); }
      go('driver', 'profile', null, 'Registration submitted – awaiting verification');
    },
    async driverProfile(f, d) {
      if (!validIban(d.iban)) return toast('Invalid IBAN');
      await act('updateDriverProfile', { phone: d.phone.trim(), city: d.city, iban: d.iban });
      toast('Saved'); render();
    },
    async driverPassword(f, d) { await act('changePassword', { portal: 'driver', current: d.current, password: d.password }); toast('Password changed'); f.reset(); },
    async adminPassword(f, d) { await act('changePassword', { portal: 'admin', current: d.current, password: d.password }); toast('Password changed'); f.reset(); },
    async inspectionForm(f, d) {
      const stage = d.stage;
      await act('recordInspection', { id: d.id, stage, data: {
        odometer_km: +d.odo, fuel_level: d.fuel, notes: d.notes.trim(), person_name: d.person.trim(),
        areas: Object.fromEntries(AREAS.map((a, i) => [a, d['area' + i]])),
        photo_paths: [...f.photos.files].map(x => x.name),
        ...(stage === 'pickup' ? { keys_count: +d.keys, documents_present: !!d.docs } : {}) } });
      const o = findOrder(d.id);
      if (stage === 'pickup') go('driver', 'navigation', { order: o.id }, 'Pickup recorded – drive safely!');
      else go('driver', 'earnings', null, `Delivered – ${eur(driverPay(o))} added to your earnings`);
    },
    async adminSetup(f, d) {
      if (d.password !== d.password2) return toast('Passwords do not match');
      await act('adminSetup', { email: d.email, password: d.password });
      go('admin', 'dashboard', null, 'Admin account created');
    },
    async adminSignIn(f, d) {
      await act('signIn', { portal: 'admin', email: d.email, password: d.password });
      go('admin', nextPage('admin'));
    },
    async pricingForm(f, d) {
      await act('updateSettings', Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(k => [k, +d[k]])));
      toast('Pricing saved'); render();
    },
    async companyForm(f, d) {
      await act('updateCompany', Object.fromEntries(Object.keys(DEFAULT_COMPANY).map(k => [k, d[k].trim()])));
      toast('Company details saved');
    }
  };

  // ================= Shell, routing & events =================
  const PAGES = { public: PUBLIC, customer: CUSTOMER, driver: DRIVER, admin: ADMIN };
  const CURRENT = {
    public: () => true,
    customer: () => findCustomer(db.session.customerId),
    driver: () => findDriver(db.session.driverId),
    admin: () => db.session.admin && db.admin
  };
  function nextPage(portal) {
    const n = params.get('next');
    return NAV[portal].some(([p]) => p === n) ? n : DEFAULT_PAGE[portal];
  }

  function topbar(user) {
    const signedIn = PORTAL !== 'public' && user && PAGE !== 'login';
    const nav = signedIn ? NAV[PORTAL] : [];
    return `<a class="brand" href="${url('', '')}">ZEMO SIIRTO${PORTAL !== 'public' ? ` <span class="badge ok">${PORTAL_LABEL[PORTAL]}</span>` : ''}<small>Auton siirto – Suomessa, luotettavasti.</small></a>
      <span class="spacer"></span>
      ${PORTAL === 'public' ? `<span class="row nowrap"><a class="btn sm" href="${url('driver', 'login')}">Drive with us</a><a class="btn sm primary" href="${url('customer', 'login')}">Sign in</a></span>` : ''}
      ${signedIn ? `<span class="row nowrap"><span class="muted who">${esc(user.name || user.email)}</span><button class="btn sm" id="signOut">Sign out</button></span>` : ''}
      ${nav.length ? `<nav class="pagenav">${nav.map(([p, l]) => `<a href="${url(PORTAL, p)}" class="${p === PAGE ? 'active' : ''}">${esc(l)}</a>`).join('')}</nav>` : ''}`;
  }

  function render() {
    if (PORTAL !== 'public' && PAGE === 'home') return location.replace(url(PORTAL, DEFAULT_PAGE[PORTAL]));
    const user = CURRENT[PORTAL] ? CURRENT[PORTAL]() : null;
    if (PORTAL !== 'public' && PAGE !== 'login' && !user) return location.replace(url(PORTAL, 'login', { next: PAGE }));
    if (PORTAL !== 'public' && PAGE === 'login' && user) return location.replace(url(PORTAL, nextPage(PORTAL)));
    $('#topbar').innerHTML = topbar(user);
    const page = (PAGES[PORTAL] || {})[PAGE];
    $('#app').innerHTML = page ? page(user) : empty('Page not found.');
    refreshQuote(); updateQuickQuote();
  }

  // Display-only pages update when data changes elsewhere; pages with forms keep the user's input.
  const LIVE = ['dashboard', 'tracking', 'available-jobs', 'my-jobs', 'earnings', 'drivers', 'customers', 'orders', 'payments'];
  const canAutoRefresh = () => LIVE.includes(PAGE) && !modal.open && !(document.activeElement && document.activeElement.closest('form'));
  if (!REMOTE) {
    window.addEventListener('storage', e => {
      if (e.key !== KEY) return;
      db = load();
      if (canAutoRefresh()) render();
    });
  }

  // Run an async UI action: disable the button while it runs, show errors as a toast.
  async function run(button, fn) {
    if (button) button.disabled = true;
    try { await fn(); } catch (err) { toast(err.message || 'Something went wrong'); } finally { if (button) button.disabled = false; }
  }

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.closest('#orderForm') && ['fromCity', 'toCity'].includes(t.name)) refreshQuote();
    if (t.closest('#quickQuote')) updateQuickQuote();
    if (t.matches('select[data-goto]') && t.value) location.href = t.value;
    if (t.dataset.assign && t.value) {
      run(t, async () => {
        await act('assignDriver', { id: t.dataset.assign, driverId: t.value });
        toast(`${t.dataset.assign} assigned to ${(findDriver(t.value) || {}).name || 'driver'}`);
      }).then(render);
    }
  });

  document.addEventListener('submit', e => {
    const f = e.target, handler = FORMS[f.getAttribute('id')];
    if (!handler) return;
    e.preventDefault();
    run(f.querySelector('button[type=submit], button:not([type])'), () => handler(f, formData(f)));
  });

  document.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    const ds = t.dataset;
    if (ds.pay) return paymentModal(ds.pay);
    if (ds.invoice) return invoiceModal(ds.invoice);
    if (ds.detail) return orderDetail(ds.detail);
    const action = (name, args, msg, after) => run(t, async () => {
      await act(name, args);
      if (msg) toast(msg);
      after ? after() : render();
    });
    if (ds.cancel) {
      const o = findOrder(ds.cancel);
      if (!confirm(`Cancel order ${o.id}?${o.payment ? ' The payment will be refunded.' : ''}`)) return;
      return action('cancelOrder', { id: o.id }, 'Order cancelled');
    }
    if (ds.accept) return action('acceptJob', { id: ds.accept }, null, () => go('driver', 'my-jobs', null, 'Job accepted'));
    if (ds.reject) return action('rejectJob', { id: ds.reject }, 'Job hidden');
    if (ds.release) {
      if (!confirm('Release this job back to other drivers?')) return;
      return action('releaseJob', { id: ds.release }, 'Job released');
    }
    if (ds.startDrive) return action('startDriving', { id: ds.startDrive }, 'Status: in transit');
    if (ds.driverStatus) return action('setDriverStatus', { id: ds.id, status: ds.driverStatus }, 'Driver ' + DRIVER_STATUS[ds.driverStatus][0].toLowerCase());
    if (ds.refund) return action('markRefunded', { id: ds.refund }, 'Marked refunded');
    if (ds.payout) {
      const due = payoutsDue().filter(o => o.driverId === ds.payout);
      if (!confirm(`Mark ${eur(due.reduce((s, o) => s + driverPay(o), 0))} as paid to ${findDriver(ds.payout).name}?`)) return;
      return action('payDriver', { driverId: ds.payout }, 'Payout recorded');
    }
    if (t.id === 'signOut') return action('signOut', { portal: PORTAL }, null, () => go(PORTAL, 'login'));
    if (t.id === 'seedDemo') return action('seedDemo', {}, 'Demo data loaded');
    if (t.id === 'resetAll' && confirm('Delete all orders, customers and drivers? Settings and the admin account are kept.')) return action('resetAll', {}, 'Data deleted');
  });

  // ================= Start =================
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  async function start() {
    if (REMOTE) {
      $('#app').innerHTML = '<div class="card empty">Loading…</div>';
      try {
        if (!window.supabase) await loadScript(SUPABASE_JS);
        sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
        await refresh();
      } catch (err) {
        $('#app').innerHTML = empty('Could not connect to the server. Please try again later.', `<span class="muted">${esc(err.message)}</span>`);
        return;
      }
      setInterval(() => { if (canAutoRefresh()) refresh().then(render).catch(() => {}); }, 15000);
    }
    render();
    showFlash();
  }

  start();
})();

/* ZEMO SIIRTO – car transfer platform prototype.
 *
 * Site map (each page is its own folder with an index.html):
 *   /                      public landing page
 *   /customer/{login,dashboard,create-order,tracking}
 *   /driver/{login,available-jobs,my-jobs,inspection,navigation,earnings,profile}
 *   /admin/{login,dashboard,drivers,customers,orders,pricing,payments,settings}
 *
 * Every page loads this one script; <body data-portal data-page data-root> tells it what to render.
 * Data lives in the browser (localStorage), shared by all pages of the site.
 * DEMO ONLY: logins are client-side and payments are simulated. A real backend is needed before going live.
 */
(function () {
  'use strict';

  // ---------- Page context & URLs ----------
  const BODY = document.body;
  const PORTAL = BODY.dataset.portal || 'public';
  const PAGE = BODY.dataset.page || 'home';
  const ROOT = BODY.dataset.root || './';
  const params = new URLSearchParams(location.search);

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

  // ---------- Reference data ----------
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
    ['awaiting_driver', 'Paid – finding driver', 'info'],
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

  // ---------- Storage ----------
  const KEY = 'zemo-siirto-v2';
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
  let db = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* storage unavailable */ } }

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

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2800);
  }
  function flash(msg) { try { sessionStorage.setItem('zemo-flash', msg); } catch (e) { /* ignore */ } }
  function showFlash() {
    try { const m = sessionStorage.getItem('zemo-flash'); if (m) { sessionStorage.removeItem('zemo-flash'); toast(m); } } catch (e) { /* ignore */ }
  }
  function go(portal, page, query, msg) { if (msg) flash(msg); location.href = url(portal, page, query); }

  const modal = $('#modal');
  function openModal(html) { modal.innerHTML = html; modal.showModal(); }
  modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) modal.close(); });

  // ---------- Passwords (client-side demo only) ----------
  function newSalt() {
    const a = new Uint8Array(12);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.random() * 256; });
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
  async function checkPassword(user, password) { return !!user && await hash(password, user.salt) === user.passHash; }

  // ---------- Pricing (distance-based) ----------
  function haversine(a, b) {
    const R = 6371, rad = x => x * Math.PI / 180;
    const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function estimateKm(from, to) {
    if (!CITIES[from] || !CITIES[to]) return null;
    if (from === to) return db.settings.sameCityKm;
    return Math.round(haversine(CITIES[from], CITIES[to]) * db.settings.roadFactor);
  }
  function priceFor(km) {
    const s = db.settings;
    const net = Math.round(Math.max(s.minPrice, s.baseFee + s.perKm * km) * 100) / 100;
    const vat = Math.round(net * s.vatRate) / 100;
    return { km, net, vat, total: Math.round((net + vat) * 100) / 100, vatRate: s.vatRate };
  }
  const driverPay = o => Math.round(o.price.net * db.settings.driverShare) / 100;
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

  // ---------- Order helpers ----------
  function setStatus(o, status, extra) {
    o.status = status;
    o.history.push({ status, at: now(), ...(extra || {}) });
    save();
  }

  function timeline(o) {
    if (o.status === 'cancelled') return `<p>${badge('cancelled')} <span class="muted">${dt(o.history.at(-1).at)}</span></p>`;
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
        ${opts.hideDriver ? '' : `<div><div class="muted">Driver</div>${d ? esc(d.name) + (opts.driverPhone ? `<br><a href="tel:${esc(d.phone)}">${esc(d.phone)}</a>` : '') : '<span class="muted">Not yet assigned</span>'}</div>`}
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

  // ---------- Payment & invoices (shared) ----------
  function paymentModal(id) {
    const o = findOrder(id);
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

  function submitPayment(f, d) {
    const o = findOrder(d.id);
    if (!o || o.payment) return;
    const payment = { method: d.method, paidAt: now() };
    if (d.method === 'card') {
      const num = (d.card || '').replace(/\D/g, '');
      const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(d.exp || '');
      if (!luhn(num)) return toast('Invalid card number');
      if (!m || +m[1] < 1 || +m[1] > 12 || new Date(2000 + +m[2], +m[1]) < new Date()) return toast('Invalid expiry date');
      if (!/^\d{3,4}$/.test(d.cvc || '')) return toast('Invalid CVC');
      payment.last4 = num.slice(-4);
    }
    o.payment = payment;
    setStatus(o, 'awaiting_driver');
    render();
    openModal(`
      <h2>✅ Booking confirmed</h2>
      <p>Thank you, ${esc(o.customer.name)}. Your transfer <b>${esc(o.id)}</b> is booked and paid.</p>
      <p class="muted">Pickup ${esc(o.pickup.date)} at ${esc(o.pickup.time)} from ${esc(o.pickup.address)}, ${esc(o.pickup.city)}.
      A confirmation would be sent to ${esc(o.customer.email)}. We'll notify you when a driver is assigned.</p>
      <div class="row"><button class="btn" data-invoice="${esc(o.id)}">View invoice</button><span class="spacer"></span>
        <a class="btn primary" href="${url('customer', 'tracking', { id: o.id })}">Track order</a></div>`);
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
      <div class="card"><div class="row"><h2 class="m0">Hei, ${esc(c.name.split(' ')[0])}!</h2><span class="spacer"></span>
        <a class="btn primary" href="${url('customer', 'create-order')}">+ New transfer</a></div>
        <div class="grid mt">${stat('Active transfers', active.length)}${stat('Delivered', list.filter(o => o.status === 'delivered').length)}${stat('Total spent', eur(spent))}</div></div>
      <div class="card"><h2>My orders & invoices</h2>${!list.length ? '<div class="empty">No orders yet.</div>' : `
        <div class="table-scroll"><table><thead><tr><th>Order</th><th>Route</th><th>Date</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map(o => `<tr><td>${esc(o.id)}</td><td>${esc(o.pickup.city)} → ${esc(o.dropoff.city)}</td><td>${esc(o.pickup.date)}</td>
          <td>${eur(o.price.total)}</td><td>${badge(o.status)}</td>
          <td><div class="row"><a class="btn sm" href="${url('customer', 'tracking', { id: o.id })}">Track</a>
            ${o.payment ? `<button class="btn sm" data-invoice="${esc(o.id)}">Invoice</button>` : o.status !== 'cancelled' ? `<button class="btn sm primary" data-pay="${esc(o.id)}">Pay</button>` : ''}
            ${['pending_payment', 'awaiting_driver'].includes(o.status) ? `<button class="btn sm danger" data-cancel="${esc(o.id)}">Cancel</button>` : ''}
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
      const today = new Date().toISOString().slice(0, 10);
      return `
      <form class="card" id="orderForm">
        <h2>Create a car transfer request</h2>
        <p class="muted">Booking as ${esc(c.name)} · ${esc(c.email)} · ${esc(c.phone)}</p>
        <h3>Pickup</h3>
        <div class="grid">
          <label>City<select name="fromCity" required>${cityOptions('Helsinki')}</select></label>
          <label>Address<input name="fromAddr" required placeholder="Street, postcode"></label>
          <label>Date<input name="date" type="date" min="${today}" value="${today}" required></label>
          <label>Time<input name="time" type="time" value="09:00" required></label>
          <label>Contact at pickup (optional)<input name="fromContact" placeholder="Name, phone"></label>
        </div>
        <h3>Delivery</h3>
        <div class="grid">
          <label>City<select name="toCity" required>${cityOptions('Tampere')}</select></label>
          <label>Address<input name="toAddr" required placeholder="Street, postcode"></label>
          <label>Contact at delivery (optional)<input name="toContact" placeholder="Name, phone"></label>
        </div>
        <h3>Vehicle</h3>
        <div class="grid">
          <label>Make & model<input name="car" required placeholder="e.g. Volvo V60"></label>
          <label>Registration plate<input name="plate" required placeholder="ABC-123" class="upper"></label>
          <label>Gearbox<select name="gearbox"><option>Automatic</option><option>Manual</option></select></label>
          <label>Fuel / power<select name="fuel"><option>Petrol</option><option>Diesel</option><option>Hybrid</option><option>Electric</option></select></label>
        </div>
        <label>Notes for the driver<textarea name="notes" placeholder="Key handover, parking, special instructions…"></textarea></label>
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

  async function customerSignIn(f, d) {
    const c = db.customers.find(x => x.email === d.email.trim().toLowerCase());
    if (!await checkPassword(c, d.password)) return toast('Wrong email or password');
    db.session.customerId = c.id; save();
    go('customer', nextPage('customer'));
  }
  async function customerRegister(f, d) {
    const email = d.email.trim().toLowerCase();
    if (db.customers.some(x => x.email === email)) return toast('An account with this email already exists');
    const c = { id: 'CUS-' + (++db.seq), createdAt: now(), name: d.name.trim(), email, phone: d.phone.trim(),
      company: d.company.trim(), ...await credentials(d.password) };
    db.customers.push(c); db.session.customerId = c.id; save();
    go('customer', 'create-order', null, 'Account created – welcome!');
  }
  function customerProfile(f, d) {
    const c = findCustomer(db.session.customerId);
    Object.assign(c, { name: d.name.trim(), phone: d.phone.trim(), company: d.company.trim() });
    save(); toast('Saved'); render();
  }
  function refreshQuote() {
    const f = $('#orderForm'); if (!f) return;
    const km = estimateKm(f.fromCity.value, f.toCity.value);
    $('#quoteBox').innerHTML = quoteHtml(km == null ? null : priceFor(km));
  }
  function submitOrder(f, d) {
    const c = findCustomer(db.session.customerId);
    const o = {
      id: 'ZS-' + (++db.seq), createdAt: now(), customerId: c.id,
      customer: { name: c.name, email: c.email, phone: c.phone, company: c.company },
      pickup: { city: d.fromCity, address: d.fromAddr.trim(), date: d.date, time: d.time, contact: d.fromContact.trim() },
      dropoff: { city: d.toCity, address: d.toAddr.trim(), contact: d.toContact.trim() },
      car: { model: d.car.trim(), plate: d.plate.trim().toUpperCase(), gearbox: d.gearbox, fuel: d.fuel },
      notes: d.notes.trim(), price: priceFor(estimateKm(d.fromCity, d.toCity)), status: 'pending_payment',
      history: [], driverId: '', rejectedBy: [], inspection: {}, payment: null
    };
    o.history.push({ status: 'pending_payment', at: o.createdAt });
    db.orders.push(o); save();
    f.reset(); refreshQuote();
    paymentModal(o.id);
  }

  // ================= DRIVER PORTAL =================
  const DRIVER_STATUS = { pending: ['Pending verification', 'warn'], verified: ['Verified', 'ok'], rejected: ['Rejected', 'bad'], suspended: ['Suspended', 'bad'] };
  const driverBadge = d => `<span class="badge ${DRIVER_STATUS[d.status][1]}">${DRIVER_STATUS[d.status][0]}</span>`;
  function gate(d) {
    if (d.status === 'verified') return '';
    const msg = { pending: 'Your documents are being reviewed by ZEMO SIIRTO. You can take jobs once you are verified.',
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
      const jobs = db.orders.filter(o => o.status === 'awaiting_driver' && !o.rejectedBy.includes(d.id))
        .map(o => ({ o, away: estimateKm(d.city, o.pickup.city) })).sort((a, b) => a.away - b.away);
      return `<div class="card"><h2>Available transfer jobs</h2><p class="muted m0">Paid orders waiting for a driver, nearest to ${esc(d.city)} first.</p></div>` +
        (jobs.length ? jobs.map(({ o, away }) => jobCard(o, `<button class="btn danger" data-reject="${esc(o.id)}">Reject</button>
          <span class="spacer"></span><button class="btn primary" data-accept="${esc(o.id)}">Accept job</button>`,
          `<p class="muted m0">Pickup is ~${away} km from ${esc(d.city)}</p>`)).join('')
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
        <label>Damage description / notes<textarea name="notes"></textarea></label>
        <label>Photos (all four sides + dashboard)<input name="photos" type="file" accept="image/*" capture="environment" multiple></label>
        <div class="grid">
          <label>${stage === 'pickup' ? 'Car handed over by' : 'Car received by'}<input name="person" required placeholder="Full name"></label>
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
          ${done.reverse().map(o => `<tr><td>${esc(o.id)}</td><td>${esc(o.pickup.city)} → ${esc(o.dropoff.city)}</td><td>${dt(o.history.at(-1).at)}</td><td>${eur(driverPay(o))}</td>
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

  const passwordForm = id => `<form class="card" id="${id}"><h2>Change password</h2><div class="grid">
      <label>Current password<input name="current" type="password" required autocomplete="current-password"></label>
      <label>New password (min. 8)<input name="password" type="password" minlength="8" required autocomplete="new-password"></label></div>
      <div class="row mt"><span class="spacer"></span><button class="btn">Change password</button></div></form>`;

  const validIban = s => /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(s.replace(/\s/g, '').toUpperCase());

  async function driverSignIn(f, d) {
    const drv = db.drivers.find(x => x.email === d.email.trim().toLowerCase());
    if (!await checkPassword(drv, d.password)) return toast('Wrong email or password');
    db.session.driverId = drv.id; save();
    go('driver', nextPage('driver'));
  }
  async function driverRegister(f, d) {
    const email = d.email.trim().toLowerCase();
    if ((Date.now() - new Date(d.dob)) / 31557600000 < 20) return toast('Drivers must be at least 20 years old');
    if (new Date(d.licenseExpiry) < new Date()) return toast('Driving licence has expired');
    if (!validIban(d.iban)) return toast('Invalid IBAN');
    if (db.drivers.some(x => x.email === email)) return toast('Email already registered');
    const drv = {
      id: 'DRV-' + (++db.seq), createdAt: now(), status: 'pending',
      name: d.name.trim(), email, phone: d.phone.trim(), city: d.city, dob: d.dob,
      licenseNo: d.licenseNo.trim(), licenseClass: d.licenseClass, licenseExpiry: d.licenseExpiry,
      iban: d.iban.replace(/\s/g, '').toUpperCase(), licensePhoto: f.licensePhoto.files[0] ? f.licensePhoto.files[0].name : '',
      ...await credentials(d.password)
    };
    db.drivers.push(drv); db.session.driverId = drv.id; save();
    go('driver', 'profile', null, 'Registration submitted – awaiting verification');
  }
  function driverProfile(f, d) {
    if (!validIban(d.iban)) return toast('Invalid IBAN');
    Object.assign(findDriver(db.session.driverId), { phone: d.phone.trim(), city: d.city, iban: d.iban.replace(/\s/g, '').toUpperCase() });
    save(); toast('Saved'); render();
  }
  async function changePassword(user, d) {
    if (!await checkPassword(user, d.current)) return toast('Current password is wrong');
    Object.assign(user, await credentials(d.password)); save();
    toast('Password changed'); render();
  }
  function submitInspection(f, d) {
    const me = findDriver(db.session.driverId);
    const o = findOrder(d.id);
    if (!o || o.driverId !== me.id) return toast('Not your job');
    const stage = d.stage;
    if (stage === 'pickup' && o.status !== 'assigned') return toast('Pickup already recorded');
    if (stage === 'delivery' && !['picked_up', 'in_transit'].includes(o.status)) return toast('Job is not in transit');
    if (stage === 'delivery' && o.inspection.pickup && +d.odo < o.inspection.pickup.odo) return toast('Odometer is lower than at pickup');
    o.inspection[stage] = {
      at: now(), odo: +d.odo, fuel: d.fuel, notes: d.notes.trim(), person: d.person.trim(),
      areas: Object.fromEntries(AREAS.map((a, i) => [a, d['area' + i]])),
      photos: [...f.photos.files].map(x => x.name),
      ...(stage === 'pickup' ? { keys: +d.keys, docs: !!d.docs } : {})
    };
    if (stage === 'pickup') { setStatus(o, 'picked_up'); go('driver', 'navigation', { order: o.id }, 'Pickup recorded – drive safely!'); }
    else { setStatus(o, 'delivered'); go('driver', 'earnings', null, `Delivered – ${eur(driverPay(o))} added to your earnings`); }
  }

  // ================= ADMIN PORTAL =================
  function revenueStats() {
    const paid = db.orders.filter(o => o.payment && o.status !== 'cancelled');
    const revenue = paid.reduce((t, o) => t + o.price.net, 0);
    const payouts = paid.reduce((t, o) => t + driverPay(o), 0);
    return { revenue, payouts };
  }
  const refundsDue = () => db.orders.filter(o => o.status === 'cancelled' && o.payment && !o.refundedAt);
  const payoutsDue = () => db.orders.filter(o => o.status === 'delivered' && !o.driverPaidAt);

  function adminOrderRow(o, verified) {
    return `<tr><td>${esc(o.id)}<br><span class="muted">${esc(o.pickup.date)}</span></td>
      <td>${esc(o.customer.name)}<br><span class="muted">${esc(o.customer.phone)}</span></td>
      <td>${esc(o.pickup.city)} → ${esc(o.dropoff.city)}<br><span class="muted">${o.price.km} km</span></td>
      <td>${eur(o.price.total)}</td><td>${badge(o.status)}</td>
      <td>${o.status === 'awaiting_driver' && verified.length ? `<select data-assign="${esc(o.id)}" class="m0"><option value="">Assign…</option>
          ${verified.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select>` : esc((findDriver(o.driverId) || {}).name || '–')}</td>
      <td><div class="row"><button class="btn sm" data-detail="${esc(o.id)}">Details</button>
        ${!['delivered', 'cancelled'].includes(o.status) ? `<button class="btn sm danger" data-cancel="${esc(o.id)}">Cancel</button>` : ''}</div></td></tr>`;
  }
  function ordersTable(list) {
    const verified = db.drivers.filter(d => d.status === 'verified');
    return !list.length ? '<div class="empty">No orders.</div>' : `<div class="table-scroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Route</th><th>Total</th><th>Status</th><th>Driver</th><th></th></tr></thead>
      <tbody>${list.map(o => adminOrderRow(o, verified)).join('')}</tbody></table></div>`;
  }

  const ADMIN = {
    login() {
      if (!db.admin) return `<form class="card narrow" id="adminSetup"><h2>Create the admin account</h2>
        <p class="muted">No admin exists yet. The first account created here becomes the administrator.</p>
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        <label>Password (min. 8)<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
        <label>Repeat password<input name="password2" type="password" minlength="8" required autocomplete="new-password"></label>
        <div class="row mt"><span class="spacer"></span><button class="btn primary">Create admin</button></div></form>`;
      return `<form class="card narrow" id="adminSignIn"><h2>Admin sign in</h2>
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
        <div class="row mt"><span class="spacer"></span><button class="btn primary">Sign in</button></div></form>`;
    },

    dashboard() {
      const { revenue, payouts } = revenueStats();
      const count = s => db.orders.filter(o => o.status === s).length;
      const pendingDrivers = db.drivers.filter(d => d.status === 'pending').length;
      const todo = [
        [pendingDrivers, `driver(s) waiting for verification`, url('admin', 'drivers')],
        [count('awaiting_driver'), 'paid order(s) without a driver', url('admin', 'orders', { status: 'awaiting_driver' })],
        [refundsDue().length, 'refund(s) due', url('admin', 'payments')],
        [payoutsDue().length, 'delivered job(s) awaiting driver payout', url('admin', 'payments')]
      ].filter(t => t[0]);
      return `<div class="card"><h2>Dashboard</h2><div class="grid">
        ${stat('Revenue (excl. VAT)', eur(revenue))}${stat('Driver payouts', eur(payouts))}${stat('Gross margin', eur(revenue - payouts))}
        ${stat('Orders', db.orders.length)}${stat('Active transfers', db.orders.filter(o => ACTIVE.includes(o.status)).length)}
        ${stat('Customers', db.customers.length)}${stat('Verified drivers', db.drivers.filter(d => d.status === 'verified').length)}</div></div>
      <div class="card"><h2>Needs attention</h2>${todo.length ? `<ul class="todo">${todo.map(([n, l, h]) => `<li><a href="${h}"><b>${n}</b> ${l} →</a></li>`).join('')}</ul>` : '<p class="muted m0">All clear 🎉</p>'}</div>
      <div class="card"><div class="row"><h2 class="m0">Latest orders</h2><span class="spacer"></span><a class="btn sm" href="${url('admin', 'orders')}">All orders</a></div>
        <div class="mt">${ordersTable([...db.orders].reverse().slice(0, 5))}</div></div>`;
    },

    drivers() {
      return `<div class="card"><h2>Drivers</h2>${!db.drivers.length ? '<div class="empty">No drivers registered.</div>' : `
        <div class="table-scroll"><table><thead><tr><th>Driver</th><th>Licence</th><th>City</th><th>Jobs</th><th>Status</th><th></th></tr></thead><tbody>
        ${db.drivers.map(d => {
          const expired = new Date(d.licenseExpiry) < new Date();
          const jobs = db.orders.filter(o => o.driverId === d.id && o.status === 'delivered').length;
          const age = Math.floor((Date.now() - new Date(d.dob)) / 31557600000);
          return `<tr><td>${esc(d.name)}<br><span class="muted">${esc(d.email)} · ${esc(d.phone)} · ${age} y</span></td>
          <td>${esc(d.licenseNo)} (${esc(d.licenseClass)})<br><span class="muted">valid until ${esc(d.licenseExpiry)}${expired ? ' – EXPIRED' : ''}${d.licensePhoto ? ' · 📎 ' + esc(d.licensePhoto) : ''}</span></td>
          <td>${esc(d.city)}</td><td>${jobs}</td><td>${driverBadge(d)}</td>
          <td><div class="row">${d.status !== 'verified' ? `<button class="btn sm primary" data-driver-status="verified" data-id="${esc(d.id)}" ${expired ? 'disabled' : ''}>Approve</button>` : ''}
            ${d.status === 'pending' ? `<button class="btn sm danger" data-driver-status="rejected" data-id="${esc(d.id)}">Reject</button>` : ''}
            ${d.status === 'verified' ? `<button class="btn sm danger" data-driver-status="suspended" data-id="${esc(d.id)}">Suspend</button>` : ''}</div></td></tr>`;
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
      const f = (k, l, step = '0.01') => `<label>${l}<input name="${k}" type="number" step="${step}" min="0" value="${s[k]}" required></label>`;
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
      return `<form class="card" id="companyForm"><h2>Company details</h2><p class="muted">Shown on invoices.</p>
        <div class="grid">${f('name', 'Company name')}${f('businessId', 'Business ID (Y-tunnus)')}${f('email', 'Email')}${f('phone', 'Phone')}${f('address', 'Address')}${f('iban', 'IBAN for invoice payments')}</div>
        <div class="row mt"><span class="spacer"></span><button class="btn primary">Save</button></div></form>
      ${passwordForm('adminPassword')}
      <div class="card"><h2>Data</h2><p class="muted">Demo accounts use the password <b>demo1234</b>: customer demo@example.com, driver mikko@example.com.</p>
        <div class="row"><button class="btn" id="seedDemo">Load demo data</button><button class="btn danger" id="resetAll">Delete all orders, customers & drivers</button></div></div>`;
    }
  };

  async function adminSetup(f, d) {
    if (db.admin) return toast('Admin already exists');
    if (d.password !== d.password2) return toast('Passwords do not match');
    db.admin = { email: d.email.trim().toLowerCase(), ...await credentials(d.password) };
    db.session.admin = true; save();
    go('admin', 'dashboard', null, 'Admin account created');
  }
  async function adminSignIn(f, d) {
    if (d.email.trim().toLowerCase() !== db.admin.email || !await checkPassword(db.admin, d.password)) return toast('Wrong email or password');
    db.session.admin = true; save();
    go('admin', nextPage('admin'));
  }
  function orderDetail(id) {
    const o = findOrder(id);
    openModal(`${orderSummary(o, { driverPhone: true, contacts: true })}
      <p class="muted">Customer: ${esc(o.customer.name)} · ${esc(o.customer.email)} · ${esc(o.customer.phone)}</p>
      <h3>Status</h3>${timeline(o)}${inspectionReport(o)}
      <div class="row mt">${o.payment ? `<button class="btn" data-invoice="${esc(o.id)}">Invoice</button>` : ''}<span class="spacer"></span><button class="btn primary" data-close>Close</button></div>`);
  }

  async function seedDemo() {
    const pw = await credentials('demo1234');
    const email = 'demo@example.com';
    if (db.customers.some(c => c.email === email)) return toast('Demo data already loaded');
    const c = { id: 'CUS-' + (++db.seq), createdAt: now(), name: 'Demo Customer', email, phone: '+358 50 111 2222', company: 'Demo Oy', ...pw };
    const mk = (name, mail, city, status) => ({ id: 'DRV-' + (++db.seq), createdAt: now(), status, name, email: mail, phone: '+358 40 000 0000',
      city, dob: '1990-01-01', licenseNo: 'FI' + db.seq, licenseClass: 'B', licenseExpiry: '2032-12-31', iban: 'FI2112345600000785', licensePhoto: '', ...pw });
    const d1 = mk('Mikko Virtanen', 'mikko@example.com', 'Helsinki', 'verified');
    db.customers.push(c);
    db.drivers.push(d1, mk('Aino Korhonen', 'aino@example.com', 'Tampere', 'pending'));
    const okAreas = Object.fromEntries(AREAS.map(a => [a, 'OK']));
    [['Helsinki', 'Tampere', 'Toyota Corolla', 'awaiting_driver'], ['Turku', 'Helsinki', 'Volvo XC60', 'delivered'], ['Espoo', 'Oulu', 'Tesla Model 3', 'in_transit']]
      .forEach(([a, b, car, st]) => {
        const o = { id: 'ZS-' + (++db.seq), createdAt: now(), customerId: c.id,
          customer: { name: c.name, email: c.email, phone: c.phone, company: c.company },
          pickup: { city: a, address: 'Esimerkkikatu 1', date: new Date().toISOString().slice(0, 10), time: '10:00', contact: '' },
          dropoff: { city: b, address: 'Testitie 5', contact: '' },
          car: { model: car, plate: 'DEM-' + (db.seq % 1000), gearbox: 'Automatic', fuel: 'Hybrid' }, notes: '', price: priceFor(estimateKm(a, b)),
          status: 'pending_payment', history: [{ status: 'pending_payment', at: now() }], driverId: '', rejectedBy: [], inspection: {},
          payment: { method: 'card', last4: '4242', paidAt: now() } };
        db.orders.push(o);
        const flow = ['awaiting_driver', 'assigned', 'picked_up', 'in_transit', 'delivered'];
        for (const s of flow.slice(0, flow.indexOf(st) + 1)) {
          if (s === 'assigned') o.driverId = d1.id;
          if (s === 'picked_up') o.inspection.pickup = { at: now(), odo: 42000, fuel: 'Full', keys: 2, docs: true, notes: '', person: c.name, areas: { ...okAreas }, photos: [] };
          if (s === 'delivered') o.inspection.delivery = { at: now(), odo: 42000 + o.price.km, fuel: '1/2', notes: 'All good', person: 'Reception', areas: { ...okAreas }, photos: [] };
          setStatus(o, s);
        }
      });
    save(); toast('Demo data loaded'); render();
  }

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

  // Pages that only display data re-render when another tab changes it; pages with forms keep the user's input.
  const LIVE = ['dashboard', 'tracking', 'available-jobs', 'my-jobs', 'earnings', 'drivers', 'customers', 'orders', 'payments'];
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    db = load();
    if (LIVE.includes(PAGE) && !modal.open) render();
  });

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.closest('#orderForm') && ['fromCity', 'toCity'].includes(t.name)) refreshQuote();
    if (t.closest('#quickQuote')) updateQuickQuote();
    if (t.matches('select[data-goto]') && t.value) location.href = t.value;
    if (t.dataset.assign && t.value) {
      const o = findOrder(t.dataset.assign);
      if (o.status !== 'awaiting_driver') return toast('Order is no longer waiting for a driver');
      o.driverId = t.value; setStatus(o, 'assigned', { by: 'admin' });
      toast(`${o.id} assigned to ${findDriver(t.value).name}`); render();
    }
  });

  const FORMS = {
    customerSignIn, customerRegister, customerProfile, orderForm: submitOrder, payForm: submitPayment,
    driverSignIn, driverRegister, driverProfile, inspectionForm: submitInspection,
    driverPassword: (f, d) => changePassword(findDriver(db.session.driverId), d),
    adminSetup, adminSignIn,
    adminPassword: (f, d) => changePassword(db.admin, d),
    pricingForm(f, d) { for (const k of Object.keys(DEFAULT_SETTINGS)) db.settings[k] = +d[k]; save(); toast('Pricing saved'); render(); },
    companyForm(f, d) { for (const k of Object.keys(DEFAULT_COMPANY)) db.company[k] = d[k].trim(); save(); toast('Company details saved'); }
  };
  document.addEventListener('submit', e => {
    const f = e.target, handler = FORMS[f.getAttribute('id')];
    if (!handler) return;
    e.preventDefault();
    Promise.resolve(handler(f, formData(f))).catch(err => toast('Error: ' + err.message));
  });

  document.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    const ds = t.dataset;
    const driver = findDriver(db.session.driverId);
    if (ds.pay) return paymentModal(ds.pay);
    if (ds.invoice) return invoiceModal(ds.invoice);
    if (ds.detail) return orderDetail(ds.detail);
    if (ds.cancel) {
      const o = findOrder(ds.cancel);
      const allowed = PORTAL === 'admin' ? !['delivered', 'cancelled'].includes(o.status)
        : o.customerId === db.session.customerId && ['pending_payment', 'awaiting_driver'].includes(o.status);
      if (!allowed) return toast('This order can no longer be cancelled');
      if (!confirm(`Cancel order ${o.id}?${o.payment ? ' The payment will be refunded.' : ''}`)) return;
      setStatus(o, 'cancelled', { by: PORTAL }); toast('Order cancelled'); return render();
    }
    if (ds.accept) {
      const o = findOrder(ds.accept);
      if (!driver || driver.status !== 'verified') return toast('Only verified drivers can accept jobs');
      if (o.status !== 'awaiting_driver') { toast('Job no longer available'); return render(); }
      o.driverId = driver.id; setStatus(o, 'assigned', { by: driver.id });
      return go('driver', 'my-jobs', null, 'Job accepted');
    }
    if (ds.reject) { findOrder(ds.reject).rejectedBy.push(driver.id); save(); toast('Job hidden'); return render(); }
    if (ds.release) {
      const o = findOrder(ds.release);
      if (o.driverId !== driver.id || o.status !== 'assigned') return;
      if (!confirm('Release this job back to other drivers?')) return;
      o.rejectedBy.push(driver.id); o.driverId = ''; setStatus(o, 'awaiting_driver', { released: driver.id });
      toast('Job released'); return render();
    }
    if (ds.startDrive) {
      const o = findOrder(ds.startDrive);
      if (o.driverId !== driver.id || o.status !== 'picked_up') return;
      setStatus(o, 'in_transit'); toast('Status: in transit'); return render();
    }
    if (ds.driverStatus) { findDriver(ds.id).status = ds.driverStatus; save(); toast('Driver ' + DRIVER_STATUS[ds.driverStatus][0].toLowerCase()); return render(); }
    if (ds.refund) { findOrder(ds.refund).refundedAt = now(); save(); toast('Marked refunded'); return render(); }
    if (ds.payout) {
      const due = payoutsDue().filter(o => o.driverId === ds.payout);
      if (!confirm(`Mark ${eur(due.reduce((s, o) => s + driverPay(o), 0))} as paid to ${findDriver(ds.payout).name}?`)) return;
      due.forEach(o => { o.driverPaidAt = now(); }); save(); toast('Payout recorded'); return render();
    }
    if (t.id === 'signOut') {
      if (PORTAL === 'customer') db.session.customerId = '';
      if (PORTAL === 'driver') db.session.driverId = '';
      if (PORTAL === 'admin') db.session.admin = false;
      save(); return go(PORTAL, 'login');
    }
    if (t.id === 'seedDemo') return seedDemo();
    if (t.id === 'resetAll' && confirm('Delete all orders, customers and drivers? Settings and the admin account are kept.')) {
      Object.assign(db, { orders: [], customers: [], drivers: [], session: { customerId: '', driverId: '', admin: true } });
      save(); toast('Data deleted'); return render();
    }
  });

  render();
  showFlash();
})();

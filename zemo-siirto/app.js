/* ZEMO SIIRTO – car transfer platform prototype.
 * Three linked systems in one page: Customer, Driver and Admin.
 * All data lives in the browser (localStorage) so the prototype runs with no backend.
 * Payments are SIMULATED – no card data leaves the browser and only the last 4 digits are stored. */
(function () {
  'use strict';

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
  STATUS_LABEL.cancelled = 'Cancelled';
  const STATUS_TONE = Object.fromEntries(STATUSES.map(s => [s[0], s[2]]));
  STATUS_TONE.cancelled = 'bad';

  const DEFAULT_SETTINGS = {
    baseFee: 49, perKm: 0.95, minPrice: 79, vatRate: 25.5,
    driverShare: 65, roadFactor: 1.15, sameCityKm: 15
  };

  // ---------- Storage ----------
  const KEY = 'zemo-siirto-v1';
  function fresh() {
    return { settings: { ...DEFAULT_SETTINGS }, orders: [], drivers: [], seq: 1000,
      session: { role: 'customer', customerEmail: '', driverId: '' } };
  }
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch (e) { db = fresh(); }
  db.settings = { ...DEFAULT_SETTINGS, ...db.settings };
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* private mode */ } }

  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = n => new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR' }).format(n || 0);
  const dt = iso => iso ? new Date(iso).toLocaleString('fi-FI', { dateStyle: 'short', timeStyle: 'short' }) : '–';
  const now = () => new Date().toISOString();
  const badge = s => `<span class="badge ${STATUS_TONE[s] || ''}">${esc(STATUS_LABEL[s] || s)}</span>`;
  const formData = form => Object.fromEntries(new FormData(form).entries());
  let ui = { customerTab: 'new', driverTab: 'jobs', adminTab: 'overview', quote: null, trackId: '' };

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  }
  const modal = $('#modal');
  function openModal(html) { modal.innerHTML = html; modal.showModal(); }
  modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) modal.close(); });

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
    const net = Math.max(s.minPrice, s.baseFee + s.perKm * km);
    const netR = Math.round(net * 100) / 100;
    const vat = Math.round(netR * s.vatRate) / 100;
    return { km, net: netR, vat, total: Math.round((netR + vat) * 100) / 100, vatRate: s.vatRate };
  }
  const driverPay = o => Math.round(o.price.net * db.settings.driverShare) / 100;

  // ---------- Order lifecycle ----------
  function setStatus(o, status, extra) {
    o.status = status;
    o.history.push({ status, at: now(), ...(extra || {}) });
    save();
  }
  const findOrder = id => db.orders.find(o => o.id === id);
  const findDriver = id => db.drivers.find(d => d.id === id);

  // ================= CUSTOMER PLATFORM =================
  function customerView() {
    const tabs = [['new', 'New transfer'], ['track', 'Track order'], ['history', 'My orders & invoices']];
    let body = '';
    if (ui.customerTab === 'new') body = newOrderForm();
    if (ui.customerTab === 'track') body = trackView();
    if (ui.customerTab === 'history') body = historyView();
    return tabBar(tabs, 'customerTab') + body;
  }

  function cityOptions(selected) {
    return Object.keys(CITIES).sort((a, b) => a.localeCompare(b, 'fi'))
      .map(c => `<option ${c === selected ? 'selected' : ''}>${c}</option>`).join('');
  }

  function newOrderForm() {
    const today = new Date().toISOString().slice(0, 10);
    const q = ui.quote;
    return `
    <form class="card" id="orderForm">
      <h2>1. Create a car transfer request</h2>
      <h3>Your details</h3>
      <div class="grid">
        <label>Full name<input name="name" required autocomplete="name"></label>
        <label>Email<input name="email" type="email" required autocomplete="email" value="${esc(db.session.customerEmail)}"></label>
        <label>Phone<input name="phone" type="tel" required autocomplete="tel" placeholder="+358 40 123 4567"></label>
      </div>
      <h3>Route</h3>
      <div class="grid">
        <label>Pickup city<select name="fromCity" required>${cityOptions('Helsinki')}</select></label>
        <label>Pickup address<input name="fromAddr" required placeholder="Street, postcode"></label>
        <label>Delivery city<select name="toCity" required>${cityOptions('Tampere')}</select></label>
        <label>Delivery address<input name="toAddr" required placeholder="Street, postcode"></label>
        <label>Pickup date<input name="date" type="date" min="${today}" value="${today}" required></label>
        <label>Pickup time<input name="time" type="time" value="09:00" required></label>
      </div>
      <h3>Vehicle</h3>
      <div class="grid">
        <label>Make & model<input name="car" required placeholder="e.g. Volvo V60"></label>
        <label>Registration plate<input name="plate" required placeholder="ABC-123" style="text-transform:uppercase"></label>
        <label>Gearbox<select name="gearbox"><option>Automatic</option><option>Manual</option></select></label>
        <label>Fuel / power<select name="fuel"><option>Petrol</option><option>Diesel</option><option>Hybrid</option><option>Electric</option></select></label>
      </div>
      <label style="margin-top:12px">Notes for the driver<textarea name="notes" placeholder="Key handover, parking, contact person…"></textarea></label>

      <h3>2. Automatic price (by distance)</h3>
      <div class="price-box" id="quoteBox">${quoteHtml(q)}</div>
      <div class="row" style="margin-top:14px">
        <span class="spacer"></span>
        <button class="btn primary" type="submit">Continue to payment</button>
      </div>
    </form>`;
  }

  function quoteHtml(q) {
    if (!q) return '<span class="muted">Choose cities to see the price.</span>';
    return `<div class="row"><div>
        <div class="muted">Estimated road distance: <b>${q.km} km</b></div>
        <div class="muted">Price excl. VAT ${eur(q.net)} + VAT ${q.vatRate}% ${eur(q.vat)}</div>
      </div><span class="spacer"></span><div class="total">${eur(q.total)}</div></div>`;
  }

  function refreshQuote() {
    const f = $('#orderForm'); if (!f) return;
    const km = estimateKm(f.fromCity.value, f.toCity.value);
    ui.quote = km == null ? null : priceFor(km);
    $('#quoteBox').innerHTML = quoteHtml(ui.quote);
  }

  function submitOrder(f) {
    const d = formData(f);
    const km = estimateKm(d.fromCity, d.toCity);
    const o = {
      id: 'ZS-' + (++db.seq), createdAt: now(),
      customer: { name: d.name.trim(), email: d.email.trim().toLowerCase(), phone: d.phone.trim() },
      pickup: { city: d.fromCity, address: d.fromAddr.trim(), date: d.date, time: d.time },
      dropoff: { city: d.toCity, address: d.toAddr.trim() },
      car: { model: d.car.trim(), plate: d.plate.trim().toUpperCase(), gearbox: d.gearbox, fuel: d.fuel },
      notes: d.notes.trim(), price: priceFor(km), status: 'pending_payment', history: [],
      driverId: '', rejectedBy: [], handover: {}, payment: null
    };
    o.history.push({ status: 'pending_payment', at: o.createdAt });
    db.orders.push(o);
    db.session.customerEmail = o.customer.email;
    save();
    paymentModal(o.id);
  }

  // ---------- Payment & booking confirmation ----------
  function paymentModal(id) {
    const o = findOrder(id);
    openModal(`
      <h2>3. Payment – ${esc(o.id)}</h2>
      <p class="muted">${esc(o.pickup.city)} → ${esc(o.dropoff.city)} · ${o.price.km} km · ${esc(o.car.model)} (${esc(o.car.plate)})</p>
      <div class="price-box"><div class="row"><span>Total incl. VAT</span><span class="spacer"></span><span class="total">${eur(o.price.total)}</span></div></div>
      <form id="payForm" style="margin-top:14px">
        <div class="grid">
          <label>Payment method<select name="method" id="payMethod">
            <option value="card">Card</option><option value="mobilepay">MobilePay</option><option value="invoice">Company invoice (14 days)</option></select></label>
        </div>
        <div id="cardFields" class="grid" style="margin-top:12px">
          <label>Card number<input name="card" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242"></label>
          <label>Expiry (MM/YY)<input name="exp" autocomplete="cc-exp" placeholder="12/28"></label>
          <label>CVC<input name="cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="123"></label>
        </div>
        <p class="notice">Demo mode: payment is simulated. Connect a real provider (e.g. Stripe, Paytrail) before going live.</p>
        <div class="row"><button type="button" class="btn" data-close>Pay later</button><span class="spacer"></span>
          <button class="btn primary" type="submit">Pay ${eur(o.price.total)}</button></div>
        <input type="hidden" name="id" value="${esc(o.id)}">
      </form>`);
    $('#payMethod').addEventListener('change', e => {
      $('#cardFields').style.display = e.target.value === 'card' ? '' : 'none';
    });
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

  function submitPayment(f) {
    const d = formData(f);
    const o = findOrder(d.id);
    let payment = { method: d.method, paidAt: now() };
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
    modal.close();
    confirmationModal(o);
    ui.quote = null; ui.trackId = o.id;
    render();
  }

  function confirmationModal(o) {
    openModal(`
      <h2>✅ Booking confirmed</h2>
      <p>Thank you, ${esc(o.customer.name)}. Your transfer <b>${esc(o.id)}</b> is booked and paid.</p>
      <p class="muted">Pickup ${esc(o.pickup.date)} at ${esc(o.pickup.time)} from ${esc(o.pickup.address)}, ${esc(o.pickup.city)}.
      A confirmation would be sent to ${esc(o.customer.email)}. We'll notify you when a driver is assigned.</p>
      <div class="row"><button class="btn" data-invoice="${esc(o.id)}">View invoice</button><span class="spacer"></span>
        <button class="btn primary" data-close>Done</button></div>`);
  }

  // ---------- Tracking ----------
  function timeline(o) {
    if (o.status === 'cancelled') return `<p>${badge('cancelled')}</p>`;
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
      <div class="row"><h2 style="margin:0">${esc(o.id)}</h2>${badge(o.status)}<span class="spacer"></span><b>${eur(o.price.total)}</b></div>
      <div class="grid" style="margin-top:10px">
        <div><div class="muted">Pickup</div>${esc(o.pickup.address)}, ${esc(o.pickup.city)}<br>${esc(o.pickup.date)} ${esc(o.pickup.time)}</div>
        <div><div class="muted">Delivery</div>${esc(o.dropoff.address)}, ${esc(o.dropoff.city)}</div>
        <div><div class="muted">Vehicle</div>${esc(o.car.model)} · ${esc(o.car.plate)}<br>${esc(o.car.gearbox)}, ${esc(o.car.fuel)}</div>
        <div><div class="muted">Driver</div>${d ? esc(d.name) + (opts.driverPhone ? '<br>' + esc(d.phone) : '') : '<span class="muted">Not yet assigned</span>'}</div>
      </div>`;
  }

  function trackView() {
    const o = ui.trackId && findOrder(ui.trackId.trim().toUpperCase());
    return `
      <form class="card" id="trackForm">
        <h2>4. Track your transfer</h2>
        <div class="row"><input name="id" placeholder="Order number, e.g. ZS-1001" value="${esc(ui.trackId)}" style="flex:1;margin:0">
          <button class="btn primary">Track</button></div>
      </form>
      ${o ? `<div class="card">${orderSummary(o, { driverPhone: true })}
        <h3>Status</h3>${timeline(o)}
        ${o.status === 'pending_payment' ? `<button class="btn primary" data-pay="${esc(o.id)}">Pay now</button>` : ''}
        ${o.handover.deliveryNotes || o.handover.receiver ? `<h3>Delivery report</h3><p>Received by ${esc(o.handover.receiver)} · odometer ${esc(o.handover.deliveryOdo)} km<br>${esc(o.handover.deliveryNotes)}</p>` : ''}
      </div>` : ui.trackId ? '<div class="card empty">Order not found.</div>' : ''}`;
  }

  // ---------- History & invoices ----------
  function historyView() {
    const email = db.session.customerEmail;
    const list = db.orders.filter(o => o.customer.email === email).reverse();
    return `
      <form class="card" id="historyLogin">
        <h2>5. My orders & invoices</h2>
        <div class="row"><input name="email" type="email" required placeholder="Your email" value="${esc(email)}" style="flex:1;margin:0">
          <button class="btn primary">Show</button></div>
      </form>
      <div class="card">${!email ? '<div class="empty">Enter your email to see your orders.</div>' : !list.length ? '<div class="empty">No orders yet.</div>' : `
        <div class="table-scroll"><table><thead><tr><th>Order</th><th>Route</th><th>Date</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map(o => `<tr><td>${esc(o.id)}</td><td>${esc(o.pickup.city)} → ${esc(o.dropoff.city)}</td><td>${esc(o.pickup.date)}</td>
          <td>${eur(o.price.total)}</td><td>${badge(o.status)}</td>
          <td class="row">
            <button class="btn sm" data-track="${esc(o.id)}">Track</button>
            ${o.payment ? `<button class="btn sm" data-invoice="${esc(o.id)}">Invoice</button>` : `<button class="btn sm primary" data-pay="${esc(o.id)}">Pay</button>`}
            ${['pending_payment', 'awaiting_driver'].includes(o.status) ? `<button class="btn sm danger" data-cancel="${esc(o.id)}">Cancel</button>` : ''}
          </td></tr>`).join('')}
        </tbody></table></div>`}</div>`;
  }

  function invoiceModal(id) {
    const o = findOrder(id);
    const methods = { card: 'Card', mobilepay: 'MobilePay', invoice: 'Invoice, 14 days net' };
    openModal(`
      <div class="invoice">
        <div class="row"><div><b style="font-size:20px">ZEMO SIIRTO</b><div class="muted">Auton siirto – Suomessa, luotettavasti.</div></div>
          <span class="spacer"></span><div style="text-align:right"><b>INVOICE / LASKU</b><div class="muted">No. ${esc(o.id.replace('ZS-', 'INV-'))}</div><div class="muted">${dt(o.payment?.paidAt || o.createdAt)}</div></div></div>
        <hr>
        <p><b>Bill to:</b> ${esc(o.customer.name)}<br><span class="muted">${esc(o.customer.email)} · ${esc(o.customer.phone)}</span></p>
        <table><thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead><tbody>
          <tr><td>Car transfer ${esc(o.pickup.city)} → ${esc(o.dropoff.city)} (${o.price.km} km)<br><span class="muted">${esc(o.car.model)}, ${esc(o.car.plate)} · ${esc(o.pickup.date)}</span></td><td style="text-align:right">${eur(o.price.net)}</td></tr>
          <tr><td>VAT ${o.price.vatRate}%</td><td style="text-align:right">${eur(o.price.vat)}</td></tr>
          <tr><td><b>Total</b></td><td style="text-align:right"><b>${eur(o.price.total)}</b></td></tr>
        </tbody></table>
        <p class="muted">Payment: ${esc(methods[o.payment?.method] || 'Unpaid')}${o.payment?.last4 ? ' •••• ' + esc(o.payment.last4) : ''}${o.status === 'cancelled' ? ' · ORDER CANCELLED – refund due' : ''}</p>
      </div>
      <div class="row" style="margin-top:12px"><button class="btn" onclick="window.print()">Print / Save PDF</button><span class="spacer"></span><button class="btn primary" data-close>Close</button></div>`);
  }

  // ================= DRIVER PLATFORM =================
  function driverView() {
    const me = findDriver(db.session.driverId);
    const verified = me && me.status === 'verified';
    const tabs = [['jobs', 'Available jobs'], ['mine', 'My jobs'], ['earnings', 'Earnings'], ['profile', me ? 'Profile' : 'Register / Sign in']];
    let body;
    if (!me || ui.driverTab === 'profile') body = driverProfile(me);
    else if (!verified) body = `<div class="card"><h2>Verification ${me.status === 'rejected' ? 'rejected' : 'pending'}</h2>
        <p class="muted">${me.status === 'rejected' ? 'Your application was not approved. Contact support.' : 'Your documents are being reviewed by ZEMO SIIRTO. You can take jobs once verified.'}</p>
        ${statusBadgeDriver(me)}</div>`;
    else if (ui.driverTab === 'jobs') body = availableJobs(me);
    else if (ui.driverTab === 'mine') body = myJobs(me);
    else body = earningsView(me);
    return tabBar(tabs, 'driverTab') + body;
  }

  function statusBadgeDriver(d) {
    const map = { pending: ['Pending verification', 'warn'], verified: ['Verified', 'ok'], rejected: ['Rejected', 'bad'] };
    const [l, t] = map[d.status];
    return `<span class="badge ${t}">${l}</span>`;
  }

  function driverProfile(me) {
    if (me) return `<div class="card"><div class="row"><h2 style="margin:0">${esc(me.name)}</h2>${statusBadgeDriver(me)}<span class="spacer"></span>
        <button class="btn sm" id="driverLogout">Sign out</button></div>
      <div class="grid" style="margin-top:12px">
        <div><div class="muted">Email</div>${esc(me.email)}</div><div><div class="muted">Phone</div>${esc(me.phone)}</div>
        <div><div class="muted">Home city</div>${esc(me.city)}</div>
        <div><div class="muted">Driving licence</div>${esc(me.licenseNo)} (class ${esc(me.licenseClass)}, valid until ${esc(me.licenseExpiry)})</div>
        <div><div class="muted">IBAN</div>${esc(me.iban.replace(/.(?=.{4})/g, '•'))}</div>
        <div><div class="muted">Registered</div>${dt(me.createdAt)}</div></div></div>`;
    const opts = db.drivers.map(d => `<option value="${esc(d.id)}">${esc(d.name)} – ${esc(d.email)}</option>`).join('');
    return `
      ${db.drivers.length ? `<form class="card" id="driverLogin"><h2>Sign in</h2>
        <div class="row"><select name="id" style="flex:1;margin:0">${opts}</select><button class="btn primary">Sign in</button></div></form>` : ''}
      <form class="card" id="driverRegister">
        <h2>1. Driver registration</h2>
        <div class="grid">
          <label>Full name<input name="name" required></label>
          <label>Email<input name="email" type="email" required></label>
          <label>Phone<input name="phone" type="tel" required></label>
          <label>Home city<select name="city">${cityOptions('Helsinki')}</select></label>
          <label>Date of birth<input name="dob" type="date" required></label>
          <label>Driving licence number<input name="licenseNo" required></label>
          <label>Licence class<select name="licenseClass"><option>B</option><option>BE</option><option>C1</option><option>C</option></select></label>
          <label>Licence valid until<input name="licenseExpiry" type="date" required></label>
          <label>IBAN (for payouts)<input name="iban" required placeholder="FI.."></label>
          <label>Licence photo<input name="licensePhoto" type="file" accept="image/*,application/pdf"></label>
        </div>
        <label style="margin-top:12px"><input type="checkbox" name="consent" required style="width:auto"> I confirm the details are correct and consent to a background / licence check.</label>
        <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn primary">Submit for verification</button></div>
      </form>`;
  }

  function submitDriver(f) {
    const d = formData(f);
    const age = (Date.now() - new Date(d.dob)) / 31557600000;
    if (age < 20) return toast('Drivers must be at least 20 years old');
    if (new Date(d.licenseExpiry) < new Date()) return toast('Driving licence has expired');
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(d.iban.replace(/\s/g, '').toUpperCase())) return toast('Invalid IBAN');
    if (db.drivers.some(x => x.email === d.email.trim().toLowerCase())) return toast('Email already registered');
    const drv = {
      id: 'DRV-' + (++db.seq), createdAt: now(), status: 'pending',
      name: d.name.trim(), email: d.email.trim().toLowerCase(), phone: d.phone.trim(), city: d.city, dob: d.dob,
      licenseNo: d.licenseNo.trim(), licenseClass: d.licenseClass, licenseExpiry: d.licenseExpiry,
      iban: d.iban.replace(/\s/g, '').toUpperCase(), licensePhoto: f.licensePhoto.files[0]?.name || ''
    };
    db.drivers.push(drv); db.session.driverId = drv.id; save();
    toast('Registration submitted – awaiting verification');
    ui.driverTab = 'jobs'; render();
  }

  function jobCard(o, actions) {
    return `<div class="card">${orderSummary(o)}
      <div class="row" style="margin-top:10px"><span class="muted">${o.price.km} km · driver pay</span><b>${eur(driverPay(o))}</b></div>
      ${o.notes ? `<p class="notice">${esc(o.notes)}</p>` : ''}
      <div class="row" style="margin-top:10px">${actions}</div></div>`;
  }

  function availableJobs(me) {
    const jobs = db.orders.filter(o => o.status === 'awaiting_driver' && !o.rejectedBy.includes(me.id));
    return `<div class="card"><h2>2. Available transfer jobs</h2><p class="muted">Paid orders waiting for a driver. Accept or reject.</p></div>` +
      (jobs.length ? jobs.map(o => jobCard(o, `<button class="btn danger" data-reject="${esc(o.id)}">Reject</button>
        <span class="spacer"></span><button class="btn primary" data-accept="${esc(o.id)}">Accept job</button>`)).join('')
        : '<div class="card empty">No open jobs right now.</div>');
  }

  function myJobs(me) {
    const jobs = db.orders.filter(o => o.driverId === me.id && o.status !== 'cancelled').reverse();
    if (!jobs.length) return '<div class="card empty">You have no jobs yet.</div>';
    return jobs.map(o => {
      let a = '';
      if (o.status === 'assigned') a = `<button class="btn" data-release="${esc(o.id)}">Release job</button><span class="spacer"></span><button class="btn primary" data-pickup="${esc(o.id)}">Record pickup</button>`;
      if (o.status === 'picked_up') a = `<span class="spacer"></span><button class="btn primary" data-transit="${esc(o.id)}">Start driving</button>`;
      if (o.status === 'in_transit') a = `<span class="spacer"></span><button class="btn primary" data-deliver="${esc(o.id)}">Record delivery</button>`;
      const h = o.handover;
      const report = h.pickupOdo ? `<h3>Handover</h3><p class="muted">Pickup: ${esc(h.pickupOdo)} km, fuel ${esc(h.pickupFuel)} · ${esc(h.pickupNotes || 'no damage noted')}<br>
        ${h.deliveryOdo ? `Delivery: ${esc(h.deliveryOdo)} km, received by ${esc(h.receiver)} · ${esc(h.deliveryNotes || 'OK')}` : ''}</p>` : '';
      return jobCard(o, a).replace(/<\/div>$/, report + '</div>');
    }).join('');
  }

  function pickupModal(id) {
    openModal(`<h2>Pickup checklist – ${esc(id)}</h2>
      <form id="pickupForm"><input type="hidden" name="id" value="${esc(id)}">
        <div class="grid"><label>Odometer (km)<input name="odo" type="number" min="0" required></label>
          <label>Fuel / charge level<select name="fuel"><option>Full</option><option>3/4</option><option>1/2</option><option>1/4</option><option>Reserve</option></select></label></div>
        <label style="margin-top:12px">Existing damage / notes<textarea name="notes"></textarea></label>
        <label style="margin-top:8px"><input type="checkbox" required style="width:auto"> Keys and documents received, photos taken</label>
        <div class="row" style="margin-top:12px"><button type="button" class="btn" data-close>Cancel</button><span class="spacer"></span><button class="btn primary">Confirm pickup</button></div>
      </form>`);
  }

  function deliverModal(id) {
    const o = findOrder(id);
    openModal(`<h2>Delivery – ${esc(id)}</h2>
      <form id="deliverForm"><input type="hidden" name="id" value="${esc(id)}">
        <div class="grid"><label>Odometer (km)<input name="odo" type="number" min="${esc(o.handover.pickupOdo || 0)}" required></label>
          <label>Received by<input name="receiver" required></label></div>
        <label style="margin-top:12px">Notes<textarea name="notes"></textarea></label>
        <div class="row" style="margin-top:12px"><button type="button" class="btn" data-close>Cancel</button><span class="spacer"></span><button class="btn primary">Confirm delivery</button></div>
      </form>`);
  }

  function earningsView(me) {
    const mine = db.orders.filter(o => o.driverId === me.id);
    const done = mine.filter(o => o.status === 'delivered');
    const active = mine.filter(o => ['assigned', 'picked_up', 'in_transit'].includes(o.status));
    const sum = arr => arr.reduce((t, o) => t + driverPay(o), 0);
    const km = done.reduce((t, o) => t + o.price.km, 0);
    return `<div class="card"><h2>3. Earnings</h2>
      <div class="grid">
        <div class="stat"><span class="muted">Earned</span><b>${eur(sum(done))}</b></div>
        <div class="stat"><span class="muted">Pending (active jobs)</span><b>${eur(sum(active))}</b></div>
        <div class="stat"><span class="muted">Completed jobs</span><b>${done.length}</b></div>
        <div class="stat"><span class="muted">Kilometres driven</span><b>${km}</b></div>
      </div>
      <p class="muted">Driver share: ${db.settings.driverShare}% of the price excl. VAT.</p>
      ${done.length ? `<div class="table-scroll"><table><thead><tr><th>Order</th><th>Route</th><th>Delivered</th><th>Pay</th></tr></thead><tbody>
        ${done.map(o => `<tr><td>${esc(o.id)}</td><td>${esc(o.pickup.city)} → ${esc(o.dropoff.city)}</td><td>${dt(o.history.at(-1).at)}</td><td>${eur(driverPay(o))}</td></tr>`).join('')}
      </tbody></table></div>` : ''}</div>`;
  }

  // ================= ADMIN PLATFORM =================
  function adminView() {
    const tabs = [['overview', 'Overview'], ['orders', 'Orders'], ['drivers', 'Drivers'], ['settings', 'Pricing']];
    let body = '';
    if (ui.adminTab === 'overview') body = adminOverview();
    if (ui.adminTab === 'orders') body = adminOrders();
    if (ui.adminTab === 'drivers') body = adminDrivers();
    if (ui.adminTab === 'settings') body = adminSettings();
    return tabBar(tabs, 'adminTab') + body;
  }

  function adminOverview() {
    const paid = db.orders.filter(o => o.payment && o.status !== 'cancelled');
    const revenue = paid.reduce((t, o) => t + o.price.net, 0);
    const payouts = paid.reduce((t, o) => t + driverPay(o), 0);
    const count = s => db.orders.filter(o => o.status === s).length;
    return `<div class="card"><h2>Overview</h2><div class="grid">
      <div class="stat"><span class="muted">Revenue (excl. VAT)</span><b>${eur(revenue)}</b></div>
      <div class="stat"><span class="muted">Driver payouts</span><b>${eur(payouts)}</b></div>
      <div class="stat"><span class="muted">Gross margin</span><b>${eur(revenue - payouts)}</b></div>
      <div class="stat"><span class="muted">Orders total</span><b>${db.orders.length}</b></div>
      <div class="stat"><span class="muted">Waiting for driver</span><b>${count('awaiting_driver')}</b></div>
      <div class="stat"><span class="muted">Drivers to verify</span><b>${db.drivers.filter(d => d.status === 'pending').length}</b></div>
    </div>
    <div class="row" style="margin-top:14px"><button class="btn" id="seedDemo">Load demo data</button><button class="btn danger" id="resetAll">Reset all data</button></div></div>`;
  }

  function adminOrders() {
    const verified = db.drivers.filter(d => d.status === 'verified');
    const list = [...db.orders].reverse();
    return `<div class="card"><h2>All orders</h2>${!list.length ? '<div class="empty">No orders.</div>' : `
      <div class="table-scroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Route</th><th>Total</th><th>Status</th><th>Driver</th><th></th></tr></thead><tbody>
      ${list.map(o => `<tr><td>${esc(o.id)}<br><span class="muted">${esc(o.pickup.date)}</span></td>
        <td>${esc(o.customer.name)}<br><span class="muted">${esc(o.customer.phone)}</span></td>
        <td>${esc(o.pickup.city)} → ${esc(o.dropoff.city)}<br><span class="muted">${o.price.km} km</span></td>
        <td>${eur(o.price.total)}</td><td>${badge(o.status)}</td>
        <td>${o.status === 'awaiting_driver' && verified.length ? `<select data-assign="${esc(o.id)}" style="margin:0"><option value="">Assign…</option>
            ${verified.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select>` : esc(findDriver(o.driverId)?.name || '–')}</td>
        <td class="row">${o.payment ? `<button class="btn sm" data-invoice="${esc(o.id)}">Invoice</button>` : ''}
          ${!['delivered', 'cancelled'].includes(o.status) ? `<button class="btn sm danger" data-cancel="${esc(o.id)}">Cancel</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>`}</div>`;
  }

  function adminDrivers() {
    return `<div class="card"><h2>Driver verification</h2>${!db.drivers.length ? '<div class="empty">No drivers registered.</div>' : `
      <div class="table-scroll"><table><thead><tr><th>Driver</th><th>Licence</th><th>City</th><th>Status</th><th></th></tr></thead><tbody>
      ${db.drivers.map(d => {
        const expired = new Date(d.licenseExpiry) < new Date();
        return `<tr><td>${esc(d.name)}<br><span class="muted">${esc(d.email)} · ${esc(d.phone)}</span></td>
        <td>${esc(d.licenseNo)} (${esc(d.licenseClass)})<br><span class="muted">valid until ${esc(d.licenseExpiry)}${expired ? ' – EXPIRED' : ''}${d.licensePhoto ? ' · 📎 ' + esc(d.licensePhoto) : ''}</span></td>
        <td>${esc(d.city)}</td><td>${statusBadgeDriver(d)}</td>
        <td class="row">${d.status !== 'verified' ? `<button class="btn sm primary" data-verify="${esc(d.id)}" ${expired ? 'disabled' : ''}>Approve</button>` : ''}
          ${d.status !== 'rejected' ? `<button class="btn sm danger" data-dreject="${esc(d.id)}">Reject</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>`}</div>`;
  }

  function adminSettings() {
    const s = db.settings;
    const f = (k, l, step = '0.01') => `<label>${l}<input name="${k}" type="number" step="${step}" min="0" value="${s[k]}" required></label>`;
    const ex = [50, 180, 400].map(km => `<tr><td>${km} km</td><td>${eur(priceFor(km).net)}</td><td>${eur(priceFor(km).total)}</td></tr>`).join('');
    return `<form class="card" id="settingsForm"><h2>Pricing rules</h2>
      <div class="grid">${f('baseFee', 'Base fee € (excl. VAT)')}${f('perKm', 'Price per km €')}${f('minPrice', 'Minimum price €')}
        ${f('vatRate', 'VAT %', '0.1')}${f('driverShare', 'Driver share %', '1')}${f('roadFactor', 'Road factor (straight line → road)')}${f('sameCityKm', 'Same-city distance km', '1')}</div>
      <h3>Examples</h3><table><thead><tr><th>Distance</th><th>Excl. VAT</th><th>Incl. VAT</th></tr></thead><tbody>${ex}</tbody></table>
      <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn primary">Save pricing</button></div></form>`;
  }

  function seedDemo() {
    const mk = (name, email, city) => ({ id: 'DRV-' + (++db.seq), createdAt: now(), status: 'verified', name, email, phone: '+358 40 000 0000',
      city, dob: '1990-01-01', licenseNo: 'FI' + db.seq, licenseClass: 'B', licenseExpiry: '2032-12-31', iban: 'FI2112345600000785', licensePhoto: '' });
    const d1 = mk('Mikko Virtanen', 'mikko@example.com', 'Helsinki');
    const d2 = { ...mk('Aino Korhonen', 'aino@example.com', 'Tampere'), status: 'pending' };
    db.drivers.push(d1, d2);
    const routes = [['Helsinki', 'Tampere', 'Toyota Corolla', 'awaiting_driver'], ['Turku', 'Helsinki', 'Volvo XC60', 'delivered'], ['Espoo', 'Oulu', 'Tesla Model 3', 'in_transit']];
    routes.forEach(([a, b, car, st]) => {
      const o = { id: 'ZS-' + (++db.seq), createdAt: now(), customer: { name: 'Demo Customer', email: 'demo@example.com', phone: '+358 50 111 2222' },
        pickup: { city: a, address: 'Esimerkkikatu 1', date: new Date().toISOString().slice(0, 10), time: '10:00' }, dropoff: { city: b, address: 'Testitie 5' },
        car: { model: car, plate: 'DEM-' + (db.seq % 1000), gearbox: 'Automatic', fuel: 'Hybrid' }, notes: '', price: priceFor(estimateKm(a, b)),
        status: 'pending_payment', history: [{ status: 'pending_payment', at: now() }], driverId: '', rejectedBy: [], handover: {},
        payment: { method: 'card', last4: '4242', paidAt: now() } };
      db.orders.push(o);
      const order = ['awaiting_driver', 'assigned', 'picked_up', 'in_transit', 'delivered'];
      for (const s of order.slice(0, order.indexOf(st) + 1)) {
        if (s === 'assigned') o.driverId = d1.id;
        if (s === 'picked_up') o.handover = { pickupOdo: 42000, pickupFuel: 'Full', pickupNotes: '' };
        if (s === 'delivered') Object.assign(o.handover, { deliveryOdo: 42000 + o.price.km, receiver: 'Reception', deliveryNotes: 'All good' });
        setStatus(o, s);
      }
    });
    db.session.customerEmail = 'demo@example.com';
    save(); toast('Demo data loaded'); render();
  }

  // ================= Shell & events =================
  function tabBar(tabs, key) {
    return `<div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${key}:${k}" class="${ui[key] === k ? 'active' : ''}">${esc(l)}</button>`).join('')}</div>`;
  }

  function render() {
    const role = db.session.role;
    document.querySelectorAll('nav.roles button').forEach(b => b.classList.toggle('active', b.dataset.role === role));
    $('#app').innerHTML = role === 'driver' ? driverView() : role === 'admin' ? adminView() : customerView();
    if (role === 'customer' && ui.customerTab === 'new') refreshQuote();
  }

  document.querySelector('nav.roles').addEventListener('click', e => {
    const b = e.target.closest('button[data-role]'); if (!b) return;
    db.session.role = b.dataset.role; save(); render();
  });

  document.addEventListener('change', e => {
    if (e.target.closest('#orderForm') && ['fromCity', 'toCity'].includes(e.target.name)) refreshQuote();
    const assign = e.target.dataset.assign;
    if (assign && e.target.value) {
      const o = findOrder(assign);
      o.driverId = e.target.value; setStatus(o, 'assigned', { by: 'admin' });
      toast(`${o.id} assigned`); render();
    }
  });

  document.addEventListener('submit', e => {
    const f = e.target; e.preventDefault();
    switch (f.getAttribute('id')) {
      case 'orderForm': return submitOrder(f);
      case 'payForm': return submitPayment(f);
      case 'trackForm': ui.trackId = formData(f).id.trim().toUpperCase(); return render();
      case 'historyLogin': db.session.customerEmail = formData(f).email.trim().toLowerCase(); save(); return render();
      case 'driverRegister': return submitDriver(f);
      case 'driverLogin': db.session.driverId = formData(f).id; ui.driverTab = 'jobs'; save(); return render();
      case 'pickupForm': {
        const d = formData(f), o = findOrder(d.id);
        o.handover = { pickupOdo: +d.odo, pickupFuel: d.fuel, pickupNotes: d.notes.trim() };
        setStatus(o, 'picked_up'); modal.close(); toast('Pickup recorded'); return render();
      }
      case 'deliverForm': {
        const d = formData(f), o = findOrder(d.id);
        Object.assign(o.handover, { deliveryOdo: +d.odo, receiver: d.receiver.trim(), deliveryNotes: d.notes.trim() });
        setStatus(o, 'delivered'); modal.close(); toast('Delivered – earnings updated'); return render();
      }
      case 'settingsForm': {
        const d = formData(f);
        for (const k of Object.keys(DEFAULT_SETTINGS)) db.settings[k] = +d[k];
        save(); toast('Pricing saved'); return render();
      }
    }
  });

  document.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    const ds = t.dataset;
    const me = db.session.driverId;
    if (ds.tab) { const [k, v] = ds.tab.split(':'); ui[k] = v; return render(); }
    if (ds.pay) return paymentModal(ds.pay);
    if (ds.invoice) return invoiceModal(ds.invoice);
    if (ds.track) { db.session.role = 'customer'; ui.customerTab = 'track'; ui.trackId = ds.track; return render(); }
    if (ds.cancel) {
      if (!confirm(`Cancel order ${ds.cancel}?`)) return;
      setStatus(findOrder(ds.cancel), 'cancelled'); toast('Order cancelled'); return render();
    }
    if (ds.accept) {
      const o = findOrder(ds.accept);
      if (o.status !== 'awaiting_driver') return toast('Job no longer available');
      o.driverId = me; setStatus(o, 'assigned', { by: me });
      ui.driverTab = 'mine'; toast('Job accepted'); return render();
    }
    if (ds.reject) { findOrder(ds.reject).rejectedBy.push(me); save(); toast('Job rejected'); return render(); }
    if (ds.release) {
      const o = findOrder(ds.release);
      o.rejectedBy.push(me); o.driverId = ''; setStatus(o, 'awaiting_driver', { released: me });
      toast('Job released'); return render();
    }
    if (ds.pickup) return pickupModal(ds.pickup);
    if (ds.transit) { setStatus(findOrder(ds.transit), 'in_transit'); toast('Status: in transit'); return render(); }
    if (ds.deliver) return deliverModal(ds.deliver);
    if (ds.verify) { findDriver(ds.verify).status = 'verified'; save(); toast('Driver approved'); return render(); }
    if (ds.dreject) { findDriver(ds.dreject).status = 'rejected'; save(); toast('Driver rejected'); return render(); }
    if (t.id === 'driverLogout') { db.session.driverId = ''; save(); return render(); }
    if (t.id === 'seedDemo') return seedDemo();
    if (t.id === 'resetAll' && confirm('Delete all orders, drivers and settings?')) { db = fresh(); db.session.role = 'admin'; save(); return render(); }
  });

  render();
})();

// LOCAL TESTING ONLY – a mock of Trustly's JSON-RPC API and payment page, so the payment flow can be
// tested end-to-end without a Trustly account. Never deploy.
//
//   node server.js <port> <merchant-public-key.pem> <trustly-private-key.pem> <username> <password>
//
// The app is configured with TRUSTLY_API_URL=http://localhost:<port>/api/1 and with this mock's public
// key as TRUSTLY_PUBLIC_KEY. Signatures use RSA-SHA1 over method + uuid + serialized data, with the
// serialization transcribed from the trustly-client npm package (MIT) – independent of the app's code.
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");

const [PORT, MERCHANT_PUB, TRUSTLY_PRIV, USERNAME, PASSWORD] = process.argv.slice(2);
const merchantPublicKey = fs.readFileSync(MERCHANT_PUB, "utf8");
const trustlyPrivateKey = fs.readFileSync(TRUSTLY_PRIV, "utf8");
const BASE = `http://localhost:${PORT}`;
const orders = new Map();   // orderid -> deposit
const log = [];             // what happened, for the test to inspect

function serialize(data) {
  const t = Object.prototype.toString.call(data);
  const isObj = t === "[object Object]", isArr = t === "[object Array]";
  if (isObj || isArr) {
    const keys = Object.keys(data); keys.sort(); let out = "";
    for (const k of keys) {
      if (data[k] === undefined) throw new Error("undefined value for " + k);
      if (data[k] === null) out = out + k; else out = out + (!isArr ? k : "") + serialize(data[k]);
    }
    return out;
  }
  return data.toString();
}
const sign = (method, uuid, data, key = trustlyPrivateKey) => crypto.createSign("RSA-SHA1").update(method + uuid + serialize(data), "utf8").sign(key, "base64");
const verify = (method, uuid, data, sig) => {
  try { return crypto.createVerify("RSA-SHA1").update(method + uuid + serialize(data), "utf8").verify(merchantPublicKey, sig, "base64"); } catch { return false; }
};
const result = (method, uuid, data) => ({ result: { signature: sign(method, uuid, data), method, uuid, data }, version: "1.1" });
const error = (method, uuid, message) => ({ error: { name: "JSONRPCError", code: 620, message, error: { signature: "", method, uuid, data: { code: 620, message } } }, version: "1.1" });

const readBody = req => new Promise(r => { let b = ""; req.on("data", c => { b += c; }); req.on("end", () => r(b)); });
const send = (res, code, body, type = "application/json") => { res.writeHead(code, { "content-type": type }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };

let notificationSeq = 1000;
async function notify(o, method, { forge = false, notificationid } = {}) {
  const uuid = crypto.randomUUID();
  const data = { notificationid: notificationid || String(++notificationSeq), messageid: o.messageid, orderid: o.orderid,
    enduserid: o.enduserid, amount: o.amount, currency: o.currency, timestamp: new Date().toISOString(), attributes: null };
  const signature = forge ? crypto.createSign("RSA-SHA1").update("x").sign(crypto.generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey, "base64") : sign(method, uuid, data);
  const res = await fetch(o.notificationUrl, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params: { signature, uuid, data }, version: "1.1" }) });
  const body = await res.json().catch(() => null);
  const r = body && body.result;
  const answerOk = !!r && r.uuid === uuid && r.method === method && r.data && r.data.status === "OK" && verify(method, uuid, r.data, r.signature);
  const entry = { method, orderid: o.orderid, notificationid: data.notificationid, httpStatus: res.status, answerOk, forged: forge };
  log.push(entry);
  return entry;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, BASE);
  try {
    if (req.method === "POST" && u.pathname === "/api/1") {
      const { method, params } = JSON.parse(await readBody(req));
      const { Data, UUID, Signature } = params;
      if (!verify(method, UUID, Data, Signature)) { log.push({ api: method, error: "bad merchant signature" }); return send(res, 200, error(method, UUID, "ERROR_INVALID_SIGNATURE")); }
      if (Data.Username !== USERNAME || Data.Password !== PASSWORD) return send(res, 200, error(method, UUID, "ERROR_INVALID_CREDENTIALS"));
      if (method === "Deposit") {
        const a = Data.Attributes || {};
        for (const f of ["NotificationURL", "EndUserID", "MessageID"]) if (!Data[f]) return send(res, 200, error(method, UUID, `ERROR_MISSING_${f}`));
        if (!a.Currency || !a.Amount) return send(res, 200, error(method, UUID, "ERROR_MISSING_AMOUNT"));
        if (Data.NotificationURL.includes("?")) return send(res, 200, error(method, UUID, "ERROR_INVALID_NOTIFICATIONURL"));
        const orderid = String(Math.floor(1e9 + Math.random() * 9e9));
        orders.set(orderid, { orderid, messageid: Data.MessageID, enduserid: Data.EndUserID, notificationUrl: Data.NotificationURL,
          amount: a.Amount, currency: a.Currency, successUrl: a.SuccessURL, failUrl: a.FailURL, firstname: a.Firstname, refunded: false });
        log.push({ api: "Deposit", orderid, amount: a.Amount, messageid: Data.MessageID });
        return send(res, 200, result(method, UUID, { orderid, url: `${BASE}/checkout/${orderid}` }));
      }
      if (method === "Refund") {
        const o = orders.get(String(Data.OrderID));
        if (!o || o.refunded || Data.Amount !== o.amount || Data.Currency !== o.currency) return send(res, 200, result(method, UUID, { orderid: String(Data.OrderID), result: "0" }));
        o.refunded = true;
        log.push({ api: "Refund", orderid: o.orderid, amount: Data.Amount });
        return send(res, 200, result(method, UUID, { orderid: o.orderid, result: "1" }));
      }
      return send(res, 200, error(method, UUID, "ERROR_UNKNOWN_METHOD"));
    }

    const m = u.pathname.match(/^\/checkout\/(\d+)(?:\/(approve|cancel))?$/);
    if (m && orders.has(m[1])) {
      const o = orders.get(m[1]);
      if (req.method === "GET" && !m[2]) {
        return send(res, 200, `<!doctype html><meta name=viewport content="width=device-width"><title>Mock Trustly</title>
          <h1>Mock Trustly – test bank</h1><p id="amount">Pay ${o.amount} ${o.currency} to Zemo Siirto</p>
          <form method="post" action="/checkout/${o.orderid}/approve"><button id="approve">Approve payment</button></form>
          <form method="post" action="/checkout/${o.orderid}/cancel"><button id="cancel">Cancel</button></form>`, "text/html");
      }
      if (req.method === "POST" && m[2] === "approve") {
        await notify(o, "pending");
        await notify(o, "credit");
        res.writeHead(303, { location: o.successUrl }); return res.end();
      }
      if (req.method === "POST" && m[2] === "cancel") {
        await notify(o, "cancel");
        res.writeHead(303, { location: o.failUrl }); return res.end();
      }
    }

    // ---- test helpers
    if (u.pathname === "/test/log") return send(res, 200, log);
    if (req.method === "POST" && u.pathname === "/test/forge") {
      const o = [...orders.values()].at(-1);
      return send(res, 200, await notify(o, "credit", { forge: true }));
    }
    if (req.method === "POST" && u.pathname === "/test/resend") {
      const o = [...orders.values()].find(x => log.some(l => l.method === "credit" && l.orderid === x.orderid));
      const first = log.find(l => l.method === "credit" && l.orderid === o.orderid && !l.forged);
      return send(res, 200, await notify(o, "credit", { notificationid: first.notificationid }));
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: String(e && e.message || e) });
  }
}).listen(+PORT, () => console.log(`mock trustly on ${BASE}`));

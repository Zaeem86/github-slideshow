// LOCAL TESTING ONLY – a small stand-in for a Supabase project, so the apps can be tested end-to-end
// against the real SQL migrations on a local Postgres, using the real supabase-js / @supabase/ssr
// libraries. Not secure; never deploy.
//
//   PGHOST=… PGPORT=… PGUSER=… PGDATABASE=… node server.js [port] [static-site-dir]
//
// Implements the parts of the Supabase HTTP API the apps use:
//   Auth (GoTrue)   POST /auth/v1/signup, POST /auth/v1/token?grant_type=password|refresh_token,
//                   GET|PUT /auth/v1/user, POST /auth/v1/logout   (users are auto-confirmed)
//   Data (PostgREST) POST /rest/v1/rpc/<fn> – runs public.<fn>(named args) as role anon/authenticated
//                   with request.jwt.claim.sub set, so RLS, grants and the role checks are the real ones.
//   Storage         POST /storage/v1/object/<bucket>/<path> (upload, x-upsert), POST /storage/v1/object/sign/<bucket>
//                   (signed URLs for many paths), GET /storage/v1/object/sign/<bucket>/<path>?token=… (download).
//                   Object rows go to storage.objects as the signed-in user, so the real storage RLS policies apply;
//                   the bytes are kept in a temporary folder.
// Optional: serves the legacy static site (zemo-siirto/) with a config.js pointing at this server.
// Service role: requests whose bearer token equals $FAKE_SERVICE_KEY run as role service_role.
// Test helper: POST /test/promote {email} makes a user admin.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const PORT = +(process.argv[2] || 8790);
const SITE = process.argv[3] ? path.resolve(process.argv[3]) : null;
const SECRET = crypto.randomBytes(32);
const pool = new Pool();
const FILES = fs.mkdtempSync(path.join(require("os").tmpdir(), "fake-storage-"));
const users = new Map();          // id -> { id, email, password, meta, created }
const refreshTokens = new Map();  // token -> user id

// ---- JWT (HS256)
const b64u = s => Buffer.from(s).toString("base64url");
function sign(payload) {
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), body = b64u(JSON.stringify(payload));
  return `${head}.${body}.${crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;
}
function verify(token) {
  const [h, p, sig] = String(token || "").split(".");
  if (!sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  return claims.exp > Date.now() / 1000 ? claims : null;
}
const bearer = req => (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

const userJson = u => ({
  id: u.id, aud: "authenticated", role: "authenticated", email: u.email, phone: "",
  email_confirmed_at: u.created, confirmed_at: u.created, last_sign_in_at: new Date().toISOString(),
  app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.meta || {}, identities: [],
  created_at: u.created, updated_at: u.created, is_anonymous: false
});
function session(u) {
  const now = Math.floor(Date.now() / 1000);
  const refresh_token = crypto.randomBytes(16).toString("hex");
  refreshTokens.set(refresh_token, u.id);
  return {
    access_token: sign({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600, session_id: crypto.randomUUID() }),
    token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token, user: userJson(u)
  };
}

// ---- HTTP helpers
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS" };
function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "content-type": type, ...CORS });
  res.end(body === undefined ? "" : typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const authError = (res, code, error_code, msg) => send(res, code, { code, error_code, msg, message: msg });
const readRaw = req => new Promise(resolve => { const c = []; req.on("data", d => c.push(d)); req.on("end", () => resolve(Buffer.concat(c))); });
const readBody = req => new Promise(resolve => {
  let b = ""; req.on("data", c => { b += c; }); req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
});

/** Run fn(client) in a transaction as the given user (RLS applies). */
async function asUser(uid, role, fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role || (uid ? "authenticated" : "anon")}`);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [uid || ""]);
    const r = await fn(client);
    await client.query("commit");
    return r;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
const fileOf = (bucket, name) => path.join(FILES, Buffer.from(`${bucket}/${name}`).toString("base64url"));
const signToken = (bucket, name, exp) => crypto.createHmac("sha256", SECRET).update(`${bucket}/${name}/${exp}`).digest("base64url") + "." + exp;

async function rpc(name, args, uid, role) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name) || Object.keys(args).some(k => !/^[a-z_][a-z0-9_]*$/.test(k))) throw Object.assign(new Error("bad request"), { code: "PGRST100" });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role || (uid ? "authenticated" : "anon")}`);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [uid || ""]);
    const keys = Object.keys(args);
    const sql = `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
    const vals = keys.map(k => (args[k] !== null && typeof args[k] === "object") ? JSON.stringify(args[k]) : args[k]);
    const { rows } = await client.query(sql, vals);
    await client.query("commit");
    return rows[0].r;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  try {
    if (req.method === "OPTIONS") return send(res, 204);

    // ---------------- Auth
    if (p === "/auth/v1/signup" && req.method === "POST") {
      const b = await readBody(req);
      const email = String(b.email || "").toLowerCase();
      if ([...users.values()].some(x => x.email === email)) return authError(res, 422, "user_already_exists", "User already registered");
      if (String(b.password || "").length < 6) return authError(res, 422, "weak_password", "Password should be at least 6 characters");
      const { rows } = await pool.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id, raw_user_meta_data", [email, b.data || {}]);
      const user = { id: rows[0].id, email, password: b.password, meta: rows[0].raw_user_meta_data, created: new Date().toISOString() };
      users.set(user.id, user);
      return send(res, 200, session(user));
    }
    if (p === "/auth/v1/token" && req.method === "POST") {
      const b = await readBody(req);
      if (u.searchParams.get("grant_type") === "refresh_token") {
        const id = refreshTokens.get(b.refresh_token);
        if (!id) return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
        refreshTokens.delete(b.refresh_token);
        return send(res, 200, session(users.get(id)));
      }
      const user = [...users.values()].find(x => x.email === String(b.email || "").toLowerCase());
      if (!user || user.password !== b.password) return authError(res, 400, "invalid_credentials", "Invalid login credentials");
      return send(res, 200, session(user));
    }
    if (p === "/auth/v1/user") {
      const claims = verify(bearer(req));
      const user = claims && users.get(claims.sub);
      if (!user) return authError(res, 401, "bad_jwt", "invalid JWT");
      if (req.method === "PUT") {
        const b = await readBody(req);
        if (b.password) user.password = b.password;
        if (b.data) user.meta = { ...user.meta, ...b.data };
      }
      return send(res, 200, userJson(user));
    }
    if (p === "/auth/v1/logout") return send(res, 204);
    if (p === "/auth/v1/.well-known/jwks.json") return send(res, 200, { keys: [] });

    // ---------------- Data
    if (p.startsWith("/rest/v1/rpc/") && req.method === "POST") {
      const token = bearer(req);
      const isService = !!process.env.FAKE_SERVICE_KEY && token === process.env.FAKE_SERVICE_KEY;
      const claims = isService ? null : verify(token);
      const args = await readBody(req);
      try {
        const data = await rpc(p.slice("/rest/v1/rpc/".length), args, claims ? claims.sub : null, isService ? "service_role" : null);
        return send(res, 200, JSON.stringify(data ?? null));
      } catch (e) {
        const status = e.code === "42501" ? 403 : 400;
        return send(res, status, { code: e.code || "P0001", message: e.message, details: null, hint: null });
      }
    }

    // ---------------- Storage
    if (p.startsWith("/storage/v1/object/")) {
      const token = bearer(req);
      const isService = !!process.env.FAKE_SERVICE_KEY && token === process.env.FAKE_SERVICE_KEY;
      const claims = isService ? null : verify(token);
      const uid = claims ? claims.sub : null, role = isService ? "service_role" : null;
      const rest = decodeURIComponent(p.slice("/storage/v1/object/".length));
      const storageError = (e, status = 400) => send(res, e.code === "42501" ? 403 : status, { statusCode: String(e.code === "42501" ? 403 : status), error: "Error", message: e.message });
      // download with a signed token (no login needed)
      if (rest.startsWith("sign/") && req.method === "GET") {
        const [bucket, ...nameParts] = rest.slice(5).split("/"), name = nameParts.join("/");
        const [, exp] = String(u.searchParams.get("token") || "").split(".");
        if (!exp || +exp < Date.now() / 1000 || u.searchParams.get("token") !== signToken(bucket, name, exp) || !fs.existsSync(fileOf(bucket, name)))
          return send(res, 400, { message: "invalid signature" });
        return send(res, 200, fs.readFileSync(fileOf(bucket, name)), "image/jpeg");
      }
      // signed URLs: the user must be allowed to see the row (storage RLS)
      if (rest.startsWith("sign/") && req.method === "POST") {
        const parts = rest.slice(5).split("/"), b = await readBody(req);
        const bucket = parts[0], single = parts.length > 1 ? parts.slice(1).join("/") : null;
        const names = single ? [single] : (b.paths || []);
        const exp = Math.floor(Date.now() / 1000) + Number(b.expiresIn || 60);
        try {
          const visible = await asUser(uid, role, c => c.query("select name from storage.objects where bucket_id = $1 and name = any($2)", [bucket, names]));
          const ok = new Set(visible.rows.map(r => r.name));
          const out = names.map(n => ok.has(n)
            ? { path: n, signedURL: `/object/sign/${bucket}/${n}?token=${signToken(bucket, n, exp)}`, error: null }
            : { path: n, signedURL: null, error: "Object not found" });
          if (single) return out[0].signedURL ? send(res, 200, { signedURL: out[0].signedURL }) : send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
          return send(res, 200, out);
        } catch (e) { return storageError(e); }
      }
      // upload
      if (req.method === "POST" || req.method === "PUT") {
        const [bucket, ...nameParts] = rest.split("/"), name = nameParts.join("/");
        const upsert = req.method === "PUT" || req.headers["x-upsert"] === "true";
        const body = await readRaw(req);
        try {
          await asUser(uid, role, c => c.query(
            `insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3)
             ${upsert ? "on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now()" : ""}`,
            [bucket, name, { size: body.length, mimetype: req.headers["content-type"] || "" }]));
        } catch (e) {
          if (e.code === "23505") return send(res, 409, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
          return storageError(e);
        }
        fs.writeFileSync(fileOf(bucket, name), body);
        return send(res, 200, { Key: `${bucket}/${name}`, Id: crypto.randomUUID() });
      }
    }

    // ---------------- Test helper
    if (p === "/test/promote" && req.method === "POST") {
      const b = await readBody(req);
      await pool.query("update public.profiles set role = 'admin' where email = $1", [String(b.email).toLowerCase()]);
      return send(res, 200, {});
    }

    // ---------------- Optional legacy static site
    if (SITE) {
      if (p === "/config.js") return send(res, 200, `window.ZEMO_CONFIG = { supabaseUrl: 'http://localhost:${PORT}', supabaseAnonKey: 'anon', supabaseJsUrl: '/__supabase.js' };`, "text/javascript");
      if (p === "/__supabase.js") return send(res, 200, fs.readFileSync(require.resolve("@supabase/supabase-js/dist/umd/supabase.js")), "text/javascript");
      let file = path.join(SITE, decodeURIComponent(p));
      if (!file.startsWith(SITE)) return send(res, 403, "forbidden", "text/plain");
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
      if (fs.existsSync(file)) {
        const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
        return send(res, 200, fs.readFileSync(file), types[path.extname(file)] || "application/octet-stream");
      }
    }
    send(res, 404, { message: "not found" });
  } catch (e) {
    send(res, 500, { message: e.message });
  }
}).listen(PORT, () => console.log(`fake supabase on http://localhost:${PORT}${SITE ? ` (serving ${SITE})` : ""}`));

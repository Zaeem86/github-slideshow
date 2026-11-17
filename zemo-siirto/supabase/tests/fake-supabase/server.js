// LOCAL TESTING ONLY – a tiny stand-in for Supabase so the website can be tested end-to-end
// against the real SQL migrations on a local Postgres. Not secure; never deploy.
//
//   node server.js <site-dir> <port>      (env: PGHOST, PGPORT, PGUSER, PGDATABASE; needs `npm i pg`)
//
// - Serves the site, with /config.js pointing the app at this server.
// - /auth/*: minimal email+password auth; sign-up inserts into auth.users (fires the profile trigger).
// - /rpc/<fn>: runs public.<fn>(named args) as role anon/authenticated with request.jwt.claim.sub set,
//   the way PostgREST does, so RLS, grants and role checks are the real ones.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const SITE = path.resolve(process.argv[2] || '.');
const PORT = +(process.argv[3] || 8790);
const pool = new Pool();
const passwords = new Map(); // email -> { id, password }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = req => new Promise(resolve => {
  let b = ''; req.on('data', c => { b += c; }); req.on('end', () => resolve(b ? JSON.parse(b) : {}));
});
const session = (id, email) => ({ access_token: id, user: { id, email } });

async function rpc(name, args, uid) {
  if (!/^[a-z_]+$/.test(name) || Object.keys(args).some(k => !/^[a-z_][a-z0-9_]*$/.test(k))) throw new Error('bad request');
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [uid || '']);
    const keys = Object.keys(args);
    const sql = `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
    const vals = keys.map(k => (args[k] !== null && typeof args[k] === 'object') ? JSON.stringify(args[k]) : args[k]);
    const { rows } = await client.query(sql, vals);
    await client.query('commit');
    return rows[0].r;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (u.pathname === '/config.js') {
      return send(res, 200, `window.ZEMO_CONFIG = { supabaseUrl: 'http://localhost:${PORT}', supabaseAnonKey: 'test', supabaseJsUrl: '/__fake-supabase.js' };`, 'text/javascript');
    }
    if (u.pathname === '/__fake-supabase.js') return send(res, 200, fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8'), 'text/javascript');
    if (req.method === 'POST') {
      const b = await readBody(req);
      if (u.pathname === '/auth/signup') {
        const email = String(b.email).toLowerCase();
        if (passwords.has(email)) return send(res, 200, { error: 'User already registered' });
        const { rows } = await pool.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [email, b.data || {}]);
        passwords.set(email, { id: rows[0].id, password: b.password });
        return send(res, 200, { user: { id: rows[0].id, email }, session: session(rows[0].id, email) });
      }
      if (u.pathname === '/auth/token') {
        const email = String(b.email).toLowerCase(), p = passwords.get(email);
        if (!p || p.password !== b.password) return send(res, 200, { error: 'Invalid login credentials' });
        return send(res, 200, { session: session(p.id, email) });
      }
      if (u.pathname === '/auth/update') {
        for (const v of passwords.values()) if (v.id === b.uid) v.password = b.password;
        return send(res, 200, {});
      }
      if (u.pathname === '/test/promote') {
        await pool.query("update public.profiles set role = 'admin' where email = $1", [b.email]);
        return send(res, 200, {});
      }
      if (u.pathname.startsWith('/rpc/')) {
        try { return send(res, 200, { data: await rpc(u.pathname.slice(5), b, req.headers['x-uid']) }); }
        catch (e) { return send(res, 400, { error: { message: e.message } }); }
      }
    }
    let file = path.join(SITE, decodeURIComponent(u.pathname));
    if (!file.startsWith(SITE)) return send(res, 403, 'forbidden', 'text/plain');
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`fake supabase + site on http://localhost:${PORT}`));

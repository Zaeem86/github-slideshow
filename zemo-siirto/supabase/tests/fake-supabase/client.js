// LOCAL TESTING ONLY – implements the few supabase-js calls the website uses, against server.js.
window.supabase = {
  createClient(url) {
    const KEY = 'fake-sb-session';
    const getS = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
    const setS = s => (s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY));
    const post = async (p, body, headers = {}) => {
      const r = await fetch(url + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
      return r.json();
    };
    return {
      auth: {
        async signUp({ email, password, options }) {
          const r = await post('/auth/signup', { email, password, data: (options || {}).data });
          if (r.error) return { data: {}, error: { message: r.error } };
          setS(r.session); return { data: { user: r.user, session: r.session }, error: null };
        },
        async signInWithPassword({ email, password }) {
          const r = await post('/auth/token', { email, password });
          if (r.error) return { data: {}, error: { message: r.error } };
          setS(r.session); return { data: { session: r.session }, error: null };
        },
        async signOut() { setS(null); return { error: null }; },
        async getUser() { const s = getS(); return { data: { user: s && s.user }, error: null }; },
        async updateUser({ password }) {
          const s = getS(); const r = await post('/auth/update', { uid: s.user.id, password });
          return { data: {}, error: r.error ? { message: r.error } : null };
        }
      },
      async rpc(name, args) {
        const s = getS();
        const r = await post('/rpc/' + name, args, { 'x-uid': s ? s.user.id : '' });
        return r.error ? { data: null, error: r.error } : { data: r.data, error: null };
      }
    };
  }
};

import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const api = 'https://publikhq.com/api/v1';
const cookie = '__Host-spellhound';
const digest = value => createHash('sha256').update(value).digest('hex');

export function publikRoutes({ origin, directory, token, upstream = fetch }) {
  const inFlight = new Map();
  const installAttempts = new Map();
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const call = (path, options) => upstream(api + path, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(45000),
  });
  async function install(res) {
    if (!token) return json(res, 503, { error: 'Spellhound needs its Publik app token before sign-in is available.' });
    const id = randomUUID();
    const r = await call('/installs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_slug: 'spellhound', app_token: token, install_id: id, app_version: '0.1.0',
        os: 'linux', device_name: 'Spellhound for Word', disclosure_version: 1, dialects: ['chat_completions'] }) });
    if (!r.ok) return json(res, 502, { error: 'Publik could not register this installation.' });
    const data = await r.json();
    if (typeof data.key !== 'string' || !data.key.startsWith('pk_')) return json(res, 502, { error: 'Invalid installation response.' });
    const sid = randomBytes(32).toString('hex');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, digest(sid)), data.key, { flag: 'wx', mode: 0o600 });
    res.setHeader('Set-Cookie', cookie + '=' + sid + '; Secure; HttpOnly; Path=/; SameSite=None; Partitioned; Max-Age=2592000');
    return json(res, 201, { registered: true });
  }
  return async function handle(req, res, path) {
    const id = (req.headers.cookie ?? '').split(/;\s*/).find(v => v.startsWith(cookie+'='))?.slice(cookie.length+1);
    const file = id && /^[a-f0-9]{64}$/.test(id) ? join(directory, digest(id)) : undefined;
    let key;
    if (file) {
      try { key = await readFile(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    if (req.method !== 'POST' || req.headers.origin !== origin) return json(res, 403, { error: 'Open Spellhound in Word.' });
    if (path === '/spellhound/session/start') {
      if (key) return json(res, 200, { registered: true });
      const ip = req.socket.remoteAddress;
      const now = Date.now();
      for (const [addr, window] of installAttempts) if (window.until <= now) installAttempts.delete(addr);
      const window = installAttempts.get(ip) ?? { count: 0, until: now + 60000 };
      if (window.count >= 10) return json(res, 429, { error: 'Try again in a minute.' });
      window.count++;
      installAttempts.set(ip, window);
      return install(res);
    }
    if (!key) return json(res, 401, { error: 'Sign in with Publik.' });
    if (path === '/spellhound/session/end') {
      await unlink(file).catch(e => { if (e.code !== 'ENOENT') throw e; });
      res.setHeader('Set-Cookie', cookie+'=; Secure; HttpOnly; Path=/; SameSite=None; Partitioned; Max-Age=0');
      return json(res, 200, { signedOut: true });
    }
    const headers = { Authorization: 'Bearer '+key };
    let pending = inFlight.get(key);
    if (!pending) {
      pending = call('/wallet', { headers }).then(async r => {
        if (!r.ok) throw Error('Publik wallet unavailable');
        return r.json();
      }).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    const wallet = await pending;
    const claimed = wallet.claim_state === 'claimed';
    if (path === '/spellhound/session/status') {
      let claimUrl = null;
      if (wallet.claim_url) {
        const url = new URL(wallet.claim_url);
        if (url.origin === 'https://publikhq.com' || url.origin === 'https://www.publikhq.com') claimUrl = url.href;
      }
      return json(res, 200, { claimed, claimUrl, handle: claimed ? wallet.account?.handle ?? null : null });
    }
    if (!claimed) return json(res, 403, { error: 'Finish signing in with Publik.' });
    if (path !== '/local/chat/completions') return json(res, 404, { error: 'Unknown route.' });
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4*1024*1024) return json(res, 413, { error: 'Document request is too large.' });
      chunks.push(chunk);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks)); } catch { return json(res, 400, { error: 'Invalid JSON.' }); }
    if (body?.model !== 'publik-balanced' || !Array.isArray(body.messages)) return json(res, 400, { error: 'Invalid chat request.' });
    const result = await call('/chat/completions', { method: 'POST', headers: { ...headers, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    if (!result.ok) return json(res, result.status, { error: result.status === 402 ? 'Add credit or choose your own AI key in Settings.' : 'Publik could not complete the request.' });
    res.writeHead(200, { 'Content-Type': result.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' });
    const { pipeline } = await import('node:stream/promises');
    await pipeline(result.body, res);
  };
}

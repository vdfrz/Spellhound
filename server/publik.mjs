import { randomUUID } from 'node:crypto';
import { researchRoute } from './research.mjs';
import { pipeline } from 'node:stream/promises';
import { cookieValue, sessionStore } from './sessions.mjs';

const APP_SLUG = "spellhound";
const version = '0.1.0';
const base = 'https://publikhq.com';
const prefix = '/spellhound/session/';
function publikLink(value) {
  try {
    const u = new URL(value);
    if (!u.username && !u.password && [base, 'https://www.publikhq.com'].includes(u.origin)) return u.href;
  } catch { /* Invalid or absent upstream link. */ }
  return null;
}
function clientOS(agent = '') {
  if (/Android|iPhone|iPad|Mobile/i.test(agent)) return null;
  if (/Windows/i.test(agent)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(agent)) return 'macos';
  if (/Linux/i.test(agent)) return 'linux';
  return null;
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  let bytes = 0; const chunks = [];
  for await (const chunk of req) {
    if ((bytes += chunk.length) > 4 * 1024 * 1024) throw new RangeError();
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks));
}
export function publikRoutes({ origin, directory, token, upstream = fetch, now = Date.now,
  store = sessionStore(directory, now), env = process.env }) {
  const lookup = researchRoute({ origin, upstream });
  const attempts = new Map();
  const call = (path, options, timeout = 45000) => upstream(base+path, { ...options, redirect:'error', signal:AbortSignal.timeout(timeout) });
  return async function handle(req, res, path) {
    if (req.method !== 'POST' || req.headers.origin !== origin) return json(res, 403, { error:'Open Spellhound in Word.' });
    const action = path.startsWith(prefix) ? path.slice(prefix.length) : path;
    const install = await store.read(req.headers.cookie);
    if (action === 'start' && !install) {
      if (!token?.startsWith('pat_')) return json(res, 503, { error:'The pilot needs a Spellhound app token.' });
      for (const [addr, w] of attempts) if (w.until <= now()) attempts.delete(addr);
      const addr = req.socket.remoteAddress;
      const w = attempts.get(addr) ?? { count:0, until:now()+60000 };
      if (w.count >= 10) return json(res, 429, { error:'Try again in a minute.' });
      w.count++; attempts.set(addr, w);
      const os = clientOS(req.headers['user-agent']);
      if (!os) return json(res, 400, {error:'Use Word on a Mac or Windows PC, or a supported desktop browser.'});
      const id = randomUUID();
      const r = await call('/api/v1/installs', { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ app_slug:APP_SLUG, app_token:token, install_id:id, app_version:version, os,
          device_name:'Spellhound for Word', disclosure_version:1, dialects:['chat_completions'] }) });
      if (!r.ok) return json(res, 502, { error:'Publik could not register this installation.' });
      const data = await r.json();
      if (typeof data.key !== 'string' || !data.key.startsWith('pk_')) return json(res, 502, { error:'Invalid installation response.' });
      const sid = await store.create({ id, key:data.key, claimUrl:publikLink(data.claim_url), os });
      res.setHeader('Set-Cookie', cookieValue(sid));
      return json(res, 201, { registered:true });
    }
    if (!install) return json(res, 401, { error:'Sign in with Publik.' });
    if (action === 'start') return json(res, 200, { registered:true });
    // Every consequential pane request is bound to the installation that opened it.
    // Another pane on the same browser can change the cookie by signing in again.
    if (action !== 'status' && req.headers['x-spellhound-install'] !== install.id)
      return json(res, 409, { error:'Reopen Spellhound to use the current session.' });
    async function end() { await store.discard(install.dir); res.setHeader('Set-Cookie', cookieValue()); }
    if (action === 'end') { await end(); return json(res, 200, { signedOut:true }); }
    const headers = { Authorization:'Bearer '+install.key };
    const walletResponse = await call('/api/v1/wallet', {headers});
    if (walletResponse.status === 401) { await end(); return json(res, 401, {error:'Sign in with Publik again.'}); }
    if (!walletResponse.ok) return json(res, 502, {error:'Publik is not reachable. Retry.'});
    const wallet = await walletResponse.json();
    const claimed = wallet.claim_state === 'claimed';
    const funded = ['plan','pack'].includes(wallet.plan?.kind) || wallet.balance_micros > 0;
    const choice = await store.setting(install.dir, 'payment');
    const usageEnabled = (action === 'status' || action === 'app_opened' || action === 'active_session') &&
      await store.setting(install.dir, 'usage') === 'on';
    if (action === 'status') return json(res, 200, { claimed, claimUrl:claimed ? null : publikLink(wallet.claim_url) ?? install.claimUrl,
      ...(claimed ? { installId:install.id, funded, choice, usageEnabled, expires:install.expires, topUpUrl:publikLink(wallet.top_up_url) } : {}) });
    if (!claimed) return json(res, 403, { error:'Finish signing in with Publik.' });
    if (action === 'choose/publik' || action === 'choose/own_key') {
      if (action === 'choose/publik' && !funded) return json(res, 402, { error:'Add credit on Publik first.' });
      await store.saveSetting(install.dir, 'payment', action.slice(7));
      return json(res, 200, { saved:true });
    }
    if (action === 'usage/on' || action === 'usage/off') {
      await store.saveSetting(install.dir, 'usage', action.slice(6));
      return json(res, 200, {saved:true});
    }
    if (action === 'app_opened' || action === 'active_session') {
      if (usageEnabled && choice && req.headers.dnt !== '1' && !/^(0|false|off)$/i.test(env.PUBLIK_TELEMETRY ?? '') &&
          /^(|0|false)$/i.test(env.DO_NOT_TRACK ?? '')) {
        await call('/api/v1/telemetry', { method:'POST', headers:{...headers,'Content-Type':'application/json'},
          body:JSON.stringify({v:1,app:APP_SLUG,install_id:install.id,event:action,app_version:version,os:install.os}) }, 5000).catch(()=>{});
      }
      res.writeHead(204); return res.end();
    }
    if (action === 'search') {
      if (choice !== 'publik') return json(res, 403, { error:'Select Publik in Account to use paid search.' });
      return lookup(req, res, install.key);
    }
    if (action !== '/local/chat/completions') return json(res, 404, {error:'Unknown route.'});
    if (choice !== 'publik') return json(res, 403, { error:'Select your Publik plan first.' });
    let body;
    try { body = await readBody(req); } catch (e) {
      return json(res, e instanceof RangeError ? 413 : 400, { error:'Invalid or oversized chat request.' });
    }
    if (body?.model !== 'publik-smart' || !Array.isArray(body.messages)) return json(res, 400, {error:'Invalid chat request.'});
    const result = await call('/api/v1/chat/completions', { method:'POST', headers:{...headers,'Content-Type':'application/json'}, body:JSON.stringify(body) });
    if (result.status === 402) {
      const e = (await result.json().catch(()=>({}))).error;
      return json(res, 402, {error:typeof e?.message === 'string' ? e.message.slice(0,240) : 'Add credit or use your own key.',
        topUpUrl:publikLink(e?.top_up_url) ?? publikLink(wallet.top_up_url)});
    }
    if (!result.ok) return json(res, result.status, {error:'Publik could not complete the request.'});
    res.writeHead(200, { 'Content-Type':result.headers.get('content-type') ?? 'application/json', 'Cache-Control':'no-store' });
    await pipeline(result.body, res);
  };
}

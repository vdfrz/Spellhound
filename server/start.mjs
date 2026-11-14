import { paneOrigin, renderManifest } from '../scripts/manifest.mjs';
import { sessionStore } from './sessions.mjs';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { researchRoute } from './research.mjs';
import { publikRoutes } from './publik.mjs';

const origin = paneOrigin(process.env.SPELLHOUND_ORIGIN);
const manifest = await renderManifest(origin);
const lookup = researchRoute({ origin });
const root = resolve('dist');
if (JSON.parse(await readFile(resolve(root,'edition.json'), 'utf8')).edition !== 'publik')
  throw Error('The hosted server requires npm run build (Publik sign-in enabled).');
const store = sessionStore(process.env.SPELLHOUND_SESSION_DIR ?? '/data/spellhound/sessions');
await store.sweep();
setInterval(() => store.sweep().catch(() => console.error('Session cleanup failed')), 60 * 60 * 1000).unref();
const route = publikRoutes({ origin, store, token:process.env.PUBLIK_APP_TOKEN });
const mime = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp', '.xml':'application/xml' };
createServer(async (req,res) => {
  try {
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"frame-ancestors 'self' https://*.officeapps.live.com https://*.office.com https://*.office365.com https://*.microsoft365.com https://*.cloud.microsoft https://*.microsoftpersonalcontent.com https://*.live.com https://*.sharepoint.com; object-src 'none'; base-uri 'self'");
    const path = new URL(req.url,origin).pathname;
    if (path === '/spellhound/research') return await lookup(req,res);
    if (path === '/health') return res.end('ok');
    if (path.startsWith('/spellhound/session/') || path === '/local/chat/completions') return await route(req,res,path);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (path === '/manifest.xml') {
      res.writeHead(200, {'Content-Type':'application/xml','Content-Disposition':'attachment; filename="Spellhound.xml"', 'Cache-Control':'no-store'});
      return res.end(req.method === 'HEAD' ? undefined : manifest);
    }
    const file = resolve(root, '.' + decodeURIComponent(path === '/' ? '/install.html' : path));
    if (!file.startsWith(root+sep) || !(await stat(file).catch(()=>null))?.isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options':'nosniff' });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  } catch { if (!res.headersSent) res.writeHead(502); res.end(); }
}).listen(Number(process.env.PORT ?? 8080), process.env.SPELLHOUND_BIND ?? '0.0.0.0');

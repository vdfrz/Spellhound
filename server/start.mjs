import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { researchRoute } from './research.mjs';
import { publikRoutes } from './publik.mjs';

const origin = new URL(process.env.SPELLHOUND_ORIGIN).origin;
if (!origin.startsWith('https://')) throw Error('SPELLHOUND_ORIGIN must be HTTPS');
const lookup = researchRoute({ origin });
const root = resolve('dist');
const route = publikRoutes({ origin, directory: process.env.SPELLHOUND_SESSION_DIR ?? '/data/spellhound/sessions', token: process.env.PUBLIK_APP_TOKEN });
const mime = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp', '.xml':'application/xml' };
createServer(async (req,res) => {
  try {
    const path = new URL(req.url,origin).pathname;
    if (path === '/spellhound/research') return await lookup(req,res);
    if (path === '/health') return res.end('ok');
    if (path.startsWith('/spellhound/session/') || path === '/local/chat/completions') return await route(req,res,path);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const file = resolve(root, '.' + decodeURIComponent(path === '/' ? '/index.html' : path));
    if (!file.startsWith(root+sep) || !(await stat(file).catch(()=>null))?.isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options':'nosniff' });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  } catch { if (!res.headersSent) res.writeHead(502); res.end(); }
}).listen(Number(process.env.PORT ?? 8080));

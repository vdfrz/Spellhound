import https from 'node:https';
import { readFileSync, createReadStream, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const port = 43187;
const origin = 'https://localhost:' + port;
const dist = resolve('source/dist');
const key = readFileSync('provider.key', 'utf8').trim();
const { researchRoute } = await import(pathToFileURL(resolve('source/server/research.mjs')));
const lookup = researchRoute({ origin });
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp' };
const server = https.createServer({cert:readFileSync('local.crt'),key:readFileSync('local.key')}, async (req,res) => {
  const fail = (status, message) => { res.writeHead(status, {'Content-Type':'text/plain'}); res.end(message); };
  if (req.headers.host !== 'localhost:'+port) return fail(403,'Invalid local host');
  try {
    const path = new URL(req.url, origin).pathname;
    if (path === '/spellhound/research') return await lookup(req, res, key);
    if (path === '/local/chat/completions') {
      if(req.method !== 'POST' || req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) return fail(403,'Open this add-in locally in Word.');
      const parts=[]; let size=0;
      for await (const part of req) {
        size += part.length;
        if(size>20*1024*1024) return fail(413,'Request too large');
        parts.push(part);
      }
      const body=JSON.parse(Buffer.concat(parts).toString());
      if(body.model !== 'publik-balanced') return fail(400,'Select Publik Balanced in Settings.');
      const upstream=await fetch('https://publikhq.com/api/v1/chat/completions',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(180000)});
      if(!upstream.ok) return fail(upstream.status, upstream.status === 402 ? 'Publik reports insufficient credit.' : 'Publik returned HTTP '+upstream.status);
      res.writeHead(200,{'Content-Type':upstream.headers.get('content-type') || 'application/json','Cache-Control':'no-store'});
      await pipeline(Readable.fromWeb(upstream.body),res); return;
    }
    if(req.method !== 'GET' && req.method !== 'HEAD') return fail(405,'Method not allowed');
    const file = resolve(dist,'.'+decodeURIComponent(path === '/' ? '/index.html' : path));
    if(!file.startsWith(dist+sep) || !statSync(file,{throwIfNoEntry:false})?.isFile()) return fail(404,'Not found');
    res.writeHead(200,{'Content-Type':types[extname(file)] || 'application/octet-stream','X-Content-Type-Options':'nosniff'});
    if(req.method === 'HEAD') return res.end();
    await pipeline(createReadStream(file),res);
  } catch { if(!res.headersSent) fail(502,'Local add-in request failed'); else res.destroy(); }
});
server.listen(port,'127.0.0.1');

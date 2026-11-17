import { paneOrigin, renderManifest } from '../scripts/manifest.mjs';
import { sessionStore } from './sessions.mjs';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { homedir } from 'node:os';
import { X509Certificate } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { researchRoute } from './research.mjs';
import { publikRoutes } from './publik.mjs';

const local = process.argv.includes('--local');
const selfTest = process.env.PUBLIK_SELF_TEST === '1' || process.argv.includes('--self-test');
if (selfTest && !local) throw Error('Use npm run self-test:local for the local installation check.');
const origin = local ? 'https://localhost:3000' : paneOrigin(process.env.SPELLHOUND_ORIGIN);
let tls;
if (local) {
  try {
    const certs = resolve(homedir(), '.office-addin-dev-certs');
    tls = {cert:await readFile(resolve(certs,'localhost.crt')), key:await readFile(resolve(certs,'localhost.key')),
      ca:await readFile(resolve(certs,'ca.crt'))};
  } catch { throw Error('Run npm run setup:local first to install the localhost certificate and build Spellhound.'); }
  if (Date.parse(new X509Certificate(tls.cert).validTo) <= Date.now() || Date.parse(new X509Certificate(tls.ca).validTo) <= Date.now())
    throw Error('The localhost certificate has expired. Run npm run setup:local to renew it.');
}
const manifest = await renderManifest(origin);
const lookup = researchRoute({ origin });
const root = resolve('dist');
if (JSON.parse(await readFile(resolve(root,'edition.json'), 'utf8')).edition !== 'publik')
  throw Error('The hosted server requires npm run build (Publik sign-in enabled).');
const localData = process.platform === 'win32' ? resolve(process.env.LOCALAPPDATA ?? resolve(homedir(),'AppData','Local'),'Spellhound')
  : process.platform === 'darwin' ? resolve(homedir(),'Library','Application Support','Spellhound')
  : resolve(process.env.XDG_DATA_HOME ?? resolve(homedir(),'.local','share'),'spellhound');
const directory = process.env.SPELLHOUND_SESSION_DIR ?? (local ? resolve(localData,'sessions') : '/data/spellhound/sessions');
const store = sessionStore(directory);
await store.sweep();
setInterval(() => store.sweep().catch(() => console.error('Session cleanup failed')), 60 * 60 * 1000).unref();
const token = process.env.PUBLIK_APP_TOKEN ?? (local ? (await readFile(new URL('../publik-app-token.txt',import.meta.url),'utf8')).trim() : undefined);
if (local && !/^pat_[A-Za-z0-9_-]+$/.test(token ?? '')) throw Error('The public Spellhound app token is missing or invalid. Download the current release.');
const route = publikRoutes({ origin, store, token });
const mime = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp', '.xml':'application/xml' };
const handle = async (req,res) => {
  try {
    if (local && req.headers.host !== 'localhost:3000') { res.writeHead(403); return res.end(); }
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
};
const server = local ? createSecureServer(tls,handle) : createServer(handle);
await new Promise((ok,fail) => {
  server.once('error',fail);
  server.listen(local ? 3000 : Number(process.env.PORT ?? 8080), local ? '127.0.0.1' : process.env.SPELLHOUND_BIND ?? '0.0.0.0',ok);
});
if (selfTest) {
  const { checkLocalInstallation } = await import('./self-test.mjs');
  try {
    await checkLocalInstallation({origin,ca:tls.ca,store});
    console.log('publik self-test: ok spellhound-app 0.1.0');
  } catch (error) {
    console.error('publik self-test: failed: '+error.message);
    process.exitCode = 1;
  } finally {
    server.closeAllConnections();
    await new Promise(ok=>server.close(ok));
  }
} else if (local) console.log('Spellhound is running at '+origin+'. Keep this terminal open while using Word.');

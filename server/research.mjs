// Public research only. No document, chat, installation token or matter context.
import { spawn } from 'node:child_process';

const limit = 5;
const tidy = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const plain = value => tidy(value).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&sect;/g, '§').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const result = (status, items = []) => ({ status, items });
const excerpt = text => text.length <= 900 ? text : text.slice(0, 899).trimEnd() + "…";
const record = (title, citation, passage, url) => ({
  title: tidy(title).slice(0, 350), citation, passage: excerpt(tidy(passage)), url, treatment: 'unknown',
});
function publicLink(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}
async function readBounded(body, bytes) {
  const chunks = []; let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > bytes) throw Error('Response too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
const json = async r => JSON.parse(await readBounded(r.body, 1024 * 1024));
function check(r) {
  if (!r.ok) throw Error(r.status === 429 ? 'rate_limited' : 'unavailable');
}

async function web(query, key, call) {
  if (!key) return result('unconfigured');
  const r = await call('https://api.parallel.ai/v1/search', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ search_queries: [query], mode: 'fast', advanced_settings: { max_results: limit } }),
  });
  if (r.status === 401 || r.status === 403) return result('key_rejected');
  check(r);
  const { results } = await json(r);
  if (!Array.isArray(results)) throw Error();
  const items = [];
  for (const row of results.slice(0, limit)) {
    const url = publicLink(row?.url);
    const passage = Array.isArray(row?.excerpts) && row.excerpts.map(tidy).find(Boolean);
    if (url && passage) items.push(record(row.title || new URL(url).hostname, new URL(url).hostname, passage, url));
  }
  return result(items.length ? 'found' : results.length ? 'no_passage' : 'no_match', items);
}

async function regulations(query, call) {
  const url = new URL('https://www.ecfr.gov/api/search/v1/results');
  url.search = new URLSearchParams({ query, per_page: '20' });
  const response = await call(url);
  check(response);
  const { results } = await json(response);
  if (!Array.isArray(results)) throw Error();
  const items = [];
  for (const row of results) {
    const { title, section } = row?.hierarchy ?? {};
    if (!/^\d+$/.test(title) || !/^\d+[\w.-]*$/.test(section) || row.removed || row.reserved || row.ends_on) continue;
    const passage = plain(row.full_text_excerpt);
    if (!passage || !/^\d{4}-\d{2}-\d{2}$/.test(row.starts_on)) continue;
    const link = 'https://www.ecfr.gov/on/' + row.starts_on + '/title-' + title + '/section-' + section;
    items.push(record(plain(row.headings?.section) || 'Regulatory text', title + ' C.F.R. § ' + section + ' (version beginning ' + row.starts_on + ')', passage, link));
    if (items.length === limit) break;
  }
  return result(items.length ? 'found' : results.length ? 'no_passage' : 'no_match', items);
}

async function usCode(query, call) {
  const match = /^(\d{1,2})\s+U\.?\s*S\.?\s*C\.?\s+(?:§\s*)?(\d{1,6}[a-z]?(?:-[\da-z]+)?)$/i.exec(query);
  if (!match) return result('unsupported');
  const [, title, section] = match;
  const host = 'https://www.govinfo.gov';
  const resolver = await call(host + '/link/uscode/' + title + '/' + section + '?link-type=html');
  if (resolver.status === 404) return result('no_match');
  if (![301, 302, 303, 307, 308].includes(resolver.status)) { check(resolver); return result('unavailable'); }
  // Follow only the published edition on the same host, never arbitrary redirects.
  const url = new URL(resolver.headers.get('location') ?? '/', host);
  const path = /^\/content\/pkg\/(USCODE-(\d{4})-title(\d+))\/html\/\1-[a-z\d-]+\.htm$/i.exec(url.pathname);
  if (url.origin !== host || url.username || url.password || !path || path[3] !== title) return result('unavailable');
  const page = await call(host + url.pathname);
  check(page);
  const html = (await readBounded(page.body, 2 * 1024 * 1024)).toString();
  const id = html.match(/<!--\s*documentid:(\S+)/)?.[1]?.toLowerCase();
  if (id !== title + '_' + section.toLowerCase()) return result('unavailable');
  const heading = plain(html.match(/<h3 class="section-head">([\s\S]*?)<\/h3>/i)?.[1]);
  const passage = plain(html.match(/<p class="statutory-body(?:-[^"]+)?">([\s\S]*?)<\/p>/i)?.[1]);
  if (!passage) return result('no_passage');
  return result('found', [record(heading || 'U.S. Code section', title + ' U.S.C. § ' + section + ' (' + path[2] + ' edition)', passage, host + url.pathname)]);
}

// Only public GovInfo U.S. Reports PDFs reach this process; no user-uploaded files.
function firstPage(pdf) {
  return new Promise((resolve, reject) => {
    const proc = spawn('pdftotext', ['-f', '1', '-l', '1', '-layout', '-', '-'], { timeout: 4000, stdio: ['pipe', 'pipe', 'ignore'] });
    let text = '';
    proc.on('error', reject);
    proc.stdin.on('error', () => {}); // close/error below reports parse failures.
    proc.stdout.setEncoding('utf8').on('data', part => {
      if (text.length < 32768) text += part;
      else proc.kill('SIGKILL');
    });
    proc.on('close', code => code === 0 ? resolve(text) : reject(Error('unavailable')));
    proc.stdin.end(pdf);
  });
}

async function usReports(query, call, extractPage) {
  const match = /^(\d{1,3})\s+U\.?\s*S\.?\s+(\d{1,4})$/i.exec(query);
  if (!match) return result('unsupported');
  const [, volume, page] = match;
  const pkg = 'USREPORTS-' + volume, id = pkg + '-' + page;
  const citation = volume + ' U.S. ' + page;
  const base = 'https://www.govinfo.gov';
  const meta = await call(base + '/metadata/granule/' + pkg + '/' + id + '/mods.xml');
  // GovInfo redirects missing granules specifically to /error.
  if (meta.status === 404 || ([301,302].includes(meta.status) && new URL(meta.headers.get('location') || '/', base).href === base + '/error')) return result('no_match');
  check(meta);
  const xml = (await readBounded(meta.body, 250000)).toString();
  if (!xml.includes('<usCitation>' + citation + '</usCitation>') || !xml.includes('<granuleClass>CASE</granuleClass>')) return result('unavailable');
  const title = plain(xml.match(/<titleInfo>\s*<title>([^<]+)<\/title>/)?.[1]);
  const url = base + '/content/pkg/' + pkg + '/pdf/' + id + '.pdf';
  const file = await call(url);
  check(file);
  const pdf = await readBounded(file.body, 8 * 1024 * 1024);
  if (pdf.subarray(0, 5).toString() !== '%PDF-') return result('unavailable');
  const passage = tidy(await extractPage(pdf));
  if (!passage) return result('no_passage');
  return result('found', [record(title || citation, citation + ', p. ' + page + ' (opening page)', passage, url)]);
}

export async function research({ source, query }, key, { upstream = fetch, extractPage = firstPage } = {}) {
  const call = (url, opts) => upstream(url, { ...opts, redirect: 'manual', signal: AbortSignal.timeout(10000) });
  try {
    if (source === 'parallel') return await web(query, key, call);
    if (source === 'uscode') return await usCode(query, call);
    if (source === 'ecfr') return await regulations(query, call);
    if (source === 'usreports') return await usReports(query, call, extractPage);
    return result('unsupported');
  } catch (e) { return result(e.message === 'rate_limited' ? 'rate_limited' : 'unavailable'); }
}

export function researchRoute({ origin, ...deps }) {
  let active = 0;
  return async (req, res) => {
    const send = (code, body = {}) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || req.headers.origin !== origin) return send(403);
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(415);
    if (active >= 6) return send(429);
    active++;
    try {
      let raw;
      try { raw = await readBounded(req, 1200); } catch { return send(413); }
      let data;
      try { data = JSON.parse(raw); } catch { return send(400); }
      if (!data || Object.keys(data).sort().join(',') !== 'query,source' ||
          !['parallel', 'ecfr', 'usreports', 'uscode'].includes(data.source) || typeof data.query !== 'string' ||
          !data.query.trim() || data.query.length > 160 || /[\u0000-\u001f\u007f]/.test(data.query)) return send(400);
      // Caller-owned key: never use operator credits or forward cookies/other headers.
      const key = data.source === 'parallel' ? req.headers['x-parallel-key'] : undefined;
      return send(200, await research({ source: data.source, query: data.query.trim() }, key, deps));
    } finally { active--; }
  };
}

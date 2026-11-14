import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { research, researchRoute } from './research.mjs';

const request = { source: 'web', query: 'privacy training' };
test('only public keywords reach Publik; a web lead needs a passage and a safe URL', async () => {
  const data = await research(request, 'test-only', { upstream: async (url, opts) => {
    assert.equal(url, 'https://publikhq.com/api/v1/search');
    assert.deepEqual(opts.headers, { 'content-type': 'application/json', Authorization: 'Bearer test-only' });
    assert.deepEqual(JSON.parse(opts.body), {q: 'privacy training', count: 5});
    return Response.json({results: [
      {title: 'Example', url:'https://example.org/article', snippet:'Source excerpt.'},
      {url:'javascript:alert(1)', snippet:'Ignored.'}, {url:'https://example.org/empty', snippet:''}
    ]});
  }});
  assert.equal(data.status, 'found');
  assert.deepEqual(data.items, [{title:'Example', citation:'example.org', passage:'Source excerpt.', url:'https://example.org/article', treatment:'unknown'}]);
});

test('no key makes no call; failures stay distinct from no match', async () => {
  let calls = 0;
  const run = (r, key = 'test-only') => research(request, key, {upstream: async () => { calls++; return r; }});
  assert.equal((await run(null, '')).status, 'unconfigured');
  assert.equal(calls, 0);
  for (const [response, status] of [[new Response(null, {status:401}), 'key_rejected'], [new Response(null,{status:429}), 'rate_limited'],
    [new Response(null,{status:402}), 'no_credit'], [new Response(null,{status:502}), 'unavailable'], [Response.json({}), 'unavailable'],
    [Response.json({results:[]}), 'no_match'], [Response.json({results:[{url:'https://example.org/'}]}), 'no_passage']]) {
    assert.deepEqual(await run(response), {status, items:[]});
  }
});

test('regulations retain version, citation and passage; search credentials never reach eCFR', async () => {
  const r = await research({source:'ecfr',query:'training'}, 'must-not-travel', {upstream: async (url, opts) => {
    assert.equal(url.origin,'https://www.ecfr.gov'); assert.equal(url.searchParams.get('query'),'training'); assert.equal(opts.headers, undefined);
    const record = { hierarchy:{title:'48',section:'24.301'}, starts_on:'2017-01-19', headings:{section:'<strong>Privacy</strong> training'}, full_text_excerpt:'Staff <strong>training</strong>.' };
    return Response.json({results:[{...record, removed:true},record]});
  }});
  assert.equal(r.items.length,1); assert.equal(r.items[0].passage,'Staff training.');
  assert.match(r.items[0].citation,/48 C.F.R. § 24.301.*2017-01-19/);
  assert.equal(r.items[0].url,'https://www.ecfr.gov/on/2017-01-19/title-48/section-24.301');
});

test('case lookup checks the exact GovInfo record before returning its opening page', async () => {
  const opts = (citation, page) => ({upstream: async url => {
    if (url.endsWith('mods.xml')) return new Response('<usCitation>'+citation+'</usCitation><granuleClass>CASE</granuleClass><titleInfo><title>Example case</title></titleInfo>');
    assert.equal(url,'https://www.govinfo.gov/content/pkg/USREPORTS-347/pdf/USREPORTS-347-483.pdf');
    return new Response('%PDF-fixture');
  }, extractPage: async () => page});
  const q = {source:'usreports',query:'347 US 483'};
  const r = await research(q, null, opts('347 U.S. 483','Opening page.'));
  assert.equal(r.items[0].passage,'Opening page.'); assert.equal(r.items[0].treatment,'unknown');
  assert.deepEqual(await research(q,null,opts('347 U.S. 484','Mismatch')), {status:'unavailable',items:[]});
  assert.equal((await research(q,null,opts('347 U.S. 483',''))).status,'no_passage');
  assert.equal((await research({...q,query:'unknown reporter'},null,{})).status,'unsupported');
  for (const [location,status] of [['/error','no_match'],['https://example.org/','unavailable']]) {
    assert.equal((await research(q,null,{upstream: async () => new Response(null,{status:302,headers:{location}})})).status,status);
  }
});

test('HTTP boundary rejects extra context, multiline input, wrong origin and non-JSON before contacting a provider', async t => {
  let calls = 0;
  const origin = 'https://pane.example';
  const handle = researchRoute({origin,upstream: async (url, opts) => {
    calls++;
    assert.equal(opts.headers.Authorization,'Bearer test-only');
    assert.equal(opts.headers.cookie,undefined);
    return Response.json({results:[]});
  }});
  const server = createServer((req,res) => handle(req,res,'test-only')).listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(() => server.close());
  const endpoint = 'http://127.0.0.1:'+server.address().port;
  const post = (body,headers={}) => fetch(endpoint,{method:'POST',headers:{origin,'content-type':'application/json',cookie:'fake=value',...headers},body: JSON.stringify(body)});
  for (const body of [{...request,document:'SYNTHETIC'}, {...request,selection:'synthetic'}, {...request,query:'two\nlines'}, {...request,source:'https://example.com'}, null]) assert.equal((await post(body)).status,400);
  assert.equal((await post(request,{origin:'https://other.example'})).status,403);
  assert.equal((await post(request,{'content-type':'text/plain'})).status,415);
  assert.equal((await post({...request,query:'x'.repeat(1500)})).status,413);
  assert.equal(calls,0);
  const r=await post(request); assert.deepEqual(await r.json(),{status:'no_match',items:[]});
  assert.equal(r.headers.get('cache-control'),'no-store'); assert.equal(calls,1);
});

test('statute lookup follows only the official granule and verifies title and section before citing an edition', async () => {
  const base = 'https://www.govinfo.gov', path = '/content/pkg/USCODE-2024-title17/html/USCODE-2024-title17-chap1-sec107.htm';
  const run = (redirect, id) => research({source:'uscode',query:'17 U.S.C. § 107'}, null, {upstream: async url => {
    if (url === base + '/link/uscode/17/107?link-type=html') return new Response(null,{status:302,headers:{location:redirect}});
    assert.equal(url, base + path);
    return new Response('<!-- documentid:'+id+'  usckey:1 --><h3 class="section-head">Heading</h3><p class="statutory-body">A public passage.</p>');
  }});
  const r = await run(base + path, '17_107');
  assert.equal(r.items[0].citation,'17 U.S.C. § 107 (2024 edition)'); assert.equal(r.items[0].passage,'A public passage.');
  assert.equal((await run('https://other.example'+path,'17_107')).status,'unavailable');
  assert.equal((await run(base+path,'17_108')).status,'unavailable');
});


test('case discovery keeps a cited mention as a lead and authenticates only the Publik request', async () => {
  const match = {title:'An opinion citing Brown', url:'https://example.org/mention', snippet:'Cites 347 U.S. 483.'};
  let officialMatches = false;
  const upstream = async (url, opts) => {
    if (url === 'https://publikhq.com/api/v1/search') {
      assert.equal(opts.headers.Authorization,'Bearer fixture');
      assert.deepEqual(JSON.parse(opts.body),{q:'347 U.S. 483 US court opinion case law',count:5});
      return Response.json({results:[match]});
    }
    assert.equal(opts.headers,undefined);
    if (url.endsWith('mods.xml')) {
      if (!officialMatches) return new Response(null,{status:404});
      return new Response('<usCitation>347 U.S. 483</usCitation><granuleClass>CASE</granuleClass><titleInfo><title>Brown</title></titleInfo>');
    }
    assert.equal(url,'https://www.govinfo.gov/content/pkg/USREPORTS-347/pdf/USREPORTS-347-483.pdf');
    return new Response('%PDF-fixture');
  };
  const lookup = () => research({source:'cases',query:'347 U.S. 483'}, 'fixture', {upstream,extractPage:async () => 'Opening page'});
  const leads = await lookup();
  assert.equal(leads.items.length,1);
  assert.equal(leads.items[0].verifiedReporter,undefined);
  officialMatches = true;
  const verified = await lookup();
  assert.equal(verified.items.length,2);
  assert.equal(verified.items[0].verifiedReporter,true);
  assert.equal(verified.items[0].treatment,'unknown');
});

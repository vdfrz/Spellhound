import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {mkdtemp, rm, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {publikRoutes} from './publik.mjs';
import {lifetime, sessionStore} from './sessions.mjs';

async function pilot(t, token = 'pat_fixture') {
  const directory = await mkdtemp(join(tmpdir(),'spellhound-fixture-'));
  const origin = 'https://word.test';
  const wallets = [], billed = [], events = [];
  const clock = {now:Date.now()};
  const store = sessionStore(directory, ()=>clock.now);
  const handler = publikRoutes({origin, store, token, env:{}, upstream: async(url,opts) => {
    if (url.endsWith('/installs')) {
      const {install_id,os,app_slug} = JSON.parse(opts.body);
      assert.equal(app_slug,'spellhound-app');
      assert.equal(os,'macos');
      wallets.push({id:install_id, claim_state:'anonymous', balance_micros:0, claim_url:null});
      return Response.json({key:'pk_fixture_'+wallets.length, claim_url:'https://publikhq.com/fixture'},{status:201});
    }
    const n = Number(opts.headers.Authorization.split('_').at(-1));
    if (url.endsWith('/wallet')) return wallets[n-1].revoked ? new Response(null,{status:401}) : Response.json(wallets[n-1]);
    if (url.endsWith('/telemetry')) { events.push({n,data:JSON.parse(opts.body)}); return new Response(null,{status:204}); }
    if (url.endsWith('/search')) {
      billed.push(n);
      assert.deepEqual(JSON.parse(opts.body), {q:'privacy training', count:5});
      return Response.json({results:[]});
    }
    assert.ok(url.endsWith('/chat/completions'));
    assert.equal(JSON.parse(opts.body).model, 'publik-smart');
    billed.push(n); return Response.json({choices:[]});
  }});
  const server = createServer((req,res) => handler(req,res,req.url).catch(()=>{res.writeHead(502);res.end();}));
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  t.after(async()=>{server.closeAllConnections(); await new Promise(ok=>server.close(ok)); await rm(directory,{recursive:true,force:true});});
  const post = (action,install={},headers={},body) => fetch('http://127.0.0.1:'+server.address().port+
    (action==='chat'?'/local/chat/completions':'/spellhound/session/'+action),{method:'POST',headers:{
      origin,'user-agent':'Word Macintosh',cookie:install.cookie??'','x-spellhound-install':install.id??'',...headers},
    body:JSON.stringify(body??{model:'publik-smart',messages:[{role:'user',content:'synthetic test'}]})});
  async function start() {
    const r=await post('start'); assert.equal(r.status,201); const header=r.headers.get('set-cookie');
    for(const flag of ['Secure','HttpOnly','Partitioned','SameSite=None']) assert.ok(header.includes(flag));
    return {cookie:header.split(';')[0], id:wallets.at(-1).id};
  }
  return {post,start,clock,store,directory,wallets,billed,events};
}

test('no app token or wrong origin: no installation',async t=>{
  const p=await pilot(t,'');
  assert.equal((await p.post('start',{}, {origin:'https://elsewhere.test'})).status,403);
  assert.equal((await p.post('start')).status,503);
  assert.equal(p.wallets.length,0);
});

test('separate installs, browser claim, payment choice, stale pane, revocation and logout',async t=>{
  const p=await pilot(t); const a=await p.start(), b=await p.start();
  const unclaimed=await (await p.post('status',a)).json();
  assert.equal(unclaimed.claimUrl,'https://publikhq.com/fixture'); assert.equal(unclaimed.installId,undefined);
  assert.equal((await p.post('choose/own_key',a)).status,403);
  Object.assign(p.wallets[0],{claim_state:'claimed',top_up_url:'https://outside.test'});
  assert.equal((await (await p.post('status',a)).json()).topUpUrl,null);
  assert.equal((await p.post('choose/publik',a)).status,402);
  assert.equal((await p.post('choose/own_key',a)).status,200);
  assert.equal((await p.post('chat',a)).status,403);
  p.wallets[0].balance_micros=500;
  assert.equal((await p.post('choose/publik',a)).status,200);
  assert.equal((await p.post('chat', a, {}, {model:'publik-balanced', messages:[]})).status, 400);
  assert.equal((await p.post('chat',a)).status,200);
  assert.equal((await p.post('chat',b)).status,403);
  assert.equal((await p.post('chat',{...a,id:b.id})).status,409);
  assert.deepEqual(p.billed,[1]);
  p.wallets[0].revoked=true;
  assert.equal((await p.post('chat',a)).status,401);
  assert.equal((await p.post('status',a)).status,401);
  assert.equal((await p.post('end',b)).status,200);
  assert.equal((await p.post('status',b)).status,401);
});

test('usage is opt-in, server constructs the payload, opt-out and DNT stop delivery',async t=>{
  const p=await pilot(t); const a=await p.start();
  p.wallets[0].claim_state='claimed';
  await p.post('choose/own_key',a);
  await p.post('app_opened',a); assert.equal(p.events.length,0);
  await p.post('usage/on',a);
  await p.post('app_opened',a,{}, {document:'never forward'});
  await p.post('active_session',a, {dnt:'1'});
  await p.post('active_session',a);
  await p.post('usage/off',a); await p.post('active_session',a);
  assert.deepEqual(p.events,['app_opened','active_session'].map(event=>({n:1,data:{
    v:1,app:'spellhound-app',install_id:a.id,event,app_version:'0.1.0',os:'macos'}})));
});

test('server expiry applies even with cookie; sweep removes dormant and unknown-age legacy credentials',async t=>{
  const p=await pilot(t); const a=await p.start(); await p.start();
  await writeFile(join(p.directory,'a'.repeat(64)),'fixture');
  p.clock.now+=lifetime+1;
  assert.equal((await p.post('status',a)).status,401);
  await p.store.sweep(); assert.deepEqual(await readdir(p.directory),[]);
});


test('search uses only the claimed installation that selected Publik', async t => {
  const p = await pilot(t);
  const a = await p.start(), b = await p.start();
  const search = install => p.post('search',install,{'content-type':'application/json'},{source:'web',query:'privacy training'});
  assert.equal((await search(b)).status,403);
  p.wallets[0].claim_state='claimed';
  await p.post('choose/own_key',a);
  assert.equal((await search(a)).status,403);
  p.wallets[0].balance_micros=50000;
  await p.post('choose/publik',a);
  assert.equal((await search({...a,id:b.id})).status,409);
  assert.deepEqual(await (await search(a)).json(),{status:'no_match',items:[]});
  assert.deepEqual(p.billed,[1]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { publikRoutes } from './publik.mjs';

test('Word installations independently claim their wallet, use their own key and sign out', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'spellhound-test-'));
  const origin = 'https://word.example';
  const claimed = new Set();
  const billed = [];
  let count = 0;
  const handler = publikRoutes({ origin, directory, token: 'test-app-token', upstream: async (url, options) => {
    const auth = options.headers.Authorization;
    if (url.endsWith('/installs')) return Response.json({key: 'pk_test_'+ ++count}, {status:201});
    if (url.endsWith('/wallet')) return Response.json({claim_state:claimed.has(auth)?'claimed':'anonymous',claim_url:'https://publikhq.com/test'});
    billed.push(auth);
    return Response.json({choices:[{message:{content:'test'}}]});
  }});
  const server = createServer((req,res) => handler(req,res,req.url).catch(()=>{res.writeHead(500);res.end();}));
  await new Promise(ok => server.listen(0,'127.0.0.1',ok));
  t.after(async()=>{ server.closeAllConnections(); await new Promise(ok=>server.close(ok)); await rm(directory,{recursive:true,force:true}); });
  const post = (p,cookie='',from=origin) => fetch('http://127.0.0.1:'+server.address().port+p, {method:'POST',headers:{origin:from,cookie},body:JSON.stringify({model:'publik-balanced',messages:[]})});
  const endpoint = '/spellhound/session/';
  assert.equal((await post(endpoint+'start','','https://wrong.example')).status,403);
  const first = await post(endpoint+'start');
  const a=first.headers.get('set-cookie').split(';')[0], b=(await post(endpoint+'start')).headers.get('set-cookie').split(';')[0];
  assert.equal((await first.json()).registered,true);
  assert.equal((await post('/local/chat/completions',a)).status,403);
  claimed.add('Bearer pk_test_1');
  assert.equal((await (await post(endpoint+'status',a)).json()).claimed,true);
  assert.equal((await post('/local/chat/completions',a)).status,200);
  assert.equal((await post('/local/chat/completions',b)).status,403);
  assert.deepEqual(billed,['Bearer pk_test_1']);
  await post(endpoint+'end',a);
  assert.equal((await post('/local/chat/completions',a)).status,401);
});

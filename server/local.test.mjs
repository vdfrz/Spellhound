import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {request} from 'node:https';
import {renderManifest} from '../scripts/manifest.mjs';

test('local manifests have usable localhost URLs; optional hosted rendering replaces them',async()=>{
  for (const name of ['manifest.xml','manifest.localhost.xml','manifest.community.xml']) {
    const xml = await readFile(new URL('../'+name,import.meta.url),'utf8');
    assert.ok(xml.includes('https://localhost:3000/index.html'));
    assert.ok(!xml.includes('spellhound.example'));
  }
  const xml = await renderManifest('https://pilot.invalid');
  assert.ok(xml.includes('https://pilot.invalid/index.html'));
  assert.ok(!xml.includes('localhost:3000'));
  assert.ok(xml.includes('https://publikhq.com'));
});

test('local HTTPS serves the Publik build and rejects foreign hosts and origins',async t=>{
  const directory = await mkdtemp(join(tmpdir(),'spellhound-local-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const certs = join(directory,'.office-addin-dev-certs');
  await mkdir(certs);
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost',
    '-keyout',join(certs,'localhost.key'),'-out',join(certs,'localhost.crt')],{stdio:'ignore'});
  await copyFile(join(certs,'localhost.crt'),join(certs,'ca.crt'));
  await mkdir(join(directory,'dist'));
  await writeFile(join(directory,'dist','edition.json'),'{"edition":"publik"}');
  await writeFile(join(directory,'dist','index.html'),'fixture pane');
  await writeFile(join(directory,'dist','install.html'),'<a href="/manifest.xml">Install</a>');
  const child = spawn(process.execPath,[fileURLToPath(new URL('./start.mjs',import.meta.url)),'--local'],{
    cwd:directory,env:{...process.env,HOME:directory,USERPROFILE:directory,PUBLIK_APP_TOKEN:'pat_fixture',
      PUBLIK_SELF_TEST:'0',SPELLHOUND_SESSION_DIR:join(directory,'sessions')},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
  t.after(async()=>{if(child.exitCode===null){child.kill();await new Promise(ok=>child.once('exit',ok));}});
  await new Promise((ok,fail)=>{
    const timeout=setTimeout(()=>fail(Error('Local server did not start')),10000);
    child.once('error',fail);
    child.once('exit',()=>{clearTimeout(timeout);fail(Error('Local server exited: '+stderr));});
    child.stdout.on('data',chunk=>{if(chunk.toString().includes('Spellhound is running')){clearTimeout(timeout);ok();}});
  });
  const ca = await readFile(join(certs,'ca.crt'));
  const get = (path,headers={},method='GET')=>new Promise((ok,fail)=>{
    const req = request({hostname:'127.0.0.1',servername:'localhost',port:3000,path,method,ca,
      headers:{host:'localhost:3000',...headers}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>ok({status:res.statusCode,body:Buffer.concat(chunks).toString()}));
    });req.on('error',fail);req.end();
  });
  assert.equal((await get('/health')).body,'ok');
  assert.equal((await get('/index.html')).body,'fixture pane');
  assert.ok((await get('/manifest.xml')).body.includes('https://localhost:3000/index.html'));
  assert.equal((await get('/',{host:'attacker.example'})).status,403);
  assert.equal((await get('/spellhound/session/start',{origin:'https://attacker.example'},'POST')).status,403);
  assert.equal((await get('/spellhound/session/status',{origin:'https://localhost:3000'},'POST')).status,401);
  assert.equal((await get('/publik-app-token.txt')).status,404);
  assert.equal((await get('/%2e%2e%2fserver/start.mjs')).status,404);
});

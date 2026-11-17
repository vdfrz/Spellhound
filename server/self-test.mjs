import { request } from 'node:https';

// Exercise the built app's real registration and wallet routes. No AI call,
// claim link, credential or telemetry event is printed by this check.
export async function checkLocalInstallation({origin,ca,store}) {
  const userAgent = process.platform === 'win32' ? 'Word Windows' : process.platform === 'darwin' ? 'Word Macintosh' : 'Word Linux';
  function post(action,cookie='') {
    return new Promise((resolve,reject)=>{
      const req = request(origin+'/spellhound/session/'+action, {method:'POST',ca,family:4,
        lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4),
        headers:{origin,cookie,'user-agent':userAgent},timeout:60000}, res=>{
        const chunks=[];
        res.on('data',chunk=>chunks.push(chunk));
        res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
        res.on('error',reject);
      });
      req.on('error',()=>reject(Error('The local HTTPS connection failed. Check the certificate and network.')));
      req.on('timeout',()=>req.destroy());
      req.end();
    });
  }
  const start = await post('start');
  if (start.status !== 201) throw Error('Installation registration returned HTTP '+start.status+'.');
  const cookie = start.headers['set-cookie']?.[0]?.split(';')[0];
  if (!cookie) throw Error('Installation registration did not set a session cookie.');
  try {
    const status = await post('status',cookie);
    if (status.status !== 200 || typeof JSON.parse(status.body).claimed !== 'boolean')
      throw Error('The Publik wallet check returned HTTP '+status.status+'.');
  } finally {
    const install = await store.read(cookie);
    if (install) await store.discard(install.dir);
  }
}

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rm, stat, rename } from 'node:fs/promises';
import { join } from 'node:path';

export const lifetime = 30 * 24 * 60 * 60 * 1000;
const hash = id => createHash('sha256').update(id).digest('hex');
const sessionName = /^[a-f0-9]{64}$/;
export const cookieName = '__Host-spellhound';
export const cookieValue = (id = '') =>
  cookieName+'='+id+'; Secure; HttpOnly; Path=/; SameSite=None; Partitioned; Max-Age='+(id ? lifetime / 1000 : 0);

export function sessionStore(directory, now = Date.now) {
  async function discard(dir) { await rm(dir, { recursive: true, force: true }); }
  async function record(dir) {
    try {
      const data = JSON.parse(await readFile(join(dir, 'install'), 'utf8'));
      if (data.expires > now()) return { ...data, dir };
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      // Foundation records were bare files without server-side expiry.
      if (e.code !== 'ENOTDIR') throw e;
    }
    await discard(dir);
    return null;
  }
  return {
    async create(data) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const sid = randomBytes(32).toString('hex');
      const dir = join(directory, hash(sid));
      await mkdir(dir, { mode: 0o700 });
      try {
        await writeFile(join(dir, 'install'), JSON.stringify({ ...data, expires: now()+lifetime }), { flag:'wx', mode:0o600 });
      } catch (e) { await discard(dir); throw e; }
      return sid;
    },
    async read(header = '') {
      const id = header.split(/;\s*/).find(v => v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
      return id && sessionName.test(id) ? record(join(directory, hash(id))) : null;
    },
    async setting(dir, name) {
      try { return await readFile(join(dir, name), 'utf8'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; return null; }
    },
    async saveSetting(dir, name, value) {
      const tmp = join(dir, randomUUID());
      await writeFile(tmp, value, { flag:'wx', mode:0o600 });
      await rename(tmp, join(dir, name));
    },
    discard,
    async sweep() {
      let names;
      try { names = await readdir(directory, {withFileTypes:true}); }
      catch (e) { if (e.code === 'ENOENT') return; throw e; }
      for (const name of names.filter(n => sessionName.test(n.name))) {
        const dir = join(directory, name.name);
        if (!name.isDirectory()) { await discard(dir); continue; }
        if (!await record(dir)) {
          const info = await stat(dir).catch(() => null);
          if (info && info.mtimeMs < now()-lifetime) await discard(dir);
        }
      }
    },
  };
}

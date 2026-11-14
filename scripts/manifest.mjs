import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function paneOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.href !== url.origin+'/' || /(^|\.)example$/.test(url.hostname))
    throw Error('Supply the verified HTTPS origin of the Publik-operated pilot.');
  return url.origin;
}
export async function renderManifest(origin) {
  const template = await readFile(new URL('../manifest.xml', import.meta.url),'utf8');
  return template.replaceAll('https://spellhound.example',paneOrigin(origin));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const xml = await renderManifest(process.argv[2]);
  await mkdir('dist',{recursive:true});
  await writeFile('dist/manifest.xml',xml);
}

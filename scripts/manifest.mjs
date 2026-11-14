import {readFile,writeFile,mkdir} from 'node:fs/promises';
const url = new URL(process.argv[2]);
if (url.protocol !== 'https:' || url.href !== url.origin+'/' || /(^|\.)example$/.test(url.hostname)) throw Error('Supply the HTTPS origin of the deployed pane.');
const template = await readFile(new URL('../manifest.xml',import.meta.url),'utf8');
await mkdir('dist',{recursive:true});
await writeFile('dist/manifest.xml',template.replaceAll('https://spellhound.example',url.origin));

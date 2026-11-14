import { useEffect, useState } from 'react';
import { matters, type Matter, type Entry, type Kind, type Experience } from './api';
import './matters.css';

const failure = (e: unknown) => e instanceof Error ? e.message : 'Please try again.';

export function MatterWorkspace({ target, initialText = '' }: { target: string; initialText?: string }) {
  const [list, setList] = useState<Matter[]>([]);
  const [selected, select] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    matters.list().then(rows => { if (active) setList(rows); })
      .catch(e => { if (active) setError(failure(e)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  return <section className="matter-workspace" aria-label="Save to a deal folder">
    <h1>Save to a deal folder</h1><p>Keep notes, decisions and reference text for one deal together.</p><p>Open in Word: <strong>{target}</strong></p>
    <label>Deal folder<select value={selected} onChange={e => select(e.target.value)}>
      <option value="">Choose a deal folder</option>{list.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}
    </select></label>
    <form onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try { const m = await matters.create(name); setList(xs => [m, ...xs]); select(m.id); setName(''); }
      catch (e) { setError(failure(e)); } finally { setBusy(false); }
    }}><label>New folder name<input value={name} maxLength={120} onChange={e => setName(e.target.value)} /></label>
      <button disabled={busy || !name.trim()}>Create folder</button></form>
    {error && <p role="alert">{error}</p>}
    {selected && <Folder key={selected} initialText={initialText} matter={list.find(m => m.id === selected)!} />}
  </section>;
}

function Folder({ matter, initialText }: { matter: Matter; initialText: string }) {
  const [rows, setRows] = useState<Entry[]>([]);
  const [memory, setMemory] = useState<Experience[] | null>(null);
  const [kind, setKind] = useState<Kind>('note');
  const [title, setTitle] = useState('');
  const [saved, setSaved] = useState('');
  const [body, setBody] = useState(initialText);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    matters.entries(matter.id).then(xs => { if (active) setRows(xs); })
      .catch(e => { if (active) setError(failure(e)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [matter.id]);

  async function run(job: () => Promise<void>) {
    setBusy(true); setError('');
    try { await job(); } catch (e) { setError(failure(e)); } finally { setBusy(false); }
  }
  const recall = (id?: string) => run(async () => { setMemory(await matters.memory(matter.id, id)); });
  return <section><h2>{matter.name}</h2>
    <form onSubmit={e => { e.preventDefault(); void run(async () => {
      const row = await matters.file(matter.id, kind, title, body);
      setRows(xs => [row, ...xs]); setSaved(row.title); setTitle(''); setBody('');
    }); }}><fieldset disabled={busy}><legend>Save an item</legend>
      <label>Item type<select value={kind} onChange={e => { setKind(e.target.value as Kind); }}>
        <option value="note">Note</option><option value="decision">Decision</option><option value="reference">Reference</option>
      </select></label>
      {kind === 'reference' && <label>Import reference text (.txt, .md, .docx)<input type="file" accept=".txt,.md,.docx" onChange={e => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
        void run(async () => {
          if (file.size > 4*1024*1024) throw Error('Choose a reference smaller than 4 MB.');
          if (!/\.(txt|md|docx)$/i.test(file.name)) throw Error('Choose a .txt, .md or .docx reference.');
          const { extractTextFromFile } = await import('@/community/extractText');
          const result = await extractTextFromFile(file);
          if (!result.text.trim() || result.text.length > 120000) throw Error('Paste an excerpt of up to 120,000 characters instead.');
          setTitle(file.name); setBody(result.text);
        });
      }} /></label>}
      <label>Title<input value={title} maxLength={240} onChange={e => setTitle(e.target.value)} /></label>
      <label>{kind === 'reference' ? 'Reference text' : 'Details'}<textarea rows={4} value={body} maxLength={kind === 'reference' ? 120000 : 12000} onChange={e => setBody(e.target.value)} /></label>
      <button disabled={!title.trim() || !body.trim() || body.length > (kind === 'reference' ? 120000 : 12000)}>Save {kind}</button>
    </fieldset></form>
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">Saved “{saved}” to {matter.name}.</p>}
    <h3>Saved items</h3>
    {!rows.length && !busy && !error && <p>No saved items yet.</p>}
    {rows.map(row => <details key={row.id}><summary><small>{row.kind}</small> {row.title}</summary><p className="matter-body">{row.body}</p>
      {row.kind === 'decision' && <button disabled={busy} onClick={() => recall(row.id)}>Summarize this decision in memory</button>}
    </details>)}
    <h3>Decision memory</h3><button disabled={busy} onClick={() => recall()}>Reopen summaries</button>
    {memory?.length === 0 && <p>No decision summaries are available.</p>}
    {memory?.map(x => <details key={x.id}><summary>{x.title}</summary><p className="matter-body">{x.body}</p></details>)}
  </section>;
}

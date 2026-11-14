import { useEffect, useState } from "react";
import { matters, type Entry, type Matter } from "@/features/matters/api";

export function MatterItemPicker({ onPick }: { onPick: (matter: Matter, entry: Entry) => void }) {
  const [list, setList] = useState<Matter[]>([]);
  const [selected, select] = useState("");
  const [items, setItems] = useState<Entry[]>([]);
  const [status, setStatus] = useState("Loading deal folders…");

  useEffect(() => {
    let active = true;
    matters.list().then(rows => {
      if (active) { setList(rows); setStatus(rows.length ? "" : "No deal folders yet. Choose “Save to a deal folder” to create one."); }
    }).catch(() => { if (active) setStatus("Couldn’t load your folders. Reopen this picker to retry."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    matters.entries(selected).then(rows => {
      if (active) { setItems(rows); setStatus(rows.length ? "" : "This folder has no saved items yet."); }
    }).catch(() => { if (active) setStatus("Couldn’t read this folder. Select it again to retry."); });
    return () => { active = false; };
  }, [selected]);

  const matter = list.find(m => m.id === selected);
  return <div className="stack">
    <label>Deal folder<select value={selected} onChange={e => {
      select(e.target.value); setItems([]); setStatus(e.target.value ? "Loading items…" : "");
    }}><option value="">Choose a deal folder</option>{list.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
    {status && <p role="status">{status}</p>}
    {matter && items.map(item => <button key={item.id} type="button" className="ctx-source" onClick={() => onPick(matter, item)}>
      {item.title} · {item.kind}
    </button>)}
  </div>;
}

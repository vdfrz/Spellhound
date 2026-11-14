import { useEffect, useState } from "react";
import { matters, type Entry, type Matter } from "@/features/matters/api";

export function MatterItemPicker({ onPick }: { onPick: (matter: Matter, entry: Entry) => void }) {
  const [list, setList] = useState<Matter[]>([]);
  const [selected, select] = useState("");
  const [items, setItems] = useState<Entry[]>([]);
  const [status, setStatus] = useState("Loading matters…");

  useEffect(() => {
    let active = true;
    matters.list().then(rows => {
      if (active) { setList(rows); setStatus(rows.length ? "" : "Create a matter in the matter workspace first."); }
    }).catch(() => { if (active) setStatus("Couldn’t load your matters. Reopen this picker to retry."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    matters.entries(selected).then(rows => {
      if (active) { setItems(rows); setStatus(rows.length ? "" : "This matter has no filed items yet."); }
    }).catch(() => { if (active) setStatus("Couldn’t read this matter. Select it again to retry."); });
    return () => { active = false; };
  }, [selected]);

  const matter = list.find(m => m.id === selected);
  return <div className="stack">
    <label>Matter<select value={selected} onChange={e => {
      select(e.target.value); setItems([]); setStatus(e.target.value ? "Loading items…" : "");
    }}><option value="">Choose a matter</option>{list.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
    {status && <p role="status">{status}</p>}
    {matter && items.map(item => <button key={item.id} type="button" className="ctx-source" onClick={() => onPick(matter, item)}>
      {item.title} · {item.kind}
    </button>)}
  </div>;
}

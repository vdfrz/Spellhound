import { useEffect, useRef, useState } from "react";
import { lookup, type ResearchResult, type ResearchStatus, type Source, type SourceItem } from "@/api/research";
import { copyPlain } from "@/lib/clipboard";
import { insertCitationFootnote } from "@/office/citations";
import { Button } from "@/ui/primitives";
import { ViewHeader } from "@/ui/ViewHeader";
import "./research.css";

const names: Record<Source, string> = {
  ecfr: "Federal regulations · eCFR", uscode: "Federal statutes · U.S. Code", usreports: "Supreme Court · U.S. Reports", parallel: "Public web · Parallel",
};
const messages: Record<Exclude<ResearchStatus, "found">, string> = {
  unconfigured: "Enter your Parallel API key to search the web. The legal sources work without a key.",
  key_rejected: "Parallel rejected this key. Check it and try again.",
  rate_limited: "Too many requests. Wait a minute and try again.",
  unsupported: "Enter a citation in the format shown in the search field.",
  no_match: "No matching record in this source. Other sources may have one.",
  no_passage: "The source returned no usable passage. Open the publisher’s site to check manually.",
  unavailable: "Couldn’t read this source. Try again later or choose another source.",
};

function SourceCard({ item, source }: { item: SourceItem; source: Source }) {
  const [notice, setNotice] = useState("");
  const label = source === "parallel" ? "Web lead" : "Primary source";
  const reference = [item.title, item.citation, names[source], item.url, "Treatment unknown"].join(" · ");
  async function cite(footnote: boolean) {
    try {
      if (footnote) await insertCitationFootnote(reference);
      else if (!await copyPlain(reference)) throw Error();
      setNotice(footnote ? "Footnote inserted." : "Citation copied.");
    } catch { setNotice(footnote ? "Couldn’t insert the footnote. Try copying the citation." : "Couldn’t copy the citation."); }
  }
  return <article className="card stack research-card">
    <span className="small muted">{label} · Treatment unknown</span>
    <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
    <strong className="small">{item.citation}</strong>
    <blockquote>{item.passage}</blockquote>
    <div className="row"><Button size="sm" onClick={() => void cite(false)}>Copy citation</Button>
      {source !== "parallel" && <Button size="sm" onClick={() => void cite(true)}>Insert footnote</Button>}</div>
    {notice && <span role="status" className="small">{notice}</span>}
  </article>;
}

export function ResearchView() {
  const [source, setSource] = useState<Source>("ecfr");
  const [query, setQuery] = useState("");
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  function reset() { active.current?.abort(); setPending(false); setResult(null); }
  async function search() {
    reset();
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    try {
      const data = await lookup(source, query, key, controller.signal);
      if (!controller.signal.aborted) setResult(data);
    } catch { if (!controller.signal.aborted) setResult({ status: "unavailable", items: [] }); }
    finally { if (!controller.signal.aborted) setPending(false); }
  }
  return <div className="stack research">
    <ViewHeader title="Public legal research" subtitle="Type public keywords or a citation. Only this query goes to the source you choose. Leave out client names, clauses and other private details." />
    <form className="stack" onSubmit={e => { e.preventDefault(); if (query.trim() && !pending) void search(); }}>
      <label>Search source<select value={source} onChange={e => {
        reset(); setSource(e.target.value as Source); setQuery(""); setKey("");
      }}>{(Object.keys(names) as Source[]).map(s => <option key={s} value={s}>{names[s]}</option>)}</select></label>
      {source === "parallel" && <label>Your Parallel API key<input type="password" value={key} autoComplete="off" onChange={e => {reset(); setKey(e.target.value);}} />
        <small>Used for this view only. Spellhound forwards the key to Parallel.</small></label>}
      <label>{source === "usreports" ? "U.S. Reports citation" : source === "uscode" ? "U.S. Code section" : "Public search terms"}<input
        value={query} maxLength={160} required autoComplete="off" placeholder={source === "usreports" ? "347 U.S. 483" : source === "uscode" ? "17 U.S.C. § 107" : "privacy training"}
        onChange={e => {reset(); setQuery(e.target.value);}} /></label>
      <Button type="submit" disabled={!query.trim() || pending}>{pending ? "Searching…" : "Search"}</Button>
    </form>
    <div aria-live="polite" className="stack">
      {result?.status === "found" ? <>
        <p className="small muted">{source === "parallel" ? "Web excerpts are leads. Verify legal claims in a primary source." : source === "usreports" ? "Excerpt from the first printed page; it may include the syllabus. Later case treatment has not been checked." : source === "uscode" ? "Opening statutory passage from the cited edition. Check amendments since that edition." : "Search excerpts from the dated eCFR text. Check the applicable date and later amendments."}</p>
        {result.items.map((item, i) => <SourceCard key={i + item.url} source={source} item={item} />)}
      </> : result && <p>{messages[result.status]}</p>}
    </div>
  </div>;
}

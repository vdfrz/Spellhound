export type Source = "ecfr" | "uscode" | "usreports" | "parallel";
export type ResearchStatus = "found" | "no_match" | "no_passage" | "unsupported" | "unconfigured" | "key_rejected" | "unavailable" | "rate_limited";
export interface SourceItem { title: string; citation: string; passage: string; url: string; treatment: "unknown" }
export interface ResearchResult { status: ResearchStatus; items: SourceItem[] }

// Intentionally accepts no context object, attachments, selection, or chat messages.
export async function lookup(source: Source, query: string, key: string, signal: AbortSignal): Promise<ResearchResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (source === "parallel" && key.trim()) headers["X-Parallel-Key"] = key.trim();
  const r = await fetch("/spellhound/research", {
    method: "POST", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error",
    headers, signal, body: JSON.stringify({ source, query: query.trim() }),
  });
  if (r.status === 429) return { status: "rate_limited", items: [] };
  if (!r.ok) throw Error("Research unavailable");
  return r.json();
}

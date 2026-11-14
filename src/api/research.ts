import { hosted, installHeaders } from "@/auth/publik";
import { errorFromResponse } from "./errors";

export type Source = "ecfr" | "uscode" | "usreports" | "web" | "cases";
export type ResearchStatus = "found" | "no_match" | "no_passage" | "unsupported" | "unconfigured" | "key_rejected" | "unavailable" | "rate_limited" | "no_credit";
export interface SourceItem { title: string; citation: string; passage: string; url: string; verifiedReporter?: boolean; treatment: "unknown" }
export interface ResearchResult { status: ResearchStatus; items: SourceItem[] }

// Intentionally accepts no context object, attachments, selection, or chat messages.
export async function lookup(source: Source, query: string, signal?: AbortSignal): Promise<ResearchResult> {
  const paid = source === "web" || source === "cases";
  const r = await fetch(paid && hosted ? "/spellhound/session/search" : "/spellhound/research", {
    method: "POST", credentials: paid ? "same-origin" : "omit", referrerPolicy: "no-referrer", redirect: "error",
    headers: { "Content-Type": "application/json", ...(paid && hosted ? installHeaders() : {}) },
    signal, body: JSON.stringify({ source, query: query.trim() }),
  });
  if (r.status === 429) return { status: "rate_limited", items: [] };
  if (!r.ok) throw await errorFromResponse(r);
  return r.json();
}

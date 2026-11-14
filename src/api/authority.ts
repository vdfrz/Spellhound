import { config } from "@/config";
import { lookup, type SourceItem } from "./research";
import { request } from "./http";
import { ApiError } from "./errors";
import { isCommunity } from "@/community/edition";
import { isStatuteCitation, type CitationKind } from "@/features/authority/extract";
import type { ContextSnippet } from "@/lib/context-snippet";

/**
 * Authority verification against Spellhound's US corpus.
 * Case citations: GET /api/v1/us/citation-lookup?citation=... (JWT, cached).
 * Statute citations: GET /api/v1/us-statutes/resolve?q=... (federal U.S.C. /
 * C.F.R. + state code cites). A matched cluster (cases) or a resolved section
 * (statutes) means the authority is real; an unmatched one is a possible
 * hallucination to verify before relying on it.
 */

export type Verdict = "verified" | "no_match" | "unrecognized" | "leads" | "error";

/** Good-law (treatment) tier for a verified case citation. */
export type GoodLaw = "good" | "caution" | "unknown";

/**
 * Treatment signal for a single case citation: whether the cited case is still
 * safe to rely on. Best-effort and additive to the base authority check.
 */
export interface CaseStatus {
  citation: string;
  status: GoodLaw;
  label: string;
  detail: string;
  citationCount: number;
}

export interface AuthorityResult {
  raw: string;
  count: number;
  verdict: Verdict;
  /** Text around the first occurrence in the document, for an in-context preview. */
  context?: ContextSnippet;
  /** Which corpus this was checked against. Absent is treated as a case. */
  kind?: CitationKind;
  leads?: SourceItem[];
  caseName?: string;
  court?: string;
  year?: string;
  /** Case-law cluster id (used to build a link + fetch treatment). */
  clusterId?: number;
  /** Full, clickable case URL (relative absolute_url is dead on its own). */
  caseUrl?: string;
  /** Cases that cite this opinion (forward citations / treatment signal). */
  citedByCount?: number;
  /** Statute-only: resolved section label, e.g. "18 U.S.C. § 1030". */
  label?: string;
  /** Statute-only: corpus the section lives in ("usc" | "cfr" | "state"). */
  corpusType?: string;
  /** Statute-only: clickable in-app URL to the resolved section. */
  sectionUrl?: string;
  /**
   * Case-only: good-law (treatment) signal, fetched in a best-effort second
   * pass after the base verdict. Absent until it arrives (or if it fails).
   */
  goodLaw?: CaseStatus;
}

interface Cluster {
  id?: number;
  case_name?: string;
  caseName?: string;
  case_name_short?: string;
  court?: string;
  court_id?: string;
  date_filed?: string;
  absolute_url?: string;
}
interface LookupEntry {
  citation?: string;
  status?: number | string;
  clusters?: Cluster[];
}

/**
 * Backend does not camelCase these fields (no serialization_alias on
 * USCitationsResponse), so they arrive snake_case exactly as serialized.
 */
interface CitationsResponse {
  authority_count?: number;
  cited_by_count?: number;
}

/**
 * Statute resolve payload. This endpoint DOES camelCase its fields
 * (response_model_by_alias=True on ResolveResponse), so they arrive camelCase.
 */
interface ResolveResponse {
  found?: boolean;
  actId?: string;
  corpusType?: string;
  displayLabel?: string;
  sectionNumber?: string;
  url?: string;
}

/** Turn a (relative) in-app path into an absolute link to the Spellhound web app. */
function buildAppUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http")) return url;
  return `${config.appBase}${url.startsWith("/") ? "" : "/"}${url}`;
}

function cleanCourt(court?: string): string | undefined {
  if (!court || court.startsWith("http")) return undefined;
  return court;
}

/**
 * Best-effort forward-citation (treatment) count for a matched case.
 * Returns undefined on any failure so a match is never downgraded by it.
 */
async function fetchCitedByCount(
  clusterId: number,
  signal?: AbortSignal,
): Promise<number | undefined> {
  try {
    const res = await request<CitationsResponse>(`/api/v1/us/case/${clusterId}/citations`, {
      signal,
    });
    const n = res?.cited_by_count;
    return typeof n === "number" && n >= 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Verify a statute / regulation citation ("18 U.S.C. § 1030", "Cal. Civ. Code
 * § 1950.5") against the US statutes corpus. `found` means the citation parsed
 * and resolved to a real section; a false / absent `found` is a possible
 * hallucination or mis-cite for the reviewer to confirm manually.
 */
async function verifyStatute(
  raw: string,
  count: number,
  signal?: AbortSignal,
): Promise<AuthorityResult> {
  try {
    const res = await request<ResolveResponse>(
      `/api/v1/us-statutes/resolve?q=${encodeURIComponent(raw)}`,
      { signal },
    );
    if (res?.found) {
      return {
        raw,
        count,
        kind: "statute",
        verdict: "verified",
        label: res.displayLabel ?? undefined,
        corpusType: res.corpusType ?? undefined,
        sectionUrl: buildAppUrl(res.url),
      };
    }
    return { raw, count, kind: "statute", verdict: "no_match" };
  } catch (e) {
    if (e instanceof ApiError && e.kind === "rate_limited") throw e; // bubble to stop the scan
    if (e instanceof ApiError && e.kind === "not_found")
      return { raw, count, kind: "statute", verdict: "no_match" };
    return { raw, count, kind: "statute", verdict: "error" };
  }
}

export async function verifyCitation(
  raw: string,
  count: number,
  signal?: AbortSignal,
): Promise<AuthorityResult> {
  // Route statute / regulation cites to the statutes corpus; everything else
  // is a case reporter and goes to the case-law lookup.
  if (isStatuteCitation(raw)) return verifyStatute(raw, count, signal);
  if (isCommunity()) {
    const response = await lookup("cases", raw, signal);
    const official = response.items.find(item => item.verifiedReporter);
    if (official) return { raw, count, verdict: "verified", caseName: official.title, caseUrl: official.url };
    switch (response.status) {
      case "found": return { raw, count, verdict: "leads", leads: response.items };
      case "no_match": case "no_passage": case "unsupported": return { raw, count, verdict: "unrecognized" };
      case "rate_limited": throw new ApiError("rate_limited", 429, "Publik search rate limit reached.");
      case "no_credit": throw new ApiError("quota", 402, "Your Publik balance is too low for this search.");
      case "unconfigured": case "key_rejected": throw new ApiError("unauthorized", 401, "Check your Publik search connection.");
      default: throw new ApiError("server", 503, "Publik search is unavailable. Try again later.");
    }
  }
  try {
    const res = await request<LookupEntry[]>(
      `/api/v1/us/citation-lookup?citation=${encodeURIComponent(raw)}`,
      { signal },
    );
    const entry = Array.isArray(res) ? res[0] : undefined;
    if (!entry) return { raw, count, verdict: "unrecognized" };

    const cluster = entry.clusters?.[0];
    // Mirror backend leniency: a non-empty clusters array is a match. Only a
    // parse-only failure (status present AND not 200) is not. status may be
    // absent or stringified, so coerce before comparing.
    const statusOk = entry.status == null || Number(entry.status) === 200;
    if (cluster && statusOk) {
      const clusterId = typeof cluster.id === "number" ? cluster.id : undefined;
      const citedByCount =
        clusterId !== undefined ? await fetchCitedByCount(clusterId, signal) : undefined;
      return {
        raw,
        count,
        verdict: "verified",
        caseName: cluster.case_name ?? cluster.caseName ?? cluster.case_name_short,
        court: cleanCourt(cluster.court ?? cluster.court_id),
        year: (cluster.date_filed ?? "").slice(0, 4) || undefined,
        clusterId,
        caseUrl: clusterId === undefined ? undefined : `${config.appBase}/cases/${clusterId}`,
        citedByCount,
      };
    }
    // Parsed as a citation but no matching case in the corpus: a real
    // possible-hallucination signal for the reviewer.
    return { raw, count, verdict: "no_match" };
  } catch (e) {
    if (e instanceof ApiError && e.kind === "not_found") return { raw, count, verdict: "no_match" };
    if (e instanceof ApiError && e.kind === "rate_limited") throw e; // bubble to stop the scan
    return { raw, count, verdict: "error" };
  }
}

/** Response envelope for the good-law batch endpoint. */
interface CaseStatusBatchResponse {
  results?: CaseStatus[];
}

/**
 * Best-effort good-law (treatment) lookup for a batch of verified case
 * citations. Returns whatever the backend resolved; an empty array on any
 * failure so the base authority check is never disrupted by treatment data.
 */
export async function getCaseStatusBatch(
  citations: string[],
  signal?: AbortSignal,
): Promise<CaseStatus[]> {
  const res = await request<CaseStatusBatchResponse>("/api/v1/citation-status/batch", {
    method: "POST",
    body: { citations },
    signal,
  });
  return res.results ?? [];
}

/**
 * Defined-terms hygiene analysis (client-only, pure text analysis).
 *
 * Flags the three defined-term defects transactional lawyers care about, a
 * marquee contract-review feature (Litera Contract Companion, Spellbook,
 * ContractKen):
 *   - unused:    a term is defined but never used elsewhere (dead definition).
 *   - duplicate: the same term is defined more than once (conflicting defs).
 *   - undefined: a quoted, capitalized term is used but never defined (gap).
 *
 * Precision over recall: the detector only recognizes the standard definition
 * grammars ("X" means..., and parentheticals like (the "X") / (each a "X")), and
 * the "undefined" check requires the term to also appear UNQUOTED so ordinary
 * quotations are not flagged. It is a hygiene aid, not a parser: it will miss
 * exotic definition styles rather than emit noise.
 */

import { termMentions } from "./term-mentions";
import { snippetAroundValue, type ContextSnippet } from "./context-snippet";

export type TermFindingKind = "undefined" | "duplicate" | "unused";

export interface TermFinding {
  term: string;
  kind: TermFindingKind;
  /** Total occurrences of the term in the document (for the detail line). */
  count: number;
  /** For duplicate: how many times it was defined. */
  definitionCount: number;
  /** Text around the first occurrence, for an in-context preview. */
  context?: ContextSnippet;
}

export interface DefinedTermsReport {
  /** Distinct terms recognized as defined. */
  definedCount: number;
  findings: TermFinding[];
}

/** Escape a term for use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Count occurrences of a whole-word term, tolerating a simple plural (s / y->ies).
 *  Case-sensitive: defined terms are proper-cased, and matching case avoids
 *  counting the common lowercase word (e.g. the defined "Party" vs "party").
 *  Uses \b boundaries only (no lookbehind), so it is safe on Safari / WKWebView
 *  hosts (Word on Mac, Word on the web in Safari) where lookbehind can be
 *  unsupported and would throw at RegExp construction. */
function countTermOccurrences(text: string, term: string): number {
  const esc = escapeRe(term);
  let variants = `${esc}s?`;
  if (/y$/.test(term)) variants = `(?:${esc}|${escapeRe(term.slice(0, -1))}ies)`;
  const re = new RegExp(`\\b(?:${variants})\\b`, "g");
  return (text.match(re) ?? []).length;
}

const MAX_PER_BUCKET = 100;

/**
 * Analyze defined-term hygiene. Pure: takes the document text, returns findings.
 * Buckets are ordered by actionability (potential gap first, cleanup last) and
 * each bucket is capped so a pathological document cannot produce an unbounded
 * list.
 */
export function analyzeDefinedTerms(text: string): DefinedTermsReport {
  const defs = new Map<string, number>();
  const quoted = new Map<string, number>();
  for (const { term, defined, blankExhibitAlias } of termMentions(text)) {
    quoted.set(term, (quoted.get(term) ?? 0) + 1);
    if (defined && !(blankExhibitAlias && defs.has(term))) {
      defs.set(term, (defs.get(term) ?? 0) + 1);
    }
  }

  const undefinedF: TermFinding[] = [];
  const duplicateF: TermFinding[] = [];
  const unusedF: TermFinding[] = [];

  // Defined-term checks: duplicate vs unused.
  for (const [term, defCount] of defs) {
    const total = countTermOccurrences(text, term);
    if (defCount >= 2) {
      duplicateF.push({
        term,
        kind: "duplicate",
        count: total,
        definitionCount: defCount,
        context: snippetAroundValue(text, term),
      });
      continue;
    }
    // Defined once: "used" means it appears beyond its single definition site.
    if (total <= 1) {
      unusedF.push({
        term,
        kind: "unused",
        count: total,
        definitionCount: 1,
        context: snippetAroundValue(text, term),
      });
    }
  }

  // Undefined check: a quoted, capitalized token that is never defined but also
  // appears UNQUOTED (so it is used like a defined term, not a stray quotation).
  for (const [token, quotedCount] of quoted) {
    if (defs.has(token)) continue;
    const total = countTermOccurrences(text, token);
    if (total > quotedCount) {
      undefinedF.push({
        term: token,
        kind: "undefined",
        count: total,
        definitionCount: 0,
        context: snippetAroundValue(text, token),
      });
    }
  }

  const byCountDesc = (a: TermFinding, b: TermFinding) => b.count - a.count;
  const findings = [
    ...undefinedF.sort(byCountDesc).slice(0, MAX_PER_BUCKET),
    ...duplicateF.sort(byCountDesc).slice(0, MAX_PER_BUCKET),
    ...unusedF.sort((a, b) => a.term.localeCompare(b.term)).slice(0, MAX_PER_BUCKET),
  ];

  return { definedCount: defs.size, findings };
}

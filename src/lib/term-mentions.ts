// Both the hygiene check and the reading glossary should recognize the same
// definition sites. Test the words immediately around each quoted term so an
// alias in a compound preamble is counted once even if multiple rules match.
const QUOTED = /["“”]([A-Za-z][^"“”]{0,60})["“”]/g;
const VERB_AFTER = /^(?:\(s\))?\s*(?:means|shall\s+mean|(?:shall\s+have|has)\s+the\s+meaning|(?:shall\s+)?refers?\s+to)\b/i;
const PAREN_BEFORE = /\(\s*(?:(?:the|this|an?)\s+|(?:hereinafter,?\s+)?(?:referred\s+to\s+as\s+)?(?:the\s+)?|each,?\s+(?:an?\s+)?)?$/i;
const ALIAS_BEFORE = /\b(?:collectively|together|individually|jointly),?\s+(?:(?:referred\s+to\s+as|known\s+as|called|as)\s+)?(?:the\s+|an?\s+)?$/i;
const EACH_BEFORE = /\b(?:are|is|and)\s+each,?\s+(?:an?\s+)?$/i;

export function* termMentions(text: string) {
  const exhibitStart = text.search(/^[ \t]*(?:exhibit|schedule|annex|appendix)[ \t]+(?:[A-Z]|[IVXLCDM]{2,4}|\d+)\b[ \t]*(?:$|[–—:-])/im);
  for (const match of text.matchAll(QUOTED)) {
    const term = match[1].replace(/\s+/g, " ").replace(/\(s\)$/i, "").replace(/[.,;:]+$/, "").trim();
    if (term.length < 2) continue;
    const index = match.index!;
    const before = text.slice(Math.max(0, index - 100), index);
    const after = text.slice(index + match[0].length, index + match[0].length + 80);
    const capitalized = /^[A-Z]/.test(term);
    const defined = VERB_AFTER.test(after) || (capitalized &&
      (PAREN_BEFORE.test(before) || ALIAS_BEFORE.test(before) || EACH_BEFORE.test(before)));
    // A blank party-identification line in an exhibit form repeats a role
    // from the agreement. It cannot name a competing party while still blank.
    const blankExhibitAlias = exhibitStart >= 0 && index > exhibitStart &&
      /(?:_{2,}|\[(?:name|party name|insert name)\])\s*\(\s*(?:the\s+)?$/i.test(before);
    if (capitalized || defined) yield { term, index, defined, blankExhibitAlias };
  }
}

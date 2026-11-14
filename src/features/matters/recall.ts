import { matters, type Entry, type Matter } from "./api";

// Keep exact filed wording. A derived summary can omit exceptions or supersede
// a date incorrectly. Never let an inferred summary override the user's record.
export function relevantDecisions(entries: Entry[], question: string) {
  const words = new Set(question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu));
  const score = (text: string) => {
    const terms = new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu));
    let total = 0;
    for (const term of terms) if (words.has(term)) total++;
    return total;
  };
  const ranked = entries.filter(e => e.kind === "decision")
    .map(entry => ({entry, rank: 3 * score(entry.title) + score(entry.body)}))
    .sort((a, b) => b.rank - a.rank || b.entry.created.localeCompare(a.entry.created));
  let available = 24000;
  return ranked.flatMap(({entry}) => {
    // Keep decisions intact, including exceptions at the end.
    const size = entry.title.length + entry.body.length;
    if (size > available) return [];
    available -= size;
    return [{title: entry.title, decision: entry.body, saved: entry.created}];
  });
}

export async function recallDecisions(folder: Matter, question: string, signal: AbortSignal) {
  const rows = await matters.decisions(folder.id, signal);
  return { folder: folder.name, decisions: relevantDecisions(rows, question) };
}

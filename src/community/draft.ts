import { uuid } from "@/api/ids";
import { draftGeneratePrompt } from "@/ai/prompts";
import { runJson } from "./llm";

/**
 * Community draft generation: a degraded, single-pass draft against the user's
 * key. It has no corpus or case-law grounding and no quality score (those are
 * the parts that need the hosted backend), but it produces a full, template-shaped
 * first draft. It mimics the durable queue-and-poll flow the UI expects: the
 * generation runs synchronously here, and the resulting row is stored in memory
 * so the poll immediately returns "completed".
 *
 * Grounding uses full document context, not client-side RAG: an uploaded
 * reference is injected whole into the prompt (modern context windows hold it).
 */
interface Section {
  title: string;
  content: string;
}
interface TiptapNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
}

const rows = new Map<string, Record<string, unknown>>();
const references = new Map<string, { text: string; fileName: string; wordCount: number }>();

export function storeReference(
  text: string,
  fileName: string,
): { id: string; fileName: string; wordCount: number } {
  const id = uuid();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  references.set(id, { text, fileName, wordCount });
  return { id, fileName, wordCount };
}

function referenceText(ids: string[]): string {
  return ids
    .map((id) => references.get(id)?.text ?? "")
    .filter(Boolean)
    .join("\n\n");
}

function buildTiptap(title: string, sections: Section[]): TiptapNode {
  const content: TiptapNode[] = title ? [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title.toUpperCase() }] },
  ] : [];
  for (const s of sections) {
    if (s.title) {
      content.push({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: s.title }] });
    }
    if (s.content) {
      content.push({ type: "paragraph", content: [{ type: "text", text: s.content }] });
    }
  }
  return { type: "doc", content };
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

// Enforce a direct one-paragraph request even if the provider returns the
// whole-document schema. "Include a one-paragraph clause" is a constraint on
// a component of a larger draft and deliberately doesn't match.
const PARAGRAPH_UNIT = /(?:a|one|1|single)(?:[ ,-]+(?:single|short|brief|concise))*[ -]+paragraph\b/.source;
const DIRECT_PARAGRAPH = new RegExp(
  String.raw`^(?:please\s+)?(?:(?:draft|write|generate|return|give me|provide|produce)\s+)?` +
  String.raw`(?:(?:in|just|only|exactly|a|short|brief|concise)[ ,]+)*` + PARAGRAPH_UNIT, "i",
);

const FULL_DOCUMENT = /\b(?:full|complete|entire)\s+(?:[\w-]+\s+){0,3}(?:nda|agreement|contract|document)\b/i;

function requestsOneParagraph(brief: string): boolean {
  const direct = DIRECT_PARAGRAPH.exec(brief.trim());
  if (direct) return !/^\s+(?:per|for each|for every)\b/i.test(brief.trim().slice(direct[0].length));
  // A full-document instruction may constrain the size of a subpart.
  if (FULL_DOCUMENT.test(brief)) return false;
  return /\b(?:in|as|limited to)\s+(?:a\s+)?(?:single|one|1)[ -]+paragraph[.!?\s]*$/i.test(brief);
}

function parsedDraft(value: unknown) {
  const raw = (value ?? {}) as { passage?: unknown; sections?: unknown };
  const passage = str(raw.passage).trim();
  const sections: Section[] = Array.isArray(raw.sections)
    ? raw.sections.map((s) => {
        const o = (s ?? {}) as Record<string, unknown>;
        return { title: str(o.title), content: str(o.content).trim() };
      }).filter((s) => s.content)
    : [];
  return { passage, sections };
}

function isSingleParagraph({ passage, sections }: ReturnType<typeof parsedDraft>): boolean {
  return Boolean(passage) && !/[\r\n\u2028\u2029]/.test(passage) && sections.length === 0;
}

export async function startDraft(body: Record<string, unknown>): Promise<{ draftId: string; status: string }> {
  const category = str(body.category, "custom");
  const title = str(body.title, "Untitled draft");
  const refIds = Array.isArray(body.reference_document_ids)
    ? body.reference_document_ids.filter((x): x is string => typeof x === "string")
    : [];

  const instructions = str(body.special_instructions);
  const oneParagraph = requestsOneParagraph(instructions) || (!FULL_DOCUMENT.test(instructions) && requestsOneParagraph(title));
  const p = draftGeneratePrompt(
    category,
    title,
    str(body.tone, "balanced"),
    str(body.governing_law_state),
    instructions,
    referenceText(refIds),
    oneParagraph,
  );
  let draft = parsedDraft(await runJson(p.system, p.user));
  if (oneParagraph && !isSingleParagraph(draft)) {
    const retry = p.user + '\n\nReturn only {"passage":"..."} containing the requested single paragraph on one line.';
    draft = parsedDraft(await runJson(p.system, retry));
    if (!isSingleParagraph(draft)) {
      throw new Error("The model did not return the requested single paragraph. Please try again.");
    }
  }
  const { passage } = draft;
  const sections = passage ? [{ title: "", content: passage }] : draft.sections;
  if (!sections.length) throw new Error("The model returned an empty draft. Please try again.");

  const draftId = uuid();
  rows.set(draftId, {
    id: draftId,
    title,
    category,
    content: buildTiptap(passage ? "" : title, sections),
    metadata: passage ? { scope: "passage" } : {},
    generationStatus: "completed",
    generationProgress: { status: "completed", stepIndex: sections.length, totalSteps: sections.length },
    generationError: null,
  });
  return { draftId, status: "completed" };
}

export function getDraftRow(id: string): Record<string, unknown> | undefined {
  return rows.get(id);
}

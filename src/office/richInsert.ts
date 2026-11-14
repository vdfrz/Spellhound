/**
 * Insert formatted content into the document using HTML. Word converts inserted
 * HTML into native headings, paragraphs, and bold runs, so generated drafts and
 * clauses look like authored Word content instead of flat pasted text.
 */
import { resolveAfterAnchor } from "./anchor";
import { runWord, serializeTrackChanges } from "./run";
import { sampleInsertionFont, matchInsertedFont } from "./font";
import { inheritListNumbering } from "./lists";

interface DraftSection {
  title: string;
}

interface Draft {
  scope?: "passage";
  title: string;
  sections: DraftSection[];
  fullText: string;
}

/** Insert complete Word paragraphs so a draft cannot become part of an existing heading. */
export async function insertDraftFormatted(draft: Draft): Promise<void> {
  const blocks = clauseBlocks(draft.fullText).filter(Boolean);
  const hasTitle = draft.scope !== "passage" && Boolean(draft.title.trim());
  if (hasTitle) blocks.unshift(draft.title.trim());
  if (!blocks.length) return;

  const sectionTitles = new Set(draft.sections.map((section) => section.title.trim().toLowerCase()));
  return runWord(async (context) => {
    const font = await sampleInsertionFont(context);
    let anchor = await resolveAfterAnchor(context);
    let first: Word.Paragraph | undefined;
    let last: Word.Paragraph | undefined;
    for (const [index, block] of blocks.entries()) {
      const paragraph: Word.Paragraph = anchor.insertParagraph(block, Word.InsertLocation.after);
      let style = Word.BuiltInStyleName.normal;
      if (hasTitle && index === 0) style = Word.BuiltInStyleName.heading1;
      else if (sectionTitles.has(block.toLowerCase())) style = Word.BuiltInStyleName.heading2;
      paragraph.styleBuiltIn = style;
      if (font.name) paragraph.font.name = font.name;
      if (font.size && style === Word.BuiltInStyleName.normal) paragraph.font.size = font.size;
      first ??= paragraph;
      last = paragraph;
      anchor = paragraph;
    }
    if (first && last) {
      first.getRange(Word.RangeLocation.content).expandTo(last.getRange(Word.RangeLocation.content)).select();
    }
    await context.sync();
  });
}

/** Split clause text into non-empty paragraph blocks (blank-line delimited). */
function clauseBlocks(text: string): string[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return blocks.length > 0 ? blocks : [text.trim()];
}

/**
 * Insert a standalone clause (e.g. a playbook position / fallback rung) as a
 * clean tracked insertion, on its own paragraph(s) immediately after the
 * paragraph the cursor sits in.
 *
 * Deliberately NOT a word-level diff-replace (unlike replaceSelectionTracked):
 * a playbook rung is standalone reference language, so diffing it against
 * whatever text happens to be selected interleaves the two into unreadable
 * garbage. Inserting whole paragraphs after the current one is non-destructive
 * (it never overwrites the selection) and never splits a word mid-token.
 */
export async function insertClauseTracked(text: string): Promise<void> {
  const blocks = clauseBlocks(text);
  return serializeTrackChanges(() => runWord(async (context) => {
    const doc = context.document;
    doc.load("changeTrackingMode");
    await context.sync();

    // Table-aware anchor (never inserts inside a table cell). Resolved BEFORE the
    // mode flip since it is read-only.
    const anchor = await resolveAfterAnchor(context);

    const priorMode = doc.changeTrackingMode;
    try {
      // Commit the mode flip on its own sync BEFORE inserting, or Word may record
      // the insert as an untracked edit (the "tracked insertion" never appears).
      doc.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
      await context.sync();
      const inserted: Word.Paragraph[] = [];
      let cursor: Word.Paragraph | undefined;
      for (const block of blocks) {
        cursor = cursor
          ? cursor.insertParagraph(block, Word.InsertLocation.after)
          : anchor.insertParagraph(block, Word.InsertLocation.after);
        inserted.push(cursor);
      }
      cursor?.select();
      await context.sync();
      // Join the anchor's numbered list so the contract renumbers natively
      // rather than the inserted clause breaking the outline.
      await inheritListNumbering(context, anchor, inserted);
    } finally {
      // Best-effort restore so a broken context can't mask the original error.
      try {
        doc.changeTrackingMode = priorMode;
        await context.sync();
      } catch {
        // original error (if any) propagates
      }
    }
  }));
}

/**
 * Insert a passage (a heading line plus the body split into paragraphs) at the
 * user's cursor as a tracked change, and select it so Word scrolls it into view.
 * Used by Research to drop a statute section / quote where the caret sits, rather
 * than at the document end. Change-tracking mode is saved and restored.
 */
export async function insertPassageAtCursor(heading: string, text: string): Promise<void> {
  const body = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return serializeTrackChanges(() =>
    runWord(async (context) => {
      const doc = context.document;
      doc.load("changeTrackingMode");
      await context.sync();

      // Table-aware anchor (never inserts inside a table cell).
      const anchor = await resolveAfterAnchor(context);

      const priorMode = doc.changeTrackingMode;
      try {
        // Commit the mode flip before inserting so the insert is tracked.
        doc.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
        await context.sync();
        const head = anchor.insertParagraph(heading, Word.InsertLocation.after);
        // Bold, NOT Word's Heading 3 style: a real heading gets a collapse
        // caret, joins the Navigation pane, and lands in any table of contents,
        // so dropping in a statute passage or a library clause would restructure
        // the lawyer's document's outline as a side effect.
        head.font.bold = true;
        let cursor: Word.Paragraph = head;
        for (const block of body.length ? body : [text]) {
          cursor = cursor.insertParagraph(block, Word.InsertLocation.after);
        }
        head.select();
        await context.sync();
      } finally {
        try {
          doc.changeTrackingMode = priorMode;
          await context.sync();
        } catch {
          // original error (if any) propagates
        }
      }
    }),
  );
}

/**
 * Insert pre-built, already-safe HTML at the user's cursor as a tracked change,
 * and select it so Word scrolls it into view. The caller is responsible for
 * escaping any text content in `html` (see markdownToSafeHtml in Research).
 */
export async function insertHtmlAtCursor(html: string): Promise<void> {
  return serializeTrackChanges(() =>
    runWord(async (context) => {
      const doc = context.document;
      doc.load("changeTrackingMode");
      await context.sync();

      // Sample before the insert so the inserted HTML matches the doc's font.
      const font = await sampleInsertionFont(context);
      const priorMode = doc.changeTrackingMode;
      try {
        // Commit the mode flip before inserting so the insert is tracked.
        doc.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
        await context.sync();
        const range = doc.getSelection().insertHtml(html, Word.InsertLocation.after);
        range.select();
        await context.sync();
        await matchInsertedFont(context, range, font);
      } finally {
        try {
          doc.changeTrackingMode = priorMode;
          await context.sync();
        } catch {
          // original error (if any) propagates
        }
      }
    }),
  );
}

/**
 * Insert a missing clause (a name plus its body) as a tracked change, on its own
 * paragraphs immediately after the paragraph the cursor sits in. Change-tracking
 * mode is saved and restored around the insert (mirroring redline.ts) so we
 * never leave the document stuck in track-all.
 *
 * Two things this deliberately does NOT do, both of which it used to:
 *  - It does not append at the BODY END. A missing clause accepted from a review
 *    belongs where the reviewer is working, not after the signature block and
 *    exhibits, outside the operative agreement.
 *  - It does not emit an <h2>. A real Word Heading style gets a collapse caret,
 *    joins the Navigation pane, and lands in any table of contents, so accepting
 *    one redline silently restructured the contract's outline. The clause name is
 *    bold text instead.
 *
 * Mirrors insertClauseTracked, which already had this right.
 */
export async function insertClauseFormatted(
  clauseName: string,
  text: string,
  opts: { tracked?: boolean } = {},
): Promise<void> {
  // `tracked` (default) inserts the clause as a reviewable tracked change; pass
  // tracked:false for a clean insert (change tracking forced off for the edit).
  const tracked = opts.tracked ?? true;
  const blocks = clauseBlocks(text);
  return serializeTrackChanges(() => runWord(async (context) => {
    const doc = context.document;
    doc.load("changeTrackingMode");
    await context.sync();

    // Table-aware anchor (never inserts inside a table cell). Resolved BEFORE the
    // mode flip since it is read-only.
    const anchor = await resolveAfterAnchor(context);

    const priorMode = doc.changeTrackingMode;
    try {
      // Commit the mode flip before inserting so the insert is tracked (or the
      // clean insert is genuinely untracked) rather than racing in one batch.
      doc.changeTrackingMode = tracked ? Word.ChangeTrackingMode.trackAll : Word.ChangeTrackingMode.off;
      await context.sync();

      const head = anchor.insertParagraph(clauseName, Word.InsertLocation.after);
      head.font.bold = true;
      let cursor: Word.Paragraph = head;
      for (const block of blocks) {
        cursor = cursor.insertParagraph(block, Word.InsertLocation.after);
      }
      head.select();
      await context.sync();
      // Only the clause NAME joins the anchor's numbering, so the clause takes
      // the next number and the contract renumbers natively. The body must stay
      // out of the list or each body paragraph would take a clause number too.
      await inheritListNumbering(context, anchor, [head]);
    } finally {
      try {
        doc.changeTrackingMode = priorMode;
        await context.sync();
      } catch {
        // original error (if any) propagates
      }
    }
  }));
}

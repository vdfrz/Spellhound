/** Escape the three HTML-significant characters in text content. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Apply inline emphasis (**bold**) on already-escaped text. */
function inlineMarkdown(escaped: string): string {
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/** How a markdown heading should land in the document. */
export interface MarkdownHtmlOptions {
  /**
   * "heading" emits real <h2>..<h4>, which Word maps to its Heading styles.
   * "bold" emits a bold paragraph instead. Use "bold" when dropping text into
   * SOMEONE ELSE'S document (an assistant answer inserted into a contract):
   * Word Heading styles get a collapse caret, join the Navigation pane, and
   * show up in a table of contents, which silently restructures their file.
   */
  headings?: "heading" | "bold";
  /**
   * "native" emits <ul>/<ol>, which Word turns into real list items (List
   * Paragraph style, folded into the surrounding numbering scheme). "plain"
   * emits paragraphs with a literal marker. Same reasoning as `headings`: use
   * "plain" for reference text dropped into someone else's document, where a
   * native list can disturb the document's own numbering.
   */
  lists?: "native" | "plain";
}

/**
 * Convert the brief's IRAC markdown to safe HTML for a Word insert: headings,
 * bold, bullet/numbered lists, and paragraphs. All text content is escaped
 * first, so only the structural tags we emit are markup (no injection).
 */
export function markdownToSafeHtml(md: string, opts: MarkdownHtmlOptions = {}): string {
  const headingMode = opts.headings ?? "heading";
  const listMode = opts.lists ?? "native";
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let para: string[] = [];
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inlineMarkdown(escapeHtml(para.join(" ")))}</p>`);
      para = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushPara();
      closeList();
      const text = inlineMarkdown(escapeHtml(heading[2]));
      if (headingMode === "bold") {
        out.push(`<p><strong>${text}</strong></p>`);
      } else {
        const level = Math.min(heading[1].length + 1, 4);
        out.push(`<h${level}>${text}</h${level}>`);
      }
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const numbered = line.match(/^(\d+)\.\s+(.*)$/);
    if (bullet || numbered) {
      flushPara();
      const itemText = inlineMarkdown(escapeHtml(bullet ? bullet[1] : numbered![2]));
      if (listMode === "plain") {
        closeList();
        out.push(`<p>${bullet ? "&#8226; " : `${numbered![1]}. `}${itemText}</p>`);
        continue;
      }
      const t = bullet ? "ul" : "ol";
      if (listType !== t) {
        closeList();
        out.push(`<${t}>`);
        listType = t;
      }
      out.push(`<li>${itemText}</li>`);
      continue;
    }
    para.push(line);
  }
  flushPara();
  closeList();
  return out.join("");
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateDraftQueued } from "@/api/drafting";
import { storeReference } from "./draft";
import { insertDraftFormatted } from "@/office/richInsert";
import { runJson } from "./llm";

vi.mock("./llm", () => ({ runJson: vi.fn() }));

const nda = {
  sections: [
    { title: "Purpose", content: "The parties may exchange information." },
    { title: "Term", content: "Confidentiality obligations last two years." },
  ],
};
const paragraph = "Either party may deliver a notice by email within five days.";
const params = { category: "nda", title: "Mutual NDA", specialInstructions: "Draft one paragraph on notices." };

describe("Draft generation through the queue and preview path", () => {
  beforeEach(() => vi.mocked(runJson).mockReset());

  it("recovers if the model returns a whole agreement for a one-paragraph request", async () => {
    vi.mocked(runJson).mockResolvedValueOnce(nda).mockResolvedValueOnce({ passage: paragraph });
    const ref = storeReference("All notices must be emailed within five days.", "fictional.txt");
    const result = await generateDraftQueued({ ...params, referenceDocumentIds: [ref.id] });
    expect(runJson).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runJson).mock.calls[1][1]).toContain("emailed within five days");
    expect(result).toMatchObject({ scope: "passage", fullText: paragraph, sections: [{ title: "", content: paragraph }] });
    const select = vi.fn();
    const range = { expandTo: vi.fn(() => ({ select })), select };
    const inserted = { getRange: vi.fn(() => range), styleBuiltIn: "", font: {} };
    const anchor = {
      insertParagraph: vi.fn(() => inserted),
      parentTableOrNullObject: { load: vi.fn(), isNullObject: true },
    };
    const document = { getSelection: () => ({ paragraphs: { load: vi.fn(), items: [anchor] } }) };
    vi.stubGlobal("Word", {
      run: (fn: Function) => fn({ document, sync: vi.fn() }),
      InsertLocation: { after: "After" },
      RangeLocation: { content: "Content" },
      BuiltInStyleName: { normal: "Normal" },
    });
    try {
      await insertDraftFormatted(result);
      expect(anchor.insertParagraph).toHaveBeenCalledExactlyOnceWith(paragraph, "After");
      expect(inserted.styleBuiltIn).toBe("Normal");
      expect(select).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ["Mutual NDA", "Please write a single short paragraph."],
    ["Mutual NDA", "In one paragraph, describe email delivery."],
    ["Mutual NDA", "Write a brief paragraph for notices."],
    ["One-paragraph notice clause", "Use a five-day deadline."],
  ])("rejects multi-paragraph output for %s / %s", async (title, specialInstructions) => {
    vi.mocked(runJson).mockResolvedValue({ passage: "Opening recital.\n\nSignatures follow." });
    await expect(generateDraftQueued({ ...params, title, specialInstructions }))
      .rejects.toThrow(/paragraph/i);
    expect(runJson).toHaveBeenCalledTimes(2);
  });

  it.each([
    "Draft a complete NDA with a one-paragraph notice provision.",
    "Write a full agreement. Summarize each obligation in a single paragraph.",
    "Draft one paragraph per section of the NDA.",
  ])("keeps a complete document for %s", async (specialInstructions) => {
    vi.mocked(runJson).mockResolvedValueOnce(nda);
    const result = await generateDraftQueued({ ...params, specialInstructions });
    expect(result.fullText).toContain("MUTUAL NDA");
    expect(result.sections.map((s) => s.title)).toEqual(["Purpose", "Term"]);
    expect(runJson).toHaveBeenCalledTimes(1);
  });

  it("preserves a scoped request for a two-paragraph clause", async () => {
    const passage = paragraph + "\n\nThe recipient must acknowledge receipt.";
    vi.mocked(runJson).mockResolvedValue({ passage });
    const result = await generateDraftQueued({ ...params, specialInstructions: "Write just the notices clause in two paragraphs." });
    expect(result.fullText).toBe(passage);
  });
});

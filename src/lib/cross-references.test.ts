import { describe, expect, it, vi } from "vitest";
import { actOnReference } from "@/office/structure";
import { analyzeCrossReferences } from "./cross-references";
import { resolveReference } from "./xrefResolve";

const amendment = [
  "1. Purpose", "2. Payment", "3. Notices", "Schedule A — Fees",
  "Section 9 of the Original Agreement is amended.",
  "The deadline in Section 8.2(b) of the Original Agreement still applies.",
  "Original Agreement, Section 2 is incorporated.",
  "See Sections 12(a) and 13 of the Original Agreement.",
  "See Section 15 (License) of the Original Agreement.",
  "See Section 18 of the Original Agreement and Section 18 of this Amendment.",
  "See Exhibit C to the Original Agreement.",
  "See Section 9 of this Amendment and Exhibit C.",
  "See Section 7 of the Agreement and 18 U.S.C. § 1030.",
].map((text) => ({ text, listString: null }));

describe("references in an amendment", () => {
  it("counts only internal dangling references even if the same labels appear externally", () => {
    const report = analyzeCrossReferences(amendment);
    expect(report.sectionCount).toBe(3);
    expect(report.scheduleCount).toBe(1);
    const [hit] = report.broken.find((ref) => ref.label === "Section 18")!.occurrences;
    expect(hit.paragraphText.slice(hit.offset)).toBe("Section 18 of this Amendment.");
    expect(report.broken.map(({ label, count }) => [label, count])).toEqual([
      ["Section 18", 1], ["Section 9", 1], ["Exhibit C", 1], ["Section 7", 1],
    ]);
  });

  it("acts only on the internal occurrence and detects a stale paragraph", async () => {
    const [hit] = analyzeCrossReferences(amendment).broken.find((ref) => ref.label === "Section 18")!.occurrences;
    const external = { select: vi.fn(), insertComment: vi.fn() };
    const internal = { select: vi.fn(), insertComment: vi.fn() };
    const search = vi.fn(() => ({ load: vi.fn(), items: [external, internal] }));
    const items = amendment.map(({ text }) => ({ text, search }));
    const document = { body: { paragraphs: { items, load: vi.fn() } } };
    vi.stubGlobal("Word", { run: (fn: Function) => fn({ document, sync: vi.fn() }), SelectionMode: { select: "Select" } });
    try {
      expect(await actOnReference(hit)).toBe(true);
      expect(await actOnReference(hit, "Missing target")).toBe(true);
      expect(internal.select).toHaveBeenCalledOnce();
      expect(internal.insertComment).toHaveBeenCalledWith("Missing target");
      expect(external.select).not.toHaveBeenCalled();
      expect(external.insertComment).not.toHaveBeenCalled();
      items[hit.paragraphIndex].text += " Updated.";
      expect(await actOnReference(hit, "Stale")).toBe(false);
      expect(internal.insertComment).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not navigate to local numbers mentioned in an external reference", () => {
    expect(resolveReference(amendment, "Section 2 of the Original Agreement")).toBeNull();
    expect(resolveReference(amendment, "Original Agreement, Section 2")).toBeNull();
    expect(resolveReference(amendment, "Section 9")).toBeNull();
    expect(resolveReference(amendment, "Exhibit C")).toBeNull();
    expect(resolveReference(amendment, "Section 2 of this Amendment")?.targetText).toBe("2. Payment");
  });
});

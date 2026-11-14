import { describe, expect, it, vi } from "vitest";
import { verifyCitation } from "./authority";
import { lookup, type SourceItem } from "./research";

vi.mock("./research", () => ({ lookup: vi.fn() }));
const item: SourceItem = {
  title: "Example opinion", citation: "347 U.S. 483", url: "https://example.org/opinion",
  passage: "A case is mentioned.", treatment: "unknown",
};

describe("Publik case lookup", () => {
  it("keeps a mention unverified and exposes the result for inspection", async () => {
    vi.mocked(lookup).mockResolvedValue({status: "found", items: [item]});
    const signal = new AbortController().signal;
    const result = await verifyCitation(item.citation, 2, signal);
    expect(lookup).toHaveBeenCalledWith("cases", item.citation, signal);
    expect(result).toMatchObject({verdict: "leads", leads: [item]});
  });
  it("accepts the independently verified reporter record", async () => {
    vi.mocked(lookup).mockResolvedValue({status: "found", items: [{...item, verifiedReporter: true}]});
    expect(await verifyCitation(item.citation, 1)).toMatchObject({verdict: "verified", caseUrl: item.url});
  });
  it("stops on exhausted credit instead of treating the citation as missing", async () => {
    vi.mocked(lookup).mockResolvedValue({status: "no_credit", items: []});
    await expect(verifyCitation(item.citation, 1)).rejects.toMatchObject({kind: "quota"});
  });
});

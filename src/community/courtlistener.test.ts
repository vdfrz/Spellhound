import { afterEach, expect, it, vi } from "vitest";
import { searchCitation } from "./courtlistener";
vi.mock("@/ai/keys", () => ({ getCourtListenerToken: () => "test-only" }));
afterEach(() => vi.unstubAllGlobals());
it("accepts the case's own citation, not a decision mentioning it or an ambiguous match", async () => {
  const row = {cluster_id: 1, caseName: "Example", citation: ["347 U.S. 483"]};
  for (const [count, rows, expected] of [
    [1, [row], 1], [1, [{...row, citation:["123 F.2d 321"]}], 0], [2, [row, row], 0],
  ] as const) {
    vi.stubGlobal("fetch", async (url: string) => {
      expect(new URL(url).searchParams.get("q")).toBe('citation:"347 US 483"');
      return Response.json({count, results:rows});
    });
    expect((await searchCitation("347 US 483"))[0]?.clusters.length ?? 0).toBe(expected);
  }
});

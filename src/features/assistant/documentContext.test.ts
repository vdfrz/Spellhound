import { describe, expect, it } from "vitest";
import { references, reviewDiscussion } from "./documentContext";

describe("Ask to Edit handoff", () => {
  it("retains the user's correction and reference filename, omitting unfinished replies", () => {
    const history = reviewDiscussion([
      { role:"user", content:"Compare the release", attachments:[{name:"Original contract.docx"}] },
      { role:"assistant", content:"Delete clause 7?" },
      { role:"user", content:"Keep clause 7. Narrow only clause 8." },
      { role:"assistant", content:"Unfinished proposal", pending:true },
    ]);
    expect(history.map(m => m.content)).toEqual(["Compare the release","Delete clause 7?","Keep clause 7. Narrow only clause 8."]);
    expect(history[0].references).toEqual(["Original contract.docx"]);
  });
  it("allocates space to both references when the first is long", () => {
    const files = references([{name:"Old agreement",text:"a".repeat(48000)},{name:"Amendment",text:"Payment in 30 days"}]);
    expect(files[0].text.length).toBeLessThan(24000);
    expect(files[1]).toEqual({name:"Amendment",text:"Payment in 30 days"});
  });
});

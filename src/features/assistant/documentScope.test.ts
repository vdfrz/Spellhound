import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindInstallation } from "@/auth/publik";
import { conversationScope, linkedFolder, resolveDocumentScope, setLinkedFolder } from "./documentScope";
import { deleteConversation, getConversation, listConversations, saveConversation } from "./chatHistoryStore";
import { recallDecisions } from "@/features/matters/recall";

const values = new Map<string, string>();
const folderA = {id: "a".repeat(32), name: "Deal"};
const folderB = {id: "b".repeat(32), name: "Deal"};
function open(path: string, settings: Map<string, string>) {
  vi.stubGlobal("Office", {context: {document: {url: path, settings: {
    get: (key: string) => settings.get(key),
    set: (key: string, value: string) => settings.set(key, value),
    saveAsync: (done: () => void) => done(),
  }}}});
  return resolveDocumentScope();
}
beforeEach(() => {
  values.clear();
  bindInstallation("qa");
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Word document and deal scope", () => {
  it("reopens one file and keeps copies, same-named files, and replacement files separate", async () => {
    const settings = new Map<string, string>();
    const path = "file:///A/Agreement.docx";
    const first = await open(path, settings);
    expect(await open(path, settings)).toBe(first);
    const copy = await open("file:///B/Agreement.docx", new Map(settings));
    const replacement = await open(path, new Map());
    expect(new Set([first, copy, replacement]).size).toBe(3);
    setLinkedFolder(first, folderA);
    expect(linkedFolder(first)).toEqual(folderA);
    expect(linkedFolder(copy)).toBeNull();

    const firstChat = conversationScope(first, folderA);
    const record = {id:"one", title:"A decision", messages:[], updatedAt:1};
    values.set("spellhound.qa.vaquill.chatHistory", JSON.stringify([record]));
    expect(listConversations(firstChat)).toEqual([]);
    saveConversation(firstChat, record);
    for (const other of [conversationScope(copy, folderA), conversationScope(first, folderB)]) {
      expect(listConversations(other)).toEqual([]);
      expect(getConversation(other, record.id)).toBeNull();
      deleteConversation(other, record.id);
    }
    expect(getConversation(firstChat, record.id)).toEqual(record);
    setLinkedFolder(first, null);
    expect(linkedFolder(first)).toBeNull();
  });

  it("reads only decisions for the linked folder and retains their exact limitations", async () => {
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify([
      {kind:"note", title:"unconfirmed", body:"90 days"},
      {kind:"decision", title:"Timing", body:url.includes(folderA.id) ? "15 days except holidays" : "45 days", created:"2026-01-01"},
    ])));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    for (const [folder, expected] of [[folderA, "15 days except holidays"], [folderB, "45 days"]] as const) {
      const result = await recallDecisions(folder, "What did we agree on timing?", signal);
      expect(result.decisions.map(d => d.decision)).toEqual([expected]);
      expect(fetch).toHaveBeenLastCalledWith("/spellhound/matters/" + folder.id + "/entries?kind=decision", expect.objectContaining({signal}));
    }
  });
});

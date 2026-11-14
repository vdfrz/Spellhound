import { afterEach, beforeEach, expect, it, vi } from "vitest";

// A second pane signs in as a different installation in the SAME browser profile.
// All browser storage survives, and a module reload simulates the new pane.
const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", { getItem:(k:string)=>values.get(k) ?? null,
    setItem:(k:string,v:string)=>values.set(k,v), removeItem:(k:string)=>values.delete(k) });
  vi.stubGlobal("window", {location:{reload:vi.fn()}, dispatchEvent:vi.fn()});
  vi.resetModules();
});
afterEach(()=>vi.unstubAllGlobals());

it("a fresh installation cannot read earlier provider keys, rules or unsuffixed legacy data", async()=>{
  const first = await import("./publik");
  first.bindInstallation("first");
  const a = await import("@/ai/keys");
  const rules = await import("@/lib/clientRules");
  a.setKey("openai","fixture-value"); rules.setClientRules("fixture",["synthetic rule"]);
  values.set("vaquill.byok.openai.key","old-fixture");
  expect(a.getKey("openai")).toBe("fixture-value");

  vi.resetModules();
  const second = await import("./publik"); second.bindInstallation("second");
  const b = await import("@/ai/keys");
  expect(b.getKey("openai")).toBeNull();
  expect((await import("@/lib/clientRules")).getClientRules("fixture")).toEqual([]);
  expect(() => second.bindInstallation("first")).toThrow(/changed/);
});

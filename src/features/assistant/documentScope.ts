import { uuid } from "@/api/ids";
import { storageName } from "@/auth/publik";
import type { Matter } from "@/features/matters/api";

const DOCUMENT_ID = "spellhound.document.id.v1";

// A copy made with Save As inherits document settings. Include the path so the
// copy cannot inherit the source's local chats or deal. A replacement at the
// same location has a new document id. Only an opaque digest is stored locally.
export async function resolveDocumentScope(): Promise<string> {
  const doc = Office.context.document;
  const path = doc.url || "";
  let id = doc.settings?.get(DOCUMENT_ID);
  if (typeof id !== "string" || !id) {
    id = uuid();
    try {
      doc.settings.set(DOCUMENT_ID, id);
      await new Promise<void>(resolve => doc.settings.saveAsync(() => resolve()));
    } catch { /* Read-only files may keep an identity only for this pane. */ }
  }
  const bytes = new TextEncoder().encode(JSON.stringify([path, id]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

export function folderStorageKey(document: string) {
  return storageName("assistant.document." + document + ".folder");
}

export function linkedFolder(document: string): Matter | null {
  try {
    const value = JSON.parse(localStorage.getItem(folderStorageKey(document)) || "null");
    return value && /^[a-f0-9]{32}$/.test(value.id) && typeof value.name === "string" ? value : null;
  } catch { return null; }
}

export function setLinkedFolder(document: string, folder: Matter | null) {
  const key = folderStorageKey(document);
  if (folder) localStorage.setItem(key, JSON.stringify(folder));
  else localStorage.removeItem(key);
}

export function conversationScope(document: string, folder: Matter | null) {
  return document + "." + (folder?.id ?? "unfiled");
}

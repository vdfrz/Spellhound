export interface ReferenceFile {
  name: string;
  text: string;
}

export function targetName(): string {
  const url = Office.context.document.url || "";
  const name = url.split(/[\\/]/).pop()?.split("?")[0];
  if (!name) return "Unsaved Word document";
  try { return decodeURIComponent(name); } catch { return name; }
}

// Each attachment gets space even if the first reference is a long agreement.
export function references(files: ReferenceFile[]): ReferenceFile[] {
  const chars = Math.floor(24000 / Math.max(files.length, 1));
  return files.map(({ name, text }) => ({ name, text: text.slice(0, chars) }));
}

export function reviewDiscussion(messages: { role: string; content: string; pending?: boolean; attachments?: {name:string}[] }[]) {
  return messages.filter(m => !m.pending && m.content.trim()).slice(-24).map(m => ({
    role: m.role, content: m.content.slice(-3000), references: m.attachments?.map(a => a.name),
  }));
}

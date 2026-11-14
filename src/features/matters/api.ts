export type Kind = 'reference' | 'note' | 'decision';
export interface Matter { id: string; name: string }
export interface Entry { id: string; kind: Kind; title: string; body: string; created: string }
export interface Experience { id: string; title: string; body: string }
const base = '/spellhound/matters';

async function request<T>(path: string, body?: object): Promise<T> {
  const r = await fetch(base + path, { credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    ...(body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!r.ok) {
    const error = await r.json().catch(() => null);
    throw new Error(error?.error ?? 'Your deal folders are unavailable.');
  }
  return r.json();
}
export const matters = {
  list: () => request<Matter[]>(''),
  create: (name: string) => request<Matter>('', { name }),
  entries: (id: string) => request<Entry[]>(`/${id}/entries`),
  file: (id: string, kind: Kind, title: string, body: string) => request<Entry>(`/${id}/entries`, {kind, title, body}),
  memory: (id: string, decisionId?: string) => request<Experience[]>(`/${id}/memory`, decisionId ? {decisionId} : undefined),
};

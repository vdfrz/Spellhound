import { clearAllProviderKeys, isConfigured } from "@/ai/keys";
import { hosted, session } from "./publik";

// The document UI needs a local display profile, not an account identifier.
// The hosted root mounts it only after the server verifies the installation.
export interface User { email?: string; user_metadata: Record<string, string> }
const profile: User = { user_metadata:{} };
type Listener = (user: User | null) => void;
const listeners = new Set<Listener>();
export function getUser() { return isConfigured() ? profile : null; }
export function notifyCommunityAuth() { for (const listener of listeners) listener(getUser()); }
export function subscribe(listener: Listener) {
  listeners.add(listener);
  listener(getUser());
  return () => { listeners.delete(listener); };
}
export async function clearSession() {
  if (hosted) {
    const response = await session("end").catch(()=>null);
    if (!response || !(response.ok || [401,409].includes(response.status))) {
      window.alert("Sign-out failed. Retry while connected."); return;
    }
  }
  clearAllProviderKeys();
  window.location.reload();
}

// The legacy transport interface cannot obtain bearer tokens in Spellhound.
export async function getAccessToken(): Promise<string|null> { return null; }
export const refresh = getAccessToken;

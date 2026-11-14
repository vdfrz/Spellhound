// This is a storage namespace and a stale-pane check, never a login credential.
let installation: string | undefined;
export const hosted = import.meta.env.MODE !== "community";
export function bindInstallation(id: string) {
  if (!id || (installation && installation !== id)) {
    window.location.reload();
    throw Error("Your Word session changed. Reopen the pane.");
  }
  installation = id;
}
export function storageName(name: string) {
  if (!hosted) return name;
  if (!installation) throw Error("Sign in with Publik.");
  return "spellhound." + installation + "." + name;
}
export function installHeaders(): Record<string, string> {
  return installation ? { "X-Spellhound-Install": installation } : {};
}
export function paymentSettings() { window.dispatchEvent(new Event("spellhound:payment")); }
export async function session(action: string, signal?: AbortSignal) {
  return fetch("/spellhound/session/" + action, {method:"POST", headers:installHeaders(), signal, cache:"no-store"});
}
export async function verifyInstallation(signal?: AbortSignal) {
  if (!hosted) return;
  const response = await session("status", signal);
  const status = response.ok ? await response.json() : null;
  if (!status?.claimed || !installation || status.installId !== installation) {
    window.dispatchEvent(new Event("spellhound:recheck"));
    throw Error("Check your Publik sign-in before continuing.");
  }
}

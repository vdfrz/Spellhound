import { useEffect, useState } from "react";
import { session } from "@/auth/publik";

let enabledForPane = false;
export function updateUsagePreference(enabled: boolean) { enabledForPane = enabled; }
export function sendUsage(event: "app_opened" | "active_session") {
  if (enabledForPane && navigator.doNotTrack !== "1") void session(event).catch(() => {});
}
export function UsageChoice() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    session("status", c.signal).then(async r => {
      if (!r.ok) throw Error();
      const state = await r.json();
      setEnabled(state.usageEnabled); setBusy(false);
    }).catch(()=>{ if (!c.signal.aborted) setError("Could not load your usage preference. Reopen Settings to retry."); });
    return () => c.abort();
  },[]);
  async function change(on: boolean) {
    setBusy(true); setError("");
    try {
      if (!(await session("usage/" + (on ? "on" : "off"))).ok) throw Error();
      setEnabled(on); updateUsagePreference(on);
    } catch { setError("Could not save your preference. Retry."); }
    finally { setBusy(false); }
  }
  return <div><label><input type="checkbox" checked={enabled && navigator.doNotTrack !== "1"} disabled={busy || navigator.doNotTrack === "1"}
    onChange={e => void change(e.target.checked)} /> Share usage counts with Publik</label>
    <p className="small muted">Optional. Reports when the pane opens and every 30 minutes it stays active, with a random installation ID, app version and operating system. No document or prompt is included.</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}

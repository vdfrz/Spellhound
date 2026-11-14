import { useEffect, useState, type ReactNode } from "react";
import { Header } from "@/ui/Header";
import { Button } from "@/ui/primitives";

type Status = { claimed: boolean; claimUrl: string | null };
async function session(action: "start" | "status", signal: AbortSignal) {
  const response = await fetch(`/spellhound/session/${action}`, { method: "POST", signal });
  if (response.status === 401 && action === "status") return null;
  if (!response.ok) throw Error("Publik sign-in is unavailable. Please retry.");
  return response.json();
}

export function PublikGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 600000;
    async function refresh() {
      try {
        let next = await session("status", signal);
        if (!next) {
          if (!attempt) return;
          await session("start", signal);
          next = await session("status", signal);
        }
        if (!next) throw Error("Word could not keep the sign-in session. Check cookie access and retry.");
        if (signal.aborted) return;
        setStatus(next);
        if (!next.claimed) {
          if (Date.now() >= deadline) throw Error("Sign-in timed out. Retry to continue.");
          timer = setTimeout(refresh, 3000);
        }
      } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : "Unable to sign in."); }
    }
    // Defer until after React StrictMode has replayed the mount.
    timer = setTimeout(refresh, 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [attempt]);
  if (status?.claimed && !error) return <>{children}</>;
  return <><Header /><main className="stack" style={{padding:16}}>
    {error && <p role="alert">{error}</p>}
    {status?.claimUrl && !error ? <a className="btn btn--primary" href={status.claimUrl} target="_blank" rel="noreferrer">Continue in your browser</a> :
      <Button onClick={() => { setError(""); setAttempt(v => v + 1); }}>{error ? "Retry" : "Sign in with Publik"}</Button>}
  </main></>;
}

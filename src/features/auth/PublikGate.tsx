import { useEffect, useState, type ReactNode } from "react";
import { Header } from "@/ui/Header";
import { Button } from "@/ui/primitives";
import { getActiveProvider, isConfigured, setActiveProvider } from "@/ai/keys";
import { bindInstallation, session } from "@/auth/publik";
import { clearSession } from "@/auth/session";
import { ProviderKeyForm } from "@/features/onboarding/ProviderKeyForm";
import { initActiveOrg } from "@/lib/org";
import { initReviewPrefs } from "@/lib/prefs";
import { sendUsage, updateUsagePreference, UsageChoice } from "./UsageChoice";

type Status = { claimed:boolean; claimUrl:string|null; installId:string; choice:"publik"|"own_key"|null;
  usageEnabled:boolean; funded:boolean; topUpUrl:string|null; expires:number };

function BrowserLink({url, children}: {url:string; children:ReactNode}) {
  return <a href={url} className="btn btn--primary" target="_blank" rel="noopener noreferrer"
    onClick={e => {
      try {
        if (Office.context.requirements.isSetSupported("OpenBrowserWindowApi","1.1")) {
          Office.context.ui.openBrowserWindow(url);
          e.preventDefault();
        }
      } catch { /* The user-activated link also works in Word for the web. */ }
    }}>{children}</a>;
}

export function PublikGate({ children }: { children:ReactNode }) {
  const [status, setStatus] = useState<Status|null>(null);
  const [error, setError] = useState("");
  const [run, setRun] = useState(0);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [byok, setByok] = useState(false);
  const [credit, setCredit] = useState<{message:string; link:string|null}|null>(null);
  const retry = () => { setError(""); setRun(n=>n+1); };
  useEffect(() => {
    const controller = new AbortController();
    const {signal} = controller;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now()+600000;
    async function refresh() {
      try {
        const r = await session("status", signal);
        if (signal.aborted) return;
        if (r.status === 401) { setStatus(null); setByok(false); setEdit(false); return; }
        if (!r.ok) throw Error("Publik is not reachable. Check your connection and retry.");
        const next: Status = await r.json();
        if (signal.aborted) return;
        if (next.claimed) { bindInstallation(next.installId); updateUsagePreference(next.usageEnabled); initActiveOrg(); initReviewPrefs(); }
        setStatus(next);
        if (!next.claimed && Date.now() >= deadline) throw Error("Sign-in timed out. Retry to continue.");
        timer = setTimeout(refresh, next.claimed ? Math.max(100,Math.min(60000,next.expires-Date.now())) : 3000);
      } catch (e) {
        if (!signal.aborted) setError(e instanceof Error ? e.message : "Unable to sign in.");
      }
    }
    timer = setTimeout(refresh,0);
    return () => { controller.abort(); clearTimeout(timer); };
  },[run]);
  useEffect(() => {
    const payment = () => { setEdit(true); setCredit(null); retry(); };
    const check = () => { setStatus(null); retry(); };
    const lowCredit = (e: Event) => setCredit((e as CustomEvent).detail);
    const onReturn = () => { if (document.visibilityState === "visible") retry(); };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("spellhound:payment",payment);
    window.addEventListener("spellhound:recheck",check);
    window.addEventListener("spellhound:credit",lowCredit);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("spellhound:payment",payment);
      window.removeEventListener("spellhound:recheck",check);
      window.removeEventListener("spellhound:credit",lowCredit);
    };
  },[]);
  const ready = !!(status?.claimed && status.choice && !edit && !error &&
    (status.choice === "publik" ? getActiveProvider() === "publik" : getActiveProvider() !== "publik" && isConfigured()));
  useEffect(() => {
    if (!ready) return;
    const launch = setTimeout(()=>sendUsage("app_opened"),0);
    const interval = setInterval(()=>{ if (!document.hidden) sendUsage("active_session"); },1800000);
    return () => { clearTimeout(launch); clearInterval(interval); };
  },[ready]);
  async function start() {
    setBusy(true);
    try {
      const r = await session("start");
      if (!r.ok) throw Error(r.status === 503 ? "The pilot is waiting for its Publik app token." : "Publik could not start sign-in. Retry.");
      if ((await session("status")).status === 401) throw Error("Word blocked the sign-in cookie. Try a supported desktop Word profile.");
      retry();
    } catch(e) { setError(e instanceof Error ? e.message : "Unable to sign in."); }
    finally { setBusy(false); }
  }
  async function choose(value:"publik"|"own_key") {
    setBusy(true);
    try {
      const r = await session("choose/"+value);
      if (!r.ok) throw Error("Could not save this payment choice. Check your balance and retry.");
      if (value === "publik") setActiveProvider("publik");
      setStatus(s => s && {...s, choice:value}); setByok(false); setEdit(false); setCredit(null); retry();
    } catch(e) { setError(e instanceof Error ? e.message : "Retry."); }
    finally { setBusy(false); }
  }
  if (ready) return <>{credit && <aside role="alert">{credit.message} {credit.link && <BrowserLink url={credit.link}>Add credit</BrowserLink>}
    <Button onClick={()=>{setCredit(null);setEdit(true);}}>Change AI payment</Button></aside>}{children}</>;
  return <><Header/><main className="stack" style={{padding:16}}>
    {error ? <><p role="alert">{error}</p><Button onClick={retry}>Retry</Button></> :
      !status?.claimed ? <>
        <h2>Sign in with Publik</h2><p>Link this Word installation in your browser, then return to this pane. Keep Word open while you sign in.</p>
        {status?.claimUrl ? <BrowserLink url={status.claimUrl}>Continue in your browser</BrowserLink> :
          status ? <p>Publik hasn’t supplied a claim link yet. Waiting for Publik…</p> :
          <Button disabled={busy} onClick={start}>Sign in with Publik</Button>}
      </> : <>
        <h2>Choose how to pay for AI</h2>
        <p>Your Publik sign-in is active. Requests use the AI provider you choose.</p>
        <UsageChoice/>
        {byok ? <><ProviderKeyForm ownOnly onSaved={()=>void choose("own_key")}/><Button onClick={()=>setByok(false)}>Back</Button></> :
          <>{status.funded ? <Button disabled={busy} onClick={()=>void choose("publik")}>Connect your Publik plan or balance</Button> :
            <>{status.topUpUrl && <BrowserLink url={status.topUpUrl}>Get a Publik plan or add credit</BrowserLink>}
              <Button onClick={retry}>Refresh balance</Button></>}
            <Button disabled={busy} onClick={()=>setByok(true)}>Use my own key</Button></>}
        <Button onClick={clearSession}>Sign out</Button>
      </>}
  </main></>;
}

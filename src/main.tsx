import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PublikGate } from "./features/auth/PublikGate";
import { App } from "./App";
import { initActiveOrg } from "./lib/org";
import { initReviewPrefs } from "./lib/prefs";
import { assertConfigured } from "./config";
import { isWordHost } from "./office/run";
import "./styles/global.css";

/**
 * Boot the task pane. We wait for Office.onReady so Office.js is initialized
 * before React touches any Office API, then mount the app.
 */
Office.onReady(() => {
  if (import.meta.env.MODE === "community") { initActiveOrg(); initReviewPrefs(); }

  const root = createRoot(document.getElementById("root")!);
  if (!isWordHost()) {
    root.render(
      <div style={{ padding: 16 }}>
        <p>Spellhound for Word runs inside Microsoft Word.</p>
      </div>,
    );
    return;
  }
  try {
    assertConfigured();
  } catch (e) {
    root.render(
      <div style={{ padding: 16 }}>
        <p>Spellhound for Word is not configured correctly.</p>
        <p style={{ color: "#a4262c", fontSize: 12 }}>{(e as Error).message}</p>
      </div>,
    );
    return;
  }

  root.render(
    <StrictMode>
      {import.meta.env.MODE === "community" ? <App /> : <PublikGate><App /></PublikGate>}
    </StrictMode>,
  );
});

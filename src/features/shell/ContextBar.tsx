import { useAppNav } from "@/app/nav";
import { useSelection } from "@/features/tools/useSelection";
import { OverflowMenu, type OverflowMenuItem } from "@/ui/OverflowMenu";
import type { SelectionToolKey } from "@/app/nav";
import "./context-bar.css";

/**
 * Persistent shell strip for cross-feature selection actions.
 *
 * When text is selected (and not on the Assistant tab, which has its own inline
 * selection tools), it exposes every verb that acts on a clause, routing each to
 * the surface that owns it: the "select a clause, act on it from anywhere"
 * unifier. Common verbs are inline; the rest live in one dropdown so the strip
 * stays compact. Renders nothing when there is no selection.
 */
export function ContextBar() {
  const { tab, navigate } = useAppNav();
  const sel = useSelection();

  // The Assistant tab has richer inline selection tools; show these verbs on the
  // other working tabs (review / draft / research / playbook / tools).
  const showSelection = sel.hasSelection && tab !== "assistant";
  if (!showSelection) return null;

  const askSelection = () =>
    navigate("assistant", { kind: "assistantAsk", prompt: "", scope: "selection" });
  const runTool = (tool: SelectionToolKey) =>
    navigate("assistant", { kind: "selectionTool", tool });
  const findAuthority = () => navigate("tools", { kind: "openTool", tool: "research" });
  const redact = () => navigate("tools", { kind: "openTool", tool: "redact" });

  // Secondary verbs behind one dropdown so the strip does not overflow the pane.
  const more: OverflowMenuItem[] = [
    { label: "Plain English", onSelect: () => runTool("plain") },
    { label: "Check compliance", onSelect: () => runTool("compliance") },
    { label: "Open public research", onSelect: findAuthority },
    { label: "Redact", onSelect: redact },
  ];

  return (
    <div className="context-bar">
      <div className="context-bar__sel">
        <span className="context-bar__sel-count">
          {sel.words} word{sel.words === 1 ? "" : "s"} selected
        </span>
        <div className="context-bar__actions">
          <button type="button" className="context-bar__verb" onClick={askSelection}>
            Ask
          </button>
          <button
            type="button"
            className="context-bar__verb"
            onClick={() => runTool("explain")}
          >
            Explain
          </button>
          <button type="button" className="context-bar__verb" onClick={() => runTool("risk")}>
            Risk
          </button>
          <button
            type="button"
            className="context-bar__verb"
            onClick={() => runTool("rewrite")}
          >
            Rewrite
          </button>
          <OverflowMenu label="More selection actions" items={more} />
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "@/api/errors";
import { ViewHeader } from "@/ui/ViewHeader";
import { RescanButton } from "@/ui/RescanButton";
import { Badge, Banner, Button, Spinner } from "@/ui/primitives";
import { LocateIcon } from "@/ui/icons";
import { actOnReference, readNumberedParagraphs } from "@/office/structure";
import { useAppNav } from "@/app/nav";
import { analyzeCrossReferences, type BrokenRef, type CrossRefReport } from "@/lib/cross-references";
import { useDocumentAutoRefresh } from "@/lib/useDocumentAutoRefresh";
import "./xref.css";

type State =
  | { status: "scanning" }
  | { status: "ready"; report: CrossRefReport }
  | { status: "error"; error: string };

/**
 * Cross-reference integrity checker (client-only). Reads the document's
 * paragraphs (with auto-numbering), runs the pure analyzer, and lists internal
 * references that point at a section/schedule that does not exist, each with a
 * Find action that jumps to the reference in the document.
 */
export function CrossRefView() {
  const { navigate } = useAppNav();
  const [state, setState] = useState<State>({ status: "scanning" });
  const [note, setNote] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setNote(null);
    setState({ status: "scanning" });
    try {
      const paragraphs = await readNumberedParagraphs();
      setState({ status: "ready", report: analyzeCrossReferences(paragraphs) });
    } catch (e) {
      setState({ status: "error", error: errorMessage(e) });
    }
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  // Silent re-scan: refresh the report in place when the document is edited (a
  // clause renumber can break refs), without flashing the scanning spinner.
  const refresh = useCallback(async () => {
    try {
      const paragraphs = await readNumberedParagraphs();
      const report = analyzeCrossReferences(paragraphs);
      setState((s) => (s.status === "ready" ? { status: "ready", report } : s));
    } catch {
      // Ignore transient read failures; the next change event or rescan recovers.
    }
  }, []);

  // Auto-refresh: re-scan when the document changes while this view is open.
  useDocumentAutoRefresh(refresh);

  // Cross-link: send a broken cross-reference to the Assistant for a fix.
  function askAboutRef(label: string, count: number) {
    navigate("assistant", {
      kind: "assistantAsk",
      prompt: `This contract references "${label}" ${count} time${count === 1 ? "" : "s"}, but that section or schedule does not appear to exist. Explain the risk and how to fix the cross-reference.`,
      scope: "document",
      autoSend: true,
      documentOnly: true,
    });
  }

  const [position, setPosition] = useState<{ ref: BrokenRef; index: number } | null>(null);
  async function actOnFinding(ref: BrokenRef, comment = false) {
    setNote(null);
    const previous = position?.ref === ref ? position.index : -1;
    const index = comment ? Math.max(0, previous) : (previous + 1) % ref.count;
    try {
      const found = await actOnReference(ref.occurrences[index], comment
        ? "Broken cross-reference: this points to a section or schedule that does not appear to exist."
        : undefined);
      if (found) setPosition({ ref, index });
      else setNote("The reference could not be located. Rescan the document.");
    } catch (e) {
      setNote(errorMessage(e));
    }
  }

  const header = (
    <ViewHeader
        title="Cross-references"
        info="Checks internal references (see Section 7.4, Exhibit C) against the sections and schedules that actually exist, catching pointers left dangling after clauses were cut or renumbered. Reads both typed and auto-numbered sections. Roman-numeral Articles are out of scope."
        subtitle="Find references that point at a section or schedule that does not exist."
      />
  );

  if (state.status === "scanning") {
    return (
      <div className="stack xref-view">
        {header}
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <Spinner /> <span className="small muted">Checking cross-references...</span>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="stack xref-view">
        {header}
        <Banner tone="danger">{state.error}</Banner>
        <Button variant="default" size="sm" onClick={() => void scan()} style={{ alignSelf: "flex-start" }}>
          Try again
        </Button>
      </div>
    );
  }

  const { report } = state;

  return (
    <div className="stack xref-view">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="view-title">Cross-references</h1>
        <span data-tour="xref-rescan">
          <RescanButton onClick={() => void scan()} />
        </span>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <Badge tone="brand">{report.sectionCount} sections</Badge>
        {report.scheduleCount > 0 && (
          <Badge tone="brand">{report.scheduleCount} schedules</Badge>
        )}
        <Badge tone={report.broken.length > 0 ? "red" : "green"}>
          {report.broken.length} broken
        </Badge>
      </div>

      {note && <Banner tone="warn">{note}</Banner>}

      {!report.checkedSections ? (
        <Banner tone="info">
          Could not confidently map this document's section numbering (found{" "}
          {report.sectionCount}), so section references were not checked. This happens with
          unusual or inconsistent numbering.
        </Banner>
      ) : null}
      {report.checkedSections && report.broken.length === 0 && (
        <Banner tone="success">
          No broken internal cross-references found among the references checked.
        </Banner>
      )}
      {report.broken.length > 0 && (
        <div className="stack" style={{ gap: 0 }} data-tour="xref-broken">
          {report.broken.map((b) => (
            <div key={`${b.kind}-${b.label}`} className="xref-row">
              <div className="stack" style={{ gap: 0, minWidth: 0 }}>
                <span className="xref-label">{b.label}</span>
                <span className="small muted">
                  {position?.ref === b
                    ? `Occurrence ${position.index + 1} of ${b.count}`
                    : `Referenced ${b.count} ${b.count === 1 ? "time" : "times"}, not found`}
                </span>
                {b.context && (
                  <span className="ctx-line">
                    {b.context.before}
                    <mark className="ctx-hit">{b.occurrences[0].text}</mark>
                    {b.context.after}
                  </span>
                )}
              </div>
              <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void actOnFinding(b)}
                  aria-label={
                    b.count > 1
                      ? `Find next occurrence of ${b.label}`
                      : `Find ${b.label} in the document`
                  }
                  title="Find in document"
                  data-tour="xref-find"
                >
                  <LocateIcon size={13} /> Find
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => askAboutRef(b.label, b.count)}
                  aria-label={`Ask the assistant about ${b.label}`}
                  title="Ask the assistant about this"
                >
                  Ask
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void actOnFinding(b, true)}
                  aria-label={`Comment on ${b.label} in the document`}
                  title="Add a comment in the document"
                >
                  Comment
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

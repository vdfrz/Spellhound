import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banner, Button, LiveRegion, SegmentedControl, Spinner } from "@/ui/primitives";
import { ChevronIcon, RefreshIcon } from "@/ui/icons";
import { MessageBubble } from "./MessageBubble";
import { Composer, type ComposerHandle, type ComposerMode } from "./Composer";
import { SuggestedPrompts, detectContractType } from "./SuggestedPrompts";
import { EditIntro } from "./EditIntro";
import { ChatHistory } from "./ChatHistory";
import {
  deriveTitle,
  getConversation,
  listConversations,
  saveConversation,
  type Conversation,
} from "./chatHistoryStore";
import { useWordSelection } from "./useWordSelection";
import { classifyIntent, type Intent } from "./intent";
import { selectClauseInDocument } from "@/office/navigate";
import { acceptAllTrackedChanges, countTrackedChanges } from "@/office/changes";
import { useAppNav } from "@/app/nav";
import { insertCommentAnchored, deleteAllComments } from "@/office/comments";

/** Actionable (non-ask) intents that get staged for an explicit confirm. */
type ActionIntent = Exclude<Intent, { action: "ask" }>;

/** Human-readable confirm prompt for a staged action. */
function suggestLabel(i: ActionIntent): string {
  switch (i.action) {
    case "edit":
      return "This looks like an edit. Redline the document for this?";
    case "navigate":
      return `Go to "${i.target}" in the document?`;
    case "comment":
      return `Add a comment on "${i.target}"?`;
    case "accept":
      return "Accept all tracked changes? Word's Undo reverses it.";
    case "cleanCopy":
      return "Make a clean copy (accept all changes, remove comments)? Word's Undo reverses it.";
  }
}

/** Button label for a staged action. */
function suggestCta(i: ActionIntent): string {
  switch (i.action) {
    case "edit":
      return "Redline it";
    case "navigate":
      return "Take me there";
    case "comment":
      return "Add comment";
    case "accept":
      return "Accept all";
    case "cleanCopy":
      return "Make clean copy";
  }
}
import { useAssistant, type AssistantMessage, type Scope } from "./useAssistant";
import type { Matter } from "@/features/matters/api";
import { recallDecisions } from "@/features/matters/recall";
import { references, reviewDiscussion, targetName } from "./documentContext";
import { useAttachments } from "./useAttachments";
import { extractFileText } from "@/api/context";
import { ocrToText, isOcrEligible } from "@/api/ocr";
import type { ContextConfig } from "./ContextMenu";
import type { AssistantOptions } from "@/api/chat";
import { uuid } from "@/api/ids";
import { SelectionTools } from "@/features/tools/SelectionTools";
import { QuotaBanner } from "@/features/usage/QuotaBanner";
import { getReviewPrefs, subscribeReviewPrefs } from "@/lib/prefs";
import { formatRelativeTime } from "@/lib/relativeTime";
import { RedlineCard } from "@/features/review/RedlineCard";
import { streamEditDocument, editDocument, editToRedline } from "@/api/edit";
import { readFullDocumentText } from "@/office/document";
import { errorMessage, ApiError } from "@/api/errors";
import type { RedlineSuggestion } from "@/api/types";
import type { Decision } from "@/features/review/decisions";
import type { AppIntent, SelectionToolKey } from "@/app/nav";
import "./assistant.css";

/** One turn of the Edit conversation: the instruction the user gave, plus the
 *  agent's dynamic prose (overview above the cards, summary below) and the
 *  grounded redlines it proposed. A follow-up refines the latest turn's set. */
interface EditTurn {
  instruction: string;
  overview: string;
  redlines: RedlineSuggestion[];
  summary: string;
}

/** Stable identity of an edit by its content (the anchor it replaces + the text
 *  it proposes). Two edits with the same key are "the same" across a refine and
 *  share a decision; a changed proposal produces a new key (so it re-reviews). */
function editKey(r: RedlineSuggestion): string {
  return `${r.currentLanguage}\u0000${r.proposedLanguage}`;
}

function ClockGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function PlusGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Compact relative time for the recent-chats list ("2h", "3d", else a date). */

export function AssistantView({
  historyScope, folder, onLink,
  onSave,
  intent,
  onIntentDone,
}: {
  historyScope: string;
  folder: Matter | null;
  onLink?: (folder: Matter) => void;
  onSave?: (text: string) => void;
  /** A cross-feature handoff (ask this, or open a selection tool). */
  intent?: AppIntent | null;
  onIntentDone?: () => void;
}) {
  const { state, send, stop, reset, truncateBefore, loadMessages } = useAssistant();
  // Chat attaches files as inline context: extract the text server-side and fold
  // it into the request context at send time.
  const attach = useAttachments(
    useCallback(async (file) => {
      const r = await extractFileText(file);
      // Community edition: a PDF comes back as raw bytes (no text) to send to the
      // user's LLM provider directly, which reads it (text and scanned pages)
      // itself. Attach it as a provider file and skip the text/OCR handling.
      if (r.fileData && r.mediaType) return { fileData: r.fileData, mediaType: r.mediaType };
      // A scanned PDF extracts to nothing. Flag it so the user can opt into OCR
      // from the chip, rather than silently attaching an empty (useless) file.
      if (!r.text.trim() && isOcrEligible(file.name)) return { needsOcr: true };
      return { text: r.text, chars: r.chars, truncated: r.truncated };
    }, []),
    // Opt-in OCR resolver: recover the text on demand for a scanned attachment.
    useCallback(async (file: File) => {
      const text = await ocrToText(file);
      return { text, chars: text.length, truncated: false };
    }, []),
  );
  const [scope, setScope] = useState<Scope>("document");
  // Ask (grounded chat) vs Edit (describe a change, get grounded redlines). The
  // mode controls stay at the top of the assistant.
  const [mode, setMode] = useState<ComposerMode>("ask");
  // A detected document action awaiting the user's confirm (Ask-mode intent
  // routing). Null when the last message was a plain question.
  const [pendingAction, setPendingAction] = useState<{ intent: ActionIntent; text: string } | null>(
    null,
  );
  // A short "what I did" line shown after an action runs (auto-clears).
  const [actionResult, setActionResult] = useState<string | null>(null);
  useEffect(() => {
    if (!actionResult) return;
    const t = setTimeout(() => setActionResult(null), 6000);
    return () => clearTimeout(t);
  }, [actionResult]);
  // The Edit conversation: each completed turn (instruction + prose + redlines).
  // A follow-up refines the latest turn's set, so only the last turn's cards are
  // interactive; earlier turns remain as the narrative of how we got here.
  const [editTurns, setEditTurns] = useState<EditTurn[]>([]);
  const [editBusy, setEditBusy] = useState(false);
  const [editPending, setEditPending] = useState(""); // instruction being drafted
  // True only when the in-flight generation is a REFINE of a prior non-empty set.
  // A follow-up after a turn that proposed nothing is a fresh attempt, not a
  // refine, so the spinner must not claim "Refining the edits...".
  const [editRefining, setEditRefining] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // Unresolved tracked changes block redlining, and finding that out one card at
  // a time (after an LLM call, on cards that then refuse to apply) is a dead
  // end. A clause whose own edits are still pending is stored as the deletion
  // and the insertion interleaved, so it is contiguous with neither the clean
  // text nor the original: no verbatim search can match it, and there is no
  // unambiguous baseline to diff against. So say it up front instead.
  const [pendingTracked, setPendingTracked] = useState(0);
  // Bumped whenever a card is applied. Applying mutates the DOCUMENT, not
  // editTurns, so without this the probe below went stale at exactly the moment
  // it starts mattering: the first Accept is what creates the pending change
  // that blocks the next one.
  const [appliedTick, setAppliedTick] = useState(0);
  const editAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => editAbortRef.current?.abort(), []);
  // Decisions are keyed by the edit's CONTENT (anchor + proposed text), not its
  // position, so they survive a refine: an identical edit keeps its accept/reject
  // decision, while a changed proposal gets a new key and resets to pending (the
  // user should re-review new language). Persists across turns; cleared only on
  // Start over / New chat.
  const { navigate: appNavigate } = useAppNav();
  // Re-probe on entering Edit, on a new turn, and after every applied card.
  useEffect(() => {
    if (mode !== "edit") return;
    let cancelled = false;
    void countTrackedChanges()
      .then((n) => {
        if (!cancelled) setPendingTracked(n);
      })
      .catch(() => {
        // Best-effort warning only: a failed probe must not block editing.
      });
    return () => {
      cancelled = true;
    };
  }, [mode, editTurns.length, appliedTick]);

  const [editDecisions, setEditDecisions] = useState<Record<string, Decision>>({});
  const editDecisionOf = (r: RedlineSuggestion): Decision =>
    editDecisions[editKey(r)] ?? "pending";
  const setEditDecision = (r: RedlineSuggestion, d: Decision) =>
    setEditDecisions((p) => ({ ...p, [editKey(r)]: d }));
  // A selection tool the shell asked us to open (Explain / Risk / Rewrite ...).
  const [selTool, setSelTool] = useState<SelectionToolKey | undefined>(undefined);
  // Composer draft is owned here so the prompt library and edit-and-re-run can
  // write into it.
  const [draft, setDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  // Grounding sources the assistant draws on (US corpus + matter docs on by
  // default; web search off). Chosen via the composer's "+" context menu.
  const [context, setContext] = useState<ContextConfig>({
    web: false,
    matterDocs: true,
    corpus: true,
  });
  // Matter + jurisdiction are the user's standing context, set once in Settings.
  // The assistant reads them here instead of re-asking on every question.
  const [prefs, setPrefs] = useState(getReviewPrefs());
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  // Whether the transcript is scrolled to the bottom. When the user scrolls up
  // mid-stream we stop auto-following and offer a "jump to latest" pill instead
  // of yanking them back down.
  const [atBottom, setAtBottom] = useState(true);
  // The device-local conversation this transcript persists to. Null until the
  // first turn creates one (or a past chat is loaded).
  const convIdRef = useRef<string | null>(null);

  // Edit-and-re-run: drop the edited turn (and its stale answer), load the text
  // back into the composer, and focus it once the DOM reflects the new draft.
  function handleEdit(message: AssistantMessage) {
    truncateBefore(message.id);
    setDraft(message.content);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  // Edit mode: describe a change, get grounded redlines across the document. A
  // follow-up refines the current set -- we send the prior instructions + the
  // edits on screen so the model updates them instead of starting over.
  async function generateEdit(instruction: string) {
    const instr = instruction.trim();
    if (!instr || editBusy || editAbortRef.current) return;
    // Own the request so Stop actually stops it, and so a turn the user walked
    // away from (New chat / load chat / unmount) can never land in the session
    // they are now looking at.
    const controller = new AbortController();
    editAbortRef.current = controller;
    setEditError(null);
    setEditPending(instr);
    setEditBusy(true);
    try {
      const text = await readFullDocumentText();
      if (controller.signal.aborted) return;
      const files = attach.contextFiles();
      const discussion = reviewDiscussion(state.messages);
      const decisions = folder ? await recallDecisions(folder, instr, controller.signal) : undefined;
      if (controller.signal.aborted) return;
      const editInstruction = [
        ...(decisions ? ["Filed decisions for this deal (negotiating instructions, not contract text): " + JSON.stringify(decisions)] : []),
        "Only edit the active Word document " + JSON.stringify(targetName()) + ".",
        "Use the discussion to resolve follow-ups. Attached files are references only. Never import their terms unless requested. If the target or change is ambiguous, explain what needs clarification and return zero edits.",
        "Earlier discussion: " + JSON.stringify(discussion),
        "Reference files: " + JSON.stringify(references(files)),
        "Current request: " + instr,
      ].join("\n");
      const binaryFiles = files.flatMap(f => f.fileData && f.mediaType ? [{name:f.name, mediaType:f.mediaType, dataBase64:f.fileData}] : []);
      // Detect the contract type so the server can gate each edit against the
      // matching doc-type playbook (approval level + deal-breaker), like Review.
      const contractType = detectContractType(text) ?? undefined;
      // A follow-up only REFINES when the previous turn actually produced edits.
      // After a turn that proposed nothing ("No grounded edits"), the next
      // instruction is a FRESH attempt: refining an empty set just re-feeds the
      // failed instruction and traps the user in a "Refining..." loop that keeps
      // returning nothing.
      const lastTurn = editTurns.length ? editTurns[editTurns.length - 1] : undefined;
      const refining = !!lastTurn && lastTurn.redlines.length > 0;
      setEditRefining(refining);
      // Only PENDING edits are context for a refine. Sending the ones the user
      // dismissed invited the model to re-propose them (so they had to dismiss
      // the same position twice), and sending accepted ones described a
      // currentLanguage that no longer exists in the document, which then failed
      // to anchor on Accept.
      const active = refining && lastTurn ? lastTurn.redlines : [];
      const prior = refining
        ? {
            priorInstructions: editTurns.map((t) => t.instruction),
            priorEdits: active
              .filter((r) => editDecisionOf(r) === "pending")
              .map((r) => ({
                label: r.clauseName,
                currentLanguage: r.currentLanguage,
                proposedLanguage: r.proposedLanguage,
              })),
          }
        : { priorInstructions: [], priorEdits: [] };
      // Create the turn shell up front so cards can grow into it as the stream
      // delivers them, instead of the whole set appearing after a long wait.
      // `prior` was computed from the EXISTING turns above, before this shell.
      // Drop a trailing EMPTY turn first: a prior "No grounded edits" dead-end
      // carries nothing forward (refining is already false after it), so a
      // resubmission should REPLACE it, not stack a second identical instruction
      // bubble with a stale "No grounded edits" banner wedged above the retry.
      setEditTurns((prev) => {
        const base =
          prev.length > 0 && prev[prev.length - 1].redlines.length === 0
            ? prev.slice(0, -1)
            : prev;
        return [...base, { instruction: instr, overview: "", redlines: [], summary: "" }];
      });
      // Append into the LAST turn (the shell just created). editBusy prevents a
      // second turn starting mid-stream, so "last" is unambiguous.
      const appendToLast = (mut: (t: EditTurn) => EditTurn) =>
        setEditTurns((prev) => {
          if (prev.length === 0) return prev;
          const next = prev.slice();
          next[next.length - 1] = mut(next[next.length - 1]);
          return next;
        });

      try {
        await streamEditDocument(text, editInstruction, contractType, { ...prior, attachments: binaryFiles }, {
          signal: controller.signal,
          onEdit: (item) => {
            if (controller.signal.aborted) return;
            const rl = editToRedline(item);
            appendToLast((t) => ({ ...t, redlines: [...t.redlines, rl] }));
          },
          onDone: ({ overview, summary }) => {
            if (controller.signal.aborted) return;
            appendToLast((t) => ({ ...t, overview, summary }));
          },
        });
      } catch (e) {
        // Deploy skew: the streaming route can be missing while the older
        // non-streaming one is still live (the add-in and backend deploy
        // separately). Fall back to the batch endpoint so Edit keeps working
        // instead of surfacing a bare 404 (which the error map mislabels as a
        // matter-access error). Any other failure propagates to the outer catch.
        if (!(e instanceof ApiError && e.status === 404) || controller.signal.aborted) throw e;
        const res = await editDocument(text, editInstruction, contractType, { ...prior, attachments: binaryFiles }, controller.signal);
        if (controller.signal.aborted) return;
        appendToLast((t) => ({
          ...t,
          overview: res.overview,
          redlines: res.edits.map(editToRedline),
          summary: res.summary,
        }));
      }
      // Decisions are content-keyed and intentionally NOT reset here: an edit that
      // survives the refine unchanged keeps its accept/reject decision.
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        // Stopped before any card streamed in: drop the empty in-flight shell
        // turn so it does not linger as a phantom "No grounded edits" verdict.
        // Only the just-created shell can be the trailing empty turn here, so a
        // completed empty turn from earlier is never touched. A partially
        // streamed turn (redlines > 0) is kept.
        setEditTurns((prev) =>
          prev.length && prev[prev.length - 1].redlines.length === 0 ? prev.slice(0, -1) : prev,
        );
        return;
      }
      setEditError(errorMessage(e));
    } finally {
      if (editAbortRef.current === controller) {
        editAbortRef.current = null;
        setEditBusy(false);
        setEditPending("");
      }
    }
  }

  /** Cancel an in-flight edit generation (the composer's Stop in Edit mode). */
  function stopEdit() {
    editAbortRef.current?.abort();
    editAbortRef.current = null;
    setEditBusy(false);
    setEditPending("");
    setEditRefining(false);
  }

  // Clear the Edit conversation back to the starter state.
  function resetEdit() {
    stopEdit();
    setPendingAction(null);
    setEditTurns([]);
    setEditDecisions({});
    setEditError(null);
    setEditPending("");
    setEditRefining(false);
  }

  // The composer's send routes by mode: Ask -> chat, Edit -> generate redlines.
  function handleSend(t: string) {
    if (mode === "edit") {
      void generateEdit(t);
      return;
    }
    // Ask mode: if the message is really a document action (redline / navigate),
    // offer to run it instead of just answering. Never acts silently.
    const intent = classifyIntent(t);
    if (intent.action !== "ask") {
      setPendingAction({ intent, text: t });
      return;
    }
    send(t, scope, grounding, attach.contextFiles());
  }

  // Run the confirmed action against the open document. Edit routes into the rich
  // Edit flow; the rest drive the Office helpers and report a short result.
  async function runPendingAction() {
    const pa = pendingAction;
    if (!pa) return;
    setPendingAction(null);
    setActionResult(null);
    try {
      switch (pa.intent.action) {
        case "edit":
          setMode("edit");
          void generateEdit(pa.text);
          break;
        case "navigate":
          await selectClauseInDocument(pa.intent.target);
          break;
        case "comment": {
          const r = await insertCommentAnchored(pa.intent.target, pa.intent.note);
          setActionResult(
            r === "inserted"
              ? `Comment added on "${pa.intent.target}".`
              : r === "not_found"
                ? `Could not find "${pa.intent.target}" in the document.`
                : "Word does not allow a comment in that location.",
          );
          break;
        }
        case "accept": {
          const n = await acceptAllTrackedChanges();
          setActionResult(
            `Accepted ${n} tracked change${n === 1 ? "" : "s"}. Word's Undo reverses it.`,
          );
          break;
        }
        case "cleanCopy": {
          const accepted = await acceptAllTrackedChanges();
          const removed = await deleteAllComments();
          setActionResult(
            `Clean copy ready: accepted ${accepted} change${accepted === 1 ? "" : "s"}, removed ${removed} comment${removed === 1 ? "" : "s"}. Word's Undo reverses it.`,
          );
          break;
        }
      }
    } catch (e) {
      setActionResult(errorMessage(e));
    }
  }

  // The user declined the action: answer the message as a normal question.
  function dismissToAnswer() {
    const pa = pendingAction;
    if (!pa) return;
    setPendingAction(null);
    send(pa.text, scope, grounding, attach.contextFiles());
  }

  // Switching mode clears the shared draft so leftover text from one mode does
  // not read as input for the other.
  function switchMode(next: ComposerMode) {
    setMode(next);
  }

  function newChat() {
    reset();
    attach.clear();
    convIdRef.current = null;
    setDraft("");
    resetEdit();
    setHistoryOpen(false);
  }

  function loadChat(id: string) {
    const conv = getConversation(historyScope, id);
    if (!conv) return;
    resetEdit();
    convIdRef.current = id;
    // History holds Ask-mode chats; force Ask so the loaded transcript actually
    // renders. Without this, opening History from Edit mode loaded the messages
    // into state but the Edit branch stayed on screen, so nothing appeared.
    setMode("ask");
    loadMessages(conv.messages);
    attach.clear();
    setDraft("");
    setHistoryOpen(false);
  }

  // Persist completed turns to device-local history (never mid-stream).
  useEffect(() => {
    if (state.streaming || state.messages.length === 0) return;
    if (!convIdRef.current) convIdRef.current = uuid();
    saveConversation(historyScope, {
      id: convIdRef.current,
      title: deriveTitle(state.messages),
      messages: state.messages.map((m) => (m.pending ? { ...m, pending: false } : m)),
      updatedAt: Date.now(),
    });
  }, [state.messages, state.streaming, historyScope]);

  useEffect(() => subscribeReviewPrefs(setPrefs), []);

  // Auto-follow the stream only while the user is already at the bottom; if they
  // have scrolled up to read, leave their position alone.
  useEffect(() => {
    if (atBottom) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages, state.thinking, atBottom]);

  function onMessagesScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(distance < 48);
  }

  function jumpToLatest() {
    setAtBottom(true);
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  const grounding = useMemo<AssistantOptions>(() => {
    const wantMatterDocs = !!prefs.matterId && context.matterDocs;
    // useRag is the backend master gate for ALL retrieval; turn it on if ANY
    // source is selected, then let the per-source levers decide what's used.
    // (Overloading useRag as the corpus toggle silently disabled matter-docs and
    // web retrieval whenever "US case law" was unticked.)
    return {
      decisionFolder: folder,
      matterId: prefs.matterId || null,
      useRag: context.corpus || wantMatterDocs || context.web,
      enableVaquillDbSearch: context.corpus,
      enableMatterDocsSearch: prefs.matterId ? context.matterDocs : undefined,
      enableWebSearch: context.web,
      usStates: prefs.jurisdiction ? [prefs.jurisdiction] : undefined,
    };
  }, [prefs.matterId, prefs.jurisdiction, context, folder]);

  const consumedIntent = useRef<AppIntent | null>(null);
  // Consume a cross-feature handoff exactly once.
  useEffect(() => {
    if (!intent || consumedIntent.current === intent) return;
    consumedIntent.current = intent;
    // Any handoff (ask this / open a selection tool) is a chat action.
    if (intent.kind === "assistantAsk" || intent.kind === "selectionTool") setMode("ask");
    if (intent.kind === "assistantAsk") {
      if (intent.scope) setScope(intent.scope);
      if (intent.prompt) setDraft(intent.prompt);
      if (intent.autoSend && intent.prompt.trim()) {
        // A document-only ask (e.g. "should I accept this redline?") is answered
        // from the open document alone: turn off every external source so the
        // backend does not auto-fall-back to web / corpus retrieval. The explicit
        // enableWebSearch:false is honored server-side as a hard opt-out.
        const askGrounding: AssistantOptions = intent.documentOnly
          ? {
              useRag: false,
              matterId: null,
              enableVaquillDbSearch: false,
              enableMatterDocsSearch: false,
              enableWebSearch: false,
            }
          : grounding;
        send(intent.prompt, intent.scope ?? scope, askGrounding, intent.documentOnly ? [] : attach.contextFiles());
        setDraft("");
      } else {
        requestAnimationFrame(() => composerRef.current?.focus());
      }
      onIntentDone?.();
    } else if (intent.kind === "selectionTool") {
      setSelTool(intent.tool);
      onIntentDone?.();
    }
    // grounding/scope are read at fire time; we intentionally key only on intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  const empty = state.messages.length === 0;

  // The current Word selection (if any), so the empty state can offer to ask
  // about the highlighted clause specifically.
  const selectionText = useWordSelection();
  // Best-effort client-side contract-type guess (tailors the starter chips and
  // the Edit-mode example preview). Load it whenever a starter surface is shown:
  // the Ask empty state, or Edit mode sitting idle.
  const [docType, setDocType] = useState<string | null>(null);
  const wantDocType = empty || (mode === "edit" && editTurns.length === 0 && !editBusy);
  useEffect(() => {
    if (!wantDocType) return;
    let alive = true;
    readFullDocumentText()
      .then((text) => alive && setDocType(detectContractType(text)))
      .catch(() => alive && setDocType(null));
    return () => {
      alive = false;
    };
  }, [wantDocType]);

  // Recent conversations to resume from the empty state (excluding this one).
  const recentChats: Conversation[] = empty
    ? listConversations(historyScope)
        .filter((c) => c.id !== convIdRef.current)
        .slice(0, 2)
    : [];

  // Only offer the selection when it's a meaningful span, not a stray caret/word.
  const hasSelection = selectionText.length > 20;

  const canNewChat = !empty || convIdRef.current !== null;

  // The active conversation's title, shown in the header (like Legora's "Redlining
  // contract"). Ask mode derives it from the first question; Edit mode from the
  // first instruction. Empty when there is nothing yet.
  const headerTitle =
    mode === "edit"
      ? (editTurns[0]?.instruction ?? "")
      : empty
        ? ""
        : deriveTitle(state.messages);

  return (
    <div className="assistant">
      {historyOpen && (
        <ChatHistory scope={historyScope} activeId={convIdRef.current} onPick={loadChat} onClose={() => setHistoryOpen(false)} />
      )}
      <div className="assistant__modes" data-tour="composer-modes">
        <SegmentedControl<ComposerMode> label="Assistant mode" value={mode} onChange={switchMode}
          options={[{ value: "ask", label: "Ask" }, { value: "edit", label: "Edit" }]} />
      </div>
      {folder && <button type="button" className="btn btn--sm" onClick={() => onSave?.("")}>Decision memory · {folder.name}</button>}
      <div className="assistant__bar">
        <span className="assistant__bar-title" title={headerTitle}>
          {headerTitle}
        </span>
        <div className="assistant__bar-actions">
          <button
            type="button"
            className="assistant__bar-btn"
            onClick={() => setHistoryOpen(true)}
            aria-label="Chat history"
            title="History"
          >
            <ClockGlyph />
            <span className="assistant__bar-label">History</span>
          </button>
          <button
            type="button"
            className="assistant__bar-btn"
            onClick={newChat}
            disabled={!canNewChat}
            aria-label="New chat"
            title="New chat"
          >
            <PlusGlyph />
            <span className="assistant__bar-label">New chat</span>
          </button>
        </div>
      </div>
      <div className="assistant__messages" ref={scrollRef} onScroll={onMessagesScroll}>
        <QuotaBanner />
        <SelectionTools initialTool={selTool} />
        {mode === "edit" ? (
          <div className="stack" style={{ padding: "4px 0" }}>
            {pendingTracked > 0 && (
              <Banner tone="warn">
                <p className="small" style={{ margin: 0 }}>
                  This document has {pendingTracked} unaccepted tracked change
                  {pendingTracked === 1 ? "" : "s"}. Edits are read from the document as if they
                  were accepted, but a clause cannot be redlined while its own edits are still
                  pending. Resolve them first, or these edits may not apply.
                </p>
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => appNavigate("review", { kind: "openReviewSub", sub: "changes" })}
                  >
                    Review changes
                  </Button>
                </div>
              </Banner>
            )}
            {editTurns.length === 0 && !editBusy && !editError ? (
              <EditIntro
                contractType={docType}
                onPick={(instruction) => {
                  setDraft(instruction);
                  requestAnimationFrame(() => composerRef.current?.focus());
                }}
              />
            ) : (
              <>
                {editTurns.length > 0 && (
                  <div className="edit-transcript__bar">
                    <span className="small muted">Editing session</span>
                    <Button variant="ghost" size="sm" onClick={resetEdit} disabled={editBusy}>
                      <RefreshIcon size={13} /> Start over
                    </Button>
                  </div>
                )}
                {/* Each turn: the instruction, the agent's overview, and (only for
                    the latest turn, since a follow-up refines the set) the cards +
                    closing summary. Earlier turns stay as the narrative. */}
                {editTurns.map((turn, ti) => {
                  const isLast = ti === editTurns.length - 1;
                  return (
                    <div key={ti} className="edit-turn stack">
                      <div className="msg msg--user msg--edit-echo">
                        <p>{turn.instruction}</p>
                      </div>
                      {turn.overview && <p className="edit-turn__prose">{turn.overview}</p>}
                      {isLast &&
                        (turn.redlines.length > 0 ? (
                          <div className="stack">
                            <span className="small muted">
                              {turn.redlines.length} proposed edit
                              {turn.redlines.length === 1 ? "" : "s"}
                            </span>
                            {turn.redlines.map((r, i) => (
                              <RedlineCard
                                key={`${editKey(r)}::${i}`}
                                redline={r}
                                index={i}
                                decision={editDecisionOf(r)}
                                onDecision={(_idx, d) => setEditDecision(r, d)}
                                onApplied={() => setAppliedTick((n) => n + 1)}
                              />
                            ))}
                          </div>
                        ) : editBusy ? (
                          // In-flight shell turn: the spinner below carries the
                          // state. Do NOT show the "no grounded edits" verdict yet.
                          null
                        ) : (
                          <Banner tone="info">
                            No grounded edits were proposed for that instruction. Try being more
                            specific.
                          </Banner>
                        ))}
                      {isLast && turn.summary && (
                        <p className="edit-turn__prose edit-turn__prose--summary">{turn.summary}</p>
                      )}
                    </div>
                  );
                })}
                {editBusy && (
                  <div className="edit-turn stack">
                    {/* Echo the instruction ONLY until its shell turn exists (i.e.
                        while the document is still being read). Once the shell is
                        created it renders the echo above, so showing it here too
                        would duplicate the bubble. */}
                    {editPending &&
                      editTurns[editTurns.length - 1]?.instruction !== editPending && (
                        <div className="msg msg--user msg--edit-echo">
                          <p>{editPending}</p>
                        </div>
                      )}
                    <div className="row" style={{ gap: 8, alignItems: "center" }}>
                      <Spinner />
                      <LiveRegion>
                        <span className="small muted">
                          {editRefining
                            ? "Refining the edits..."
                            : "Reading the document and drafting edits..."}
                        </span>
                      </LiveRegion>
                    </div>
                  </div>
                )}
                {editError && <Banner tone="danger">{editError}</Banner>}
              </>
            )}
          </div>
        ) : empty ? (
          <div className="assistant__intro">
            <div className="assistant__greeting">
              <p className="assistant__greeting-title">Ask anything about the open contract.</p>
              <p className="assistant__greeting-sub">
                Use Add context to include a file or a legal source.
              </p>
            </div>

            {hasSelection && (
              <button
                type="button"
                className="suggest-chip assistant__sel-chip"
                onClick={() =>
                  send(
                    "Explain the selected clause: what it does, and any risk to me.",
                    "selection",
                    grounding,
                    attach.contextFiles(),
                  )
                }
              >
                <span className="suggest-chip__icon" aria-hidden>
                  <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" />
                  </svg>
                </span>
                Ask about the selected text
              </button>
            )}

            <SuggestedPrompts
              contractType={docType}
              onPick={(p) => send(p, scope, grounding, attach.contextFiles())}
            />

            {recentChats.length > 0 && (
              <div className="assistant__recent">
                <span className="small muted assistant__recent-label">Recent</span>
                {recentChats.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="assistant__recent-item"
                    onClick={() => loadChat(c.id)}
                  >
                    <span className="assistant__recent-title">{c.title}</span>
                    <span className="small muted">{formatRelativeTime(c.updatedAt)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {state.messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onSave={onSave}
                onEdit={m.role === "user" && !state.streaming ? handleEdit : undefined}
              />
            ))}
            {state.thinking && (
              <LiveRegion className="assistant__thinking">
                <Spinner />
                {/* Strip any trailing dots the label already carries so we never
                    render a doubled ellipsis ("...statutes......"). */}
                <span className="small muted">
                  {state.thinking.replace(/[.…\s]+$/, "")}
                  {"…"}
                </span>
              </LiveRegion>
            )}
            {state.error && <Banner tone="danger">{state.error}</Banner>}
            <div ref={endRef} />
          </>
        )}
      </div>
      {mode === "ask" && !empty && !atBottom && (
        <button
          type="button"
          className="assistant__jump"
          onClick={jumpToLatest}
          aria-label="Jump to latest"
          title="Jump to latest"
        >
          <ChevronIcon size={16} />
        </button>
      )}
      {pendingAction && (
        <div className="assistant__suggest">
          <span className="small assistant__suggest-text">
            {suggestLabel(pendingAction.intent)}
          </span>
          <div className="row" style={{ gap: 6, flexShrink: 0 }}>
            <Button
              variant={
                pendingAction.intent.action === "accept" ||
                pendingAction.intent.action === "cleanCopy"
                  ? "danger"
                  : "primary"
              }
              size="sm"
              onClick={() => void runPendingAction()}
            >
              {suggestCta(pendingAction.intent)}
            </Button>
            <Button variant="ghost" size="sm" onClick={dismissToAnswer}>
              Just answer
            </Button>
          </div>
        </div>
      )}
      {!pendingAction && actionResult && (
        <div className="assistant__action-result small muted" role="status">
          {actionResult}
        </div>
      )}
      <Composer
        onLink={onLink}
        onSave={onSave ? () => onSave(draft || selectionText) : undefined}
        ref={composerRef}
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        // Stop must cancel whatever is actually running. This was always the
        // chat abort, so in Edit mode the composer showed a Stop button wired to
        // an aborter with nothing in flight: clicking it did nothing and the
        // spinner ran on to the 120s timeout.
        onStop={mode === "edit" ? stopEdit : stop}
        disabled={mode === "edit" ? editBusy : state.streaming}
        mode={mode}
        scope={scope}
        onScope={setScope}
        context={context}
        onContextChange={setContext}
        hasMatter={!!prefs.matterId}
        attachments={attach.files}
        onAttach={attach.add}
        onRemoveAttachment={attach.remove}
        onOcrAttachment={attach.ocr}
        atCap={attach.atCap}
      />
    </div>
  );
}

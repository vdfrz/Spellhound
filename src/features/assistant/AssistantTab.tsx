import { lazy, Suspense, useEffect, useState } from 'react';
import type { AppIntent } from '@/app/nav';
import type { Matter } from '@/features/matters/api';
import { uuid } from '@/api/ids';
import { AssistantView } from './AssistantView';
import { targetName } from './documentContext';
import { conversationScope, folderStorageKey, linkedFolder, resolveDocumentScope, setLinkedFolder } from './documentScope';
import './assistant-tab.css';

const Workspace = lazy(async () => ({ default: (await import('@/features/matters/MatterWorkspace')).MatterWorkspace }));
type Props = { intent?: AppIntent | null; onIntentDone?: () => void; privateMattersAvailable?: boolean };

export function AssistantTab(props: Props = {}) {
  const [identity, setIdentity] = useState<{path: string; id: string} | null>(null);
  const [path, setPath] = useState(() => Office.context.document.url || '');
  useEffect(() => {
    function refresh() { setPath(Office.context.document.url || ''); }
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 500);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => {
    let current = true;
    resolveDocumentScope().catch(() => uuid()).then(id => {
      if (current) setIdentity({path, id});
    });
    return () => { current = false; };
  }, [path]);
  if (!identity || identity.path !== path) return <p>Opening this document’s chat…</p>;
  return <DocumentAssistant key={identity.id} documentId={identity.id} {...props} />;
}

function DocumentAssistant({documentId, intent, onIntentDone, privateMattersAvailable = false}: Props & {documentId: string}) {
  const [saveText, setSaveText] = useState<string | null>(null);
  const [folder, setFolder] = useState(() => privateMattersAvailable ? linkedFolder(documentId) : null);
  const [sessionId, setSessionId] = useState(0);
  function changeFolder(next: Matter | null) {
    // A document-only chat can continue when its first folder is linked.
    // Once a deal was in scope, switching or unlinking must clear its transcript.
    if (folder && folder.id !== next?.id) setSessionId(n => n + 1);
    setFolder(next);
  }
  const saving = privateMattersAvailable && saveText !== null;
  useEffect(() => {
    if (!privateMattersAvailable) return;
    const refresh = (event: StorageEvent) => {
      if (event.key === null || event.key === folderStorageKey(documentId)) {
        setSessionId(n => n + 1);
        setFolder(linkedFolder(documentId));
      }
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [documentId, privateMattersAvailable]);
  function link(next: Matter | null) {
    setLinkedFolder(documentId, next);
    changeFolder(next);
  }
  const scope = conversationScope(documentId, folder);
  return <div className="assistant-tab">
    <div className="assistant-tab__body" hidden={saving}>
      <AssistantView key={sessionId} historyScope={scope} folder={folder} onLink={privateMattersAvailable ? link : undefined}
        onSave={privateMattersAvailable ? setSaveText : undefined}
        intent={intent} onIntentDone={onIntentDone} />
    </div>
    {saving && <div className="assistant-tab__body assistant-tab__body--pad">
      <button type="button" className="btn btn--sm" onClick={() => setSaveText(null)}>Back to assistant</button>
      <Suspense fallback={<p>Opening deal folders…</p>}>
        <Workspace target={targetName()} initialText={saveText} linked={folder} onLink={link} />
      </Suspense>
    </div>}
  </div>;
}

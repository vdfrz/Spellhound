import { lazy, Suspense, useState } from 'react';
import type { AppIntent } from '@/app/nav';
import { AssistantView } from './AssistantView';
import { targetName } from './documentContext';
import './assistant-tab.css';

const Workspace = lazy(async () => ({ default: (await import('@/features/matters/MatterWorkspace')).MatterWorkspace }));

/** Capability is absent until the host can verify private workspace identity. */
export function AssistantTab({ intent, onIntentDone, privateMattersAvailable = false }: {
  intent?: AppIntent | null;
  onIntentDone?: () => void;
  privateMattersAvailable?: boolean;
} = {}) {
  const [saveText, setSaveText] = useState<string | null>(null);
  const saving = privateMattersAvailable && saveText !== null;
  return <div className="assistant-tab">
    <div className="assistant-tab__body" hidden={saving}>
      <AssistantView onSave={privateMattersAvailable ? setSaveText : undefined}
        intent={intent} onIntentDone={onIntentDone} />
    </div>
    {saving && <div className="assistant-tab__body assistant-tab__body--pad">
      <button type="button" className="btn btn--sm" onClick={() => setSaveText(null)}>Back to assistant</button>
      <Suspense fallback={<p>Opening deal folders…</p>}>
        <Workspace target={targetName()} initialText={saveText} />
      </Suspense>
    </div>}
  </div>;
}

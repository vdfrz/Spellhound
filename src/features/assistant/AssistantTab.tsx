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
  const [showMatters, setShowMatters] = useState(false);
  const assistant = <AssistantView privateMattersAvailable={privateMattersAvailable} intent={intent} onIntentDone={onIntentDone} />;
  if (!privateMattersAvailable) return assistant;
  return <div className="assistant-tab">
    <div className="assistant-tab__toggle"><button className="btn btn--sm" onClick={() => setShowMatters(x => !x)}>
      {showMatters ? 'Back to assistant' : 'Open matter workspace'}
    </button></div>
    <div className="assistant-tab__body" hidden={showMatters}>{assistant}</div>
    {showMatters && <div className="assistant-tab__body assistant-tab__body--pad">
      <Suspense fallback={<p>Opening workspace…</p>}><Workspace target={targetName()} /></Suspense>
    </div>}
  </div>;
}

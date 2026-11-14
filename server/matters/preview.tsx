import { createRoot } from 'react-dom/client';
import { MatterWorkspace } from '@/features/matters/MatterWorkspace';
import '@/styles/global.css';
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:480, margin:'auto'}}><p>Synthetic local preview · use fictional material only. Summaries use a test model.</p><MatterWorkspace target="Sample agreement.docx (simulated)" /></main>);

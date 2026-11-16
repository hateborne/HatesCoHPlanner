import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { CrashGuard } from './ui/components/CrashGuard.tsx';
import { APP_COMMIT, versionLabel } from './version.ts';
import './index.css';

// which release this is, for bug reports that quote the console
console.info(`Hate's CoH Planner ${versionLabel()}${APP_COMMIT ? ` (commit ${APP_COMMIT})` : ''}`);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <CrashGuard>
      <App />
    </CrashGuard>
  </StrictMode>,
);

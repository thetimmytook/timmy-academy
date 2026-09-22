import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './style.css';

const StyleSystemPage = lazy(() => import('./pages/StyleSystemPage'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<p role="status">Loading Academy…</p>}>
      {window.location.pathname.replace(/\/$/, '') === '/style-system' ? (
        <StyleSystemPage />
      ) : (
        <App />
      )}
    </Suspense>
  </StrictMode>,
);

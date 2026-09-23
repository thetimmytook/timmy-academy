import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';

import App from './App';
import { BrowserAuthProvider } from './auth/BrowserAuth';
import './style.css';

const StyleSystemPage = lazy(() => import('./pages/StyleSystemPage'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<p role="status">Loading Academy…</p>}>
      <BrowserRouter>
        <Routes>
          <Route path="/style-system" element={<StyleSystemPage />} />
          <Route
            path="*"
            element={
              <BrowserAuthProvider>
                <App />
              </BrowserAuthProvider>
            }
          />
        </Routes>
      </BrowserRouter>
    </Suspense>
  </StrictMode>,
);

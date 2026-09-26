import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { AuthPocPage } from '../pages/AuthPocPage';
import '../style.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthPocPage />
    </BrowserRouter>
  </StrictMode>,
);

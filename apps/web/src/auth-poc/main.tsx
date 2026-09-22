import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AuthPocPage } from '../pages/AuthPocPage';
import '../style.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthPocPage />
  </StrictMode>,
);

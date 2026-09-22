import { healthResponseSchema } from '@timmy/contracts';
import { useEffect, useState } from 'react';

import { css } from '../styled-system/css';
import { button } from '../styled-system/recipes';

export default function App() {
  const [apiStatus, setApiStatus] = useState('Checking API…');

  useEffect(() => {
    const controller = new AbortController();

    async function checkHealth() {
      try {
        const response = await fetch('/api/bench/v1/health', { signal: controller.signal });
        if (!response.ok) throw new Error('API unavailable');
        const payload: unknown = await response.json();
        healthResponseSchema.parse(payload);
        setApiStatus('API connected');
      } catch {
        if (!controller.signal.aborted) setApiStatus('API unavailable');
      }
    }

    void checkHealth();
    return () => controller.abort();
  }, []);

  return (
    <main
      className={css({
        maxWidth: '40rem',
        mx: 'auto',
        py: '20',
        px: '6',
        display: 'grid',
        gap: '4',
      })}
    >
      <h1 className={css({ textStyle: 'h1' })}>Hello, Timmy Academy</h1>
      <p>Project skeleton is ready.</p>
      <p role="status">{apiStatus}</p>
      <a href="/style-system" className={button({ variant: 'primary' })}>
        Explore the Style System
      </a>
    </main>
  );
}

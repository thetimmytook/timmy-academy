import { useEffect, useState } from 'react';
import { healthResponseSchema } from '@timmy/contracts';

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
    <main>
      <h1>Hello, Timmy Academy</h1>
      <p>Project skeleton is ready.</p>
      <p role="status">{apiStatus}</p>
    </main>
  );
}

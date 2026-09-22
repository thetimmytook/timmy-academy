import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from './App';

afterEach(() => vi.unstubAllGlobals());

describe('hello page', () => {
  it('shows the app name and confirms the API connection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ status: 'ok' })));
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Hello, Timmy Academy' })).toBeTruthy();
    expect(await screen.findByText('API connected')).toBeTruthy();
  });
});

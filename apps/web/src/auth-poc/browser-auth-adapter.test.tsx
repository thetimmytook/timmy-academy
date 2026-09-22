import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthPocPage } from '../pages/AuthPocPage';

import type { JSX, ReactNode } from 'react';

const clerk = vi.hoisted(() => ({
  loaded: true,
  session: null as { id: string } | null,
  signOut: vi.fn<() => Promise<void>>(),
  provider: vi.fn(),
}));

// UI wiring only: no Clerk network calls and no proof of a live provider session.
vi.mock('@clerk/react', () => ({
  ClerkProvider: (props: { children: ReactNode }): ReactNode => {
    clerk.provider(props);

    return props.children;
  },
  useSession: (): { isLoaded: boolean; session: typeof clerk.session } => ({
    isLoaded: clerk.loaded,
    session: clerk.session,
  }),
  useClerk: (): { signOut: typeof clerk.signOut } => ({ signOut: clerk.signOut }),
  SignIn: (): JSX.Element => <p>Email sign-in widget</p>,
  SignUp: (): JSX.Element => <p>Sign-up widget</p>,
  OAuthConsent: (): JSX.Element => <p>Provider consent widget</p>,
  RedirectToSignIn: (): JSX.Element => <p>Redirect to provider sign-in</p>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_fixture');
  window.history.replaceState(null, '', '/');
  clerk.loaded = true;
  clerk.session = null;
  clerk.signOut.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const sessionId = 'private-session-fixture';

describe('isolated browser auth harness with stubbed Clerk components', () => {
  it.each(['', 'pk_live_fixture', 'sk_test_fixture', 'pk_test_REPLACE'])(
    'does not start Clerk for an unavailable or non-development key: %s',
    key => {
      vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', key);
      render(<AuthPocPage />);
      expect(screen.getByRole('status').textContent).toContain('Configure');
      expect(clerk.provider).not.toHaveBeenCalled();
    },
  );

  it('shows only loading status until the browser session is known', () => {
    clerk.loaded = false;
    render(<AuthPocPage />);
    expect(screen.getByRole('status').textContent).toContain('Loading');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('links a signed-out browser to the isolated sign-in route', () => {
    render(<AuthPocPage />);
    expect(screen.getByRole('link', { name: 'Sign in with email' }).getAttribute('href')).toBe(
      '/sign-in',
    );
  });

  it('logs out only the current browser session without exposing its ID', async () => {
    clerk.session = { id: sessionId };
    render(<AuthPocPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out of this browser' }));
    await waitFor(() =>
      expect(clerk.signOut).toHaveBeenCalledExactlyOnceWith({ sessionId: clerk.session?.id }),
    );
    expect(document.body.textContent).not.toContain(sessionId);
  });

  it('sanitizes logout errors and allows retry', async () => {
    clerk.session = { id: sessionId };
    clerk.signOut.mockRejectedValue(new Error('sensitive provider detail'));
    render(<AuthPocPage />);
    fireEvent.click(screen.getByRole('button'));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Browser sign-out failed. Try again.',
    );
    expect(document.body.textContent).not.toContain('sensitive provider detail');
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false);
  });

  it('leaves consent parameters intact and shows no logout or navigation controls', () => {
    clerk.session = { id: sessionId };
    const consentPath = '/oauth/consent?state=fixture&code_challenge=fixture';
    window.history.replaceState(null, '', consentPath);
    render(<AuthPocPage />);
    expect(screen.getByText('Provider consent widget')).toBeTruthy();
    expect(window.location.pathname + window.location.search).toBe(consentPath);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('requires sign-in for a direct signed-out consent visit', () => {
    window.history.replaceState(null, '', '/oauth/consent');
    render(<AuthPocPage />);
    expect(screen.getByText('Redirect to provider sign-in')).toBeTruthy();
    expect(screen.queryByText('Provider consent widget')).toBeNull();
  });

  it.each([
    ['/sign-in/verify-email-address', 'Email sign-in widget'],
    ['/sign-up/verify-email-address', 'Sign-up widget'],
  ])('supports provider subroutes: %s', (path, widget) => {
    window.history.replaceState(null, '', path);
    render(<AuthPocPage />);
    expect(screen.getByText(widget)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

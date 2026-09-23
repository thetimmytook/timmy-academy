import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App';

import { BrowserAuthProvider } from './BrowserAuth';

import type { JSX, ReactNode } from 'react';

interface ProviderProps {
  children: ReactNode;
  routerPush(url: string): void;
  routerReplace(url: string): void;
}

const clerk = vi.hoisted(() => ({
  loaded: true,
  session: null as { id: string } | null,
  signOut: vi.fn<() => Promise<void>>(),
  provider: vi.fn<(props: ProviderProps) => void>(),
  signIn: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock('@clerk/react', () => ({
  ClerkProvider: (props: ProviderProps): ReactNode => {
    clerk.provider(props);

    return props.children;
  },
  useSession: (): { isLoaded: boolean; session: typeof clerk.session } => ({
    isLoaded: clerk.loaded,
    session: clerk.session,
  }),
  useClerk: (): { signOut: typeof clerk.signOut } => ({ signOut: clerk.signOut }),
  SignIn: (props: unknown): JSX.Element => {
    clerk.signIn(props);

    return <p>Sign-in widget</p>;
  },
  SignUp: (props: unknown): JSX.Element => {
    clerk.signUp(props);

    return <p>Sign-up widget</p>;
  },
}));
vi.mock('../pages/BenchPage', () => ({ default: (): JSX.Element => <p>Public benchmarks</p> }));

function start(path = '/bench/'): ReturnType<typeof render> {
  window.history.replaceState(null, '', path);

  return render(
    <BrowserRouter>
      <BrowserAuthProvider>
        <App />
      </BrowserAuthProvider>
    </BrowserRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_fixture');
  clerk.loaded = true;
  clerk.session = null;
  clerk.signOut.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function openProfile(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
}

const publicBenchmarks = 'Public benchmarks';
const expandedAttribute = 'aria-expanded';
const signInLabel = 'Sign in with email →';

describe('browser authentication in the main app', () => {
  it('toggles the profile panel and closes with Escape, outside click and focus leaving', () => {
    start();
    const trigger = screen.getByRole('button', { name: 'Profile' });
    expect(trigger.getAttribute(expandedAttribute)).toBe('false');
    expect(screen.queryByRole('region', { name: 'Profile' })).toBeNull();
    openProfile();
    const panel = screen.getByRole('region', { name: 'Profile' });
    expect(trigger.getAttribute('aria-controls')).toBe(panel.id);
    expect(trigger.getAttribute(expandedAttribute)).toBe('true');
    const link = screen.getByRole('link', { name: /Sign in with email/ });
    act(() => link.focus());
    expect(screen.getByRole('region', { name: 'Profile' })).toBeTruthy();
    fireEvent.keyDown(link, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute(expandedAttribute)).toBe('false');
    openProfile();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('region', { name: 'Profile' })).toBeNull();
    openProfile();
    act(() => screen.getByRole('link', { name: 'BENCH' }).focus());
    expect(trigger.getAttribute(expandedAttribute)).toBe('false');
    openProfile();
    openProfile();
    expect(trigger.getAttribute(expandedAttribute)).toBe('false');
  });

  it('keeps public browsing available without an auth key', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '');
    start();
    expect(screen.getByText(publicBenchmarks)).toBeTruthy();
    openProfile();
    fireEvent.click(screen.getByRole('link', { name: signInLabel }));
    expect(window.location.pathname).toBe('/sign-in');
    expect(screen.getByRole('status').textContent).toContain('Sign-in is currently unavailable');
    expect(clerk.provider).not.toHaveBeenCalled();
  });

  it('shows an unavailable message on a direct sign-in URL without a key', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '');
    start('/sign-in');
    expect(screen.getByRole('status').textContent).toContain('Sign-in is currently unavailable');
    expect(clerk.signIn).not.toHaveBeenCalled();
  });

  it('opens the sign-in page from the shared header', () => {
    start();
    openProfile();
    fireEvent.click(screen.getByRole('link', { name: signInLabel }));
    expect(window.location.pathname).toBe('/sign-in');
    expect(document.title).toBe('Sign in · Timmy Academy');
    expect(screen.getByText('Sign-in widget')).toBeTruthy();
  });

  it.each(['/sign-in', '/sign-in/factor-one'])(
    'supports the sign-in path and verification subroutes: %s',
    path => {
      start(path);
      expect(clerk.signIn).toHaveBeenCalledWith({
        routing: 'path',
        path: '/sign-in',
        signUpUrl: '/sign-up',
      });
      expect(screen.queryByText('Page not found')).toBeNull();
    },
  );

  it.each(['/sign-up', '/sign-up/verify-email-address'])(
    'supports sign-up and email verification: %s',
    path => {
      start(path);
      expect(clerk.signUp).toHaveBeenCalledWith({
        routing: 'path',
        path: '/sign-up',
        signInUrl: '/sign-in',
      });
      expect(document.title).toBe('Create account · Timmy Academy');
    },
  );

  it('shows session loading without blocking public content', () => {
    clerk.loaded = false;
    start();
    openProfile();
    expect(screen.getByRole('status').textContent).toBe('Loading account…');
    expect(screen.getByText(publicBenchmarks)).toBeTruthy();
    expect(screen.queryByRole('link', { name: signInLabel })).toBeNull();
  });

  it('uses the configured key and SPA navigation with a fixed post-login destination', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_live_fixture');
    start('/sign-in');
    expect(clerk.provider).toHaveBeenCalledWith(
      expect.objectContaining({
        publishableKey: 'pk_live_fixture',
        signInForceRedirectUrl: '/bench/',
        signUpForceRedirectUrl: '/bench/',
        telemetry: false,
      }),
    );
    const props = clerk.provider.mock.calls[0]?.[0];
    act(() => props?.routerPush('/sign-up'));
    expect(screen.getByText('Sign-up widget')).toBeTruthy();
    act(() => props?.routerReplace('/bench/'));
    expect(screen.getByText(publicBenchmarks)).toBeTruthy();
  });

  it('signs out only the current browser session and disables repeated submission', async () => {
    clerk.session = { id: 'private_browser_session' };

    let finish: () => void = () => {};

    clerk.signOut.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        }),
    );
    const view = start();
    openProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Signing out…' }).disabled).toBe(
      true,
    );
    expect(clerk.signOut).toHaveBeenCalledExactlyOnceWith({ sessionId: 'private_browser_session' });
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    clerk.session = null;
    view.rerender(
      <BrowserRouter>
        <BrowserAuthProvider>
          <App />
        </BrowserAuthProvider>
      </BrowserRouter>,
    );
    expect(screen.getByRole('link', { name: signInLabel })).toBeTruthy();
    expect(screen.getByText(publicBenchmarks)).toBeTruthy();
  });

  it('shows a retryable error without provider details when logout fails', async () => {
    clerk.session = { id: 'private_browser_session' };
    clerk.signOut.mockRejectedValue(new Error('private provider details'));
    start();
    openProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Could not sign out. Please try again.'),
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Sign out' }).disabled).toBe(
      false,
    );
  });

  it('does not show the sign-in widget to an already signed-in browser', () => {
    clerk.session = { id: 'private_browser_session' };
    start('/sign-in');
    expect(screen.getByText('You are signed in.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Browse benchmarks' })).toBeTruthy();
    expect(clerk.signIn).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('private_browser_session');
  });
});

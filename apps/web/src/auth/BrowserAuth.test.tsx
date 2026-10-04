import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App';
import { rememberBrowse } from '../bench/navigation';
import { loadConfig } from '../config';

import { BrowserAuthProvider } from './BrowserAuth';

import type { PublicConfig } from '@timmy/contracts';
import type { JSX, ReactNode } from 'react';

let config: PublicConfig;

interface ProviderProps {
  children: ReactNode;
  routerPush(url: string): void;
  routerReplace(url: string): void;
}

const clerk = vi.hoisted(() => ({
  loaded: true,
  metadata: {},
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
  useSession: (): {
    isLoaded: boolean;
    session: { id: string; user: { publicMetadata: Record<string, unknown> } } | null;
  } => ({
    isLoaded: clerk.loaded,
    session: clerk.session ? { ...clerk.session, user: { publicMetadata: clerk.metadata } } : null,
  }),
  useClerk: (): {
    signOut: typeof clerk.signOut;
    frontendApi: string;
    buildUserProfileUrl: () => string;
  } => ({
    signOut: clerk.signOut,
    frontendApi: 'fixture.clerk.accounts.dev',
    buildUserProfileUrl: () => 'https://fixture.accounts.dev/user',
  }),
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
      <BrowserAuthProvider config={config}>
        <App />
      </BrowserAuthProvider>
    </BrowserRouter>,
  );
}

beforeEach(() => {
  rememberBrowse('/bench/');
  vi.clearAllMocks();
  config = { clerkPublishableKey: 'pk_test_fixture' };
  clerk.loaded = true;
  clerk.metadata = {};
  clerk.session = null;
  clerk.signOut.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const continuation =
  'https://fixture.accounts.dev/oauth-consent?client_id=fixture&state=fixture&code_challenge=fixture&redirect_uri=http%3A%2F%2F127.0.0.1%3A50000%2Fcallback';

it.each(['/sign-in', '/sign-up'])('preserves OAuth continuation in %s', path => {
  const search = '?' + new URLSearchParams({ redirect_url: continuation }).toString();
  start(path + search);
  const widget = path === '/sign-in' ? clerk.signIn : clerk.signUp;
  expect(widget).toHaveBeenLastCalledWith(
    expect.objectContaining({ forceRedirectUrl: continuation }),
  );
  expect(widget.mock.lastCall?.[0]).toEqual(
    expect.objectContaining(
      path === '/sign-in'
        ? { signUpUrl: '/sign-up' + search, signUpForceRedirectUrl: continuation }
        : { signInUrl: '/sign-in' + search, signInForceRedirectUrl: continuation },
    ),
  );
});

it.each(['/sign-in', '/sign-up'])('resumes OAuth from an existing session on %s', path => {
  const replace = vi.fn();
  window.history.replaceState(
    null,
    '',
    path + '?' + new URLSearchParams({ redirect_url: continuation }).toString(),
  );
  const originalLocation = window.location;
  vi.stubGlobal('location', { ...originalLocation, replace });
  clerk.session = { id: 'private_browser_session' };
  render(
    <BrowserRouter>
      <BrowserAuthProvider config={config}>
        <App />
      </BrowserAuthProvider>
    </BrowserRouter>,
  );
  expect(replace).toHaveBeenCalledExactlyOnceWith(continuation);
  expect(screen.getByRole('status').textContent).toBe('Continuing desktop sign-in…');
  expect(screen.queryByText('You are signed in.')).toBeNull();
});

it('does not use an external redirect as an OAuth continuation', () => {
  start('/sign-in?redirect_url=https://untrusted.example/oauth/authorize-with-immediate-redirect');
  expect(clerk.signIn).toHaveBeenLastCalledWith({
    routing: 'path',
    path: '/sign-in',
    signUpUrl: '/sign-up',
  });
  expect(clerk.provider).toHaveBeenLastCalledWith(
    expect.objectContaining({ signInForceRedirectUrl: '/bench/' }),
  );
});

function openProfile(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
}

const publicBenchmarks = 'Public benchmarks';
const expandedAttribute = 'aria-expanded';
const signInLabel = 'Sign in with email →';
const signInUnavailable = 'Sign-in is currently unavailable';

describe('browser authentication in the main app', () => {
  it('keeps public browsing available when runtime config cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    config = await loadConfig();
    start();
    expect(screen.getByText(publicBenchmarks)).toBeTruthy();
    expect(clerk.provider).not.toHaveBeenCalled();
    openProfile();
    fireEvent.click(screen.getByRole('link', { name: signInLabel }));
    expect(screen.getByRole('status').textContent).toContain(signInUnavailable);
  });

  it.each(['admin', 'Admin', 'moderator', undefined])(
    'shows Admin only for the exact role: %s',
    role => {
      clerk.session = { id: 'session_admin' };
      clerk.metadata = { role };
      start();
      openProfile();
      expect(Boolean(screen.queryByRole('link', { name: 'Admin' }))).toBe(role === 'admin');
    },
  );

  it('preserves the admin sign-in destination through sign-up', () => {
    start('/sign-in?returnTo=/admin');
    expect(clerk.provider).toHaveBeenLastCalledWith(
      expect.objectContaining({
        signInForceRedirectUrl: '/admin',
        signUpForceRedirectUrl: '/admin',
      }),
    );
    expect(clerk.signIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ signUpUrl: '/sign-up?returnTo=%2Fadmin' }),
    );
  });
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
    config = { clerkPublishableKey: null };
    start();
    expect(screen.getByText(publicBenchmarks)).toBeTruthy();
    openProfile();
    fireEvent.click(screen.getByRole('link', { name: signInLabel }));
    expect(window.location.pathname).toBe('/sign-in');
    expect(screen.getByRole('status').textContent).toContain(signInUnavailable);
    expect(clerk.provider).not.toHaveBeenCalled();
  });

  it('shows an unavailable message on a direct sign-in URL without a key', () => {
    config = { clerkPublishableKey: null };
    start('/sign-in');
    expect(screen.getByRole('status').textContent).toContain(signInUnavailable);
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

  it.each(['/bench/', '/bench/?ram_gb=32&map=woods&limit=2'])(
    'returns to the remembered search after sign-in or sign-up: %s',
    destination => {
      rememberBrowse(destination);
      start('/sign-in');
      expect(clerk.provider).toHaveBeenLastCalledWith(
        expect.objectContaining({
          signInForceRedirectUrl: destination,
          signUpForceRedirectUrl: destination,
        }),
      );
      fireEvent.click(screen.getByRole('link', { name: '← Back to benchmarks' }));
      expect(window.location.pathname + window.location.search).toBe(destination);
      expect(screen.getByText(publicBenchmarks)).toBeTruthy();
    },
  );

  it('uses the configured key and SPA navigation with the default post-login destination', () => {
    config = { clerkPublishableKey: 'pk_live_fixture' };
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
        <BrowserAuthProvider config={config}>
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

it('returns a My Bench sign-in to the owner page and ignores external destinations', () => {
  start('/sign-in?returnTo=/bench/me');
  expect(clerk.provider).toHaveBeenLastCalledWith(
    expect.objectContaining({
      signInForceRedirectUrl: '/bench/me',
      signUpForceRedirectUrl: '/bench/me',
    }),
  );
  expect(clerk.signIn).toHaveBeenLastCalledWith(
    expect.objectContaining({ signUpUrl: '/sign-up?returnTo=%2Fbench%2Fme' }),
  );
  cleanup();
  start('/sign-in?returnTo=https://untrusted.example');
  expect(clerk.provider).toHaveBeenLastCalledWith(
    expect.objectContaining({ signInForceRedirectUrl: '/bench/' }),
  );
});

it('preserves owner filters through sign-in and sign-up', () => {
  const destination = '/bench/me?status=rejected#runs';
  const search = new URLSearchParams({ returnTo: destination }).toString();
  start('/sign-in?' + search);
  expect(clerk.provider).toHaveBeenLastCalledWith(
    expect.objectContaining({
      signInForceRedirectUrl: destination,
      signUpForceRedirectUrl: destination,
    }),
  );
  expect(clerk.signIn).toHaveBeenLastCalledWith(
    expect.objectContaining({ signUpUrl: '/sign-up?' + search }),
  );
});

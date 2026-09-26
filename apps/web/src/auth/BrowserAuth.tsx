import { ClerkProvider, SignIn, SignUp, useClerk, useSession } from '@clerk/react';
import { createContext, useContext, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router';

import { lastBrowse } from '../bench/navigation';
import { readConfig } from '../config';
import { Button } from '../elements/Button';
import { Message } from '../elements/Message';

import { oauthContinuation } from './oauth-continuation';

import type { JSX, ReactNode } from 'react';

interface BrowserSession {
  canModerate: boolean;
  sessionKey: string | null;
  status: 'unavailable' | 'loading' | 'signed-out' | 'signed-in';
  signOut: () => Promise<void>;
}

const SessionContext = createContext<BrowserSession>({
  canModerate: false,
  sessionKey: null,
  status: 'unavailable',
  signOut: () => Promise.resolve(),
});

function SessionProvider({ children }: Readonly<{ children: ReactNode }>): JSX.Element {
  const { isLoaded, session } = useSession();
  const clerk = useClerk();
  const loadedStatus = session ? 'signed-in' : 'signed-out';

  return (
    <SessionContext.Provider
      value={{
        canModerate: isLoaded && session?.user.publicMetadata.role === 'admin',
        sessionKey: session?.id ?? null,
        status: isLoaded ? loadedStatus : 'loading',
        async signOut(): Promise<void> {
          if (session) {
            await clerk.signOut({ sessionId: session.id });
          }
        },
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function BrowserAuthProvider({ children }: Readonly<{ children: ReactNode }>): JSX.Element {
  const navigate = useNavigate();
  const { search } = useLocation();
  const destination = signInDestination(search);
  const { auth } = readConfig();

  if (!auth) {
    return <>{children}</>;
  }

  return (
    <ClerkProvider
      publishableKey={auth.publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInForceRedirectUrl={destination}
      signUpForceRedirectUrl={destination}
      routerPush={url => void navigate(url)}
      routerReplace={url => void navigate(url, { replace: true })}
      telemetry={false}
    >
      <SessionProvider>{children}</SessionProvider>
    </ClerkProvider>
  );
}

export function useBrowserSession(): BrowserSession {
  return useContext(SessionContext);
}

export function BrowserAuthForm({ mode }: Readonly<{ mode: 'sign-in' | 'sign-up' }>): JSX.Element {
  const { status } = useBrowserSession();

  if (status === 'unavailable') {
    return (
      <Message role="status">
        Sign-in is currently unavailable. You can still browse benchmarks.
      </Message>
    );
  }

  if (status === 'loading') {
    return <Message role="status">Loading sign-in…</Message>;
  }

  return <AvailableAuthForm mode={mode} />;
}

function AvailableAuthForm({ mode }: Readonly<{ mode: 'sign-in' | 'sign-up' }>): JSX.Element {
  const { status } = useBrowserSession();
  const clerk = useClerk();
  const { search } = useLocation();
  const continuation = oauthContinuation(search, clerk.frontendApi, clerk.buildUserProfileUrl());
  const destination = signInDestination(search);
  const webSuffix =
    destination === '/bench/me' || destination === '/admin' ? '?returnTo=' + destination : '';
  const suffix = continuation
    ? '?' + new URLSearchParams({ redirect_url: continuation }).toString()
    : webSuffix;
  const signInRedirect = continuation
    ? { forceRedirectUrl: continuation, signUpForceRedirectUrl: continuation }
    : {};
  const signUpRedirect = continuation
    ? { forceRedirectUrl: continuation, signInForceRedirectUrl: continuation }
    : {};

  useEffect(() => {
    if (status === 'signed-in' && continuation) {
      window.location.replace(continuation);
    }
  }, [status, continuation]);

  if (status === 'signed-in' && continuation) {
    return <Message role="status">Continuing desktop sign-in…</Message>;
  }

  if (status === 'signed-in') {
    const pageLabel = destination === '/admin' ? 'Admin' : 'My Bench';

    return (
      <Message>
        You are signed in.{' '}
        <Button href={destination}>{suffix ? pageLabel : 'Browse benchmarks'}</Button>
      </Message>
    );
  }

  return mode === 'sign-in' ? (
    <SignIn routing="path" path="/sign-in" signUpUrl={'/sign-up' + suffix} {...signInRedirect} />
  ) : (
    <SignUp routing="path" path="/sign-up" signInUrl={'/sign-in' + suffix} {...signUpRedirect} />
  );
}

function signInDestination(search: string): string {
  const destination = new URLSearchParams(search).get('returnTo');

  return destination === '/bench/me' || destination === '/admin' ? destination : lastBrowse();
}

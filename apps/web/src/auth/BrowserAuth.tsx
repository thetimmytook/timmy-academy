import { ClerkProvider, SignIn, SignUp, useClerk, useSession } from '@clerk/react';
import { createContext, useContext } from 'react';
import { useNavigate } from 'react-router';

import { readConfig } from '../config';
import { Button } from '../elements/Button';
import { Message } from '../elements/Message';

import type { JSX, ReactNode } from 'react';

interface BrowserSession {
  status: 'unavailable' | 'loading' | 'signed-out' | 'signed-in';
  signOut: () => Promise<void>;
}

const SessionContext = createContext<BrowserSession>({
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
  const { auth } = readConfig();

  if (!auth) {
    return <>{children}</>;
  }

  return (
    <ClerkProvider
      publishableKey={auth.publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInForceRedirectUrl="/bench/"
      signUpForceRedirectUrl="/bench/"
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

  if (status === 'signed-in') {
    return (
      <Message>
        You are signed in. <Button href="/bench/">Browse benchmarks</Button>
      </Message>
    );
  }

  return mode === 'sign-in' ? (
    <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
  ) : (
    <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
  );
}

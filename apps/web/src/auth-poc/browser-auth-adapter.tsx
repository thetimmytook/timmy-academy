import {
  ClerkProvider,
  OAuthConsent,
  RedirectToSignIn,
  SignIn,
  SignUp,
  useClerk,
  useSession,
} from '@clerk/react';

import type { JSX } from 'react';

export interface BrowserSession {
  signedIn: boolean;
  signOut(): Promise<void>;
}

interface AdapterProps {
  readonly screen: 'home' | 'sign-in' | 'sign-up' | 'consent';
  readonly children: (session: BrowserSession) => JSX.Element;
}

function BrowserSessionView({ screen, children }: AdapterProps): JSX.Element {
  const { isLoaded, session } = useSession();
  const clerk = useClerk();

  if (!isLoaded) {
    return <p role="status">Loading browser session…</p>;
  }

  if (screen === 'consent') {
    return session ? <OAuthConsent /> : <RedirectToSignIn />;
  }

  if (screen === 'sign-in') {
    return <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />;
  }

  if (screen === 'sign-up') {
    return <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />;
  }

  return children({
    signedIn: Boolean(session),
    async signOut(): Promise<void> {
      if (session) {
        // End this browser session; desktop OAuth revocation is a separate operation.
        await clerk.signOut({ sessionId: session.id });
      }
    },
  });
}

/** Clerk types and widgets stay at the isolated browser adapter boundary. */
export function BrowserAuthAdapter(props: AdapterProps): JSX.Element {
  const key: unknown = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

  // Local test harness only. Do not load Clerk for production keys or non-loopback hosts.
  if (
    !['127.0.0.1', 'localhost'].includes(window.location.hostname) ||
    typeof key !== 'string' ||
    !key.startsWith('pk_test_') ||
    key === 'pk_test_REPLACE'
  ) {
    return <p role="status">Configure the local development publishable key before testing.</p>;
  }

  return (
    <ClerkProvider
      publishableKey={key}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      telemetry={false}
    >
      <BrowserSessionView {...props} />
    </ClerkProvider>
  );
}

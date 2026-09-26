import { useState } from 'react';
import { useLocation } from 'react-router';

import { css } from '../../styled-system/css';
import { BrowserAuthAdapter } from '../auth-poc/browser-auth-adapter';
import { Button } from '../elements/Button';
import { Message } from '../elements/Message';

import type { BrowserSession } from '../auth-poc/browser-auth-adapter';
import type { JSX } from 'react';

function SessionControls({ session }: { readonly session: BrowserSession }): JSX.Element {
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function signOut(): Promise<void> {
    setBusy(true);
    setFailed(false);

    try {
      await session.signOut();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p role="status">Browser session: {session.signedIn ? 'signed in' : 'signed out'}.</p>
      {session.signedIn ? (
        <Button disabled={busy} onClick={() => void signOut()}>
          Sign out of this browser
        </Button>
      ) : (
        <Button href="/sign-in">Sign in with email</Button>
      )}
      {failed && <Message role="alert">Browser sign-out failed. Try again.</Message>}
      <p>Start desktop sign-in from the separate Windows harness in the same browser profile.</p>
    </>
  );
}

function screenForPath(path: string): 'home' | 'sign-in' | 'sign-up' | 'consent' {
  if (path === '/sign-in' || path.startsWith('/sign-in/')) {
    return 'sign-in';
  }

  if (path === '/sign-up' || path.startsWith('/sign-up/')) {
    return 'sign-up';
  }

  return path === '/oauth/consent' ? 'consent' : 'home';
}

export function AuthPocPage(): JSX.Element {
  const { pathname } = useLocation();
  const screen = screenForPath(pathname);

  return (
    <main className={css({ maxWidth: '720px', margin: 'auto', padding: '6' })}>
      <h1>Academy auth proof of concept</h1>
      <p>Local development test only.</p>
      <BrowserAuthAdapter screen={screen}>
        {session => <SessionControls session={session} />}
      </BrowserAuthAdapter>
    </main>
  );
}

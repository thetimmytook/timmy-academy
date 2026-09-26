import { useEffect, useId, useRef, useState } from 'react';

import { css } from '../../styled-system/css';
import { panel } from '../../styled-system/recipes';
import { Button } from '../elements/Button';
import { Message } from '../elements/Message';

import { useBrowserSession } from './BrowserAuth';

import type { JSX } from 'react';

export function SessionControls(): JSX.Element {
  const { status, signOut, canModerate } = useBrowserSession();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    function dismiss(event: PointerEvent | FocusEvent): void {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function escape(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    }

    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    document.addEventListener('keydown', escape);

    return (): void => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  async function logOut(): Promise<void> {
    setPending(true);
    setFailed(false);

    try {
      await signOut();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div ref={container} className={css({ ml: 'auto', position: 'relative' })}>
      <Button
        ref={trigger}
        variant="ghost"
        aria-label="Profile"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="7" r="4" />
          <path d="M4 22v-4a8 8 0 0 1 16 0v4z" />
        </svg>
      </Button>
      {open && (
        <section
          id={panelId}
          aria-label="Profile"
          className={
            panel() +
            ' ' +
            css({
              position: 'absolute',
              right: '0',
              top: '100%',
              mt: '2',
              zIndex: 3,
              width: '16rem',
              maxWidth: 'calc(100vw - 2rem)',
              boxShadow: 'overlay',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: '3',
            })
          }
        >
          {status === 'loading' && <p role="status">Loading account…</p>}
          {(status === 'signed-out' || status === 'unavailable') && (
            <>
              <p>My Bench requires sign-in</p>
              <Button
                href="/sign-in?returnTo=/bench/me"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                Sign in with email →
              </Button>
            </>
          )}
          {status === 'signed-in' && (
            <>
              <p className={css({ fontWeight: 'semibold' })}>Your account</p>
              <Button href="/bench/me" variant="ghost" onClick={() => setOpen(false)}>
                My Bench
              </Button>
              {canModerate && (
                <Button href="/admin" variant="ghost" onClick={() => setOpen(false)}>
                  Admin
                </Button>
              )}
              <Button variant="ghost" disabled={pending} onClick={() => void logOut()}>
                {pending ? 'Signing out…' : 'Sign out'}
              </Button>
              {failed && (
                <Message tone="danger" role="alert">
                  Could not sign out. Please try again.
                </Message>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

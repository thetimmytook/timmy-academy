import { css } from '../../styled-system/css';
import { useBrowserSession } from '../auth/BrowserAuth';
import { Approvals } from '../bench/Approvals';
import { stack } from '../bench/styles';
import { Button } from '../elements/Button';
import { Message } from '../elements/Message';

import type { JSX } from 'react';

export default function AdminPage(): JSX.Element {
  const { status, sessionKey, canModerate } = useBrowserSession();

  return (
    <div className={stack}>
      <h1 className={css({ textStyle: 'h1' })}>Admin</h1>
      {status === 'loading' && <Message role="status">Loading account…</Message>}
      {status === 'unavailable' && <Message>Sign-in is currently unavailable.</Message>}
      {status === 'signed-out' && (
        <Message>
          Sign in to access administration. <Button href="/sign-in?returnTo=/admin">Sign in</Button>
        </Message>
      )}
      {status === 'signed-in' && !canModerate && (
        <Message role="alert">Administrator access is required.</Message>
      )}
      {status === 'signed-in' && canModerate && (
        <div
          className={css({
            display: 'grid',
            gap: '6',
            alignItems: 'start',
            gridTemplateColumns: { base: 'minmax(0, 1fr)', tablet: '12rem minmax(0, 1fr)' },
          })}
        >
          <nav aria-label="Admin navigation">
            <Button href="/admin" variant="ghost" aria-current="page">
              Approvals
            </Button>
          </nav>
          <Approvals key={sessionKey} />
        </div>
      )}
    </div>
  );
}

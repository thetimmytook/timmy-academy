import { css } from '../../styled-system/css';
import { useBrowserSession } from '../auth/BrowserAuth';
import { OwnerRuns } from '../bench/OwnerRuns';
import { muted, stack } from '../bench/styles';
import { Button } from '../elements/Button';
import { Message } from '../elements/Message';

import type { JSX } from 'react';

export default function MyBenchPage(): JSX.Element {
  const { status, sessionKey } = useBrowserSession();

  return (
    <div className={stack}>
      <h1 className={css({ textStyle: 'h1' })}>My Bench</h1>
      <p className={muted}>
        Runs you submitted from the Windows Benchmark app. Local captures stay on your device.
      </p>
      {status === 'loading' && <Message role="status">Loading account…</Message>}
      {status === 'unavailable' && (
        <Message role="status">
          Sign-in is currently unavailable. You can still browse benchmarks.
        </Message>
      )}
      {status === 'signed-out' && (
        <Message>
          Sign in to see your submissions.{' '}
          <Button href="/sign-in?returnTo=/bench/me">Sign in</Button>
        </Message>
      )}
      {status === 'signed-in' && <OwnerRuns key={sessionKey} />}
    </div>
  );
}

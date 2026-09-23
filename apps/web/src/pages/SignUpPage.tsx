import { css } from '../../styled-system/css';
import { BrowserAuthForm } from '../auth/BrowserAuth';
import { lastBrowse } from '../bench/navigation';
import { Button } from '../elements/Button';

import type { JSX } from 'react';

export default function SignUpPage(): JSX.Element {
  return (
    <section
      aria-label="Create account"
      className={css({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: '6' })}
    >
      <Button href={lastBrowse()} variant="link">
        ← Back to benchmarks
      </Button>
      <BrowserAuthForm mode="sign-up" />
    </section>
  );
}

import { BrowserAuthForm } from '../auth/BrowserAuth';

import type { JSX } from 'react';

export default function SignUpPage(): JSX.Element {
  return (
    <section aria-label="Create account">
      <BrowserAuthForm mode="sign-up" />
    </section>
  );
}

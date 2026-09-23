import { BrowserAuthForm } from '../auth/BrowserAuth';

import type { JSX } from 'react';

export default function SignInPage(): JSX.Element {
  return (
    <section aria-label="Sign in">
      <BrowserAuthForm mode="sign-in" />
    </section>
  );
}

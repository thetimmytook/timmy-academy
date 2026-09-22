import { Button } from './Button';
import { Message } from './Message';

import type { JSX } from 'react';

export function ErrorMessage({
  message,
  retry,
}: Readonly<{ message: string; retry: () => void }>): JSX.Element {
  return (
    <Message tone="danger">
      <p role="alert">{message}</p>
      <Button variant="link" onClick={retry}>
        Retry
      </Button>
    </Message>
  );
}

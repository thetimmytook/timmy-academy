import { Button } from './Button';
import { Message } from './Message';

export function ErrorMessage({ message, retry }: Readonly<{ message: string; retry: () => void }>) {
  return (
    <Message tone="danger">
      <p role="alert">{message}</p>
      <Button variant="link" onClick={retry}>
        Retry
      </Button>
    </Message>
  );
}

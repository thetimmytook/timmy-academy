import { benchmarkErrorSchema } from '@timmy/contracts';
import { useEffect, useState } from 'react';

type Parser<T> = { parse: (value: unknown) => T };
type Result<T> = { url: string; data?: T; error?: string };
const unavailable = 'Unable to load benchmark data. Please retry.';
const errorMessages = new Map([
  ['authentication_required', 'Your session has expired. Please sign in again.'],
  ['email_verification_required', 'Verify your email to view your submissions.'],
  ['not_found', 'This public run is unavailable. It may have been removed.'],
  ['invalid_input', 'These search parameters are invalid. Clear the filters to start again.'],
  ['invalid_cursor', 'This page link is no longer valid. Return to the first page.'],
  ['cursor_stale', 'Results have changed. Return to the first page.'],
  ['group_key_stale', 'This group has changed. Return to the first page.'],
  ['rate_limited', 'Too many requests. Please wait a moment and retry.'],
]);

async function read<T>(url: string, schema: Parser<T>, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const body: unknown = await response.json();

  if (!response.ok) {
    const parsed = benchmarkErrorSchema.safeParse(body);
    throw new Error(
      parsed.success ? (errorMessages.get(parsed.data.code) ?? unavailable) : unavailable,
    );
  }

  return schema.parse(body);
}

export function useResource<T>(
  url: string,
  schema: Parser<T>,
): { data: T | undefined; error: string | undefined; retry: () => void } {
  const [result, setResult] = useState<Result<T>>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void read(url, schema, controller.signal)
      .then(data => {
        if (!controller.signal.aborted) {
          setResult({ url, data });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            url,
            error:
              error instanceof Error && errorMessagesHas(error.message)
                ? error.message
                : unavailable,
          });
        }
      });

    return (): void => controller.abort();
  }, [url, schema, attempt]);
  const current = result?.url === url ? result : undefined;

  return {
    data: current?.data,
    error: current?.error,
    retry: (): void => {
      setResult(undefined);
      setAttempt(value => value + 1);
    },
  };
}

function errorMessagesHas(message: string): boolean {
  return [...errorMessages.values()].includes(message);
}

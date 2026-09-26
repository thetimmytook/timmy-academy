import { deletePublicationResponseSchema } from '@timmy/contracts';
import { useEffect, useRef, useState } from 'react';

import { css } from '../../styled-system/css';
import { useApiFetch } from '../auth/useApiFetch';
import { Button } from '../elements/Button';
import { Message } from '../elements/Message';

import { stack } from './styles';

import type { JSX } from 'react';

const unavailable = 'Unable to confirm deletion. Please retry.';

export function DeletePublication({
  publicRunId,
  onDeleted,
}: Readonly<{ publicRunId: string; onDeleted: () => void }>): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const apiFetch = useApiFetch();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => (): void => request.current?.abort(), []);
  useEffect(() => {
    if (confirming) {
      cancel.current?.focus();
    }
  }, [confirming]);

  async function remove(): Promise<void> {
    if (request.current) {
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(undefined);

    try {
      const response = await apiFetch('/api/bench/v1/me/runs/' + publicRunId, {
        method: 'DELETE',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(unavailable);
      }

      const receipt = deletePublicationResponseSchema.parse(await response.json());

      if (receipt.public_run_id !== publicRunId) {
        throw new Error(unavailable);
      }

      if (!controller.signal.aborted) {
        onDeleted();
      }
    } catch {
      if (!controller.signal.aborted) {
        setError(unavailable);
      }
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setPending(false);
      }
    }
  }

  return (
    <div className={stack}>
      <Button ref={trigger} aria-expanded={confirming} onClick={() => setConfirming(true)}>
        Delete publication
      </Button>
      {confirming && (
        <Message role="group" aria-label="Confirm publication deletion" className={stack}>
          <p>
            Delete this publication? It will disappear from public search and comparisons. Your
            local Windows capture will remain on your computer. This cannot be undone.
          </p>
          {error && <p role="alert">{error}</p>}
          {pending && <p role="status">Deleting publication…</p>}
          <div className={css({ display: 'flex', gap: '3', flexWrap: 'wrap' })}>
            <Button disabled={pending} onClick={() => void remove()}>
              Yes, delete publication
            </Button>
            <Button
              ref={cancel}
              disabled={pending}
              onClick={() => {
                setConfirming(false);
                setError(undefined);
                trigger.current?.focus();
              }}
            >
              No, keep it
            </Button>
          </div>
        </Message>
      )}
    </div>
  );
}

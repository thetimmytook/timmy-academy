import { moderationDecisionResponseSchema } from '@timmy/contracts';
import { useEffect, useRef, useState } from 'react';

import { css } from '../../styled-system/css';
import { useApiFetch } from '../auth/useApiFetch';
import { Button } from '../elements/Button';
import { Message } from '../elements/Message';

import { stack } from './styles';

import type { ModerationDecision } from '@timmy/contracts';
import type { JSX } from 'react';

const unavailable = 'Unable to confirm the decision. Please retry.';
const errors = new Map([
  [409, 'This submission already has a different decision. Refresh the queue.'],
  [403, 'Administrator access is required.'],
  [401, 'Your session has expired. Please sign in again.'],
]);

export function ModerationActions({
  submissionId,
  onChanged,
}: Readonly<{
  submissionId: number;
  onChanged: () => void;
}>): JSX.Element {
  const [decision, setDecision] = useState<ModerationDecision>();
  const apiFetch = useApiFetch();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<AbortController | null>(null);
  useEffect(() => (): void => request.current?.abort(), []);

  async function submit(selected: ModerationDecision): Promise<void> {
    if (request.current) {
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(undefined);

    try {
      const response = await apiFetch(`/api/admin/v1/approvals/${submissionId}/${selected}`, {
        method: 'POST',
        signal: controller.signal,
      });

      if (!response.ok) {
        const message = errors.get(response.status) ?? unavailable;

        if (!controller.signal.aborted) {
          setError(message);
        }

        return;
      }

      const receipt = moderationDecisionResponseSchema.parse(await response.json());

      if (
        receipt.submission_id !== submissionId ||
        receipt.publication_status !== (selected === 'approve' ? 'published' : 'rejected')
      ) {
        throw new Error(unavailable);
      }

      if (!controller.signal.aborted) {
        onChanged();
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
      <div className={css({ display: 'flex', gap: '3', flexWrap: 'wrap' })}>
        <Button
          disabled={pending}
          onClick={() => {
            setDecision('approve');
            setError(undefined);
          }}
        >
          Approve
        </Button>
        <Button
          disabled={pending}
          onClick={() => {
            setDecision('reject');
            setError(undefined);
          }}
        >
          Reject
        </Button>
      </div>
      {decision && (
        <Message role="group" aria-label="Confirm moderation decision" className={stack}>
          <p>
            {decision === 'approve'
              ? 'Publish this measurement for everyone to see?'
              : 'Reject this submission? The measurement will remain private.'}
          </p>
          {error && <p role="alert">{error}</p>}
          {pending && <p role="status">Saving decision…</p>}
          <div className={css({ display: 'flex', gap: '3', flexWrap: 'wrap' })}>
            <Button disabled={pending} onClick={() => void submit(decision)}>
              {decision === 'approve' ? 'Confirm approval' : 'Confirm rejection'}
            </Button>
            <Button disabled={pending} onClick={() => setDecision(undefined)}>
              Cancel
            </Button>
            {error && (
              <Button disabled={pending} onClick={onChanged}>
                Refresh queue
              </Button>
            )}
          </div>
        </Message>
      )}
    </div>
  );
}

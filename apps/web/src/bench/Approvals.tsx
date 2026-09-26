import { moderationQueueSchema } from '@timmy/contracts';
import { useState } from 'react';

import { css } from '../../styled-system/css';
import { panel } from '../../styled-system/recipes';
import { Button } from '../elements/Button';
import { ErrorMessage } from '../elements/ErrorMessage';
import { Message } from '../elements/Message';

import { execution, number } from './format';
import { ModerationActions } from './ModerationActions';
import { useResource } from './resource';
import { muted, stack } from './styles';
import { SubmissionReview } from './SubmissionReview';

import type { JSX } from 'react';

export function Approvals(): JSX.Element {
  const [after, setAfter] = useState<number>();
  const { data, error, retry } = useResource(
    '/api/admin/v1/approvals' + (after === undefined ? '' : '?after=' + after),
    moderationQueueSchema,
  );

  function refresh(): void {
    setAfter(undefined);

    if (after === undefined) {
      retry();
    }
  }

  return (
    <section aria-label="Pending approvals" className={stack}>
      <h2 className={css({ textStyle: 'h2' })}>Approvals</h2>
      <Button onClick={refresh}>Refresh queue</Button>
      {error && <ErrorMessage message={error} retry={retry} />}
      {!data && !error && <Message role="status">Loading submissions…</Message>}
      {data?.items.length === 0 && <Message>No pending submissions on this page.</Message>}
      {data?.items.map(item => (
        <article key={item.submission_id} className={`${panel()} ${stack}`}>
          <h3 className={css({ textStyle: 'h3', overflowWrap: 'anywhere' })}>
            {item.run.hardware.cpu.name} · {item.run.hardware.gpu.name} · {item.run.hardware.ram_gb}{' '}
            GB RAM
          </h3>
          <p>
            {item.run.conditions.map.name} · {execution(item.run.conditions.execution)} ·{' '}
            {number(item.run.metrics.average_fps)} FPS
          </p>
          <p className={muted}>Submitted {item.submitted_at.slice(0, 10)}</p>
          <SubmissionReview run={item.run} />
          <ModerationActions submissionId={item.submission_id} onChanged={refresh} />
        </article>
      ))}
      <div className={css({ display: 'flex', gap: '3', flexWrap: 'wrap' })}>
        {after !== undefined && <Button onClick={refresh}>First page</Button>}
        {data?.next_after != null && (
          <Button onClick={() => setAfter(data.next_after!)}>Next page →</Button>
        )}
      </div>
    </section>
  );
}

import { ownerRunsQuerySchema, ownerRunsResponseSchema } from '@timmy/contracts';
import { useSearchParams } from 'react-router';

import { css } from '../../styled-system/css';
import { panel } from '../../styled-system/recipes';
import { Button } from '../elements/Button';
import { Dropdown } from '../elements/Dropdown';
import { ErrorMessage } from '../elements/ErrorMessage';
import { Field } from '../elements/Field';
import { Message } from '../elements/Message';

import { DeletePublication } from './DeletePublication';
import { execution, number, resolution, words } from './format';
import { useResource } from './resource';
import { muted, stack } from './styles';

import type { OwnerRunsQuery } from '@timmy/contracts';
import type { JSX } from 'react';

export function OwnerRuns(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const parsed = ownerRunsQuerySchema.safeParse(Object.fromEntries(params));

  if (!parsed.success || [...params.keys()].some(key => params.getAll(key).length !== 1)) {
    return (
      <Message role="alert">
        These list parameters are invalid. <Button onClick={() => setParams({})}>Reset list</Button>
      </Message>
    );
  }

  return (
    <div className={stack}>
      <Field label="Publication status">
        <Dropdown
          value={parsed.data.status}
          onChange={event => setParams({ status: event.target.value })}
        >
          <option value="all">All statuses</option>
          <option value="pending_review">Pending review</option>
          <option value="published">Published</option>
          <option value="rejected">Rejected</option>
        </Dropdown>
      </Field>
      <OwnerRunList query={parsed.data} />
    </div>
  );
}

function OwnerRunList({ query }: Readonly<{ query: OwnerRunsQuery }>): JSX.Element {
  const [, setParams] = useSearchParams();
  const params = new URLSearchParams({ status: query.status, limit: String(query.limit) });

  if (query.cursor) {
    params.set('cursor', query.cursor);
  }

  const { data, error, retry } = useResource(
    '/api/bench/v1/me/runs?' + params.toString(),
    ownerRunsResponseSchema,
  );

  function page(cursor?: string): void {
    const next = new URLSearchParams({ status: query.status, limit: String(query.limit) });

    if (cursor) {
      next.set('cursor', cursor);
    }

    setParams(next);
  }

  return (
    <section aria-label="Your submissions" className={stack}>
      {error && <ErrorMessage message={error} retry={retry} />}
      {!data && !error && <Message role="status">Loading submissions…</Message>}
      {data?.items.length === 0 && <Message>No submissions match this status.</Message>}
      {data?.items.map(item => (
        <article
          key={item.client_run_id}
          className={panel() + ' ' + css({ display: 'grid', gap: '2', overflowWrap: 'anywhere' })}
        >
          <h2 className={css({ textStyle: 'h3' })}>
            {item.hardware.cpu} · {item.hardware.gpu} · {item.hardware.ram_gb} GB RAM
          </h2>
          <p>{words(item.publication_status)}</p>
          <p>
            {item.map.name} · {execution(item.execution)} · {resolution(item.game_resolution)}
          </p>
          <p className={muted}>
            Captured {item.captured_day} · Submitted {item.submitted_at.slice(0, 10)}
          </p>
          <p>
            Average FPS: {number(item.metrics.average_fps)} · 1% low:{' '}
            {number(item.metrics.one_percent_low_fps)}
          </p>
          {item.publication_status === 'published' && (
            <>
              <Button href={item.url} variant="link">
                Open public run →
              </Button>
              <DeletePublication
                publicRunId={item.public_run_id}
                onDeleted={() => {
                  page();

                  if (!query.cursor) {
                    retry();
                  }
                }}
              />
            </>
          )}
        </article>
      ))}
      <div className={css({ display: 'flex', gap: '3', flexWrap: 'wrap' })}>
        {query.cursor && <Button onClick={() => page()}>First page</Button>}
        {data?.next_cursor && (
          <Button onClick={() => page(data.next_cursor ?? undefined)}>Next page →</Button>
        )}
      </div>
    </section>
  );
}

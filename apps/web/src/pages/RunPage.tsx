import { publicRunDetailSchema } from '@timmy/contracts';

import { useResource } from '../bench/resource';
import { RunDetails } from '../bench/RunDetails';
import { stack } from '../bench/styles';
import { Button } from '../elements/Button';
import { ErrorMessage } from '../elements/ErrorMessage';

export default function RunPage({ id, back }: Readonly<{ id: string; back: string }>) {
  const { data, error, retry } = useResource(
    `/api/bench/v1/runs/${encodeURIComponent(id)}`,
    publicRunDetailSchema,
  );

  return (
    <div className={stack}>
      <Button variant="link" href={back}>
        ← Back to search results
      </Button>
      {error && <ErrorMessage message={error} retry={retry} />}
      {!data && !error && <p role="status">Loading public run…</p>}
      {data && <RunDetails key={data.public_run_id} run={data} />}
    </div>
  );
}

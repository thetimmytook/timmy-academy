import { groupRunsResponseSchema } from '@timmy/contracts';

import { css } from '../../styled-system/css';
import { panel } from '../../styled-system/recipes';
import { Button } from '../elements/Button';
import { ErrorMessage } from '../elements/ErrorMessage';
import { navigate } from '../routing';

import { counted } from './format';
import { browseUrl, resetPage, searchParameters } from './navigation';
import { useResource } from './resource';
import { RunList } from './RunList';
import { RunPagination } from './RunPagination';
import { muted, stack } from './styles';

import type { HardwareGroup } from '@timmy/contracts';

function ExpandedRuns({
  group,
  params,
}: Readonly<{ group: HardwareGroup; params: URLSearchParams }>) {
  const query = searchParameters(params);
  query.delete('cursor');
  query.set('view', 'items');
  query.set('group_key', group.group_key);
  query.set('limit', '5');
  const cursor = params.get('item_cursor');

  if (cursor) {
    query.set('cursor', cursor);
  }

  const { data, error, retry } = useResource(
    `/api/bench/v1/runs?${query}`,
    groupRunsResponseSchema,
  );

  if (error) {
    return (
      <>
        <ErrorMessage message={error} retry={retry} />
        <Button variant="link" href={browseUrl(resetPage(params))}>
          Return to the first page
        </Button>
      </>
    );
  }

  if (!data) {
    return <p role="status">Loading runs…</p>;
  }

  return (
    <>
      <RunList runs={data.items} />
      <RunPagination params={params} next={data.next_cursor} item />
    </>
  );
}

export function HardwareGroupCard({
  group,
  params,
}: Readonly<{ group: HardwareGroup; params: URLSearchParams }>) {
  const expanded = params.get('expanded') === group.group_key;
  const regionId = `runs-${group.group_key}`;

  return (
    <article className={`${panel()} ${stack}`}>
      <div>
        <h2 className={css({ textStyle: 'h3' })}>
          {group.hardware.cpu.name} · {group.hardware.gpu.name} · {group.hardware.ram_gb} GB RAM
        </h2>
        <p className={muted}>
          {counted(group.run_count, 'run')} · {counted(group.contributor_count, 'contributor')} ·{' '}
          {counted(group.map_count, 'map')}
        </p>
      </div>
      <div id={regionId}>
        {expanded ? (
          <ExpandedRuns group={group} params={params} />
        ) : (
          <RunList runs={group.preview_runs} />
        )}
      </div>
      <Button
        variant="link"
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={() => {
          const next = new URLSearchParams(params);
          next.delete('item_cursor');

          if (expanded) {
            next.delete('expanded');
          } else {
            next.set('expanded', group.group_key);
          }

          navigate(browseUrl(next));
        }}
      >
        {expanded
          ? 'Show preview'
          : `Show all ${counted(group.run_count, 'run')} across ${counted(group.map_count, 'map')} (${counted(group.remaining_run_count, 'more run')})`}
      </Button>
    </article>
  );
}

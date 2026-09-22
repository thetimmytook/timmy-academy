import { groupSearchResponseSchema } from '@timmy/contracts';

import { css } from '../../styled-system/css';
import { panel } from '../../styled-system/recipes';
import { Button } from '../elements/Button';
import { ErrorMessage } from '../elements/ErrorMessage';

import { counted } from './format';
import { HardwareGroupCard } from './HardwareGroupCard';
import { browseUrl, resetPage, searchParameters } from './navigation';
import { useResource } from './resource';
import { RunPagination } from './RunPagination';
import { muted, stack } from './styles';

export function SearchResults({ params }: Readonly<{ params: URLSearchParams }>) {
  const query = searchParameters(params);
  const { data, error, retry } = useResource(
    `/api/bench/v1/runs?${query}`,
    groupSearchResponseSchema,
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
    return <p role="status">Loading benchmark results…</p>;
  }

  return (
    <section aria-label="Search results" className={stack}>
      <p role="status">
        {counted(data.summary.group_count, 'hardware configuration')} ·{' '}
        {counted(data.summary.run_count, 'run')} ·{' '}
        {counted(data.summary.contributor_count, 'contributor')}
      </p>
      {data.groups.length === 0 && (
        <div className={panel()}>
          <h2 className={css({ textStyle: 'h3' })}>No matching runs</h2>
          <p className={muted}>
            No published measurements match these conditions. Change or clear filters to explore
            other runs.
          </p>
        </div>
      )}
      {data.groups.map(group => (
        <HardwareGroupCard key={group.group_key} group={group} params={params} />
      ))}
      <RunPagination params={params} next={data.next_cursor} />
    </section>
  );
}

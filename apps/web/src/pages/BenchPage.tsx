import { runSearchQuerySchema } from '@timmy/contracts';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';

import { css } from '../../styled-system/css';
import { FilterDropdown } from '../bench/FilterDropdown';
import { Filters } from '../bench/Filters';
import { browseUrl, rememberBrowse, resetPage, searchParameters } from '../bench/navigation';
import { SearchResults } from '../bench/SearchResults';
import { muted, stack } from '../bench/styles';

import type { JSX } from 'react';

export default function BenchPage({ url }: Readonly<{ url: string }>): JSX.Element {
  const navigate = useNavigate();
  const params = new URL(url, window.location.origin).searchParams;
  const parsed = runSearchQuerySchema.safeParse(Object.fromEntries(searchParameters(params)));
  const valid =
    parsed.success &&
    parsed.data.view === 'groups' &&
    [...params.keys()].every(key => params.getAll(key).length === 1);
  useEffect(() => {
    rememberBrowse(url);
  }, [url]);

  return (
    <div className={stack}>
      <div>
        <p className={css({ textStyle: 'eyebrow', color: 'brand.default', mb: '2' })}>Benchmark</p>
        <h1 tabIndex={-1} className={css({ textStyle: 'h1' })}>
          Escape from Tarkov benchmarks
        </h1>
        <p className={muted}>
          Browse published runs by hardware and map. Every FPS value belongs to a specific capture.
        </p>
      </div>
      <Filters params={params} />
      <div className={css({ display: 'flex', flexWrap: 'wrap', gap: '4', alignItems: 'end' })}>
        <FilterDropdown
          label="Capture date"
          allowAny={false}
          value={params.get('sort') ?? 'captured_desc'}
          options={[
            { value: 'captured_desc', label: 'Newest first' },
            { value: 'captured_asc', label: 'Oldest first' },
          ]}
          onChange={value => {
            const next = resetPage(params);
            next.set('sort', value || 'captured_desc');
            void navigate(browseUrl(next));
          }}
        />
        <FilterDropdown
          label="Configurations per page"
          allowAny={false}
          value={params.get('limit') ?? '20'}
          options={[2, 10, 20, 50].map(value => ({ value: String(value), label: String(value) }))}
          onChange={value => {
            const next = resetPage(params);
            next.set('limit', value || '20');
            void navigate(browseUrl(next));
          }}
        />
      </div>
      {valid ? (
        <SearchResults params={params} />
      ) : (
        <p role="alert">These search parameters are invalid. Clear the filters to start again.</p>
      )}
    </div>
  );
}
